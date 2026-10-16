import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../config/redis.provider';

/** Local AND shared Redis gate; processors remain blocked until this instance finishes recovery. */
@Injectable()
export class BattleQueueGateService implements OnModuleInit {
  private readonly logger = new Logger(BattleQueueGateService.name);
  private readonly key = 'battle:queue:startup-gate';
  private readonly lockKey = 'battle:queue:startup-lock';
  private locallyReady = false;
  private leaseToken: string | null = null;
  private leaseTimer: NodeJS.Timeout | null = null;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleInit(): Promise<void> {
    // Close shared state before Nest starts listening or any processor can pass its gate check.
    await this.acquireStartupLease();
    await this.closeForStartup();
  }

  /** Serialize startup maintenance across replicas. Do not mutate DB/Redis until a lease is held. */
  async acquireStartupLease(): Promise<void> {
    if (this.leaseToken) return;
    const token = randomUUID();
    for (;;) {
      const acquired = await this.redis.set(this.lockKey, token, 'PX', 60_000, 'NX');
      if (acquired === 'OK') break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    this.leaseToken = token;
    this.leaseTimer = setInterval(() => {
      void this.redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
        1, this.lockKey, token, '60000',
      ).catch(error => this.logger.error('Could not renew battle queue startup lease', error instanceof Error ? error.stack : String(error)));
    }, 15_000);
  }

  async releaseStartupLease(): Promise<void> {
    if (this.leaseTimer) { clearInterval(this.leaseTimer); this.leaseTimer = null; }
    const token = this.leaseToken;
    this.leaseToken = null;
    if (!token) return;
    await this.redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1, this.lockKey, token,
    );
  }

  async closeForStartup(): Promise<void> {
    this.locallyReady = false;
    await this.redis.set(this.key, 'closed');
  }

  async markReady(): Promise<void> {
    if (!this.leaseToken) throw new Error('Cannot open battle queue gate without the startup maintenance lease');
    await this.redis.set(this.key, 'open');
    this.locallyReady = true;
    this.logger.log('Battle queue startup gate opened after database, queue and presence reconciliation');
  }

  async assertReadyForProcessing(): Promise<void> {
    if (!this.locallyReady) throw new Error('Battle queue startup gate is closed for this API instance');
    let state: string | null;
    try { state = await this.redis.get(this.key); }
    catch { throw new Error('Battle queue startup gate state is unavailable; refusing to execute job'); }
    if (state !== 'open') throw new Error('Battle queue startup gate is closed for maintenance');
  }

  isLocallyReady(): boolean { return this.locallyReady; }
}
