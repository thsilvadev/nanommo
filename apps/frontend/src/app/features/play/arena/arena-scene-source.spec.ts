import { defaultAppearance } from '@nanommo/shared';
import { ArenaSceneSource, type ArenaSourceInputs } from './arena-scene-source';
import type { ArenaCharacterLook } from './arena.types';
import { SOLO_V2_ENTRY } from './fixtures/solo-v2.fixture';
import { PARTY_V2_VIEW } from './fixtures/party-v2.fixture';

const look = (mainHand: string): ArenaCharacterLook => ({
  sex: 'male', heightCm: 181, appearance: defaultAppearance(), dominantHand: 'right', equipment: { mainHand }, refinement: null, mainHandType: 'sword', offHandType: null,
});
const entry = (id: string, startAtMs: number) => {
  const length = Date.parse(SOLO_V2_ENTRY.endAt) - Date.parse(SOLO_V2_ENTRY.startAt);
  return { ...SOLO_V2_ENTRY, id, startAt: new Date(startAtMs).toISOString(), endAt: new Date(startAtMs + length).toISOString() };
};
const START = Date.parse(SOLO_V2_ENTRY.startAt);
const LENGTH = Date.parse(SOLO_V2_ENTRY.endAt) - START;

function inputs(over: Partial<ArenaSourceInputs>): ArenaSourceInputs {
  return {
    nowMs: START + 1000, mapId: 'map_green_grounds_2', selfId: 'char-self', selfLook: look('equip_sword_t3'), selfAttackStyle: 'melee',
    soloQueue: [], resolved: [], shared: null, sharedReceivedAtMs: null, nextEncounterAt: null, partyIds: [], gatherAtMs: null, ...over,
  };
}

describe('ArenaSceneSource', () => {
  it('a running solo battle is the current battle, with both actors visible', () => {
    const source = new ArenaSceneSource();
    const frame = source.build(inputs({ soloQueue: [entry('e1', START)] }));
    expect(frame.scene.phase).toBe('battle');
    expect(frame.scene.battleId).toBe('e1');
    expect([...frame.visuals.keys()].sort()).toEqual(['char-self', 'monster:mon_mutantbee:0']);
    expect(frame.region).toBe('green_grounds');
  });

  it('the next queued battle drives the intro', () => {
    const source = new ArenaSceneSource();
    const frame = source.build(inputs({ nowMs: START - 500, soloQueue: [entry('e1', START)] }));
    expect(frame.scene.phase).toBe('intro');
  });

  it('a battle that left the queue still plays its outro', () => {
    const source = new ArenaSceneSource();
    source.build(inputs({ nowMs: START + LENGTH - 100, soloQueue: [entry('e1', START)] }));
    const frame = source.build(inputs({ nowMs: START + LENGTH + 100, soloQueue: [entry('e2', START + LENGTH + 3000)] }));
    expect(frame.scene.phase).toBe('outro');
  });

  it('a solo flee still plays after the entry leaves the queue: the character runs off', () => {
    const source = new ArenaSceneSource();
    source.build(inputs({ nowMs: START + 2000, soloQueue: [entry('e1', START)] }));
    const fledAt = START + 3000;
    const resolved = [{ entryId: 'e1', cancellationReason: 'flee', cancelledAt: new Date(fledAt).toISOString() }];
    const running = source.build(inputs({ nowMs: fledAt + 300, soloQueue: [], resolved }));
    expect(running.scene.phase).toBe('battle');
    expect(running.scene.frame.actors.find((a) => a.id === 'char-self')!.fleeing).toEqual({ sinceMs: fledAt });
    const after = source.build(inputs({ nowMs: fledAt + 1600, soloQueue: [], resolved }));
    expect(after.scene.phase).toBe('outro');
    expect(source.build(inputs({ nowMs: START + LENGTH + 200, soloQueue: [], resolved })).scene.phase).toBe('walk');
  });

  it('a regenerated entry that never started leaves no phantom outro', () => {
    const source = new ArenaSceneSource();
    source.build(inputs({ nowMs: START - 5000, soloQueue: [entry('e1', START)] }));
    const later = START + LENGTH + 10_000;
    source.build(inputs({ nowMs: START - 4000, soloQueue: [entry('e1b', later)] }));
    expect(source.build(inputs({ nowMs: START + LENGTH + 100, soloQueue: [entry('e1b', later)] })).scene.phase).toBe('walk');
  });

  it('a battle that ran is still the previous one after many regenerations', () => {
    const source = new ArenaSceneSource();
    source.build(inputs({ nowMs: START + 1000, soloQueue: [entry('e1', START)] }));
    for (let i = 0; i < 10; i++) source.build(inputs({ nowMs: START + 2000 + i, soloQueue: [entry('e1', START), entry(`gen${i}`, START + LENGTH + 60_000 + i * 1000)] }));
    expect(source.build(inputs({ nowMs: START + LENGTH + 100, soloQueue: [] })).scene.phase).toBe('outro');
  });

  it('production solo entries (self actor id "character") keep the viewing character in the party: it walks off after the battle', () => {
    // The API's solo snapshot carries no characterId, so solo-adapter names the actor 'character'.
    const prod = (id: string, startAtMs: number) => ({ ...JSON.parse(JSON.stringify(entry(id, startAtMs)).replace(/"char-self"/g, '"character"')), characterId: 'char-self' });
    const source = new ArenaSceneSource();
    const running = source.build(inputs({ nowMs: START + 1000, soloQueue: [prod('e1', START)] }));
    expect(running.scene.frame.actors.map((a) => a.id)).toContain('char-self');
    const outro = source.build(inputs({ nowMs: START + LENGTH + 300, soloQueue: [prod('e2', START + LENGTH + 3000)] }));
    const self = outro.scene.frame.actors.find((a) => a.id === 'char-self')!;
    expect(self.exit).toBeUndefined();
    expect(self.anim.base).toBe('Walk');
  });

  it('keeps playing battles after many have run (a 5-deep queue, battle after battle)', () => {
    // Production: after ~7 battles the arena kept only the walk while the portraits fought.
    const source = new ArenaSceneSource();
    const gap = LENGTH + 3000;
    const at = (i: number) => START + i * gap;
    for (let i = 0; i < 20; i++) {
      const queue = Array.from({ length: 5 }, (_, k) => entry(`e${i + k}`, at(i + k)));
      for (const t of [at(i) - 1000, at(i) + 1000, at(i) + LENGTH - 500]) {
        const frame = source.build(inputs({ nowMs: t, soloQueue: queue }));
        if (t > at(i)) expect(`${i}:${frame.scene.phase}:${frame.scene.battleId}`).toBe(`${i}:battle:e${i}`);
      }
    }
  });

  it('gear change during walk re-dresses before the next battle', () => {
    const source = new ArenaSceneSource();
    const walking = source.build(inputs({ nowMs: START - 5000, soloQueue: [entry('e1', START)], selfLook: look('equip_sword_t3') }));
    expect(walking.visuals.get('char-self')!.look!.equipment.mainHand).toBe('equip_sword_t3');
    const after = source.build(inputs({ nowMs: START - 4000, soloQueue: [entry('e1', START)], selfLook: look('equip_bow_t1') }));
    expect(after.visuals.get('char-self')!.look!.equipment.mainHand).toBe('equip_bow_t1');
  });

  it('party battle without look renders a placeholder actor (look null)', () => {
    const source = new ArenaSceneSource();
    const shared = PARTY_V2_VIEW;
    const frame = source.build(inputs({ nowMs: Date.parse(shared.startAt) + 1000, shared, sharedReceivedAtMs: Date.parse(shared.startAt), partyIds: ['char-self', 'char-ally'] }));
    expect(frame.scene.phase).toBe('battle');
    expect(frame.visuals.get('char-ally')!.look).toBeNull();
    expect(frame.visuals.get('char-self')!.look!.equipment.mainHand).toBe('equip_sword_t3');
  });

  it('a party walks in its order with the next encounter time', () => {
    const source = new ArenaSceneSource();
    const due = START + 10_000;
    const frame = source.build(inputs({ nowMs: due - 600, partyIds: ['char-self', 'char-ally'], nextEncounterAt: due }));
    expect(frame.scene.phase).toBe('intro');
    expect(frame.scene.frame.actors.map((a) => a.id)).toEqual(['char-self', 'char-ally']);
  });

  it('a gather kneels the viewing character', () => {
    const source = new ArenaSceneSource();
    const frame = source.build(inputs({ nowMs: START - 5000, gatherAtMs: START - 5300 }));
    expect(frame.scene.frame.actors[0].anim.oneShot?.clip).toBe('Gather');
  });
});
