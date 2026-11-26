// Changing the party's destination during a shared battle: the route is kept (paused) instead of
// PARTY_BUSY, and the party tries to flee; it only gets away when every living member beats every
// living enemy targeting it. Run after `pnpm --filter @nanommo/shared build && pnpm --filter @nanommo/api build`.
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const shared = require(path.join(root, 'packages/shared/dist'));
const { PartyService } = require('../dist/apps/api/src/modules/party/party.service');
const { SharedBattleService } = require('../dist/apps/api/src/modules/party/shared-battle.service');

(async () => {
  // --- travel() while fighting: a paused route that asks to flee that battle ----------------------
  {
    const a = { id: 'field1', type: 'grind', coordinates: { x: 0, y: 0 } }, b = { id: 'field2', type: 'grind', coordinates: { x: 1, y: 0 } };
    const service = Object.create(PartyService.prototype);
    const ctx = { now: 10_000, party: { id: 'p', kind: 'manual', leaderCharacterId: 'l', mapId: 'field1', activity: null }, members: [{ characterId: 'l' }, { characterId: 'm' }],
      characters: [{ id: 'l', userId: 'u1', name: 'Leader', currentMapId: 'field1', discoveredMapIds: ['field1', 'field2'] }, { id: 'm', userId: 'u2', name: 'Member', currentMapId: 'field1' }],
      manager: {
        getRepository: () => ({ findOneBy: async () => ({ emailVerified: true }) }),
        query: async (sql) => (/active_battle_participants/.test(sql) ? [{ id: 'battle-1', endAt: new Date(40_000) }] : []),
      } };
    Object.assign(service, {
      data: { getMapById: (id) => (id === 'field1' ? a : b), getMaps: () => [a, b] },
      serialized: async (_ids, fn) => fn(ctx), isBusy: async () => true, changed: async () => {}, get: async () => null, event: async () => {},
      advanceRoute: async (c) => { Object.assign(c.party.activity, { segmentStartedAt: c.now, segmentDueAt: c.now + 6000, remainingMs: 6000 }); },
    });
    await service.travel('l', 'field2');
    const route = ctx.party.activity;
    assert.equal(route?.kind, 'route', 'the new destination is kept (no PARTY_BUSY)');
    assert.equal(route.destinationMapId, 'field2');
    assert.equal(route.paused, true, 'the trip waits for the battle');
    assert.equal(route.remainingMs, 6000, 'the whole first segment is still ahead');
    assert.equal(route.fleeBattleId, 'battle-1', 'the party tries to flee the battle it is in');

    // Busy for another reason (a member's legacy solo battle): still refused.
    ctx.party.activity = null;
    ctx.manager.query = async () => [];
    await assert.rejects(() => service.travel('l', 'field2'), /PARTY BUSY/);
  }

  // --- tickParty during that battle: tries to flee, then reports the change ----------------------------
  {
    const service = Object.create(PartyService.prototype);
    const calls = [];
    const ctx = { now: 12_000, party: { id: 'p', kind: 'manual', leaderCharacterId: 'l', mapId: 'field1', activity: { kind: 'route', paused: true, fleeBattleId: 'battle-1' } }, members: [{ characterId: 'l' }], characters: [{ id: 'l' }],
      manager: { query: async (sql) => (/active_battle_participants/.test(sql) ? [{ id: 'battle-1', endAt: new Date(40_000) }] : []) } };
    Object.assign(service, {
      db: { query: async () => [{ characterId: 'l' }] }, serialized: async (_ids, fn) => fn(ctx),
      shared: { autoFlee: async (_ctx, leaderId) => { calls.push(leaderId); return true; }, resolve: async () => { throw new Error('the battle is not over'); } },
      changed: async () => calls.push('changed'),
    });
    await service.tickParty('p');
    assert.deepEqual(calls, ['l', 'changed'], 'the leader flees for the party, and the members hear of it');
    ctx.party.activity.fleeBattleId = 'another-battle';
    calls.length = 0;
    await service.tickParty('p');
    assert.deepEqual(calls, [], 'a battle met later on the trip is fought');
  }

  // --- autoFlee: the real flee roll, its cooldown, success resolves as fled ----------------------------
  {
    const statuses = Object.fromEntries(require(path.join(root, 'status_effects.json')).statusEffects.map((s) => [s.id, s]));
    const monsters = require(path.join(root, 'monsters.json'));
    const slime = (Array.isArray(monsters) ? monsters : (monsters.monsters ?? Object.values(monsters).flat())).find((m) => m.id === 'mon_slime');
    const snap = (speed) => ({ level: 10, hp: 900, maxHp: 900, sp: 50, maxSp: 50, atk: 1, matk: 1, def: 0, mdefPercent: 0, accuracy: 100, evasion: 0, critChance: 0,
      hpRegenPerTenTicks: 0, spRegenPerTenTicks: 0, agi: 5, dex: 5, attackSpeed: 100, moveSpeed: speed, luk: 5, characterId: 'l', characterName: 'Leader' });
    const attack = [{ priority: 1, conditions: [{ id: 'always' }], action: { id: 'attack' } }];
    const rowFor = (speed) => {
      const input = shared.simulateBattleV2Solo(snap(speed), slime, attack, 'flee-seed', { statusEffectDefs: statuses }).log.header.v2Input;
      input.actors.find((x) => x.kind === 'monster').snapshot.moveSpeed = 100;
      return { id: 'battle-1', seed: 'flee-seed', startAt: new Date(0), endAt: new Date(60_000), snapshot: input, log: { durationTicks: 120 } };
    };
    const run = async (speed, leader) => {
      const service = Object.create(SharedBattleService.prototype);
      const out = { resolved: false, events: [] };
      const row = rowFor(speed);
      const ctx = { now: 8_000, characters: [leader], manager: { query: async () => [row], getRepository: () => ({ save: async () => {} }) } };
      Object.assign(service, { resolve: async (_c, _r, _remove, fled) => { out.resolved = fled; return true; }, event: async (_m, id, name, payload) => out.events.push({ id, name, payload }) });
      out.result = await service.autoFlee(ctx, 'l', async () => {});
      return out;
    };
    // Monsters target the character from the first tick: a far faster character always gets away, a far slower one never does.
    const fast = await run(100_000, { id: 'l', fleeAttemptIndex: 0, fleeNextAttemptAt: null });
    assert.equal(fast.result, true); assert.equal(fast.resolved, true, 'everyone beat their attackers: the battle resolves as fled');
    const slow = { id: 'l', fleeAttemptIndex: 0, fleeNextAttemptAt: null };
    const failed = await run(1, slow);
    assert.equal(failed.result, false); assert.equal(failed.resolved, false, 'one lost roll: the party keeps fighting');
    assert(slow.fleeNextAttemptAt instanceof Date && slow.fleeNextAttemptAt.getTime() === 18_000, 'next try in 10 s, as for a solo flee');
    const waiting = await run(100_000, { id: 'l', fleeAttemptIndex: 0, fleeNextAttemptAt: new Date(9_000) });
    assert.equal(waiting.result, false); assert.equal(waiting.resolved, false, 'no roll before the cooldown ends (and no error)');
  }
  console.log('party-destination-during-battle: route kept while fighting, group flee tried every 10 s, success resolves as fled');
})().catch((e) => { console.error(e); process.exitCode = 1; });
