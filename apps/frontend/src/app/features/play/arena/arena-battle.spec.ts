import { defaultAppearance } from '@nanommo/shared';
import { fromSharedBattle, fromSoloEntry } from './arena-battle';
import type { ArenaCharacterLook } from './arena.types';
import { SOLO_V2_ENTRY } from './fixtures/solo-v2.fixture';
import { PARTY_V2_VIEW } from './fixtures/party-v2.fixture';

const look: ArenaCharacterLook = {
  sex: 'male', heightCm: 181, appearance: defaultAppearance(), dominantHand: 'right',
  equipment: { mainHand: 'equip_bow_t1' }, refinement: null, mainHandType: 'bow', offHandType: null,
};
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('fromSoloEntry', () => {
  it('builds two actors on their deployment cells, the character on team a', () => {
    const battle = fromSoloEntry(SOLO_V2_ENTRY, { id: 'char-self', look, attackStyle: 'bow' })!;
    const input = SOLO_V2_ENTRY.log.header.v2Input;
    expect(battle.actors.length).toBe(2);
    const self = battle.actors.find((a) => a.kind === 'character')!;
    const foe = battle.actors.find((a) => a.kind === 'monster')!;
    expect(self.team).toBe('a');
    expect(self.start).toEqual(input.actors.find((a: any) => a.kind === 'character').position);
    expect(foe.start).toEqual(input.actors.find((a: any) => a.kind === 'monster').position);
    expect(foe.monsterId).toBe('mon_mutantbee');
    expect(self.look).toBe(look);
    expect(self.attackStyle).toBe('bow');
    expect(battle.selfId).toBe('char-self');
    expect(battle.mapId).toBe('map_green_grounds_2');
  });

  it('keeps the timing and the V2 events', () => {
    const battle = fromSoloEntry(SOLO_V2_ENTRY, { id: 'char-self', look, attackStyle: 'bow' })!;
    expect(battle.startAtMs).toBe(Date.parse(SOLO_V2_ENTRY.startAt));
    expect(battle.endAtMs).toBe(Date.parse(SOLO_V2_ENTRY.endAt));
    expect(battle.tickMs).toBe(500);
    expect(battle.events.length).toBe(SOLO_V2_ENTRY.log.v2Events.length);
    expect(battle.events.filter((e) => e.action === 'move').length).toBe(8);
    expect(battle.flee).toBeNull();
    expect(battle.outcome).toBe('win');
  });

  it('a legacy entry without V2 events gives null', () => {
    const legacy = clone(SOLO_V2_ENTRY);
    delete legacy.log.v2Events;
    expect(fromSoloEntry(legacy, { id: 'char-self', look, attackStyle: 'melee' })).toBeNull();
  });

  it('a fled entry carries the flee time', () => {
    const fled = { ...clone(SOLO_V2_ENTRY), cancellationReason: 'flee', cancelledAt: '2026-11-24T12:00:04.000Z' };
    expect(fromSoloEntry(fled, { id: 'char-self', look, attackStyle: 'melee' })!.flee).toEqual({ atMs: Date.parse('2026-11-24T12:00:04.000Z') });
  });

  it('asks for the monster attack style', () => {
    const battle = fromSoloEntry(SOLO_V2_ENTRY, { id: 'char-self', look, attackStyle: 'melee' }, { monsterStyle: (id) => (id === 'mon_mutantbee' ? 'bow' : 'melee') })!;
    expect(battle.actors.find((a) => a.kind === 'monster')!.attackStyle).toBe('bow');
  });
});

describe('fromSharedBattle', () => {
  it('splits five actors into teams 2 / 3 with their placed cells', () => {
    const battle = fromSharedBattle(PARTY_V2_VIEW, 'char-self');
    expect(battle.actors.length).toBe(5);
    expect(battle.actors.filter((a) => a.team === 'a').length).toBe(2);
    expect(battle.actors.filter((a) => a.team === 'b').length).toBe(3);
    expect(battle.actors.find((a) => a.id === 'monster:mon_slime:2')!.start).toEqual({ row: 4, column: 9 });
    expect(battle.startAtMs).toBe(Date.parse(PARTY_V2_VIEW.startAt));
    expect(battle.tickMs).toBe(500);
    expect(battle.mapId).toBe('map_kwaioua_forest_0');
    expect(battle.selfId).toBe('char-self');
  });

  it('turns a character look into an arena look with hand types', () => {
    const view = clone(PARTY_V2_VIEW);
    view.snapshot.actors[0].look = { sex: 'female', heightCm: 170, appearance: defaultAppearance(), dominantHand: 'left', equipment: { mainHand: 'equip_bow_t1' }, refinement: null };
    const battle = fromSharedBattle(view, 'char-self', { handTypes: () => ({ main: 'bow', off: null }) });
    const actor = battle.actors.find((a) => a.id === view.snapshot.actors[0].id)!;
    expect(actor.look!.mainHandType).toBe('bow');
    expect(actor.look!.dominantHand).toBe('left');
    expect(actor.attackStyle).toBe('bow');
  });

  it('a character without a look has look null', () => {
    const battle = fromSharedBattle(PARTY_V2_VIEW, 'char-self');
    expect(battle.actors.find((a) => a.kind === 'character')!.look).toBeNull();
  });

  it('a fled shared battle flees at its end time', () => {
    const view = { ...clone(PARTY_V2_VIEW), state: 'fled' };
    expect(fromSharedBattle(view, 'char-self').flee).toEqual({ atMs: Date.parse(view.endAt) });
  });
});
