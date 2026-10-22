import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatReport } from '../../database/entities/chat-report.entity';
import { GlobalChatMessage } from '../../database/entities/global-chat-message.entity';
import { Character } from '../../database/entities/character.entity';
import { DataModule } from '../data/data.module';
import { RedisModule } from '../../config/redis.module';
import { GlobalChatHistoryService, TransientChatHistoryService, IdleJournalService } from './chat-history.service';

@Module({
  imports: [TypeOrmModule.forFeature([ChatReport, GlobalChatMessage, Character]), DataModule, RedisModule],
  controllers: [ChatController],
  providers: [GlobalChatHistoryService, TransientChatHistoryService, IdleJournalService, ChatService],
  exports: [ChatService, IdleJournalService, TransientChatHistoryService],
})
export class ChatModule {}
