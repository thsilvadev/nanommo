import { Controller, Get, Post, Delete, UseGuards, Request, Body, Param, Query } from '@nestjs/common';
import { MailService } from './mail.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('mail')
@UseGuards(JwtAuthGuard)
export class MailController {
  constructor(private readonly mailService: MailService) {}

  /**
   * Get inbox for character
   */
  @Get('inbox')
  async getInbox(@Request() req: any) {
    const characterId = req.user.characterId;
    return this.mailService.getInbox(characterId);
  }

  /**
   * Get unread mail count
   */
  @Get('unread-count')
  async getUnreadCount(@Request() req: any) {
    const characterId = req.user.characterId;
    return { unreadCount: await this.mailService.getUnreadCount(characterId) };
  }

  /**
   * Get specific mail message
   */
  @Get(':mailId')
  async getMail(@Param('mailId') mailId: string) {
    return this.mailService.getMail(mailId);
  }

  /**
   * Search mail
   */
  @Get('search/:query')
  async searchMail(@Request() req: any, @Param('query') query: string) {
    const characterId = req.user.characterId;
    return this.mailService.searchMail(characterId, query);
  }

  /**
   * Send mail to another player
   */
  @Post('send')
  async sendMail(
    @Request() req: any,
    @Body()
    body: {
      recipientName: string;
      subject: string;
      body: string;
      attachedGold?: number;
      attachedItemId?: string;
      attachedItemQuantity?: number;
    },
  ) {
    const senderId = req.user.characterId;
    return this.mailService.sendMail(
      senderId,
      body.recipientName,
      body.subject,
      body.body,
      body.attachedGold,
      body.attachedItemId,
      body.attachedItemQuantity,
    );
  }

  /**
   * Mark mail as read
   */
  @Post(':mailId/read')
  async markAsRead(@Param('mailId') mailId: string) {
    await this.mailService.markAsRead(mailId);
    return { success: true };
  }

  /**
   * Mark mail as unread
   */
  @Post(':mailId/unread')
  async markAsUnread(@Param('mailId') mailId: string) {
    await this.mailService.markAsUnread(mailId);
    return { success: true };
  }

  /**
   * Collect attachments from mail
   */
  @Post(':mailId/collect')
  async collectAttachments(@Request() req: any, @Param('mailId') mailId: string) {
    const characterId = req.user.characterId;
    await this.mailService.collectAttachments(characterId, mailId);
    return { success: true };
  }

  /**
   * Delete mail
   */
  @Delete(':mailId')
  async deleteMail(@Param('mailId') mailId: string) {
    await this.mailService.deleteMail(mailId);
    return { success: true };
  }
}
