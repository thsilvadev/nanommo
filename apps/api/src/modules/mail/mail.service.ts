import { Injectable, BadRequestException, NotFoundException, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { DataSource, EntityManager, LessThan, MoreThan } from 'typeorm';
import { MailMessage } from '../../database/entities/mail-message.entity';
import { Character } from '../../database/entities/character.entity';
import { InventoryItem } from '../../database/entities/inventory-item.entity';
import { DataService } from '../data/data.service';
import { MAX_MARKET_ORDER_GOLD } from '@nanommo/shared';
import { validateAttachedGold } from '../market/market-contract';
import { BattleService } from '../battle/battle.service';

const MAIL_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CHARACTER_GOLD_CAP = 1_000_000_000_000;

@Injectable()
export class MailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  private expiryTimer: NodeJS.Timeout | null = null;
  private expiryInProgress = false;
  constructor(
    private readonly dataService: DataService,
    private readonly dataSource: DataSource,
    private readonly battleService: BattleService,
  ) {}

  onModuleInit(): void {
    // Startup recovery plus bounded periodic cleanup; the operation is retry-safe.
    const startupTimer = setTimeout(() => { void this.runExpirySafely(); }, 5000);
    (startupTimer as any).unref?.();
    this.expiryTimer = setInterval(() => { void this.runExpirySafely(); }, 60_000);
    (this.expiryTimer as any).unref?.();
  }
  onModuleDestroy(): void { if (this.expiryTimer) clearInterval(this.expiryTimer); this.expiryTimer = null; }
  private async runExpirySafely(): Promise<void> {
    if (this.expiryInProgress) return;
    this.expiryInProgress = true;
    try { await this.expireMail(); }
    catch (error) { this.logger.error('Mail expiry reconciliation failed', error instanceof Error ? error.stack : String(error)); }
    finally { this.expiryInProgress = false; }
  }

  private settledTown(character: Character): boolean {
    return this.dataService.getMapById(character.currentMapId)?.type === 'town' &&
      character.status === 'town' && character.pendingMapTransition == null && character.travelIntent == null;
  }

  private async assertTown(characterId: string, manager: EntityManager = this.dataSource.manager): Promise<Character> {
    const character = await manager.getRepository(Character).findOne({ where: { id: characterId }, lock: { mode: 'pessimistic_write' } });
    if (!character) throw new NotFoundException('Character not found');
    if (!this.settledTown(character)) throw new BadRequestException('Mailbox is only available while settled in Town');
    return character;
  }

  async getInbox(characterId: string): Promise<MailMessage[]> {
    return this.dataSource.transaction(async manager => {
      await this.assertTown(characterId, manager);
      return manager.getRepository(MailMessage).find({ where: { recipientCharacterId: characterId, recipientDeleted: false, expiresAt: MoreThan(new Date()) }, order: { createdAt: 'DESC' } });
    });
  }

  async getSent(characterId: string): Promise<MailMessage[]> {
    return this.dataSource.transaction(async manager => {
      await this.assertTown(characterId, manager);
      return manager.getRepository(MailMessage).find({ where: { senderCharacterId: characterId, senderDeleted: false, expiresAt: MoreThan(new Date()) }, order: { createdAt: 'DESC' } });
    });
  }

  async getUnreadCount(characterId: string): Promise<number> {
    return this.dataSource.transaction(async manager => {
      await this.assertTown(characterId, manager);
      return manager.getRepository(MailMessage).countBy({ recipientCharacterId: characterId, recipientDeleted: false, isRead: false });
    });
  }

  async getMail(characterId: string, mailId: string): Promise<MailMessage> {
    return this.dataSource.transaction(async manager => {
      await this.assertTown(characterId, manager);
      const mail = await manager.getRepository(MailMessage).findOne({ where: { id: mailId } });
      if (!mail || mail.expiresAt.getTime() <= Date.now() || (mail.recipientCharacterId !== characterId && mail.senderCharacterId !== characterId)) throw new NotFoundException('Mail not found');
      if (mail.recipientCharacterId === characterId) {
        if (mail.recipientDeleted) throw new NotFoundException('Mail not found');
        mail.isRead = true;
        await manager.getRepository(MailMessage).save(mail);
      } else if (mail.senderDeleted) throw new NotFoundException('Mail not found');
      return mail;
    });
  }

  async sendMail(senderId: string, recipientName: string, subject: string, body: string, attachedGold?: number, attachedItemId?: string, attachedItemQuantity?: number, idempotencyKey?: string, attachedInventoryItemId?: string): Promise<MailMessage> {
    return this.battleService.withCharacterQueueLock(senderId, () => this.dataSource.transaction(async manager => {
      const mailRepo = manager.getRepository(MailMessage);
      const sender = await manager.getRepository(Character).findOne({ where: { id: senderId }, lock: { mode: 'pessimistic_write' } });
      if (!sender) throw new NotFoundException('Sender character not found');
      if (!this.settledTown(sender)) throw new BadRequestException('Mail can only be sent while settled in Town');
      if (idempotencyKey) {
        const existing = await mailRepo.findOne({ where: { sourceKey: `player-send:${senderId}:${idempotencyKey}` } });
        if (existing) return existing;
      }
      if (typeof recipientName !== 'string' || !recipientName.trim()) throw new BadRequestException('Recipient name is required');
      if (typeof subject !== 'string' || !subject.trim() || subject.length > 120) throw new BadRequestException('Subject must contain 1-120 characters');
      if (typeof body !== 'string' || !body.trim() || body.length > 5000) throw new BadRequestException('Message body must contain 1-5000 characters');
      const recipient = await manager.getRepository(Character).findOne({ where: { name: recipientName.trim() } });
      if (!recipient) throw new NotFoundException('Recipient character not found');
      if (recipient.id === senderId) throw new BadRequestException('You cannot send mail to yourself');
      const gold = attachedGold === undefined || attachedGold === null ? 0 : Number(attachedGold);
      validateAttachedGold(gold);
      if (Number(sender.gold) < gold) throw new BadRequestException('Insufficient gold');
      const quantity = attachedItemId ? Number(attachedItemQuantity ?? 1) : 0;
      let itemRow: InventoryItem | null = null;
      let itemInstanceData: any;
      if (attachedItemId) {
        if (!Number.isSafeInteger(quantity) || quantity < 1) throw new BadRequestException('Invalid attachment quantity');
        const definition = this.dataService.getItemById(attachedItemId);
        if (!definition) throw new NotFoundException('Item definition not found');
        const rows = await manager.getRepository(InventoryItem).find({ where: { characterId: senderId, itemId: attachedItemId, location: 'inventory' }, order: { slotIndex: 'ASC' }, lock: { mode: 'pessimistic_write' } });
        const reserved = (sender.cookingSession?.ingredients ?? []).filter((row: any) => row.itemId === attachedItemId).reduce((sum: number, row: any) => sum + Number(row.quantity), 0);
        itemRow = attachedInventoryItemId ? rows.find(row => row.id === attachedInventoryItemId) ?? null : rows.find(row => row.quantity >= quantity) ?? null;
        if (!itemRow || itemRow.quantity < quantity) throw new BadRequestException('Selected attachment stack does not contain the requested quantity');
        if (rows.reduce((sum, row) => sum + Number(row.quantity), 0) - quantity < reserved) throw new BadRequestException('Items are reserved for your active Cooking session');
        if (!definition.stackable && quantity !== 1) throw new BadRequestException('Non-stackable items can only be attached one at a time');
        if (definition.stackable && quantity > Number(definition.maxStack ?? 1)) throw new BadRequestException('Attachment exceeds the item stack limit');
        itemInstanceData = itemRow.instanceData ?? null;
      }
      if (!gold && !itemRow) throw new BadRequestException('Attach gold or an item');
      sender.gold = Number(sender.gold) - gold;
      await manager.getRepository(Character).save(sender);
      if (itemRow) {
        itemRow.quantity -= quantity;
        if (itemRow.quantity === 0) await manager.getRepository(InventoryItem).remove(itemRow);
        else await manager.getRepository(InventoryItem).save(itemRow);
      }
      const mail = mailRepo.create({
        senderCharacterId: sender.id, senderName: sender.name, recipientCharacterId: recipient.id, recipientName: recipient.name,
        subject: subject.trim(), body: body.trim(), attachedGold: gold || null,
        itemId: itemRow?.itemId ?? null, itemInstanceData, quantity: itemRow ? quantity : null,
        createdAt: new Date(), expiresAt: new Date(Date.now() + MAIL_TTL_MS), collected: false, isRead: false,
        attachmentsCollected: false, senderDeleted: false, recipientDeleted: false,
        sourceKey: idempotencyKey ? `player-send:${senderId}:${idempotencyKey}` : null,
      } as any);
      return (await mailRepo.save(mail as any)) as unknown as MailMessage;
    }));
  }

  async markAsRead(characterId: string, mailId: string): Promise<void> {
    await this.dataSource.transaction(async manager => {
      await this.assertTown(characterId, manager);
      const result = await manager.getRepository(MailMessage).update({ id: mailId, recipientCharacterId: characterId, recipientDeleted: false }, { isRead: true });
      if (!result.affected) throw new NotFoundException('Inbox mail not found');
    });
  }

  async markAsUnread(characterId: string, mailId: string): Promise<void> {
    await this.dataSource.transaction(async manager => {
      await this.assertTown(characterId, manager);
      const result = await manager.getRepository(MailMessage).update({ id: mailId, recipientCharacterId: characterId, recipientDeleted: false }, { isRead: false });
      if (!result.affected) throw new NotFoundException('Inbox mail not found');
    });
  }

  async collectAttachments(characterId: string, mailId: string): Promise<void> {
    return this.battleService.withCharacterQueueLock(characterId, () => this.dataSource.transaction(async manager => {
      const characterRepo = manager.getRepository(Character);
      const character = await characterRepo.findOne({ where: { id: characterId }, lock: { mode: 'pessimistic_write' } });
      if (!character) throw new NotFoundException('Character not found');
      if (!this.settledTown(character)) throw new BadRequestException('Mail attachments can only be collected while settled in Town');
      const repo = manager.getRepository(MailMessage);
      const mail = await repo.findOne({ where: { id: mailId, recipientCharacterId: characterId, recipientDeleted: false }, lock: { mode: 'pessimistic_write' } });
      if (!mail) throw new NotFoundException('Mail not found');
      if (mail.expiresAt.getTime() <= Date.now()) throw new BadRequestException('Mail attachments have expired');
      if (mail.attachmentsCollected) throw new BadRequestException('Mail attachments have already been collected');
      const gold = Number(mail.attachedGold ?? 0);
      if (!Number.isSafeInteger(gold) || gold < 0 || Number(character.gold) + gold > CHARACTER_GOLD_CAP) throw new BadRequestException('Collecting this gold would exceed your gold limit');
      const inventoryRepo = manager.getRepository(InventoryItem);
      let placements: Array<{ row?: InventoryItem; quantity: number }> = [];
      if (mail.itemId && Number(mail.quantity) > 0) {
        const definition = this.dataService.getItemById(mail.itemId);
        if (!definition) throw new BadRequestException('Attached item definition no longer exists');
        const quantity = Number(mail.quantity);
        const rows = await inventoryRepo.find({ where: { characterId, location: 'inventory' }, order: { slotIndex: 'ASC' }, lock: { mode: 'pessimistic_write' } });
        const compatible = rows.filter(row => row.itemId === mail.itemId && JSON.stringify(row.instanceData ?? null) === JSON.stringify(mail.itemInstanceData ?? null));
        let remaining = quantity;
        if (definition.stackable) {
          const maxStack = Number(definition.maxStack ?? 1);
          for (const row of compatible) {
            const add = Math.min(remaining, Math.max(0, maxStack - Number(row.quantity)));
            if (add > 0) { placements.push({ row, quantity: add }); remaining -= add; }
            if (remaining <= 0) break;
          }
        }
        const occupied = new Set(rows.map(row => Number(row.slotIndex)));
        while (remaining > 0) {
          const slot = Array.from({ length: 50 }, (_, i) => i).find(i => !occupied.has(i));
          if (slot === undefined) throw new BadRequestException('Not enough inventory space to collect all attachments');
          occupied.add(slot);
          const add = definition.stackable ? Math.min(remaining, Number(definition.maxStack ?? 1)) : 1;
          placements.push({ quantity: add });
          remaining -= add;
        }
        // Preserve the free slot (or merge room) reserved for an active Cooking output.
        if (character.cookingSession) {
          const projected = rows.map(row => ({ id: row.id, itemId: row.itemId, quantity: Number(row.quantity) }));
          for (const placement of placements) {
            if (placement.row) {
              const projectedRow = projected.find(row => row.id === placement.row!.id);
              if (projectedRow) projectedRow.quantity += placement.quantity;
            } else projected.push({ id: '', itemId: mail.itemId!, quantity: placement.quantity });
          }
          const output = this.dataService.getItemById(character.cookingSession.outputItemId);
          const outputCanMerge = !!output?.stackable && projected.some(row => row.itemId === output.id && row.quantity < Number(output.maxStack ?? 1));
          if (!outputCanMerge && projected.length >= 50) throw new BadRequestException('Inventory space is reserved for your active Cooking session');
        }
        // All capacity is checked before any gold or item is transferred.
        for (const placement of placements) {
          if (placement.row) { placement.row.quantity += placement.quantity; await inventoryRepo.save(placement.row); }
          else {
            const occupied = await inventoryRepo.find({ where: { characterId, location: 'inventory' } });
            const used = new Set(occupied.map(row => Number(row.slotIndex)));
            // Pick a free slot again after earlier inserts.
            const slotIndex = Array.from({ length: 50 }, (_, i) => i).find(i => !used.has(i));
            if (slotIndex === undefined) throw new BadRequestException('Not enough inventory space to collect all attachments');
            await inventoryRepo.save(inventoryRepo.create({ characterId, location: 'inventory', slotIndex, itemId: mail.itemId!, quantity: placement.quantity, instanceData: mail.itemInstanceData ?? null }));
          }
        }
      }
      character.gold = Number(character.gold) + gold;
      await characterRepo.save(character);
      mail.attachmentsCollected = true;
      mail.collected = true;
      await repo.save(mail);
    }));
  }

  async deleteMail(characterId: string, mailId: string): Promise<void> {
    await this.dataSource.transaction(async manager => {
      await this.assertTown(characterId, manager);
      const repo = manager.getRepository(MailMessage);
      const mail = await repo.findOne({ where: { id: mailId }, lock: { mode: 'pessimistic_write' } });
      if (!mail || (mail.senderCharacterId !== characterId && mail.recipientCharacterId !== characterId)) throw new NotFoundException('Mail not found');
      if (mail.senderCharacterId === characterId) {
        mail.senderDeleted = true;
      } else {
        if (!mail.attachmentsCollected && (mail.itemId || Number(mail.attachedGold ?? 0) > 0) && mail.expiresAt.getTime() > Date.now()) throw new BadRequestException('Collect attachments before deleting this mail');
        mail.recipientDeleted = true;
      }
      await repo.save(mail);
    });
  }

  async expireMail(): Promise<number> {
    return this.dataSource.transaction(async manager => {
      const repo = manager.getRepository(MailMessage);
      const now = new Date();
      const expired = await repo.find({ where: { expiresAt: LessThan(now), attachmentsCollected: false },
        take: 200, order: { expiresAt: 'ASC' }, lock: { mode: 'pessimistic_write', onLocked: 'skip_locked' } as any });
      for (const mail of expired) {
        mail.itemId = null; mail.itemInstanceData = null; mail.quantity = null; mail.attachedGold = null;
        mail.attachmentsCollected = true; mail.collected = true;
        // Keep the expired row as a source-key tombstone so an old idempotency key can never recreate assets.
        await repo.save(mail);
      }
      return expired.length;
    });
  }

  async sendSystemMail(recipientId: string, subject: string, body = '', attachedGold?: number, attachment?: { itemId: string; quantity: number; itemInstanceData?: any; sourceKey?: string }, manager?: EntityManager, sourceKey?: string): Promise<MailMessage> {
    const create = async (tx: EntityManager) => {
      const repo = tx.getRepository(MailMessage);
      const key = sourceKey ?? attachment?.sourceKey;
      if (key) {
        const existing = await repo.findOne({ where: { sourceKey: key } });
        if (existing) return existing;
      }
      const recipient = await tx.getRepository(Character).findOne({ where: { id: recipientId } });
      if (!recipient) throw new NotFoundException('Recipient character not found');
      const gold = attachedGold === undefined ? null : Number(attachedGold);
      if (gold !== null) validateAttachedGold(gold);
      return (await repo.save(repo.create({
        senderCharacterId: null, senderName: 'Auction House', recipientCharacterId: recipient.id, recipientName: recipient.name,
        subject, body, attachedGold: gold || null, itemId: attachment?.itemId ?? null,
        quantity: attachment?.quantity ?? null, itemInstanceData: attachment?.itemInstanceData ?? null,
        createdAt: new Date(), expiresAt: new Date(Date.now() + MAIL_TTL_MS), collected: false,
        isRead: false, attachmentsCollected: false, senderDeleted: false, recipientDeleted: false, sourceKey: key ?? null,
      } as any))) as unknown as MailMessage;
    };
    return manager ? create(manager) : this.dataSource.transaction(create);
  }

  async searchMail(characterId: string, query: string): Promise<MailMessage[]> {
    return this.dataSource.transaction(async manager => {
      await this.assertTown(characterId, manager);
      const q = String(query ?? '').trim();
      if (!q) return [];
      return manager.getRepository(MailMessage).createQueryBuilder('mail')
        .where('((mail."recipientCharacterId" = :characterId AND mail."recipientDeleted" = false) OR (mail."senderCharacterId" = :characterId AND mail."senderDeleted" = false))', { characterId })
        .andWhere('mail."expiresAt" > :now', { now: new Date() })
        .andWhere('(mail.subject ILIKE :q OR mail.body ILIKE :q OR mail."senderName" ILIKE :q OR mail."recipientName" ILIKE :q)', { q: `%${q.replace(/[%_\\]/g, '\\$&')}%` })
        .orderBy('mail."createdAt"', 'DESC').take(50).getMany();
    });
  }
}
