/**
 * Dev tool: start a Smashing Spree (Quebra-Quebra) right now, without waiting for
 * 03:30/09:30/15:30/21:30. Enqueues a start phase and a delayed end phase on the
 * `town-event` queue; a running API (NODE_ENV !== production) processes them.
 *
 *   pnpm --filter @nanommo/api build && node apps/api/dist/apps/api/src/maintenance/smashing-spree-start-now.js
 */
import Bull from 'bull';
import { getRedisConnectionOptions } from '../config/redis.config';
import type { SmashingSpreePhase } from '../modules/town-event/smashing-spree.logic';

const QUEUE = 'town-event';
const RUN_PHASE = 'smashing-spree-run-phase';

/** Start now and end `durationSeconds` later, under a dev-only event key. */
export function devStartPhases(nowMs: number, durationSeconds: number): [SmashingSpreePhase, SmashingSpreePhase] {
  const eventKey = `ss-dev-${nowMs}`;
  return [
    { kind: 'start', eventKey, startMs: nowMs, endsAt: nowMs + durationSeconds * 1000 },
    { kind: 'end', eventKey, startMs: nowMs },
  ];
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('smashing-spree-start-now is a development tool');
  const queue = new Bull(QUEUE, { redis: getRedisConnectionOptions() });
  const duration = Number(process.env.SMASHING_SPREE_SECONDS ?? 300);
  const [start, end] = devStartPhases(Date.now(), duration);
  await queue.add(RUN_PHASE, { phase: start }, { removeOnComplete: true });
  await queue.add(RUN_PHASE, { phase: end }, { delay: duration * 1000, removeOnComplete: true });
  console.log(`Smashing Spree ${start.eventKey} queued: starts now, ends in ${duration}s.`);
  await queue.close();
}

if (require.main === module) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
