/** Floating damage numbers and hit flashes: which style and colour an event gets. Pure, no Angular. */
export type BattleDamageTarget = 'character' | 'monster';
export interface FloatingDamageEvent {
  tick?: number;
  action?: string;
  target?: string;
  damage?: number;
  crit?: boolean;
  status?: string;
  statusApplied?: string;
  skillId?: string;
  sourceSkillId?: string;
}
export type DamageFeedbackStyle = 'character-damage' | 'monster-damage' | 'critical' | 'dot' | 'poison' | 'bleed';

export function damageFeedbackStyle(event: FloatingDamageEvent): DamageFeedbackStyle {
  const status = String(event.status ?? event.statusApplied ?? '').toLowerCase().replaceAll('-', '_');
  if (event.action === 'status_damage') {
    if (status.includes('poison') || String(event.skillId ?? event.sourceSkillId ?? '').toLowerCase().includes('poison')) return 'poison';
    if (status.includes('bleed')) return 'bleed';
    return 'dot';
  }
  if (event.target === 'monster' && event.crit === true) return 'critical';
  return event.target === 'character' ? 'character-damage' : 'monster-damage';
}
/** Hit flash colour in the battle arena: own side white, the other side red; damage over time by its status. */
export type ArenaFlash = 'white' | 'red' | 'green' | 'orange' | 'darkred';
export function flashColor(event: { action?: string; status?: string; crit?: boolean }, targetIsSelfTeam: boolean): ArenaFlash {
  if (event.action === 'status_tick' || event.action === 'status_damage') {
    const status = String(event.status ?? '').toLowerCase();
    if (status.includes('poison')) return 'green';
    if (status.includes('burn')) return 'orange';
    if (status.includes('bleed')) return 'darkred';
  }
  return targetIsSelfTeam ? 'white' : 'red';
}

export function isFloatingDamageEvent(event: FloatingDamageEvent): event is FloatingDamageEvent & { target: BattleDamageTarget; damage: number } {
  return (event.target === 'character' || event.target === 'monster') && Number(event.damage ?? 0) > 0;
}

