// Battle arena: shared (party) battles carry each character's look, and the party
// state carries the next encounter time, so the arena can draw and time party battles.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SharedBattleService } = require('../dist/apps/api/src/modules/party/shared-battle.service');
const { loadArenaLooks, nextPartyEncounterAt } = require('../dist/apps/api/src/modules/party/party-arena');

const appearance = { v: 1, hair: 2, hairColor: 1, skin: 1, face: 0, nose: 0, mouth: 0, mouthDetails: 0, chest: 0, facialHair: 0, piercing: 0, tattoo: 0 };

(async () => {
  // --- loadArenaLooks: one query for every character -----------------------------
  const calls = [];
  const looks = await loadArenaLooks(async (sql, params) => {
    calls.push({ sql, params });
    return [
      { id: 'c1', appearance, sex: 'female', heightCm: 168, dominantHand: 'left', equipment: { mainHand: 'equip_bow_t1', body: 'equip_body_phys_t2', ring: 'x' }, refinement: { mainHand: 11 } },
      { id: 'c2', appearance: null, sex: null, heightCm: null, dominantHand: null, equipment: null, refinement: null },
    ];
  }, ['c1', 'c2']);
  assert.equal(calls.length, 1, 'one query for all characters');
  assert.deepEqual(calls[0].params, [['c1', 'c2']]);
  assert.match(calls[0].sql, /equipped_items/);
  assert.deepEqual(looks.get('c1'), { sex: 'female', heightCm: 168, appearance, dominantHand: 'left', equipment: { mainHand: 'equip_bow_t1', body: 'equip_body_phys_t2' }, refinement: { mainHand: 11 } });
  assert.equal(looks.get('c2'), null, 'no appearance → no look');
  assert.equal((await loadArenaLooks(async () => { throw new Error('must not query'); }, [])).size, 0);

  // --- publicBattle: character actors get `look`, monsters do not -------------------
  const service = Object.create(SharedBattleService.prototype);
  const queries = [];
  const row = {
    id: 'b1', revision: 2, partyId: 'p1', mapId: 'map_green_grounds_0', startAt: new Date(0), endAt: new Date(10_000), state: 'running',
    snapshot: { definitions: {}, actors: [
      { id: 'c1', name: 'One', kind: 'character', team: 'a', position: { row: 5, column: 0 }, snapshot: { hp: 10, sp: 5, maxHp: 10, maxSp: 5 } },
      { id: 'monster:mon_slime:0', name: 'Slime', kind: 'monster', team: 'b', definitionId: 'mon_slime', position: { row: 5, column: 9 }, snapshot: { hp: 30, sp: 0, maxHp: 30, maxSp: 0 } },
    ] },
    log: { outcome: 'win', events: [], durationTicks: 4, actorsAfter: {} },
  };
  service.db = { query: async (sql, params) => {
    queries.push(sql);
    if (/FROM shared_battles/.test(sql)) return [row];
    if (/equipped_items/.test(sql)) return [{ id: 'c1', appearance, sex: 'male', heightCm: 181, dominantHand: 'right', equipment: { mainHand: 'equip_sword_t3' }, refinement: null }];
    throw new Error(`unexpected query ${sql}`);
  } };
  const view = await service.publicBattle('c1');
  const character = view.snapshot.actors.find((a) => a.id === 'c1');
  const monster = view.snapshot.actors.find((a) => a.kind === 'monster');
  assert.equal(character.look.equipment.mainHand, 'equip_sword_t3');
  assert.deepEqual(character.position, { row: 5, column: 0 });
  assert.equal('look' in monster, false, 'monsters carry no look');
  assert.equal(queries.length, 2, 'battle row + one looks query');

  // --- a fled shared battle ends at the flee, not at its precomputed end ------------------
  const fledRow = { ...row, state: 'fled', endAt: new Date(10_000), result: { fledAt: '1970-01-01T00:00:03.500Z', checkpoint: { durationTicks: 7 } } };
  service.db = { query: async (sql) => (/FROM shared_battles/.test(sql) ? [fledRow] : []) };
  assert.equal(new Date((await service.publicBattle('c1')).endAt).toISOString(), '1970-01-01T00:00:03.500Z', 'fled battle ends at fledAt');
  const olderFled = { ...fledRow, result: { checkpoint: { durationTicks: 7 } } };
  service.db = { query: async (sql) => (/FROM shared_battles/.test(sql) ? [olderFled] : []) };
  assert.equal(new Date((await service.publicBattle('c1')).endAt).getTime(), 7 * 500, 'older fled rows: startAt + checkpoint ticks');
  const sharedSource = fs.readFileSync(path.join(__dirname, '../src/modules/party/shared-battle.service.ts'), 'utf8');
  assert.match(sharedSource, /fledAt:fled\?new Date\(ctx\.now\)\.toISOString\(\):null/, 'resolve records when the party fled');

  // --- next party encounter -----------------------------------------------------------
  const due = new Date('2026-11-24T12:00:05.000Z');
  let clockParams = null;
  assert.equal(await nextPartyEncounterAt(async (sql, params) => { clockParams = params; assert.match(sql, /encounter_clocks/); assert.match(sql, /'searching'/); return [{ dueAt: due }]; }, 'p1'), due.toISOString());
  assert.deepEqual(clockParams, ['p1']);
  assert.equal(await nextPartyEncounterAt(async () => [], 'p1'), null);

  // PartyService.get returns it (source contract: it needs the database to run).
  const partySource = fs.readFileSync(path.join(__dirname, '../src/modules/party/party.service.ts'), 'utf8');
  assert.match(partySource, /nextEncounterAt\s*=\s*await nextPartyEncounterAt\(/);
  assert.match(partySource, /return \{party,battle,invites,actions:await this\.actions\(characterId\),autoPartyEnabled:[^}]*,nextEncounterAt\}/);
  // --- party members carry their look (the arena draws a partner before any shared battle) ---
  const { PartyService } = require('../dist/apps/api/src/modules/party/party.service');
  const party = Object.create(PartyService.prototype);
  const memberRows = [{ characterId: 'c1', name: 'One', orderIndex: 0, pendingLeave: false, hpCurrent: 10, spCurrent: 5, statusEffects: [] }, { characterId: 'c2', name: 'Two', orderIndex: 1, pendingLeave: false, hpCurrent: 10, spCurrent: 5, statusEffects: [] }];
  party.member = async () => ({ partyId: 'p1', characterId: 'c1' });
  party.actions = async () => [];
  party.shared = { publicBattle: async () => null };
  party.battle = { buildCharacterSnapshot: async () => ({ maxHp: 10, maxSp: 5 }) };
  party.db = {
    getRepository: () => ({ findOneBy: async ({ id }) => ({ id, hpCurrent: 10, spCurrent: 5, consumableCooldowns: {} }) }),
    query: async (sql) => {
      if (/FROM parties WHERE id/.test(sql)) return [{ id: 'p1', kind: 'manual', leaderCharacterId: 'c1', mapId: 'map_town', revision: 3, activity: null }];
      if (/FROM party_members m JOIN characters/.test(sql)) return memberRows;
      if (/equipped_items/.test(sql)) return [{ id: 'c1', appearance, sex: 'male', heightCm: 181, dominantHand: 'right', equipment: { mainHand: 'equip_bow_t1' }, refinement: null }, { id: 'c2', appearance, sex: 'female', heightCm: 165, dominantHand: 'left', equipment: {}, refinement: null }];
      return [];
    },
  };
  const state = await party.get('c1');
  assert.equal(state.party.members.find((m) => m.characterId === 'c2').look.sex, 'female', 'a member carries its look');
  assert.equal(state.party.members.find((m) => m.characterId === 'c1').look.equipment.mainHand, 'equip_bow_t1');

  console.log('party-arena-visuals: passed');
})().catch((error) => { console.error(error); process.exit(1); });
