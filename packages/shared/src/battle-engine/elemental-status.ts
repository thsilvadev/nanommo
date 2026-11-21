import { elementalMultiplier } from '../elements';

/** Capture potency when Burn is applied; duration and cadence belong to the status catalogue. */
export function burnStatusPayload(sourceMatk: number, definition: any, tick: number): Record<string, any> {
  const interval = Math.max(1, Number(definition?.damageIntervalTicks ?? 10));
  return { damagePerTick: Math.floor(Math.max(0, sourceMatk) / 5), damageIntervalTicks: interval,
    nextDamageAtTick: tick + interval, damageType: 'magical', element: 'fire' };
}
/** Old saved Burn instances lacked damage type/element; interpret them through the canonical definition. */
export function periodicDamageProfile(status: any, definition: any): { damageType: string; element: unknown } {
  const burn = (status.type ?? status.id) === 'burn';
  return { damageType: burn ? 'magical' : String(status.damageType ?? definition?.damageType ?? 'pure'),
    element: burn ? 'fire' : status.element ?? definition?.element ?? 'neutral' };
}
export function periodicDamageAmount(raw: number, status: any, definition: any, target: { element?: unknown }, mdefPercent: number): number {
  const profile = periodicDamageProfile(status, definition);
  const magic = ['magic', 'magical'].includes(profile.damageType);
  const mitigation = magic ? 1 - Math.min(100, Math.max(0, mdefPercent)) / 100 : 1;
  return Math.max(0, Math.floor(raw * mitigation * (profile.damageType === 'pure' ? 1 : elementalMultiplier(profile.element, target.element))));
}
