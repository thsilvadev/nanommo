import { Directive, ElementRef, Input, OnDestroy, OnInit, inject } from '@angular/core';
import { BattleStore } from '../core/game.store';

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
export function isFloatingDamageEvent(event: FloatingDamageEvent): event is FloatingDamageEvent & { target: BattleDamageTarget; damage: number } {
  return (event.target === 'character' || event.target === 'monster') && Number(event.damage ?? 0) > 0;
}

@Directive({ selector: '[battleHitFeedback]', standalone: true })
export class BattleHitFeedbackDirective implements OnInit, OnDestroy {
  @Input('battleHitFeedback') target: BattleDamageTarget = 'character';
  private readonly host = inject(ElementRef<HTMLElement>).nativeElement;
  private readonly battle = inject(BattleStore);
  private timer: ReturnType<typeof setInterval> | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private battleId = '';
  private lastEventIndex = -1;
  private sequence = 0;
  private readonly elements = new Set<HTMLElement>();
  private readonly cleanupTimers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

  ngOnInit(): void {
    this.host.classList.add('battle-feedback-anchor');
    this.timer = setInterval(() => this.update(), 80);
    this.update();
  }

  private update(): void {
    const entry: any = this.battle.active();
    if (!entry?.id || !entry.startAt || !entry.log) { this.reset(); return; }
    const startAt = Date.parse(entry.startAt);
    if (!Number.isFinite(startAt) || Date.now() < startAt) return;
    const tick = Math.floor((Date.now() - startAt) / 1000);
    const events: FloatingDamageEvent[] = Array.isArray(entry.log.events) ? entry.log.events : [];
    if (entry.id !== this.battleId) {
      this.clearEffects();
      this.battleId = entry.id;
      this.lastEventIndex = events.reduce((last, event, index) => Number(event.tick ?? 0) < tick ? index : last, -1);
    }
    for (let i = this.lastEventIndex + 1; i < events.length; i++) {
      const event = events[i];
      if (Number(event.tick ?? 0) > tick) break;
      this.lastEventIndex = i;
      if (!isFloatingDamageEvent(event) || event.target !== this.target) continue;
      this.showDamage(event);
      this.flash();
    }
  }

  private showDamage(event: FloatingDamageEvent & { damage: number }): void {
    const el = document.createElement('span');
    const style = damageFeedbackStyle(event);
    const serial = this.sequence++;
    el.className = `floating-damage floating-damage--${style}`;
    el.textContent = String(Math.floor(event.damage));
    el.setAttribute('aria-hidden', 'true');
    el.style.setProperty('--damage-offset-x', `${((serial % 5) - 2) * 12}px`);
    el.style.setProperty('--damage-offset-y', `${(serial % 3) * 7}px`);
    el.style.setProperty('--damage-duration', `${1050 + (serial % 3) * 70}ms`);
    this.host.appendChild(el);
    this.elements.add(el);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const remove = () => {
      el.removeEventListener('animationend', remove);
      if (timer !== null) clearTimeout(timer);
      this.cleanupTimers.delete(el);
      el.remove();
      this.elements.delete(el);
    };
    el.addEventListener('animationend', remove, { once: true });
    timer = setTimeout(remove, 1800);
    this.cleanupTimers.set(el, timer);
  }

  private flash(): void {
    const target = this.target === 'monster' ? this.host.querySelector('.foe-sprite') as HTMLElement | null : this.host;
    if (!target) return;
    const cls = this.target === 'character' ? 'battle-hit-flash--character' : 'battle-hit-flash--monster';
    target.classList.remove(cls);
    void target.offsetWidth;
    target.classList.add(cls);
    if (this.flashTimer !== null) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => { target.classList.remove(cls); this.flashTimer = null; }, 190);
  }

  private clearEffects(): void {
    if (this.flashTimer !== null) clearTimeout(this.flashTimer);
    this.flashTimer = null;
    this.host.classList.remove('battle-hit-flash--character', 'battle-hit-flash--monster');
    this.host.querySelector('.foe-sprite')?.classList.remove('battle-hit-flash--monster');
    for (const timer of this.cleanupTimers.values()) clearTimeout(timer);
    this.cleanupTimers.clear();
    for (const el of this.elements) el.remove();
    this.elements.clear();
  }
  private reset(): void { this.clearEffects(); this.battleId = ''; this.lastEventIndex = -1; }
  ngOnDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.reset();
    this.host.classList.remove('battle-feedback-anchor');
  }
}
