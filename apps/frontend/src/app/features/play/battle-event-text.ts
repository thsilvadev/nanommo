/** One readable vocabulary for live solo, shared and historical battle logs. */
export function battleEventText(event: any, actor: string, target: string, name: (id: string, kind: string) => string): string {
  const e = { ...event, ...(event.payload ?? {}) };
  const skill = e.skillId ? name(String(e.skillId), 'skill') : 'a skill';
  const statusId = e.statusId ?? e.status ?? e.statusApplied;
  const status = statusId ? name(String(statusId), 'status') : 'an effect';
  switch (e.action) {
    case 'target': case 'target_changed': return `${actor} targets ${target}.`;
    case 'cast_start': return `${actor} begins casting ${skill}.`;
    case 'cast_cancel': case 'cast_cancelled': return `${actor}'s ${skill} was interrupted.`;
    case 'status_apply': case 'status_applied': case 'status_refreshed': case 'status_stack_applied': return `${actor} applies ${status} to ${target}.`;
    case 'status_expire': case 'status_expired': case 'status_ended': return `${target}'s ${status} expires.`;
    case 'status_stack_lessened': return `${target}'s ${status} fades (${e.remainingStacks ?? e.stackCount ?? 0} stacks).`;
    case 'status_damage': return `${target} takes ${Number(e.damage ?? 0)} ${status} damage.`;
    case 'attack': return e.hit === false || Number(e.damage ?? 0) === 0 ? `${actor} misses ${target}!` : `${actor} hits ${target} for ${e.damage} damage${e.crit ? ' — CRITICAL!' : '.'}`;
    case 'use_skill': return `${actor} uses ${skill} on ${target}${Number(e.damage) > 0 ? ` for ${e.damage} damage` : ''}${Number(e.healAmount) > 0 ? ` and restores ${e.healAmount} HP` : ''}.`;
    case 'use_item': return `${actor} uses ${name(String(e.itemId ?? ''), 'item') || 'an item'}${Number(e.healAmount) > 0 ? ` and restores ${e.healAmount} HP` : ''}${Number(e.spGain) > 0 ? ` and ${e.spGain} SP` : ''}.`;
    case 'regen': {
      if (e.hpGain != null || e.spGain != null) return `${actor} regenerates ${[Number(e.hpGain) > 0 ? `${e.hpGain} HP` : '', Number(e.spGain) > 0 ? `${e.spGain} SP` : ''].filter(Boolean).join(' and ') || '0 HP'}.`;
      return `${actor} regenerates ${Number(e.amount ?? 0)} ${String(e.resource ?? 'HP').replace(/_regen$/, '').toUpperCase()}.`;
    }
    case 'sp_regen': return `${actor} regenerates ${Number(e.amount ?? 0)} SP.`;
    case 'move': {
      const from = e.from?.column ?? e.fromGridPosition?.column ?? e.fromPosition;
      const to = e.to?.column ?? e.toGridPosition?.column ?? e.toPosition;
      const rowDelta = Math.abs(Number(e.to?.row ?? e.toGridPosition?.row ?? 0) - Number(e.from?.row ?? e.fromGridPosition?.row ?? 0));
      const spaces = Number(e.spacesMoved ?? Math.max(rowDelta, Math.abs(Number(to ?? 0) - Number(from ?? 0))));
      const arrow = to > from ? ' →' : to < from ? ' ←' : e.direction === 'right' || e.direction === 1 ? ' →' : e.direction === 'left' || e.direction === -1 ? ' ←' : '';
      if (e.reason === 'push' || e.reason === 'violent_shot_push') {
        const pushArrow = arrow === ' →' ? ' -->' : arrow === ' ←' ? ' <--' : '';
        return `${actor} pushes ${target} for ( ${spaces} ) ${spaces === 1 ? 'space' : 'spaces'}${pushArrow}.`;
      }
      return `${actor} moves ( ${spaces} ) ${spaces === 1 ? 'space' : 'spaces'}${arrow}.`;
    }
    case 'ko': return `${actor} is knocked out!`;
    case 'revive': return `${target} returns to battle!`;
    default: return `${actor}: ${String(e.action ?? 'battle event').replace(/_/g, ' ')}.`;
  }
}
export function battleEventTone(event: any): string {
  const e = { ...event, ...(event.payload ?? {}) };
  if (e.actor === 'monster' && ['regen', 'sp_regen'].includes(e.action)) return 'foe-regen';
  if (['regen', 'sp_regen', 'revive'].includes(e.action) || Number(e.healAmount) > 0 && !Number(e.damage)) return 'healing';
  if (['attack', 'use_skill', 'status_damage'].includes(e.action) && Number(e.damage) > 0) return e.actor === 'character' ? 'outgoing' : 'incoming';
  if (String(e.action).startsWith('status')) return 'status';
  if (['cast_start', 'use_skill', 'use_item'].includes(e.action)) return 'skill';
  return 'muted';
}
export function visibleBattleEvent(event: any): boolean {
  if (['range_blocked', 'action_suppressed'].includes(event.action)) return false;
  if (event.action !== 'regen' && event.action !== 'sp_regen') return true;
  const e = { ...event, ...(event.payload ?? {}) };
  return Number(e.hpGain ?? 0) > 0 || Number(e.spGain ?? 0) > 0 || Number(e.amount ?? 0) > 0;
}
