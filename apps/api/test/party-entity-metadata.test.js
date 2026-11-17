const assert = require('node:assert/strict');
const { DataSource } = require('typeorm');
const entities = require('../dist/apps/api/src/database/entities');
const expected = {
  Party: ['parties', ['id'], ['id','kind','leaderCharacterId','mapId','revision','activity','createdAt','updatedAt']],
  PartyMember: ['party_members', ['partyId','characterId'], ['partyId','characterId','orderIndex','joinedAt','pendingLeave','reason']],
  PartyInvite: ['party_invites', ['id'], ['id','inviterId','candidateId','partyId','mode','status','expiresAt','createdAt','revision','clientRequestId']],
  CharacterActionIntent: ['character_action_intents', ['id'], ['id','characterId','clientRequestId','sequence','kind','payload','status','result','createdAt','completedAt']],
  EncounterClock: ['encounter_clocks', ['ownerKind','ownerId'], ['ownerKind','ownerId','mapId','cycle','searchStartedAt','dueAt','seed','generation','roster','status']],
  SharedBattle: ['shared_battles', ['id'], ['id','engineVersion','partyId','mapId','seed','startAt','endAt','state','snapshot','log','result','revision']],
  SharedBattleParticipant: ['shared_battle_participants', ['battleId','characterId'], ['battleId','characterId','snapshot','result']],
  ActiveBattleParticipant: ['active_battle_participants', ['characterId'], ['characterId','battleId']],
  PartyOutbox: ['party_outbox', ['id'], ['id','characterId','event','payload','createdAt','publishedAt']],
};
for (const name of Object.keys(expected)) assert.equal(typeof entities[name], 'function', `${name} must be registered and exported as a TypeORM entity`);
(async () => {
  const db = new DataSource({ type: 'postgres', entities: Object.keys(expected).map(name => entities[name]) });
  await db.buildMetadatas();
  for (const [name, [table, primary, columns]] of Object.entries(expected)) {
    const metadata = db.getMetadata(entities[name]);
    assert.equal(metadata.tableName, table);
    assert.deepEqual(metadata.primaryColumns.map(column => column.propertyName).sort(), primary.sort(), `${table} primary claim`);
    assert.deepEqual(metadata.columns.map(column => column.propertyName).sort(), columns.sort(), `${table} migration columns`);
  }
  const members = db.getMetadata(entities.PartyMember);
  assert.ok(members.uniques.some(unique => unique.columns.map(column => column.propertyName).sort().join(',') === 'orderIndex,partyId' && unique.deferrable === 'INITIALLY DEFERRED'), 'formation order uniqueness must allow atomic reorder');
  assert.ok(members.uniques.some(unique => unique.columns.map(column => column.propertyName).join(',') === 'characterId'), 'membership is exclusive');
  const outbox = db.getMetadata(entities.PartyOutbox);
  assert.ok(outbox.indices.some(index => index.name === 'party_outbox_pending' && index.where === '"publishedAt" IS NULL'));
  assert.equal(db.getMetadata(entities.SharedBattle).findColumnWithPropertyName('engineVersion').default, 2);
  assert.equal(db.getMetadata(entities.EncounterClock).findColumnWithPropertyName('roster').type, 'jsonb');
  console.log('party-entity-metadata: passed all nine table mappings, primary claims, deferred formation order and outbox index without a database connection');
})().catch(error => { console.error(error); process.exitCode = 1; });
