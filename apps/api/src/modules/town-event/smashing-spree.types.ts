export type { TownEventVase, TownEventSnapshot } from '@nanommo/shared';

export interface SmashingSpreePrizeRule { count: number; quantity: number; itemId?: string; oneOf?: string[] }

export interface SmashingSpreeConfig {
  timezone: string;
  startTimes: string[];
  announceMinutesBefore: number[];
  durationSeconds: number;
  vasesPerTown: number;
  minVaseSpacing: number;
  hitRange: number;
  approachDistance: number;
  attackCooldownMs: number;
  prizes: SmashingSpreePrizeRule[];
  announceFindItemIds: string[];
}

/** A prize as granted (server-only until its vase breaks). */
export interface TownEventPrize { itemId: string; quantity: number }

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
const positive = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const positiveInt = (v: unknown) => positive(v) && Number.isInteger(v);

/** Every problem in the `smashingSpree` block of town_events.json (empty when valid). */
export function validateSmashingSpreeConfig(raw: unknown, itemIds: Set<string>): string[] {
  const errors: string[] = [];
  const cfg = raw as Partial<SmashingSpreeConfig> | null;
  if (!cfg || typeof cfg !== 'object') return ['smashingSpree block is missing'];
  if (typeof cfg.timezone !== 'string' || !cfg.timezone) errors.push('timezone is required');
  else { try { new Intl.DateTimeFormat('en-US', { timeZone: cfg.timezone }); } catch { errors.push(`unknown timezone ${cfg.timezone}`); } }
  if (!Array.isArray(cfg.startTimes) || !cfg.startTimes.length) errors.push('startTimes must be a non-empty array');
  else for (const t of cfg.startTimes) if (typeof t !== 'string' || !HH_MM.test(t)) errors.push(`startTimes entry ${String(t)} must be HH:MM`);
  if (!Array.isArray(cfg.announceMinutesBefore)) errors.push('announceMinutesBefore must be an array');
  else for (const m of cfg.announceMinutesBefore) if (!positiveInt(m)) errors.push(`announceMinutesBefore entry ${String(m)} must be a positive integer`);
  for (const key of ['durationSeconds', 'vasesPerTown', 'attackCooldownMs'] as const) if (!positiveInt(cfg[key])) errors.push(`${key} must be a positive integer`);
  for (const key of ['minVaseSpacing', 'hitRange', 'approachDistance'] as const) if (!positive(cfg[key])) errors.push(`${key} must be a positive number`);
  if (!Array.isArray(cfg.prizes) || !cfg.prizes.length) errors.push('prizes must be a non-empty array');
  else {
    let total = 0;
    cfg.prizes.forEach((rule, i) => {
      if (!positiveInt(rule?.count)) errors.push(`prizes[${i}].count must be a positive integer`);
      if (!positiveInt(rule?.quantity)) errors.push(`prizes[${i}].quantity must be a positive integer`);
      const hasId = typeof rule?.itemId === 'string';
      const hasOneOf = Array.isArray(rule?.oneOf);
      if (hasId === hasOneOf) errors.push(`prizes[${i}] needs exactly one of itemId / oneOf`);
      if (hasOneOf && !rule.oneOf!.length) errors.push(`prizes[${i}].oneOf must not be empty`);
      for (const id of hasId ? [rule.itemId!] : hasOneOf ? rule.oneOf! : []) if (!itemIds.has(id)) errors.push(`prizes[${i}] unknown item ${id}`);
      total += Number(rule?.count) || 0;
    });
    if (positiveInt(cfg.vasesPerTown) && total > cfg.vasesPerTown!) errors.push(`prize vases (${total}) exceed vasesPerTown (${cfg.vasesPerTown})`);
  }
  if (!Array.isArray(cfg.announceFindItemIds)) errors.push('announceFindItemIds must be an array');
  else for (const id of cfg.announceFindItemIds) if (!itemIds.has(id)) errors.push(`announceFindItemIds unknown item ${id}`);
  return errors;
}
