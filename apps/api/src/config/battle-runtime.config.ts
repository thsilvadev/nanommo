import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface BattleRuntimeConfig {
  tickDurationMs: 500;
  battleResolveConcurrency: number;
  battleQueueConcurrency: number;
  worldActivityConcurrency: number;
}

const RUNTIME_KEYS = [
  'BATTLE_TICK_DURATION_MS',
  'BATTLE_RESOLVE_CONCURRENCY',
  'BATTLE_QUEUE_CONCURRENCY',
  'WORLD_ACTIVITY_CONCURRENCY',
] as const;

/**
 * Bull @Process concurrency is decorator metadata, evaluated before Nest's
 * ConfigModule loads .env. Read only these non-secret runtime keys here so the
 * same .env values are used by decorators and ConfigModule validation. Real
 * process environment variables retain precedence over the file.
 */
function runtimeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (env !== process.env) return env;
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../.env'),
    resolve(process.cwd(), '../../.env'),
  ];
  const fileValues: NodeJS.ProcessEnv = {};
  const envPath = candidates.find(existsSync);
  if (envPath) {
    const contents = readFileSync(envPath, 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || !RUNTIME_KEYS.includes(match[1] as typeof RUNTIME_KEYS[number])) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      } else {
        value = value.replace(/\s+#.*$/, '').trim();
      }
      fileValues[match[1]] = value;
    }
  }
  return { ...fileValues, ...env };
}

function integerSetting(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer between 1 and 8`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 8) throw new Error(`${name} must be an integer between 1 and 8`);
  return value;
}

/** The 500 ms simulation clock is a deliberate gameplay contract, not a tuning knob. */
export function getBattleRuntimeConfig(env: NodeJS.ProcessEnv = process.env): BattleRuntimeConfig {
  const configured = runtimeEnvironment(env);
  const tickRaw = configured.BATTLE_TICK_DURATION_MS?.trim();
  if (tickRaw !== undefined && tickRaw !== '500') {
    throw new Error('BATTLE_TICK_DURATION_MS currently supports only 500');
  }
  return {
    tickDurationMs: 500,
    battleResolveConcurrency: integerSetting(configured, 'BATTLE_RESOLVE_CONCURRENCY', 4),
    battleQueueConcurrency: integerSetting(configured, 'BATTLE_QUEUE_CONCURRENCY', 2),
    worldActivityConcurrency: integerSetting(configured, 'WORLD_ACTIVITY_CONCURRENCY', 1),
  };
}
