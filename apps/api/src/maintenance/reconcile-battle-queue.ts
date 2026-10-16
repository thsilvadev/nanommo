import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { BattleRecoveryService } from '../modules/battle/battle-recovery.service';

/**
 * Controlled post-migration maintenance entry point. The context does not register
 * Bull processors, requires an explicit stopped-consumer confirmation, and leaves
 * the shared queue paused/gated. Normal API startup performs final readiness + resume.
 */
async function main(): Promise<void> {
  if (process.env.BATTLE_QUEUE_MAINTENANCE_ONLY !== 'true') {
    throw new Error('Set BATTLE_QUEUE_MAINTENANCE_ONLY=true to disable all Bull consumers in this process.');
  }
  if (process.env.CONFIRM_QUEUE_CONSUMERS_STOPPED !== '1') {
    throw new Error('Refusing maintenance: set CONFIRM_QUEUE_CONSUMERS_STOPPED=1 only after every API/Bull consumer has stopped.');
  }
  const logger = new Logger('BattleQueueMaintenance');
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;
  try {
    app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });
    const recovery = app.get(BattleRecoveryService);
    const result = await recovery.runStoppedConsumerReconciliation();
    logger.log(`Authoritative queue/job/MapPresence reconciliation passed: ${JSON.stringify(result)}. Bull remains paused until a normal API startup revalidates state.`);
  } finally {
    await app?.close();
  }
}

main().catch(error => {
  // Deliberately non-zero: shell/maintenance orchestrators must not start workers
  // after migration/reconciliation errors.
  console.error('[BattleQueueMaintenance] FAILED CLOSED:', error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
