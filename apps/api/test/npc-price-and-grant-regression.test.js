const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Test } = require('@nestjs/testing');
const { JwtAuthGuard } = require('../dist/apps/api/src/modules/auth/jwt-auth.guard');
const { InventoryController } = require('../dist/apps/api/src/modules/inventory/inventory.controller');
const { InventoryService } = require('../dist/apps/api/src/modules/inventory/inventory.service');
const { CharacterService } = require('../dist/apps/api/src/modules/character/character.service');
const { BattleService } = require('../dist/apps/api/src/modules/battle/battle.service');
const { TownService } = require('../dist/apps/api/src/modules/town/town.service');
const items = Object.values(require('../../../items.json')).filter(Array.isArray).flat();
const catalog = require('../../../npc_catalog.json');
const william = require('../../../npc_vendor.json');
const data = {getItemById: id => items.find(x => x.id === id), getNpcCatalog: () => catalog, getNpcVendor: () => william};

test('registered HTTP routes do not allow ordinary authenticated users to grant items', async () => {
  let grants = 0;
  const module = await Test.createTestingModule({controllers:[InventoryController],providers:[
    {provide:InventoryService,useValue:{addItem(){grants++;}}},
    {provide:CharacterService,useValue:{getCharacterByUserId:async()=>({id:'c'})}},
    {provide:BattleService,useValue:{}}
  ]}).overrideGuard(JwtAuthGuard).useValue({canActivate(ctx){ctx.switchToHttp().getRequest().user={userId:'ordinary'};return true;}}).compile();
  const app = module.createNestApplication({abortOnError:false, logger:console});
  await app.init();
  // Inspect the actual Express router installed by Nest, including controller guards.
  const routes = app.getHttpAdapter().getInstance()._router.stack.filter(x=>x.route).map(x=>x.route);
  assert.equal(routes.some(r=>r.path==='/inventory/add' && r.methods.post),false);
  assert.equal(grants,0);
  await app.close();
});

test('all NPC buy/sell pairs are bounded globally; T2 drop income remains', () => {
  const town = new TownService({}, {}, data, {}, {}, {}, {});
  const vendors = [william,...catalog.npcs.filter(n=>n.vendor).map(n=>town.vendor(n.id))];
  for(const source of vendors) for(const stock of source.sellStock) {
    if(!stock.infiniteStock) continue;
    const buy = town.buyPrice(source,stock.itemId);
    for(const target of vendors.filter(v=>v.buysAnyItem)) {
      assert.ok(town.sellPrice(target,stock.itemId)<=Math.floor(buy*.4),`${source.id} -> ${target.id}: ${stock.itemId}`);
    }
  }
  assert.equal(town.sellPrice(william,'equip_body_phys_t2'),4160);
});

test('safe NPC payment policy examples',()=>{
  const {safeNpcSellPrice} = require('../dist/apps/api/src/modules/town/npc-price-policy');
  assert.equal(safeNpcSellPrice(2300,1000),400);
  assert.equal(safeNpcSellPrice(4680,null),4680);
  assert.equal(safeNpcSellPrice(400,1000),400);
});

test('public removal cannot mint quantity through negative/invalid consumption',async()=>{
 const row={id:'r',characterId:'c',location:'inventory',itemId:'loot',quantity:5};
 const repo={find:async()=>[row],save:async()=>row,remove:async()=>{}};
 const service=Object.create(InventoryService.prototype);
 Object.assign(service,{inventoryItemRepo:repo,characterRepo:{findOne:async()=>({id:'c'})}});
 for(const n of [-1,0,NaN,1.5,Infinity])await assert.rejects(()=>service.removeItem('c','loot',n),/positive integer/);
 assert.equal(row.quantity,5);
 await assert.rejects(()=>service.removeItem('c','loot',6),/Insufficient item quantity/);
 assert.equal(row.quantity,5,'failed removal cannot partially consume a stack');
});
