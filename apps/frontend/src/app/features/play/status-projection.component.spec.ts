import { signal } from '@angular/core';
import { CharacterSummary, GrindInfo } from './components';

describe('shared status timeline in Character Summary and Grind STATUS', () => {
  function harness() {
    const startAt = '2026-10-16T12:00:00.000Z';
    const startMs = Date.parse(startAt);
    const entry: any = {
      id: 'battle-1', startAt, endAt: new Date(startMs + 10_000).toISOString(), monsterId: 'monster-1',
      log: {
        header: {
          characterSnapshot: { statusEffects: [] },
          monsterSnapshot: { statusEffects: [{ type: 'freeze', appliedAtTick: 0, expiresAtTick: 4, sourceSkillId: 'ice_bolt' }] },
        },
        events: [
          { tick: 1, actor: 'monster', target: 'character', action: 'status_applied', status: 'poison', durationTicks: 5, sourceSkillId: 'poison_sting' },
          { tick: 2, actor: 'character', target: 'monster', action: 'status_stack_applied', status: 'bleed', durationTicks: 6, expiresAtTick: 8, stackCount: 1, sourceSkillId: 'heavy_swing' },
          { tick: 3, actor: 'monster', target: 'character', action: 'status_ended', status: 'poison', sourceSkillId: 'antidote' },
          { tick: 4, actor: 'character', target: 'monster', action: 'status_stack_applied', status: 'bleed', durationTicks: 5, expiresAtTick: 9, stackCount: 2, sourceSkillId: 'heavy_swing' },
        ],
      },
    };
    const statuses: any = {
      freeze: { id: 'freeze', name: 'Freeze', maxStacks: 3, moveSpeedPenaltyPerStack: 25 },
      poison: { id: 'poison', name: 'Poison', maxStacks: 1 },
      bleed: { id: 'bleed', name: 'Bleed', maxStacks: 5 },
    };
    const catalog: any = { statusEffect: (id: string) => statuses[id] ?? null, monster: () => ({ id: 'monster-1' }), skills: () => [] };
    const now = signal(startMs);
    const active = signal<any>(entry);
    const characterSummary: any = Object.create(CharacterSummary.prototype);
    Object.assign(characterSummary, { battle: { active: () => active() }, battleDisplayNow: now, catalog });
    const grindInfo: any = Object.create(GrindInfo.prototype);
    Object.assign(grindInfo, { now, catalog });
    return { entry, now, active, characterSummary, grindInfo, startMs };
  }

  it('shows character-target and monster-target statuses at the same event ticks only', () => {
    const h = harness();
    h.now.set(h.startMs + 500);
    expect(h.characterSummary.activeStatusEffects('character').map((row: any) => row.id)).toEqual([]);
    expect(h.grindInfo.monsterStatusEffects(h.entry).map((row: any) => row.id)).toEqual(['freeze']);

    h.now.set(h.startMs + 1000);
    expect(h.characterSummary.activeStatusEffects('character').map((row: any) => row.id)).toEqual(['poison']);
    expect(h.grindInfo.monsterStatusEffects(h.entry).map((row: any) => row.id)).toEqual(['freeze']);

    h.now.set(h.startMs + 2000);
    const monsterStatuses = h.grindInfo.monsterStatusEffects(h.entry);
    expect(monsterStatuses.map((row: any) => row.id)).toEqual(['freeze', 'bleed']);
    expect(monsterStatuses.find((row: any) => row.id === 'bleed')?.stacks).toBe(1);
    expect(h.characterSummary.activeStatusEffects('character').map((row: any) => row.id)).toEqual(['poison']);

    h.now.set(h.startMs + 3000);
    expect(h.characterSummary.activeStatusEffects('character').map((row: any) => row.id)).toEqual([]);
    expect(h.grindInfo.monsterStatusEffects(h.entry).find((row: any) => row.id === 'bleed')?.stacks).toBe(1);

    h.now.set(h.startMs + 4000);
    expect(h.grindInfo.monsterStatusEffects(h.entry).find((row: any) => row.id === 'freeze')).toBeUndefined();
    expect(h.grindInfo.monsterStatusEffects(h.entry).find((row: any) => row.id === 'bleed')?.stacks).toBe(2);

    h.now.set(h.startMs + 8000);
    expect(h.grindInfo.monsterStatusEffects(h.entry).find((row: any) => row.id === 'bleed')?.stacks).toBe(1);
    h.now.set(h.startMs + 9000);
    expect(h.grindInfo.monsterStatusEffects(h.entry).find((row: any) => row.id === 'bleed')).toBeUndefined();
  });

  it('clears status projections at battle end without mutating immutable log snapshots', () => {
    const h = harness();
    const before = JSON.stringify(h.entry.log);
    h.now.set(Date.parse(h.entry.endAt));
    expect(h.characterSummary.activeStatusEffects('character')).toEqual([]);
    expect(h.grindInfo.monsterStatusEffects(h.entry)).toEqual([]);
    expect(JSON.stringify(h.entry.log)).toBe(before);
  });
});
