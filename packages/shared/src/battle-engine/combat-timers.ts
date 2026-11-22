import type { CombatantSnapshot } from './index';
import type { CombatItemDefinition } from '../types/group-battle';
import { secondsToBattleTicks } from './time';

/** Presentation metadata only: consumption/eligibility remain owned by the executor. */
export function consumableCooldownKey(item: CombatItemDefinition | undefined, id: string): string {
  const type = String(item?.effect?.type ?? '');
  if (item?.alchemyCategory === 'super_tonics' || ['revive_full_cleanse', 'revive_ally', 'revive_half'].includes(type)) return 'item:super_tonic';
  if (item?.alchemyCategory === 'potions' || ['heal_hp', 'heal_sp', 'heal_hp_sp', 'heal_status', 'cure_status'].includes(type)) return 'item:potion';
  if (item?.alchemyCategory === 'tonics' || type === 'apply_status') return 'item:tonic';
  return `item:${id}`;
}

export function combatCooldownDurations(snapshot: Pick<CombatantSnapshot, 'skillDefs'>, items: Record<string, CombatItemDefinition> = {}): Record<string, number> {
  const durations: Record<string, number> = { 'item:potion': secondsToBattleTicks(10), 'item:tonic': secondsToBattleTicks(30), 'item:super_tonic': secondsToBattleTicks(60) };
  for (const [id, skill] of Object.entries(snapshot.skillDefs ?? {})) {
    const ticks = Number(skill.cooldownTicks ?? 0);
    if (ticks > 0) durations[`skill:${id}`] = ticks + 1;
  }
  for (const [id, item] of Object.entries(items)) {
    const seconds = Number(item.cooldownInSeconds ?? item.cooldownSeconds ?? 0);
    if (seconds > 0) durations[consumableCooldownKey(item, id)] = secondsToBattleTicks(seconds);
  }
  return durations;
}
