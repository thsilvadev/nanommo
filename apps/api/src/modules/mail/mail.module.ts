import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailController } from './mail.controller';
import { MailService } from './mail.service';
import { MailMessage } from '../../database/entities/mail-message.entity';
import { Character } from '../../database/entities/character.entity';
import { DataModule } from '../data/data.module';

@Module({
  imports: [TypeOrmModule.forFeature([MailMessage, Character]), DataModule],
  controllers: [MailController],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
