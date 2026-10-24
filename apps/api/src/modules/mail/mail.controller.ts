import { Controller, Get, Post, Delete, UseGuards, Request, Body, Param, Query, Headers } from '@nestjs/common';
import { MailService } from './mail.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('mail')
@UseGuards(JwtAuthGuard)
export class MailController {
  constructor(private readonly mailService: MailService) {}

  @Get('inbox')
  getInbox(@Request() req: any) { return this.mailService.getInbox(req.user.characterId); }

  @Get('sent')
  getSent(@Request() req: any) { return this.mailService.getSent(req.user.characterId); }

  @Get('unread-count')
  async getUnreadCount(@Request() req: any) { return { unreadCount: await this.mailService.getUnreadCount(req.user.characterId) }; }

  @Get('search/:query')
  searchMail(@Request() req: any, @Param('query') query: string) { return this.mailService.searchMail(req.user.characterId, query); }

  @Get(':mailId')
  getMail(@Request() req: any, @Param('mailId') mailId: string) { return this.mailService.getMail(req.user.characterId, mailId); }

  @Post('send')
  sendMail(@Request() req: any, @Headers('idempotency-key') idempotencyKey: string | undefined, @Body() body: {
    recipientName: string; subject: string; body: string; attachedGold?: number;
    attachedItemId?: string; attachedItemQuantity?: number; attachedInventoryItemId?: string; idempotencyKey?: string;
  }) {
    return this.mailService.sendMail(req.user.characterId, body.recipientName, body.subject, body.body,
      body.attachedGold, body.attachedItemId, body.attachedItemQuantity, idempotencyKey ?? body.idempotencyKey, body.attachedInventoryItemId);
  }

  @Post(':mailId/read')
  async markAsRead(@Request() req: any, @Param('mailId') mailId: string) {
    await this.mailService.markAsRead(req.user.characterId, mailId); return { success: true };
  }

  @Post(':mailId/unread')
  async markAsUnread(@Request() req: any, @Param('mailId') mailId: string) {
    await this.mailService.markAsUnread(req.user.characterId, mailId); return { success: true };
  }

  @Post(':mailId/collect')
  async collectAttachments(@Request() req: any, @Param('mailId') mailId: string) {
    await this.mailService.collectAttachments(req.user.characterId, mailId); return { success: true };
  }

  @Delete(':mailId')
  async deleteMail(@Request() req: any, @Param('mailId') mailId: string) {
    await this.mailService.deleteMail(req.user.characterId, mailId); return { success: true };
  }
}
