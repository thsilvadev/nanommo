#!/usr/bin/env ts-node

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { MailerModule } from './src/modules/mailer/mailer.module';
import { MailerService } from './src/modules/mailer/mailer.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: '../../.env' }), MailerModule],
})
class TestModule {}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(TestModule);
  const mailerService = app.get(MailerService);
  const testEmail = 'thiagopereira_cmm@hotmail.com';
  
  console.log(`\n📧 Sending VERIFICATION email only to: ${testEmail}\n`);
  const result = await mailerService.sendVerificationEmail(testEmail, 'abc123def456-verification-token');
  console.log(`\n   Result: ${result ? '✅ Sent' : '❌ Failed'}\n`);
  
  await app.close();
  process.exit(result ? 0 : 1);
}

bootstrap().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
