import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { EntityManager, Repository } from 'typeorm';
import { Character } from '../../database/entities/character.entity';
import { InventoryItem } from '../../database/entities/inventory-item.entity';
import { QuestInstance } from '../../database/entities/quest-instance.entity';
import { DataService } from '../data/data.service';
import { gatheringLevelForXp } from '@nanommo/shared';

const INVENTORY_SLOTS = 50;
const GOLD_CAP = 999_999_999;

@Injectable()
export class QuestService {
  private readonly activeQuestLimit: number;
  constructor(
    @InjectRepository(Character) private readonly characters: Repository<Character>,
    @InjectRepository(InventoryItem) private readonly inventory: Repository<InventoryItem>,
    @InjectRepository(QuestInstance) private readonly instances: Repository<QuestInstance>,
    private readonly data: DataService,
    config: ConfigService,
  ) {
    const raw = config.get<string>('QUEST_ACTIVE_LIMIT');
    const value = raw === undefined || raw === '' ? 5 : Number(raw);
    if ((raw !== undefined && raw !== '' && !/^\d+$/.test(raw)) || !Number.isSafeInteger(value) || value < 1) throw new Error('QUEST_ACTIVE_LIMIT must be a positive integer');
    this.activeQuestLimit = value;
  }

  private definitions(): any[] { const rows = this.data.getQuests()?.quests; if (!Array.isArray(rows)) throw new NotFoundException('Quest catalogue unavailable'); return rows; }
  private definition(id: string): any { const row = this.definitions().find(q => q.id === id); if (!row) throw new NotFoundException('Quest not found'); return row; }
  isQuestOnlyItem(itemId: string): boolean { return this.data.getItemById(itemId)?.questOnly === true; }
  isQuestRewardInstance(instanceData: any): boolean { return instanceData?.questReward?.marketTradable === false && typeof instanceData?.questReward?.questId === 'string'; }
  private async characterAtTown(manager: EntityManager, characterId: string, npcId?: string): Promise<Character> {
    const repo = manager.getRepository(Character);
    const character = await repo.findOne({ where: { id: characterId }, lock: { mode: 'pessimistic_write' } });
    if (!character) throw new NotFoundException('Character not found');
    const map: any = this.data.getMapById(character.currentMapId);
    if (map?.type !== 'town' || character.status !== 'town' || character.pendingMapTransition != null || character.travelIntent != null) throw new BadRequestException('Quest NPC interactions are only available while settled in Town');
    if (npcId && !(map.npcIds ?? []).includes(npcId)) throw new BadRequestException('That NPC is not present in this Town');
    return character;
  }
  private activeRows(characterId: string, manager?: EntityManager) { return (manager?.getRepository(QuestInstance) ?? this.instances).find({ where: { characterId, status: 'active' } }); }
  private async removeOwnedQuestItems(manager: EntityManager, instance: QuestInstance): Promise<void> {
    const repo = manager.getRepository(InventoryItem);
    const rows = await repo.find({ where: { characterId: instance.characterId } });
    for (const row of rows) if (row.instanceData?.questInstanceId === instance.id && this.isQuestOnlyItem(row.itemId)) await repo.remove(row);
  }
  private async expire(manager: EntityManager, characterId: string, now = Date.now()): Promise<void> {
    const repo = manager.getRepository(QuestInstance);
    const rows = await repo.find({ where: { characterId, status: 'active' }, lock: { mode: 'pessimistic_write' } });
    for (const row of rows) if (row.expiresAt && row.expiresAt.getTime() <= now) { row.status = 'expired'; await repo.save(row); await this.removeOwnedQuestItems(manager, row); }
  }
  private async eligible(character: Character, quest: any, manager: EntityManager): Promise<boolean> {
    if (Number(character.level) < Number(quest.minLevel ?? 1)) return false;
    const rows = await manager.getRepository(QuestInstance).find({ where: { characterId: character.id } });
    const completed = new Set(rows.filter(r => r.status === 'completed').map(r => r.questId));
    if ((quest.requiresCompletedQuestIds ?? []).some((id: string) => !completed.has(id))) return false;
    if (rows.some(r => r.questId === quest.id && r.status === 'active')) return false;
    const completedThis = rows.some(r => r.questId === quest.id && r.status === 'completed');
    if (completedThis && quest.repeatable !== true) return false;
    const abandoned = rows.some(r => r.questId === quest.id && r.status === 'abandoned');
    if (abandoned && quest.allowReacceptAfterAbandon !== true) return false;
    return true;
  }
  async getAvailable(characterId: string, npcId?: string): Promise<any[]> {
    await this.withExpiry(characterId);
    const character = await this.characters.findOne({ where: { id: characterId } }); if (!character) throw new NotFoundException('Character not found');
    const rows = await this.instances.find({ where: { characterId } });
    const completed = new Set(rows.filter(r => r.status === 'completed').map(r => r.questId));
    const out: any[] = [];
    for (const quest of this.definitions()) {
      if (npcId && quest.giverNpcId !== npcId) continue;
      if (Number(character.level) < Number(quest.minLevel ?? 1) || (quest.requiresCompletedQuestIds ?? []).some((id: string) => !completed.has(id))) continue;
      if (rows.some(r => r.questId === quest.id && r.status === 'active')) continue;
      if (rows.some(r => r.questId === quest.id && r.status === 'completed') && !quest.repeatable) continue;
      if (rows.some(r => r.questId === quest.id && r.status === 'abandoned') && !quest.allowReacceptAfterAbandon) continue;
      out.push({ id: quest.id, title: quest.title, titleLocales: quest.titleLocales ?? null, description: quest.description, descriptionLocales: quest.descriptionLocales ?? null, giverNpcId: quest.giverNpcId, turnInNpcId: quest.turnInNpcId, minLevel: quest.minLevel, rewards: quest.rewards });
    }
    return out;
  }
  private async objectiveReadyForNpc(manager: EntityManager, instance: QuestInstance, quest: any): Promise<boolean> {
    const repo = manager.getRepository(InventoryItem);
    const inventory = await repo.find({ where: { characterId: instance.characterId, location: 'inventory' } });
    const count = (itemId: string) => inventory.filter(row => row.itemId === itemId).reduce((sum, row) => sum + Number(row.quantity), 0);
    return quest.objectives.every((objective: any) => {
      if (objective.type === 'deliver_items') return (objective.items ?? []).every((required: any) => count(required.itemId) >= Number(required.quantity));
      return Number(instance.progress?.[objective.id] ?? 0) >= Number(objective.quantity ?? 1);
    });
  }

  private offerInteraction(quest: any, stepIndex: number, nodeId?: string): any {
    const titleFields = { titleLocales: quest.titleLocales, descriptionLocales: quest.descriptionLocales };
    if (quest.offerGraph?.nodes) {
      const id = nodeId ?? quest.offerGraph.entryNodeId;
      const node = quest.offerGraph.nodes[id];
      if (!node) throw new BadRequestException('Quest offer dialogue state is invalid');
      return { kind: 'offer', questId: quest.id, title: quest.title, ...titleFields, nodeId: id,
        npcText: node.npcText, npcTextLocales: node.npcTextLocales,
        choices: (node.choices ?? []).map((choice: any) => ({ id: choice.id, text: choice.text, textLocales: choice.textLocales })),
        action: 'advance' };
    }
    const step = quest.offerDialogue[stepIndex];
    return { kind: 'offer', questId: quest.id, title: quest.title, ...titleFields, stepIndex, totalSteps: quest.offerDialogue.length,
      npcText: step.npcText, npcTextLocales: step.npcTextLocales, buttonText: step.buttonText, buttonTextLocales: step.buttonTextLocales, action: 'advance' };
  }

  private async activeInteraction(manager: EntityManager, instance: QuestInstance, quest: any, npcId: string): Promise<any> {
    const dialogue = quest.activeDialogue ?? {};
    const ready = npcId === quest.turnInNpcId && await this.objectiveReadyForNpc(manager, instance, quest);
    const action = ready ? 'turn_in' : 'close';
    return { kind: 'active', questId: quest.id, instanceId: instance.id, title: quest.title, titleLocales: quest.titleLocales,
      npcText: dialogue.npcText ?? quest.description, npcTextLocales: dialogue.npcTextLocales ?? quest.descriptionLocales,
      buttonText: ready ? (dialogue.handleItemsButtonText ?? dialogue.readyButtonText ?? '[Continue]') : (dialogue.waitButtonText ?? "I'll be back"),
      buttonTextLocales: ready ? (dialogue.handleItemsButtonTextLocales ?? dialogue.readyButtonTextLocales) : dialogue.waitButtonTextLocales, action };
  }

  async getNpcInteraction(characterId: string, npcId: string): Promise<any | null> {
    await this.withExpiry(characterId);
    return this.instances.manager.transaction(async manager => {
      const character = await this.characterAtTown(manager, characterId, npcId);
      await this.expire(manager, characterId);
      const instanceRepo = manager.getRepository(QuestInstance);
      const rows = await instanceRepo.find({ where: { characterId } });
      const npc = (this.data.getNpcCatalog()?.npcs ?? []).find((entry: any) => entry.id === npcId);
      const hasDialogue = Array.isArray(npc?.types) && npc.types.includes('dialogue');
      const activeRows = rows.filter(row => row.status === 'active');
      const activeCandidates = activeRows.map(row => ({ row, quest: this.definitions().find(quest => quest.id === row.questId) }))
        .filter((entry: any) => entry.quest && (entry.quest.giverNpcId === npcId || entry.quest.turnInNpcId === npcId));
      if (activeCandidates.length) {
        const candidates = await Promise.all(activeCandidates.map(async (entry: any) => ({ ...entry, ready: npcId === entry.quest.turnInNpcId && await this.objectiveReadyForNpc(manager, entry.row, entry.quest) })));
        candidates.sort((a: any, b: any) => Number(b.ready) - Number(a.ready) || new Date(a.row.acceptedAt).getTime() - new Date(b.row.acceptedAt).getTime());
        if (candidates.length === 1 && !hasDialogue) return this.activeInteraction(manager, candidates[0].row, candidates[0].quest, npcId);
        const actions: any[] = [];
        if (hasDialogue) actions.push({ type: 'dialogue', title: 'Talk', titleLocales: { 'pt-BR': 'Conversar', 'en-US': 'Talk' }, buttonText: 'Talk', buttonTextLocales: { 'pt-BR': 'Conversar', 'en-US': 'Talk' } });
        for (const candidate of candidates) {
          const interaction = await this.activeInteraction(manager, candidate.row, candidate.quest, npcId);
          actions.push({ type: 'active', questId: candidate.quest.id, instanceId: candidate.row.id, title: candidate.quest.title, titleLocales: candidate.quest.titleLocales ?? null,
            buttonText: `${interaction.action === 'turn_in' ? '[Handle items]' : 'Continue'} · ${candidate.quest.title}`,
            buttonTextLocales: { 'pt-BR': `${interaction.action === 'turn_in' ? '[Entregar itens]' : 'Continuar'} · ${candidate.quest.titleLocales?.['pt-BR'] ?? candidate.quest.title}`, 'en-US': `${interaction.action === 'turn_in' ? '[Handle items]' : 'Continue'} · ${candidate.quest.titleLocales?.['en-US'] ?? candidate.quest.title}` }, interaction });
        }
        return { kind: 'select', npcId, npcText: 'What would you like to do?', npcTextLocales: { 'pt-BR': 'O que você gostaria de fazer?', 'en-US': 'What would you like to do?' }, actions };
      }

      const available: any[] = [];
      for (const quest of this.definitions()) {
        if (quest.giverNpcId === npcId && await this.eligible(character, quest, manager)) available.push(quest);
      }
      if (!available.length) return null;
      if (available.length > 1 || hasDialogue) {
        const actions: any[] = [];
        if (hasDialogue) actions.push({ type: 'dialogue', title: 'Talk', titleLocales: { 'pt-BR': 'Conversar', 'en-US': 'Talk' }, buttonText: 'Talk', buttonTextLocales: { 'pt-BR': 'Conversar', 'en-US': 'Talk' } });
        actions.push(...available.map(quest => ({ type: 'offer', questId: quest.id, title: quest.title, titleLocales: quest.titleLocales ?? null, buttonText: quest.title, buttonTextLocales: quest.titleLocales ?? null })));
        return { kind: 'select', npcId, npcText: 'What can I help you with, darling?', npcTextLocales: { 'pt-BR': 'Como posso ajudar?', 'en-US': 'What can I help you with, darling?' }, actions };
      }

      const quest = available[0];
      const sessions = { ...(character.questOfferProgress ?? {}) };
      if (!sessions[quest.id]) sessions[quest.id] = { stepIndex: 0, nodeId: quest.offerGraph?.entryNodeId, startedAt: new Date().toISOString() };
      const index = Math.max(0, Math.min(quest.offerDialogue.length - 1, Number(sessions[quest.id].stepIndex ?? 0)));
      character.questOfferProgress = sessions;
      await manager.getRepository(Character).save(character);
      return this.offerInteraction(quest, index, sessions[quest.id].nodeId);
    });
  }

  async getState(characterId: string): Promise<any> {
    await this.withExpiry(characterId);
    const character = await this.characters.findOne({ where: { id: characterId } }); if (!character) throw new NotFoundException('Character not found');
    const [rows, inventory] = await Promise.all([this.instances.find({ where: { characterId }, order: { acceptedAt: 'DESC' } }), this.inventory.find({ where: { characterId, location: 'inventory' } })]);
    const count = (itemId: string) => inventory.filter(x => x.itemId === itemId).reduce((sum, x) => sum + Number(x.quantity), 0);
    const questView = (row: QuestInstance) => {
      const quest = this.definition(row.questId);
      const objectives = row.status === 'active' ? quest.objectives.map((objective: any) => {
        let progress = Math.max(0, Number(row.progress?.[objective.id] ?? 0));
        let required = Number(objective.quantity ?? 1);
        if (objective.type === 'deliver_items') {
          progress = Math.min(...objective.items.map((req: any) => count(req.itemId) / Number(req.quantity)));
          progress = Number.isFinite(progress) ? Math.floor(progress * required) : 0;
          required = 1;
        }
        const requirements = objective.type === 'deliver_items' ? objective.items.map((req: any) => ({ ...req, owned: count(req.itemId) })) : undefined;
        return { id: objective.id, type: objective.type, npcId: objective.npcId, description: objective.description, descriptionLocales: objective.descriptionLocales ?? null, progress: Math.min(required, progress), required, completed: objective.type === 'deliver_items' ? objective.items.every((req: any) => count(req.itemId) >= Number(req.quantity)) : progress >= required, items: requirements };
      }) : [];
      const map: any = this.data.getMapById(character.currentMapId);
      const objectivesReady = objectives.length === quest.objectives.length && objectives.every((objective: any) => objective.completed);
      const canTurnIn = row.status === 'active' && objectivesReady && !!quest.turnInNpcId && map?.type === 'town' && (map.npcIds ?? []).includes(quest.turnInNpcId) && character.status === 'town' && !character.travelIntent && !character.pendingMapTransition;
      return { id: row.id, questId: quest.id, title: quest.title, titleLocales: quest.titleLocales ?? null, description: quest.description, descriptionLocales: quest.descriptionLocales ?? null, giverNpcId: quest.giverNpcId, giverNpcName: this.npcName(quest.giverNpcId), giverNpcNameLocales: (this.data.getNpcCatalog()?.npcs ?? []).find((n:any)=>n.id===quest.giverNpcId)?.locales ? Object.fromEntries(Object.entries((this.data.getNpcCatalog()?.npcs ?? []).find((n:any)=>n.id===quest.giverNpcId).locales).map(([locale,values]:any)=>[locale,values.name])) : null, turnInNpcId: quest.turnInNpcId, turnInNpcName: this.npcName(quest.turnInNpcId), turnInNpcNameLocales: (this.data.getNpcCatalog()?.npcs ?? []).find((n:any)=>n.id===quest.turnInNpcId)?.locales ? Object.fromEntries(Object.entries((this.data.getNpcCatalog()?.npcs ?? []).find((n:any)=>n.id===quest.turnInNpcId).locales).map(([locale,values]:any)=>[locale,values.name])) : null, status: row.status, acceptedAt: row.acceptedAt, expiresAt: row.expiresAt ?? null, completedAt: row.completedAt ?? null, objectives, rewards: quest.rewards, canTurnIn };
    };
    return { active: rows.filter(r => r.status === 'active').map(questView), completed: rows.filter(r => r.status === 'completed').map(r => ({ id: r.id, questId: r.questId, title: this.definition(r.questId).title, titleLocales: this.definition(r.questId).titleLocales ?? null, giverNpcName: this.npcName(this.definition(r.questId).giverNpcId), giverNpcNameLocales: (this.data.getNpcCatalog()?.npcs ?? []).find((n:any)=>n.id===this.definition(r.questId).giverNpcId)?.locales ? Object.fromEntries(Object.entries((this.data.getNpcCatalog()?.npcs ?? []).find((n:any)=>n.id===this.definition(r.questId).giverNpcId).locales).map(([locale,values]:any)=>[locale,values.name])) : null, status: 'completed' })), available: await this.getAvailable(characterId) };
  }
  private npcName(id: string): string { const row = (this.data.getNpcCatalog()?.npcs ?? []).find((n: any) => n.id === id); const vendor = this.data.getNpcVendor(); return row?.name ?? (vendor?.id === id ? vendor.name : id); }
  private async withExpiry(characterId: string): Promise<void> { await this.instances.manager.transaction(async manager => this.expire(manager, characterId)); }

  async getOffer(characterId: string, questId: string): Promise<any> {
    await this.withExpiry(characterId);
    const quest = this.definition(questId);
    return this.characters.manager.transaction(async manager => {
      const character = await this.characterAtTown(manager, characterId, quest.giverNpcId);
      await this.expire(manager, characterId);
      if (!await this.eligible(character, quest, manager)) throw new BadRequestException('Quest is not currently available');
      const sessions = { ...(character.questOfferProgress ?? {}) };
      if (!sessions[questId]) sessions[questId] = { stepIndex: 0, nodeId: quest.offerGraph?.entryNodeId, startedAt: new Date().toISOString() };
      character.questOfferProgress = sessions; await manager.getRepository(Character).save(character);
      const stepIndex = Math.max(0, Math.min(quest.offerDialogue.length - 1, Number(sessions[questId].stepIndex ?? 0)));
      return this.offerInteraction(quest, stepIndex, sessions[questId].nodeId);
    });
  }

  async advanceOffer(characterId: string, questId: string, choiceId?: string): Promise<any> {
    await this.withExpiry(characterId);
    const quest = this.definition(questId);
    return this.characters.manager.transaction(async manager => {
      const character = await this.characterAtTown(manager, characterId, quest.giverNpcId);
      await this.expire(manager, characterId);
      if (!await this.eligible(character, quest, manager)) throw new BadRequestException('Quest is not currently available');
      const sessions = { ...(character.questOfferProgress ?? {}) };
      const session = sessions[questId]; if (!session) throw new BadRequestException('Start the quest dialogue first');
      if (quest.offerGraph?.nodes) {
        const nodeId = String(session.nodeId ?? quest.offerGraph.entryNodeId);
        const node = quest.offerGraph.nodes[nodeId];
        if (!node) throw new BadRequestException('Quest offer dialogue state is invalid');
        if (!choiceId) throw new BadRequestException('A dialogue choice is required');
        const choice = (node.choices ?? []).find((row: any) => row.id === choiceId);
        if (!choice) throw new BadRequestException('Invalid quest dialogue choice');
        if (choice.close === true) {
          delete sessions[questId]; character.questOfferProgress = sessions; await manager.getRepository(Character).save(character);
          return { accepted: false, closed: true, interaction: null };
        }
        if (choice.acceptsQuest === true) {
          const active = await manager.getRepository(QuestInstance).find({ where: { characterId, status: 'active' }, lock: { mode: 'pessimistic_write' } });
          if (active.length >= this.activeQuestLimit) throw new BadRequestException('You can have at most ' + this.activeQuestLimit + ' active quests');
          const acceptedAt = new Date();
          const instance = manager.getRepository(QuestInstance).create({ characterId, questId, status: 'active', progress: {}, acceptedAt, expiresAt: quest.timeLimitSeconds ? new Date(acceptedAt.getTime() + Number(quest.timeLimitSeconds) * 1000) : null, completedAt: null });
          const saved = await manager.getRepository(QuestInstance).save(instance);
          delete sessions[questId]; character.questOfferProgress = sessions; await manager.getRepository(Character).save(character);
          return { accepted: true, instanceId: saved.id, questId, title: quest.title, titleLocales: quest.titleLocales,
            interaction: await this.activeInteraction(manager, saved, quest, quest.giverNpcId) };
        }
        if (!choice.nextNodeId || !quest.offerGraph.nodes[choice.nextNodeId]) throw new BadRequestException('Quest dialogue branch has no valid destination');
        sessions[questId] = { ...session, nodeId: choice.nextNodeId };
        character.questOfferProgress = sessions; await manager.getRepository(Character).save(character);
        return { accepted: false, ...this.offerInteraction(quest, 0, choice.nextNodeId) };
      }
      const index = Math.max(0, Math.floor(Number(session.stepIndex ?? 0)));
      const current = quest.offerDialogue[index]; if (!current) throw new BadRequestException('Quest dialogue state is invalid');
      if (current.acceptsQuest === true) {
        const active = await manager.getRepository(QuestInstance).find({ where: { characterId, status: 'active' }, lock: { mode: 'pessimistic_write' } });
        if (active.length >= this.activeQuestLimit) throw new BadRequestException(`You can have at most ${this.activeQuestLimit} active quests`);
        const acceptedAt = new Date();
        const instance = manager.getRepository(QuestInstance).create({ characterId, questId, status: 'active', progress: {}, acceptedAt, expiresAt: quest.timeLimitSeconds ? new Date(acceptedAt.getTime() + Number(quest.timeLimitSeconds) * 1000) : null, completedAt: null });
        const saved = await manager.getRepository(QuestInstance).save(instance);
        delete sessions[questId]; character.questOfferProgress = sessions; await manager.getRepository(Character).save(character);
        return { accepted: true, instanceId: saved.id, questId, title: quest.title,
          interaction: await this.activeInteraction(manager, saved, quest, quest.giverNpcId) };
      }
      const next = Math.min(quest.offerDialogue.length - 1, index + 1);
      sessions[questId] = { ...session, stepIndex: next }; character.questOfferProgress = sessions; await manager.getRepository(Character).save(character);
      return { accepted: false, ...this.offerInteraction(quest, next) };
    });
  }

  async completeNpcAction(characterId: string, instanceId: string, npcId: string, objectiveId: string): Promise<any> {
    await this.withExpiry(characterId);
    return this.instances.manager.transaction(async manager => {
      const character = await this.characterAtTown(manager, characterId, npcId);
      await this.expire(manager, characterId);
      const row = await manager.getRepository(QuestInstance).findOne({ where: { id: instanceId, characterId }, lock: { mode: 'pessimistic_write' } });
      if (!row || row.status !== 'active') throw new BadRequestException('Active quest not found');
      const quest = this.definition(row.questId);
      if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) throw new BadRequestException('Quest has expired');
      const objective = quest.objectives.find((entry: any) => entry.id === objectiveId && entry.type === 'npc_action' && entry.npcId === npcId);
      if (!objective) throw new BadRequestException('This NPC action does not match an active quest objective');
      const previous = Math.max(0, Number(row.progress?.[objectiveId] ?? 0));
      if (previous >= Number(objective.quantity ?? 1)) throw new BadRequestException('Quest objective is already complete');
      row.progress = { ...(row.progress ?? {}), [objectiveId]: previous + 1 };
      await manager.getRepository(QuestInstance).save(row);
      return { completed: true, questId: quest.id, objectiveId, progress: row.progress[objectiveId], required: Number(objective.quantity ?? 1), characterId: character.id };
    });
  }

  async abandon(characterId: string, instanceId: string): Promise<void> {
    await this.withExpiry(characterId);
    await this.instances.manager.transaction(async manager => {
      const character = await manager.getRepository(Character).findOne({ where: { id: characterId }, lock: { mode: 'pessimistic_write' } }); if (!character) throw new NotFoundException('Character not found');
      const row = await manager.getRepository(QuestInstance).findOne({ where: { id: instanceId, characterId }, lock: { mode: 'pessimistic_write' } });
      if (!row || row.status !== 'active') throw new BadRequestException('Active quest not found');
      await this.expire(manager, characterId);
      const fresh = await manager.getRepository(QuestInstance).findOne({ where: { id: instanceId, characterId }, lock: { mode: 'pessimistic_write' } });
      if (!fresh || fresh.status !== 'active') throw new BadRequestException('Quest is no longer active');
      fresh.status = 'abandoned'; await manager.getRepository(QuestInstance).save(fresh); await this.removeOwnedQuestItems(manager, fresh);
    });
  }

  private deliveryRequirements(quest: any): any[] {
    const deliveries = quest.objectives.filter((x: any) => x.type === 'deliver_items').flatMap((x: any) => x.items ?? []);
    const questDrops = quest.objectives.filter((x: any) => x.type === 'monster_drop' && x.itemId)
      .map((x: any) => ({ itemId: x.itemId, quantity: Math.max(1, Number(x.quantity ?? 1)) * Math.max(1, Number(x.itemQuantity ?? 1)) }));
    return [...deliveries, ...questDrops];
  }
  private async consumeRequirements(manager: EntityManager, characterId: string, instanceId: string, requirements: any[]): Promise<void> {
    const repo = manager.getRepository(InventoryItem);
    for (const req of requirements) {
      let remaining = Number(req.quantity);
      const rows = await repo.find({ where: { characterId, itemId: req.itemId, location: 'inventory' }, order: { slotIndex: 'ASC' }, lock: { mode: 'pessimistic_write' } });
      const def = this.data.getItemById(req.itemId);
      const eligible = rows.filter(row => !def?.questOnly || row.instanceData?.questInstanceId === instanceId);
      if (eligible.reduce((sum, row) => sum + Number(row.quantity), 0) < remaining) throw new BadRequestException(`Missing required item: ${def?.name ?? req.itemId}`);
      for (const row of eligible) { const take = Math.min(remaining, Number(row.quantity)); row.quantity -= take; remaining -= take; if (row.quantity === 0) await repo.remove(row); else await repo.save(row); if (!remaining) break; }
    }
  }
  private rewardInstances(quest: any, instanceId: string): Array<{ itemId: string; quantity: number; instanceData: any }> {
    const out: Array<{ itemId: string; quantity: number; instanceData: any }> = [];
    for (const reward of quest.rewards?.items ?? []) {
      const def = this.data.getItemById(reward.itemId); if (!def) throw new BadRequestException(`Unknown reward item ${reward.itemId}`);
      if (def.type === 'equipment') {
        if (Number(reward.quantity) !== 1) throw new BadRequestException('Equipment rewards must be granted one instance at a time');
        const random = reward.disableRandomRoll !== true && def.randomRollOnDrop?.enabled ? createHash('sha256').update(`${instanceId}:${reward.itemId}:reward`).digest() : null;
        let instanceData: any = { questReward: { questId: quest.id, marketTradable: false } };
        if (random) { const pool: string[] = def.randomRollOnDrop.attributesPool ?? []; if (pool.length) { instanceData.rolledAttribute = pool[random.readUInt32BE(0) % pool.length]; instanceData.rolledValue = Number(def.randomRollOnDrop.min ?? 1) + random.readUInt32BE(4) % (Number(def.randomRollOnDrop.max ?? 1) - Number(def.randomRollOnDrop.min ?? 1) + 1); } }
        out.push({ itemId: reward.itemId, quantity: 1, instanceData });
      } else out.push({ itemId: reward.itemId, quantity: Number(reward.quantity), instanceData: def.questOnly ? { questInstanceId: instanceId } : null });
    }
    return out;
  }
  private async rowsAfterDelivery(manager: EntityManager, characterId: string, instanceId: string, requirements: any[]): Promise<any[]> {
    const rows = await manager.getRepository(InventoryItem).find({ where: { characterId, location: 'inventory' }, lock: { mode: 'pessimistic_write' } });
    const copy = rows.map(r => ({ itemId: r.itemId, quantity: Number(r.quantity), instanceData: r.instanceData ?? null }));
    for (const req of requirements) {
      let remaining = Number(req.quantity); const def = this.data.getItemById(req.itemId);
      for (const row of copy.filter(r => r.itemId === req.itemId && (!def?.questOnly || r.instanceData?.questInstanceId === instanceId))) { const n = Math.min(remaining, row.quantity); row.quantity -= n; remaining -= n; if (!remaining) break; }
    }
    return copy.filter(r => r.quantity > 0);
  }
  private canFitRewards(rows: any[], rewards: Array<{ itemId: string; quantity: number; instanceData: any }>): boolean {
    const projected = rows.map(r => ({ ...r }));
    for (const reward of rewards) {
      const def = this.data.getItemById(reward.itemId); if (!def) return false;
      let remaining = reward.quantity;
      if (def.stackable) for (const row of projected.filter(r => r.itemId === reward.itemId && JSON.stringify(r.instanceData ?? null) === JSON.stringify(reward.instanceData ?? null))) { const add = Math.min(remaining, Math.max(0, Number(def.maxStack ?? 1) - row.quantity)); row.quantity += add; remaining -= add; if (!remaining) break; }
      while (remaining > 0) { if (projected.length >= INVENTORY_SLOTS) return false; const n = def.stackable ? Math.min(remaining, Number(def.maxStack ?? remaining)) : 1; projected.push({ itemId: reward.itemId, quantity: n, instanceData: reward.instanceData ?? null }); remaining -= n; }
    }
    return true;
  }
  private async grantItem(manager: EntityManager, character: Character, reward: { itemId: string; quantity: number; instanceData: any }): Promise<void> {
    const repo = manager.getRepository(InventoryItem); const def = this.data.getItemById(reward.itemId); if (!def) throw new BadRequestException('Reward item is unavailable');
    let remaining = reward.quantity; const sameData = (x: any) => JSON.stringify(x ?? null) === JSON.stringify(reward.instanceData ?? null);
    if (def.stackable) {
      const rows = await repo.find({ where: { characterId: character.id, location: 'inventory', itemId: reward.itemId }, order: { slotIndex: 'ASC' }, lock: { mode: 'pessimistic_write' } });
      for (const row of rows.filter(r => sameData(r.instanceData))) { const add = Math.min(remaining, Math.max(0, Number(def.maxStack ?? 1) - Number(row.quantity))); if (add > 0) { row.quantity += add; await repo.save(row); remaining -= add; } if (!remaining) break; }
    }
    while (remaining > 0) {
      const rows = await repo.find({ where: { characterId: character.id, location: 'inventory' } }); const used = new Set(rows.map(r => Number(r.slotIndex)));
      const slotIndex = Array.from({ length: INVENTORY_SLOTS }, (_, i) => i).find(i => !used.has(i)); if (slotIndex === undefined) throw new BadRequestException('Inventory is full');
      const quantity = def.stackable ? Math.min(remaining, Number(def.maxStack ?? remaining)) : 1;
      await repo.save(repo.create({ characterId: character.id, location: 'inventory', slotIndex, itemId: reward.itemId, quantity, instanceData: reward.instanceData ?? null })); remaining -= quantity;
    }
    if (!character.knownItemIds?.includes(reward.itemId)) character.knownItemIds = [...(character.knownItemIds ?? []), reward.itemId];
  }
  async turnIn(characterId: string, instanceId: string): Promise<any> {
    await this.withExpiry(characterId);
    return this.instances.manager.transaction(async manager => {
      const character = await this.characterAtTown(manager, characterId);
      const repo = manager.getRepository(QuestInstance);
      const instance = await repo.findOne({ where: { id: instanceId, characterId }, lock: { mode: 'pessimistic_write' } });
      if (!instance || instance.status !== 'active') throw new BadRequestException('Active quest not found');
      const quest = this.definition(instance.questId);
      await this.characterAtTown(manager, characterId, quest.turnInNpcId);
      await this.expire(manager, characterId);
      const fresh = await repo.findOne({ where: { id: instanceId, characterId }, lock: { mode: 'pessimistic_write' } }); if (!fresh || fresh.status !== 'active') throw new BadRequestException('Quest has expired');
      for (const objective of quest.objectives) {
        if (objective.type === 'deliver_items') continue;
        if (Number(fresh.progress?.[objective.id] ?? 0) < Number(objective.quantity ?? 1)) throw new BadRequestException(`Objective incomplete: ${objective.id}`);
      }
      const requirements = this.deliveryRequirements(quest);
      const afterConsume = await this.rowsAfterDelivery(manager, characterId, fresh.id, requirements);
      const rewardRows = this.rewardInstances(quest, fresh.id);
      if (!this.canFitRewards(afterConsume, rewardRows)) throw new BadRequestException('Not enough Inventory space for all quest rewards');
      await this.consumeRequirements(manager, characterId, fresh.id, requirements);
      for (const reward of rewardRows) await this.grantItem(manager, character, reward);
      const rewards = quest.rewards ?? {};
      character.gold = Math.min(GOLD_CAP, Number(character.gold) + Number(rewards.gold ?? 0));
      let xp = Math.max(0, Number(character.xp ?? 0)) + Number(rewards.characterXp ?? 0); let level = Math.max(1, Number(character.level ?? 1)); let gained = 0;
      while (level < 99) { const need = Number(this.data.getXpToNextLevel(level)); if (need <= 0 || xp < need) break; xp -= need; level++; gained++; }
      character.xp = xp; character.level = level; if (gained) character.unspentAttributePoints = Number(character.unspentAttributePoints ?? 0) + 5 * gained;
      for (const reward of rewards.professionXp ?? []) {
        if (reward.profession === 'gathering') { character.gatheringXp = Math.max(0, Number(character.gatheringXp ?? 0)) + Number(reward.amount); character.gatheringLevel = gatheringLevelForXp(character.gatheringXp); }
        else if (reward.profession === 'cooking') { character.cookingXp = Math.max(0, Number(character.cookingXp ?? 0)) + Number(reward.amount); character.cookingLevel = this.cookingLevelForXp(Number(character.cookingXp)); }
      }
      fresh.status = 'completed'; fresh.completedAt = new Date(); await repo.save(fresh); await manager.getRepository(Character).save(character);
      const completion = quest.completionDialogue;
      return { completed: true, questId: quest.id, title: quest.title,
        interaction: completion ? { kind: 'completed', questId: quest.id, title: quest.title, npcText: completion.npcText, buttonText: completion.buttonText, action: 'close' } : null };
    });
  }
  private cookingThreshold(level: number): number { const known = [0,20,44,78,128,328,828,1578]; if (level <= 1) return 0; if (known[level-1] !== undefined) return known[level-1]; let total=known[known.length-1], increment=known[known.length-1]-known[known.length-2]; for(let current=known.length;current<level;current++){increment=Math.floor(increment*1.5);total+=increment;}return total; }
  private cookingLevelForXp(xp: number): number { let level=1; while(level<99 && xp>=this.cookingThreshold(level+1)) level++; return level; }

  async recordTalkAction(manager: EntityManager, characterId: string, npcId: string, objectiveId?: string): Promise<void> {
    const rows = await manager.getRepository(QuestInstance).find({ where: { characterId, status: 'active' }, lock: { mode: 'pessimistic_write' } });
    const now = Date.now();
    for (const row of rows) {
      const quest = this.definition(row.questId); if (row.expiresAt && row.expiresAt.getTime() <= now) continue;
      for (const objective of quest.objectives) if (objective.type === 'npc_action' && objective.npcId === npcId && (!objectiveId || objective.id === objectiveId)) {
        row.progress = { ...(row.progress ?? {}), [objective.id]: Math.min(Number(objective.quantity ?? 1), Number(row.progress?.[objective.id] ?? 0) + 1) }; await manager.getRepository(QuestInstance).save(row);
      }
    }
  }
  async recordBattleVictory(manager: EntityManager, character: Character, battle: { id: string; monsterId: string; mapId: string; endAt: Date }): Promise<void> {
    // The enclosing battle-resolution transaction is the event idempotency boundary;
    // use its authoritative end timestamp for expiry, so stale quests receive no progress.
    await this.expire(manager, character.id, battle.endAt.getTime());
    const rows = await manager.getRepository(QuestInstance).find({ where: { characterId: character.id, status: 'active' }, lock: { mode: 'pessimistic_write' } });
    const now = battle.endAt.getTime();
    for (const row of rows) {
      if (row.acceptedAt.getTime() > now || (row.expiresAt && row.expiresAt.getTime() <= now)) continue;
      const quest = this.definition(row.questId); const progress = { ...(row.progress ?? {}) }; let changed = false;
      for (const objective of quest.objectives) {
        if (objective.mapIds?.length && !objective.mapIds.includes(battle.mapId)) continue;
        if (objective.type === 'kill_monster' && (!objective.monsterIds?.length || objective.monsterIds.includes(battle.monsterId))) {
          progress[objective.id] = Math.min(Number(objective.quantity ?? 1), Number(progress[objective.id] ?? 0) + 1); changed = true;
        }
        if (objective.type === 'monster_drop' && (!objective.monsterIds?.length || objective.monsterIds.includes(battle.monsterId))) {
          const rollBytes = createHash('sha256').update(`${battle.id}:${row.id}:${objective.id}`).digest();
          const roll = rollBytes.readUInt32BE(0) % 10000; const chance = Math.floor(Number(objective.chancePercent ?? 0) * 100);
          if (roll < chance) {
            const item = this.data.getItemById(objective.itemId); const def = item?.questOnly ? { questInstanceId: row.id } : null;
            const quantity = Number(objective.itemQuantity ?? 1); const reward = { itemId: objective.itemId, quantity, instanceData: def };
            const invRows = await manager.getRepository(InventoryItem).find({ where: { characterId: character.id, location: 'inventory' } });
            if (this.canFitRewards(invRows.map(r => ({ itemId: r.itemId, quantity: Number(r.quantity), instanceData: r.instanceData ?? null })), [reward])) {
              await this.grantItem(manager, character, reward); progress[objective.id] = Math.min(Number(objective.quantity ?? 1), Number(progress[objective.id] ?? 0) + quantity); changed = true;
            }
          }
        }
      }
      if (changed) { row.progress = progress; await manager.getRepository(QuestInstance).save(row); }
    }
  }
  async applyGatheringBonuses(manager: EntityManager, character: Character, mapId: string, cycleIndex: number): Promise<void> {
    // Cycle index and the ordinary Gathering grant commit with this transaction.
    // Expiration cleanup shares that transaction, avoiding stale quest-owned stacks.
    await this.expire(manager, character.id);
    const rows = await manager.getRepository(QuestInstance).find({ where: { characterId: character.id, status: 'active' }, lock: { mode: 'pessimistic_write' } });
    const now = Date.now();
    for (const row of rows) {
      if (row.acceptedAt.getTime() > now || (row.expiresAt && row.expiresAt.getTime() <= now)) continue;
      const quest = this.definition(row.questId); const progress = { ...(row.progress ?? {}) }; let changed = false;
      for (const objective of quest.objectives) if (objective.type === 'gathering_bonus' && objective.mapIds?.includes(mapId) && Number(progress[objective.id] ?? 0) < Number(objective.quantity ?? 1)) {
        const rollBytes = createHash('sha256').update(`${character.id}:${mapId}:${cycleIndex}:${row.id}:${objective.id}:gather`).digest();
        if ((rollBytes.readUInt32BE(0) % 10000) >= Math.floor(Number(objective.chancePercent ?? 0) * 100)) continue;
        const quantity = Math.max(1, Number(objective.itemQuantity ?? 1)); const reward = { itemId: objective.containerItem, quantity, instanceData: { questInstanceId: row.id } };
        const invRows = await manager.getRepository(InventoryItem).find({ where: { characterId: character.id, location: 'inventory' } });
        if (!this.canFitRewards(invRows.map(r => ({ itemId: r.itemId, quantity: Number(r.quantity), instanceData: r.instanceData ?? null })), [reward])) continue;
        await this.grantItem(manager, character, reward); progress[objective.id] = Math.min(Number(objective.quantity ?? 1), Number(progress[objective.id] ?? 0) + quantity); changed = true;
      }
      if (changed) { row.progress = progress; await manager.getRepository(QuestInstance).save(row); }
    }
  }
}
