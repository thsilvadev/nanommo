import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatReport } from '../../database/entities/chat-report.entity';
import { Character } from '../../database/entities/character.entity';
import { DataModule } from '../data/data.module';

@Module({
  imports: [TypeOrmModule.forFeature([ChatReport, Character]), DataModule],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
