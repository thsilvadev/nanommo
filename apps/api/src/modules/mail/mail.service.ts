import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MailMessage } from '../../database/entities/mail-message.entity';
import { Character } from '../../database/entities/character.entity';
import { DataService } from '../data/data.service';

@Injectable()
export class MailService {
  constructor(
    @InjectRepository(MailMessage)
    private readonly mailRepo: Repository<MailMessage>,
    @InjectRepository(Character)
    private readonly characterRepo: Repository<Character>,
    private readonly dataService: DataService,
  ) {}

  /**
   * Get inbox for a character
   */
  async getInbox(characterId: string): Promise<MailMessage[]> {
    return this.mailRepo.find({
      where: { recipientCharacterId: characterId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Get unread mail count
   */
  async getUnreadCount(characterId: string): Promise<number> {
    return this.mailRepo.countBy({
      recipientCharacterId: characterId,
      collected: false,
    });
  }

  /**
   * Get a specific mail message
   */
  async getMail(mailId: string): Promise<MailMessage | null> {
    return this.mailRepo.findOneBy({ id: mailId });
  }

  /**
   * Send mail to another player
   */
  async sendMail(
    senderId: string,
    recipientName: string,
    subject: string,
    body: string,
    attachedGold?: number,
    attachedItemId?: string,
    attachedItemQuantity?: number,
  ): Promise<MailMessage> {
    // TODO: Implement mail sending
    // - Validate recipient exists
    // - Validate sender has gold/items if attached
    // - Create mail message
    // - Lock gold/items in sender inventory
    throw new Error('Not implemented');
  }

  /**
   * Mark mail as read
   */
  async markAsRead(mailId: string): Promise<void> {
    await this.mailRepo.update(mailId, { collected: true });
  }

  /**
   * Mark mail as unread
   */
  async markAsUnread(mailId: string): Promise<void> {
    await this.mailRepo.update(mailId, { collected: false });
  }

  /**
   * Collect attachments from mail
   */
  async collectAttachments(characterId: string, mailId: string): Promise<void> {
    // TODO: Implement attachment collection
    // - Get mail
    // - Add gold to character
    // - Add items to inventory
    // - Mark as collected
    throw new Error('Not implemented');
  }

  /**
   * Delete mail
   */
  async deleteMail(mailId: string): Promise<void> {
    await this.mailRepo.delete(mailId);
  }

  /**
   * Expire old mail
   */
  async expireMail(): Promise<number> {
    // TODO: Find and delete mail older than retention period
    // - Return count of deleted messages
    throw new Error('Not implemented');
  }

  /**
   * Send system mail (from NPC/system)
   */
  async sendSystemMail(
    recipientId: string,
    subject: string,
    body: string,
    attachedGold?: number,
  ): Promise<MailMessage> {
    // TODO: Send mail from system account
    throw new Error('Not implemented');
  }

  /**
   * Search mail by subject or content
   */
  async searchMail(characterId: string, query: string): Promise<MailMessage[]> {
    // TODO: Implement mail search
    throw new Error('Not implemented');
  }
}
