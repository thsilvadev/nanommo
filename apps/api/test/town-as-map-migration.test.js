const assert = require('node:assert/strict');
const { TownAsMapAndGenericTransition1794000000000 } = require('../dist/apps/api/src/database/migrations/1794000000000-TownAsMapAndGenericTransition');

function queryRunnerWith(columns) {
  const queries = [];
  return {
    queries,
    getTable: async () => ({ findColumnByName: name => columns.includes(name) ? {} : undefined }),
    query: async sql => { queries.push(sql); },
  };
}

(async () => {
  {
    const qr = queryRunnerWith(['currentMapId', 'returnToTownAfterBattle']);
    await new TownAsMapAndGenericTransition1794000000000().up(qr);
    const joined = qr.queries.join('\n');
    assert.match(joined, /ADD "pendingMapTransition" jsonb NULL/);
    assert.match(joined, /returnToTownAfterBattle" = true/);
    assert.match(joined, /SET "currentMapId" = 'map_town' WHERE "currentMapId" IS NULL/);
    assert.match(joined, /ALTER COLUMN "currentMapId" SET DEFAULT 'map_town'/);
    assert.match(joined, /ALTER COLUMN "currentMapId" SET NOT NULL/);
    assert.match(joined, /DROP COLUMN "returnToTownAfterBattle"/);
    assert.ok(qr.queries.findIndex(q => q.includes('pendingMapTransition') && q.includes('ADD')) < qr.queries.findIndex(q => q.includes('returnToTownAfterBattle" = true')));
  }

  {
    const qr = queryRunnerWith(['currentMapId', 'pendingMapTransition']);
    await new TownAsMapAndGenericTransition1794000000000().down(qr);
    const joined = qr.queries.join('\n');
    assert.match(joined, /ADD "returnToTownAfterBattle" boolean NOT NULL DEFAULT false/);
    assert.match(joined, /pendingMapTransition.*destinationMapId.*map_town/);
    assert.match(joined, /ALTER COLUMN "currentMapId" DROP NOT NULL/);
    assert.match(joined, /UPDATE "characters" SET "currentMapId" = NULL WHERE "currentMapId" = 'map_town'/);
    assert.match(joined, /DROP COLUMN "pendingMapTransition"/);
  }

  console.log('Town migration ordering/down-path: 11 assertions passed');
})().catch(error => { console.error(error); process.exit(1); });
