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

  const testEmail = process.argv[2] || 'test@example.com';

  console.log(`\n📧 Testing email sending to: ${testEmail}`);
  console.log('─'.repeat(50));

  console.log('\n1. Sending verification email...');
  const verificationResult = await mailerService.sendVerificationEmail(testEmail, 'token-fake-123-verify');
  console.log(`   Result: ${verificationResult ? '✅ Sent' : '❌ Failed'}`);

  console.log('\n2. Sending password reset email...');
  const resetResult = await mailerService.sendPasswordResetEmail(testEmail, 'token-fake-123-reset');
  console.log(`   Result: ${resetResult ? '✅ Sent' : '❌ Failed'}`);

  console.log('\n' + '─'.repeat(50));
  if (verificationResult && resetResult) {
    console.log('✅ All test emails sent successfully!');
    console.log('   Check your inbox (and spam folder) for the emails.');
  } else {
    console.log('❌ Some emails failed to send.');
    console.log('   Check the logs above for details.');
    console.log('   Make sure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, and FRONTEND_URL are set in .env');
  }

  await app.close();
  process.exit(verificationResult && resetResult ? 0 : 1);
}

bootstrap().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});