/** Opt-in only: exercises durable commands and deadline guards on disposable PostgreSQL. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DataSource } = require('typeorm');
const entities = require('../dist/apps/api/src/database/entities');
const { PartyService } = require('../dist/apps/api/src/modules/party/party.service');
const { SharedBattleService } = require('../dist/apps/api/src/modules/party/shared-battle.service');
const { PartyDeadlineGuard1800600000000 } = require('../dist/apps/api/src/database/migrations/1800600000000-PartyDeadlineGuard');

if (process.env.PARTY_TEST_DATABASE !== 'nanommo_town_actions_test') {
  throw Error('Set PARTY_TEST_DATABASE=nanommo_town_actions_test for the disposable database');
}
const db = new DataSource({
  type: 'postgres', host: '127.0.0.1', port: 55439, username: 'party_test',
  database: 'nanommo_town_actions_test', entities: Object.values(entities).filter(e => typeof e === 'function'),
});
const item = { id: 'test_helmet', type: 'equipment', slot: 'head', levelReq: 1 };
const data = {
  getMapById: id => ({ id, type: id === 'map_town' ? 'town' : 'grind' }),
  getItemById: id => id === item.id ? item : null,
};
const shared = new SharedBattleService(db, {}, data, {
  addItem: async (characterId, itemId, quantity, location, instanceData, manager) => {
    await manager.getRepository(entities.InventoryItem).save({ characterId, itemId, quantity, location, slotIndex: 0, instanceData });
  },
}, {}, {});
const party = new PartyService(db, {}, data, shared);
let hero;
async function reserve(mapId, dueAt, ownerKind = 'character', ownerId = hero.id) {
  await db.query(`INSERT INTO encounter_clocks("ownerKind","ownerId","mapId","searchStartedAt","dueAt",seed,status)
    VALUES($1,$2,$3,clock_timestamp(),$4,'original-seed','searching')
    ON CONFLICT("ownerKind","ownerId") DO UPDATE SET "mapId"=$3,"dueAt"=$4,status='searching'`, [ownerKind, ownerId, mapId, dueAt]);
}
async function command(kind, payload) {
  const requestId = randomUUID();
  await party.serialized([hero.id], async ctx => {
    await shared.enqueue(ctx, hero.id, requestId, kind, payload);
  });
  await party.enqueueDrain(hero.id);
  return (await db.query('SELECT * FROM character_action_intents WHERE "clientRequestId"=$1', [requestId]))[0];
}
(async () => {
  await db.initialize();
  await db.synchronize(true);
  await db.query('DROP FUNCTION IF EXISTS check_party_deadline_at_commit()');
  const runner = db.createQueryRunner();
  try { await new PartyDeadlineGuard1800600000000().up(runner); } finally { await runner.release(); }
  const user = await db.getRepository(entities.User).save({ email: 'town-actions@test.invalid', emailVerified: true, provider: 'local' });
  hero = await db.getRepository(entities.Character).save({ userId: user.id, name: 'TownActions', hpCurrent: 100, spCurrent: 50, lastSeenAt: new Date(), currentMapId: 'map_town', status: 'town', unspentAttributePoints: 5 });
  const source = await db.getRepository(entities.InventoryItem).save({ characterId: hero.id, itemId: item.id, quantity: 1, location: 'inventory', slotIndex: 0, instanceData: { refinement: 2 } });
  await reserve('old_field', new Date(Date.now() - 60000));
  const equip = await command('equip', { slot: 'head', itemId: item.id, inventoryItemId: source.id });
  assert.equal(equip.status, 'applied', 'equipment must apply in town despite the overdue search left by travel');
  assert.equal((await db.getRepository(entities.EquippedItem).findOneBy({ characterId: hero.id, slot: 'head' })).itemId, item.id);
  assert.equal(await db.getRepository(entities.InventoryItem).countBy({ id: source.id }), 0);
  assert.equal((await db.query('SELECT status FROM encounter_clocks WHERE "ownerId"=$1', [hero.id]))[0].status, 'cancelled');
  assert.equal((await command('unequip', { slot: 'head' })).status, 'applied');
  assert.equal(await db.getRepository(entities.EquippedItem).countBy({ characterId: hero.id }), 0);
  assert.deepEqual((await db.getRepository(entities.InventoryItem).findOneBy({ characterId: hero.id })).instanceData, { refinement: 2 });

  // A town reservation is invalid even when its map ID matches the current map.
  await reserve('map_town', new Date(Date.now() - 1000));
  assert.equal((await command('attributes', { str: 1 })).status, 'applied');
  assert.equal((await db.getRepository(entities.Character).findOneBy({ id: hero.id })).str, 6);

  // Old-map reservations must also stop blocking commands after moving to another field.
  await db.getRepository(entities.Character).update(hero.id, { currentMapId: 'new_field', status: 'grinding' });
  await reserve('old_field', new Date(Date.now() - 1000));
  assert.equal((await command('attributes', { str: 1 })).status, 'applied');

  const future = new Date(Date.now() + 60000);
  await reserve('new_field', future);
  assert.equal((await command('attributes', { str: 1 })).status, 'applied');
  const validClock = (await db.query('SELECT * FROM encounter_clocks WHERE "ownerId"=$1', [hero.id]))[0];
  assert.equal(validClock.status, 'searching');
  assert.equal(validClock.dueAt.getTime(), future.getTime(), 'a valid encounter deadline must never move');
  assert.equal(validClock.seed, 'original-seed');
  await reserve('new_field', new Date(Date.now() - 1000));
  const waiting = await command('attributes', { str: 1 });
  assert.equal(waiting.status, 'pending', 'an overdue valid encounter still takes priority');
  await db.query(`UPDATE encounter_clocks SET status='consumed' WHERE "ownerId"=$1`, [hero.id]);
  await party.enqueueDrain(hero.id);
  assert.equal((await db.query('SELECT status FROM character_action_intents WHERE id=$1', [waiting.id]))[0].status, 'applied');
  await party.enqueueDrain(hero.id);
  assert.equal((await db.getRepository(entities.Character).findOneBy({ id: hero.id })).str, 9, 'retry must not apply a command twice');

  // An active shared battle remains immutable, even if character location is inconsistent.
  await db.getRepository(entities.Character).update(hero.id, { currentMapId: 'map_town', status: 'town' });
  const battleId = randomUUID();
  await db.query(`INSERT INTO shared_battles(id,"mapId",seed,"startAt","endAt",state,snapshot,log) VALUES($1,'new_field','battle',clock_timestamp(),clock_timestamp()+interval '1 minute','started','{}','{}')`, [battleId]);
  await db.query('INSERT INTO active_battle_participants("characterId","battleId") VALUES($1,$2)', [hero.id, battleId]);
  assert.equal((await command('unequip', { slot: 'head' })).status, 'pending');
  await db.query('DELETE FROM active_battle_participants WHERE "characterId"=$1', [hero.id]);
  await party.enqueueDrain(hero.id);
  // Group reservations receive the same reconciliation without bypassing valid group encounters.
  const partyId = randomUUID();
  await db.query(`INSERT INTO parties(id,kind,"leaderCharacterId","mapId") VALUES($1,'manual',$2,'map_town')`, [partyId, hero.id]);
  await db.query('INSERT INTO party_members("partyId","characterId","orderIndex") VALUES($1,$2,0)', [partyId, hero.id]);
  await reserve('old_field', new Date(Date.now() - 1000), 'party', partyId);
  assert.equal((await command('equip', { slot: 'head', itemId: item.id })).status, 'applied');
  assert.equal((await db.query('SELECT status FROM encounter_clocks WHERE "ownerId"=$1', [partyId]))[0].status, 'cancelled');
  await reserve('map_town', new Date(Date.now() - 1000), 'party', partyId);
  assert.equal((await command('unequip', { slot: 'head' })).status, 'applied');
  await db.getRepository(entities.Character).update(hero.id, { currentMapId: 'new_field', status: 'grinding' });
  await db.query('UPDATE parties SET "mapId"=$2 WHERE id=$1', [partyId, 'new_field']);
  await reserve('new_field', new Date(Date.now() - 1000), 'party', partyId);
  const groupWaiting = await command('equip', { slot: 'head', itemId: item.id });
  assert.equal(groupWaiting.status, 'pending', 'a valid group encounter must still take priority');
  await db.query(`UPDATE encounter_clocks SET status='consumed' WHERE "ownerId"=$1`, [partyId]);
  await party.enqueueDrain(hero.id);
  assert.equal((await db.query('SELECT status FROM character_action_intents WHERE id=$1', [groupWaiting.id]))[0].status, 'applied');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM party_deadline_checks'))[0].n, 0);
  console.log('town-action-queue: town equip/unequip, stale map recovery, valid search identity, overdue/active battle priority and idempotency passed');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.isInitialized && db.destroy());
