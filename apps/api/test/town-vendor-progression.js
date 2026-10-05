const assert = require('assert');
const fs = require('fs');

const root = require('path').resolve(__dirname, '../../..');
const npc = JSON.parse(fs.readFileSync(root + '/npc_catalog.json', 'utf8'));
const loren = npc.npcs.find((x) => x.id === 'blacksmith_loren');
const t1Weapons = [
  'equip_sword_t1',
  'equip_greatsword_t1',
  'equip_dagger_t1',
  'equip_bow_t1',
  'equip_staff_t1',
  'equip_wand_t1',
  'equip_shield_t1',
];
assert(loren, 'Blacksmith Loren must exist');
for (const itemId of t1Weapons) {
  assert.strictEqual(loren.vendor.sellStock.find((x) => x.itemId === itemId)?.price, 2000, itemId + ' must cost 2000');
}

const characterService = fs.readFileSync(root + '/apps/api/src/modules/character/character.service.ts', 'utf8');
assert(!characterService.includes("itemId: 'equip_sword_t1'"), 'character creation must not grant a starter sword');
assert(characterService.includes('}, {});'), 'character creation must calculate base stats without weapon equipment');

const mapService = fs.readFileSync(root + '/apps/api/src/modules/map/map.service.ts', 'utf8');
assert(!mapService.includes('EquipmentService'), 'map entry must not depend on equipment');
assert(!mapService.includes('main-hand weapon is required'), 'map entry must not require a weapon');

const catalogService = fs.readFileSync(root + '/apps/frontend/src/app/core/catalog.service.ts', 'utf8');
assert(catalogService.includes('itemTooltipLines(itemId:string,instanceData?:any)'), 'item tooltip generation must be centralized');

const vendorTemplate = fs.readFileSync(root + '/apps/frontend/src/app/features/play/vendor-panel.html', 'utf8');
assert(vendorTemplate.includes('item-tooltip'), 'vendor stock must render the shared tooltip');

console.log('town-vendor-progression: 6 assertions passed');
