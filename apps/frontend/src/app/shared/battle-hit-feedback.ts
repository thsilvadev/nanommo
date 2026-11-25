import { Directive, ElementRef, Input, NgZone, OnDestroy, OnInit, inject } from '@angular/core';
import { BattleStore } from '../core/game.store';
import { battleTickAt } from './battle-timing';
import { ArenaFeedbackOwner } from '../features/play/arena/arena-feedback-owner.service';

// The pure rules live in battle-feedback-style.ts (shared with the battle arena, no Angular); re-exported here.
export * from './battle-feedback-style';
import { damageFeedbackStyle, isFloatingDamageEvent, type BattleDamageTarget, type FloatingDamageEvent } from './battle-feedback-style';

@Directive({ selector: '[battleHitFeedback]', standalone: true })
export class BattleHitFeedbackDirective implements OnInit, OnDestroy {
  @Input('battleHitFeedback') target: BattleDamageTarget = 'character';
  private readonly host = inject(ElementRef<HTMLElement>).nativeElement;
  private readonly battle = inject(BattleStore);
  private readonly zone = inject(NgZone);
  /** While the battle arena is shown, it owns the numbers and flashes. */
  private readonly owner = inject(ArenaFeedbackOwner);
  private timer: ReturnType<typeof setInterval> | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private battleId = '';
  private lastEventIndex = -1;
  private sequence = 0;
  private readonly elements = new Set<HTMLElement>();
  private readonly cleanupTimers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

  ngOnInit(): void {
    this.host.classList.add('battle-feedback-anchor');
    // Pure DOM work (floating numbers, flashes): polled outside the Angular zone so the
    // 12.5 Hz poll and its cleanup timeouts never re-check the whole app.
    this.zone.runOutsideAngular(() => {
      this.timer = setInterval(() => this.update(), 80);
      this.update();
    });
  }

  private update(): void {
    const entry: any = this.battle.active();
    if (!entry?.id || !entry.startAt || !entry.log) { this.reset(); return; }
    const startAt = Date.parse(entry.startAt);
    if (!Number.isFinite(startAt) || Date.now() < startAt) return;
    const tick = battleTickAt(entry, Date.now());
    if (tick === null) { this.reset(); return; }
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
      if (!isFloatingDamageEvent(event) || event.target !== this.target || this.owner.arenaVisible()) continue;
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
    el.style.setProperty('--damage-duration', `${(1050 + (serial % 3) * 70) * 1.25}ms`);
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
    // the monster's 3D model replaces its sprite once loaded (grind-info `.foe-3d-ready`): flash whichever is shown
    const target = this.target === 'monster'
      ? this.host.querySelector(this.host.classList.contains('foe-3d-ready') ? '.foe-3d' : '.foe-sprite') as HTMLElement | null
      : this.host;
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
    this.host.querySelectorAll('.foe-sprite, .foe-3d').forEach((el: Element) => el.classList.remove('battle-hit-flash--monster'));
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
