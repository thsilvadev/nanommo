// A hungry member cannot leave Town with the party (the solo Town Guard rule): Auto Feed does not
// feed them on the way out. Run after `pnpm --filter @nanommo/api build`.
const assert = require('node:assert/strict');
const { PartyService } = require('../dist/apps/api/src/modules/party/party.service');
(async () => {
  const town = { id: 'town', type: 'town', coordinates: { x: 0, y: 0 } }, field = { id: 'field', type: 'grind', coordinates: { x: 1, y: 0 } };
  const later = new Date(10_000).toISOString(), earlier = new Date(500).toISOString();
  const run = async (memberFood) => {
    const service = Object.create(PartyService.prototype), events = [];
    const characters = [
      { id: 'a', userId: 'u1', name: 'Leader', currentMapId: 'town', discoveredMapIds: ['town'], diet: [{ itemId: 'food_bread', digestUntil: later }] },
      { id: 'b', userId: 'u2', name: 'Member', currentMapId: 'town', ...memberFood },
    ];
    const ctx = { now: 1000, party: { id: 'p', kind: 'manual', leaderCharacterId: 'a', mapId: 'town', activity: null }, members: [{ characterId: 'a' }, { characterId: 'b' }], characters,
      manager: { getRepository: () => ({ findOneBy: async () => ({ emailVerified: true }) }) } };
    let travelled = false;
    Object.assign(service, {
      data: { getMapById: (id) => (id === 'town' ? town : field), getMaps: () => [town, field] },
      // Auto Feed would feed anyone with food in the bag: leaving Town must not rely on it.
      battle: { preparePartyFood: async () => true },
      serialized: async (_ids, fn) => fn(ctx), isBusy: async () => false, changed: async () => {}, get: async () => null,
      event: async (_m, id, name, payload) => events.push({ id, name, payload }),
      advanceRoute: async () => { travelled = true; },
    });
    await service.travel('a', 'field');
    return { travelled, events };
  };
  const hungry = await run({ diet: [{ itemId: 'food_bread', digestUntil: earlier }] });
  assert.equal(hungry.travelled, false, 'a hungry member keeps the party in Town');
  assert(hungry.events.some((e) => e.name === 'party:actionUpdated' && /Member/.test(e.payload.message)), 'the Town Guard names who is hungry');
  assert.equal((await run({ diet: [] })).travelled, false, 'no Diet at all is hungry too');
  assert.equal((await run({ diet: [{ itemId: 'food_bread', digestUntil: later }] })).travelled, true, 'everyone fed: the party leaves');
  assert.equal((await run({ diet: [], activeFoodBuff: { itemId: 'food_bread', expiresAt: later } })).travelled, true, 'a legacy active food buff counts, like solo');
  console.log('party-town-hunger: hungry members keep the party in Town; Auto Feed does not feed them on the way out');
})().catch((e) => { console.error(e); process.exitCode = 1; });
