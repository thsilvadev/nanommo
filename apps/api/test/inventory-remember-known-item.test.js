// InventoryService.rememberKnownItem: an atomic, idempotent append to knownItemIds inside the caller's transaction.
const assert = require('node:assert/strict');
const { InventoryService } = require('../dist/apps/api/src/modules/inventory/inventory.service');
(async () => {
  const service = Object.create(InventoryService.prototype);
  const queries = [];
  await service.rememberKnownItem('c1', 'mega_elixir', { query: async (sql, params) => { queries.push({ sql, params }); return []; } });
  assert.equal(queries.length, 1, 'one statement');
  assert.match(queries[0].sql, /UPDATE characters SET "knownItemIds"\s*=\s*"knownItemIds"\s*\|\|/, 'appends in SQL (no stale entity save)');
  assert.match(queries[0].sql, /NOT \("knownItemIds" \? \$2\)/, 'only when not known yet');
  assert.deepEqual(queries[0].params, ['c1', 'mega_elixir']);
  console.log('inventory-remember-known-item: atomic idempotent append');
})().catch((e) => { console.error(e); process.exitCode = 1; });
