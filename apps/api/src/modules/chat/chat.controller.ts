import { Controller, Get, Post, UseGuards, Request, Body, Param, Query } from '@nestjs/common';
import { ChatService } from './chat.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /**
   * Get available chat channels
   */
  @Get('channels')
  async getAvailableChannels() {
    return this.chatService.getAvailableChannels();
  }

  /**
   * Get chat history for a channel
   */
  @Get('history/:channel')
  async getChatHistory(
    @Param('channel') channel: string,
    @Query('limit') limit: number = 50,
  ) {
    return this.chatService.getChatHistory(channel, limit);
  }

  /**
   * Send chat message (REST fallback - Socket.IO preferred)
   */
  @Post('send')
  async sendChatMessage(
    @Request() req: any,
    @Body() body: { channel: string; message: string },
  ) {
    const characterId = req.user.characterId;
    await this.chatService.sendChatMessage(characterId, body.channel, body.message);
    return { success: true };
  }

  /**
   * Get muted players list
   */
  @Get('muted')
  async getMutedPlayers(@Request() req: any) {
    const characterId = req.user.characterId;
    return this.chatService.getMutedPlayers(characterId);
  }

  /**
   * Mute a player
   */
  @Post('mute/:playerId')
  async mutePlayer(
    @Request() req: any,
    @Param('playerId') playerId: string,
    @Body() body: { durationMinutes?: number },
  ) {
    const characterId = req.user.characterId;
    await this.chatService.mutePlayer(characterId, playerId, body.durationMinutes);
    return { success: true };
  }

  /**
   * Unmute a player
   */
  @Post('unmute/:playerId')
  async unmutePlayer(@Request() req: any, @Param('playerId') playerId: string) {
    const characterId = req.user.characterId;
    await this.chatService.unmutePlayer(characterId, playerId);
    return { success: true };
  }

  /**
   * Report a chat message
   */
  @Post('report')
  async reportChatMessage(
    @Request() req: any,
    @Body() body: { reportedPlayerId: string; messageText: string; reason: string },
  ) {
    const reporterId = req.user.characterId;
    return this.chatService.reportChatMessage(
      reporterId,
      body.reportedPlayerId,
      body.messageText,
      body.reason,
    );
  }

  /**
   * Get chat reports (admin only)
   */
  @Get('reports')
  async getChatReports(@Query('limit') limit: number = 20) {
    // TODO: Add admin guard
    return this.chatService.getChatReports(limit);
  }

  /**
   * Resolve a chat report (admin only)
   */
  @Post('reports/:reportId/resolve')
  async resolveChatReport(
    @Param('reportId') reportId: string,
    @Body() body: { action: string; notes: string },
  ) {
    // TODO: Add admin guard
    await this.chatService.resolveChatReport(reportId, body.action, body.notes);
    return { success: true };
  }
}
