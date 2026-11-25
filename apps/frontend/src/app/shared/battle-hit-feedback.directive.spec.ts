import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BattleStore } from '../core/game.store';
import { ArenaFeedbackOwner } from '../features/play/arena/arena-feedback-owner.service';
import { BattleHitFeedbackDirective } from './battle-hit-feedback';

@Component({ standalone: true, imports: [BattleHitFeedbackDirective], template: `<div class="host" [battleHitFeedback]="'character'"></div>` })
class HostComponent {}

describe('BattleHitFeedbackDirective ownership', () => {
  const entry = () => ({
    id: 'e1', startAt: new Date(Date.now() - 100).toISOString(), endAt: new Date(Date.now() + 10_000).toISOString(), tickDurationMs: 500,
    log: { events: [{ tick: 1, actor: 'monster', target: 'character', action: 'attack', damage: 9 }] },
  });
  async function numbersShown(arenaVisible: boolean): Promise<number> {
    const active = signal<any>(entry());
    TestBed.configureTestingModule({ imports: [HostComponent], providers: [{ provide: BattleStore, useValue: { active } }] });
    TestBed.inject(ArenaFeedbackOwner).arenaVisible.set(arenaVisible);
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 700));
    const count = fixture.nativeElement.querySelectorAll('.floating-damage').length;
    fixture.destroy();
    return count;
  }

  it('shows the floating number in the panel while the arena is hidden', async () => {
    // The hit lands ~400 ms after the battle is first seen.
    expect(await numbersShown(false)).toBe(1);
  });

  it('panel feedback suppressed while arena visible', async () => {
    expect(await numbersShown(true)).toBe(0);
  });
});
