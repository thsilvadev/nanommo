import { Body, Controller, Delete, Get, Post, Request, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Character } from '../../database/entities/character.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService, @InjectRepository(Character) private readonly characters: Repository<Character>) {}
  private async characterId(req: any): Promise<string> {
    const userId = String(req?.user?.userId ?? '');
    if (!userId) throw new BadRequestException('Authenticated account is required');
    const character = await this.characters.findOne({ where: { userId } });
    if (!character) throw new BadRequestException('Character not found');
    return character.id;
  }
  @Get()
  @UseGuards(JwtAuthGuard)
  async getState(@Request() req: any) { return this.notifications.getState(await this.characterId(req)); }
  @Post('acknowledge')
  @UseGuards(JwtAuthGuard)
  async acknowledge(@Request() req: any, @Body() body: { keys: string[] }) { return this.notifications.acknowledge(await this.characterId(req), body?.keys); }
  @Post('push/subscribe')
  @UseGuards(JwtAuthGuard)
  async subscribe(@Request() req: any, @Body() body: { subscription: any; locale: string }) {
    await this.notifications.registerSubscription(await this.characterId(req), body?.subscription, body?.locale);
    return { success: true };
  }
  @Post('push/unsubscribe')
  @UseGuards(JwtAuthGuard)
  async unsubscribe(@Request() req: any, @Body() body: { endpoint: string }) {
    await this.notifications.removeSubscription(await this.characterId(req), String(body?.endpoint ?? ''));
    return { success: true };
  }
  @Post('push/displayed')
  async displayed(@Body() body: { characterId: string; notificationId: string; token: string }) {
    await this.notifications.confirmDisplayed(String(body?.characterId ?? ''), String(body?.notificationId ?? ''), String(body?.token ?? ''));
    return { success: true };
  }
}
