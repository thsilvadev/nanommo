const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const baseline = require('../docs/handoffs/2026-11-27-balance-baseline.json');
const monsters = baseline.original_monster_drop_tables;
/** Idempotent: every target derives only from the persisted pre-update baseline. */
function applyBalanceItemPrices(input) {
  const items = structuredClone(input);
  for (const old of baseline.original_common_part_prices) {
    if (old.questOnly) continue;
    const item = items.monsterParts.find(item => item.id === old.id);
    const monster = monsters.find(monster => monster.id === old.droppedBy[0]);
    if (!item || !monster || old.droppedBy.length !== 1) throw Error('Invalid baseline: ' + old.id);
    const payment = Math.floor((old.marketBasePrice ?? old.sellPriceToVendor) * .4) + 2 * Math.floor(monster.level / 10);
    item.marketBasePrice = Math.ceil(payment / .4);
    item.sellPriceToVendor = payment;
    if (Math.floor(item.marketBasePrice * .4) !== payment) throw Error('Unrepresentable payment: ' + old.id);
  }
  return items;
}
module.exports = { applyBalanceItemPrices };
if (require.main === module) {
  const file = path.join(root, 'items.json');
  fs.writeFileSync(file, JSON.stringify(applyBalanceItemPrices(JSON.parse(fs.readFileSync(file, 'utf8'))), null, 2) + '\n');
}
