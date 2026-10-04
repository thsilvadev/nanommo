const assert = require('assert');
const { TownService } = require('../dist/apps/api/src/modules/town/town.service');
const { Character } = require('../dist/apps/api/src/database/entities/character.entity');
const { InventoryItem } = require('../dist/apps/api/src/database/entities/inventory-item.entity');

const catalog = require('../../../npc_catalog.json');
const items = require('../../../items.json');
const allItems = [...(items.consumables || []), ...(items.equipment || []), ...(items.monsterParts || [])];
const itemById = id => allItems.find(x => x.id === id);
const makeCharacter = hungry => ({ id: 'char-1', status: 'town', activeFoodBuff: hungry ? null : { itemId:'food_bread', expiresAt:new Date(Date.now()+3600000).toISOString(), hpRegenPerTenTicks:4, spRegenPerTenTicks:1 }, lastSeenAt:new Date() });

function harness(character, rows) {
  const charRepo = { findOne: async () => character, save: async x => x };
  const invRepo = {
    find: async () => rows,
    save: async x => x,
    remove: async x => { rows.splice(rows.indexOf(x), 1); return x; },
  };
  const manager = { getRepository: entity => entity === Character ? charRepo : invRepo };
  charRepo.manager = { transaction: async fn => fn(manager) };
  return new TownService(charRepo, invRepo, {
    getNpcCatalog: () => catalog,
    getNpcVendor: () => ({ id:'william', name:'William', type:'vendor', location:'town', buysAnyItem:true, buyRatePercent:40, sellStock:[] }),
    getItemById: itemById,
  }, { consumeFood: async () => { character.activeFoodBuff={ itemId:'food_bread', expiresAt:new Date(Date.now()+3600000).toISOString(), hpRegenPerTenTicks:4, spRegenPerTenTicks:1 }; return character; } }, { getDerivedStatsForCharacter: async () => ({ maxHp:100, maxSp:50 }) });
}
async function run() {
  let c = makeCharacter(true);
  let rows = [{ id:'food-slot', characterId:c.id, location:'inventory', slotIndex:0, itemId:'pot_hp_small', quantity:1 }];
  let svc = harness(c, rows);
  let state = await svc.getNpcDialogue(c.id, 'father_marcelus');
  assert.strictEqual(state.npcText, 'May the light be with us, friend. How are you, fellow adventurer?');
  assert.deepStrictEqual(state.choices.map(x => x.id), ['hungry_response']);
  state = await svc.chooseNpcDialogue(c.id, 'father_marcelus', 'hungry_response', 'greeting');
  assert.strictEqual(state.npcText, 'Eat and rest, for the love of god is forever, but you are not.');
  assert.deepStrictEqual(state.choices.map(x => x.id), ['eat_bread']);
  await svc.chooseNpcDialogue(c.id, 'father_marcelus', 'eat_bread', 'hungry');
  assert.strictEqual(c.activeFoodBuff.itemId, 'food_bread');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].itemId, 'pot_hp_small');

  c = makeCharacter(true); rows = [];
  svc = harness(c, rows);
  await svc.chooseNpcDialogue(c.id, 'father_marcelus', 'hungry_response', 'greeting');
  await svc.chooseNpcDialogue(c.id, 'father_marcelus', 'eat_bread', 'hungry');
  assert.strictEqual(c.activeFoodBuff.itemId, 'food_bread');
  assert.strictEqual(rows.length, 0);

  c = makeCharacter(false); rows = [];
  svc = harness(c, rows);
  state = await svc.getNpcDialogue(c.id, 'father_marcelus');
  assert.deepStrictEqual(state.choices.map(x => x.id), ['fine_response']);
  state = await svc.chooseNpcDialogue(c.id, 'father_marcelus', 'fine_response', 'greeting');
  assert.strictEqual(state.npcText, "The Lord doesn't want blood to be spilled. But I pray you'll return in peace 🙏.");
  assert.strictEqual(c.activeFoodBuff.itemId, 'food_bread');

  let rejected = false;
  try { await svc.chooseNpcDialogue(c.id, 'father_marcelus', 'eat_bread', 'hungry'); } catch { rejected = true; }
  assert.strictEqual(rejected, true);
  console.log('NPC framework: 12 assertions passed');
}
run().catch(error => { console.error(error); process.exit(1); });
