import { Controller, Get, Post, Delete, UseGuards, Request, Body, Param, Headers, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Character } from '../../database/entities/character.entity';
import { MailService } from './mail.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('mail')
@UseGuards(JwtAuthGuard)
export class MailController {
  constructor(
    private readonly mailService: MailService,
    @InjectRepository(Character) private readonly characterRepo: Repository<Character>,
  ) {}

  private async resolveCharacterId(req: any): Promise<string> {
    // JwtStrategy returns userId; it deliberately does not copy characterId from the JWT payload.
    const userId = String(req?.user?.userId ?? '');
    if (!userId) throw new NotFoundException('Authenticated account was not found');
    const character = await this.characterRepo.findOne({ where: { userId } });
    if (!character) throw new NotFoundException('Character not found');
    return character.id;
  }

  @Get('inbox')
  async getInbox(@Request() req: any) { return this.mailService.getInbox(await this.resolveCharacterId(req)); }

  @Get('sent')
  async getSent(@Request() req: any) { return this.mailService.getSent(await this.resolveCharacterId(req)); }

  @Get('unread-count')
  async getUnreadCount(@Request() req: any) { return { unreadCount: await this.mailService.getUnreadCount(await this.resolveCharacterId(req)) }; }

  @Get('search/:query')
  async searchMail(@Request() req: any, @Param('query') query: string) { return this.mailService.searchMail(await this.resolveCharacterId(req), query); }

  @Get(':mailId')
  async getMail(@Request() req: any, @Param('mailId') mailId: string) { return this.mailService.getMail(await this.resolveCharacterId(req), mailId); }

  @Post('send')
  async sendMail(@Request() req: any, @Headers('idempotency-key') idempotencyKey: string | undefined, @Body() body: {
    recipientName: string; subject: string; body: string; attachedGold?: number;
    attachedItemId?: string; attachedItemQuantity?: number; attachedInventoryItemId?: string; idempotencyKey?: string;
  }) {
    return this.mailService.sendMail(await this.resolveCharacterId(req), body.recipientName, body.subject, body.body,
      body.attachedGold, body.attachedItemId, body.attachedItemQuantity, idempotencyKey ?? body.idempotencyKey, body.attachedInventoryItemId);
  }

  @Post(':mailId/read')
  async markAsRead(@Request() req: any, @Param('mailId') mailId: string) {
    await this.mailService.markAsRead(await this.resolveCharacterId(req), mailId);
    return { success: true };
  }

  @Post(':mailId/unread')
  async markAsUnread(@Request() req: any, @Param('mailId') mailId: string) {
    await this.mailService.markAsUnread(await this.resolveCharacterId(req), mailId);
    return { success: true };
  }

  @Post(':mailId/collect')
  async collectAttachments(@Request() req: any, @Param('mailId') mailId: string) {
    await this.mailService.collectAttachments(await this.resolveCharacterId(req), mailId);
    return { success: true };
  }

  @Delete(':mailId')
  async deleteMail(@Request() req: any, @Param('mailId') mailId: string) {
    await this.mailService.deleteMail(await this.resolveCharacterId(req), mailId);
    return { success: true };
  }
}
