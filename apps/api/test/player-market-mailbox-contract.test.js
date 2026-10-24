const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const parse = (p) => JSON.parse(read(p));

const cap = read('packages/shared/src/index.ts');
assert.match(cap, /MAX_MARKET_ORDER_GOLD\s*=\s*999_999_999/);


const marketContract = require('../dist/apps/api/src/modules/market/market-contract.js');
assert.equal(marketContract.marketGrossValue(1, 1), 1);
assert.equal(marketContract.marketGrossValue(999999999, 1), 999999999);
assert.equal(marketContract.marketListingFee(1), 1);
assert.equal(marketContract.marketListingFee(100), 1);
assert.equal(marketContract.marketListingFee(101), 2);
assert.equal(marketContract.marketListingFee(999999999), 10000000);
assert.equal(marketContract.validateAttachedGold(0), 0);
assert.equal(marketContract.validateAttachedGold(999999999), 999999999);
assert.throws(() => marketContract.marketGrossValue(0, 1));
assert.throws(() => marketContract.marketGrossValue(2, 500000000));
assert.throws(() => marketContract.marketGrossValue(Number.MAX_SAFE_INTEGER, 2));
assert.throws(() => marketContract.marketListingFee(0));
assert.throws(() => marketContract.marketListingFee(1000000000));
assert.throws(() => marketContract.validateAttachedGold(-1));
assert.throws(() => marketContract.validateAttachedGold(1.5));
assert.throws(() => marketContract.validateAttachedGold(1000000000));

const maps = parse('maps.json');
const publicMaps = parse('apps/frontend/public/data/maps.json');
assert.deepEqual(publicMaps, maps, 'public map catalogue mirrors canonical map catalogue');
const npc = parse('npc_catalog.json');
const publicNpc = parse('apps/frontend/public/data/npc_catalog.json');
assert.deepEqual(publicNpc, npc, 'public NPC catalogue mirrors canonical NPC catalogue');
assert(npc.npcs.some(row => row.id === 'mailbox' && row.types.includes('mailbox')), 'Mailbox capability is catalogued');
const towns = maps.maps.filter(row => row.type === 'town');
assert(towns.length > 0);
assert(towns.every(row => Array.isArray(row.npcIds) && row.npcIds.includes('mailbox')), 'every Town map lists Mailbox');

const market = read('apps/api/src/modules/market/market.service.ts');
const marketController = read('apps/api/src/modules/market/market.controller.ts');
assert.match(read('apps/api/src/modules/market/market-contract.ts'), /Math\.max\(1, Math\.ceil\(gross \* 0\.01\)\)/, 'listing fee is 1%, rounded up, minimum 1');
assert.match(market, /MAX_MARKET_ORDER_GOLD/, 'market enforces shared cap');
assert.match(market, /withCharacterQueueLock\(characterId/, 'listing/purchase mutation participates in encounter-chain lock');
assert.match(market, /getPriceSuggestion/, 'server-side price suggestion is available');
assert.match(market, /market-deal:\$\{deal\.id\}:buyer-item/);
assert.match(market, /market-deal:\$\{deal\.id\}:seller-gold/);
assert.match(market, /market-legacy-buy-refund:/, 'legacy buy escrow has idempotent mail source keys');
assert.doesNotMatch(market, /private async matchBuyOrder|private async matchSellOrder/, 'automatic matching code removed');
assert.doesNotMatch(market, /seller\.gold\s*=\s*Number\(seller\.gold\)\s*\+/, 'seller proceeds are not directly credited');
assert.doesNotMatch(marketController, /@Post\('orders\/buy'\)/, 'buy-order creation endpoint removed');
assert.match(marketController, /@Post\('orders\/:orderId\/purchase'\)/, 'sell listing purchase endpoint exists');

const mail = read('apps/api/src/modules/mail/mail.service.ts');
const mailController = read('apps/api/src/modules/mail/mail.controller.ts');
assert.match(mail, /assertTown\(characterId/);
assert.match(mail, /attachmentsCollected/);
assert.match(mail, /withCharacterQueueLock\(senderId/, 'sending item mail participates in encounter-chain lock');
assert.match(mail, /withCharacterQueueLock\(characterId/, 'collecting item mail participates in encounter-chain lock');
assert.match(mail, /MAX_MARKET_ORDER_GOLD/);
assert.match(mail, /sourceKey/);
assert.match(mailController, /resolveCharacterId/);
assert.doesNotMatch(mailController, /req\.user\.characterId/);
assert.match(mailController, /where: \{ userId \}/);
assert.match(marketController, /resolveCharacterId/);
assert.match(marketController, /where: \{ userId \}/);
assert.doesNotMatch(marketController, /req\.user\.characterId/);
assert.doesNotMatch(mailController, /getMail\(@Param\('mailId'\)/, 'message detail endpoint is scoped to authenticated character');

const migration = read('apps/api/src/database/migrations/1799920000000-PlayerMarketAndMailbox.ts');
for (const field of ['senderCharacterId','senderName','recipientName','attachedGold','body','isRead','attachmentsCollected','senderDeleted','recipientDeleted','sourceKey','listingFeeGold']) assert(migration.includes(field), 'migration includes ' + field);
assert.match(migration, /forward-only/);
assert.match(migration, /"attachmentsCollected" = \("itemId" IS NULL AND "attachedGold" IS NULL\)/, 'legacy read state does not imply attachment collection');
console.log('Player Market/Mailbox contract checks passed (catalog parity, Town NPC coverage, cap, sell-only path, idempotency markers, ownership gates, additive migration).');
