const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { BattleService } = require('../dist/apps/api/src/modules/battle/battle.service');

(async()=>{
  const attempted=[];const warnings=[];const stored=[];
  const service=Object.create(BattleService.prototype);
  service.logger={warn:message=>warnings.push(message)};
  service.inventoryService={
    async canFitInventoryDrop(_characterId,itemId,quantity){attempted.push({itemId,quantity,phase:'capacity'});return itemId!=='too-large';},
    async addItem(characterId,itemId,quantity,location,instanceData,manager){
      attempted.push({itemId,quantity,location,phase:'grant'});
      if(itemId==='grant-error')throw new Error('synthetic storage exception');
      stored.push({characterId,itemId,quantity,location,instanceData,manager});
    },
  };
  const character={id:'character-1',knownItemIds:['old-item']};
  const manager={transactionId:'battle-tx'};
  const battle={id:'battle-1',characterId:'character-1',drops:[
    {itemId:'too-large',quantity:45},
    {itemId:'good-a',quantity:3},
    {itemId:'grant-error',quantity:1,instanceData:{roll:1}},
    {itemId:'good-b',quantity:2,instanceData:{roll:2}},
  ]};
  await service.grantBattleDropsBestEffort(character,battle,manager);
  assert.deepEqual(stored.map(row=>row.itemId),['good-a','good-b'],'one non-fitting drop and one isolated add error do not prevent other drops');
  assert.ok(stored.every(row=>row.location==='inventory'),'combat never grants directly to Warehouse');
  assert.ok(stored.every(row=>row.characterId==='character-1'&&row.manager===manager));
  assert.deepEqual(character.knownItemIds,['old-item','good-a','good-b'],'only committed drops become known item IDs');
  assert.equal(warnings.some(message=>message.includes('too-large')&&message.includes('Inventory capacity insufficient')),true);
  assert.equal(warnings.some(message=>message.includes('grant-error')&&message.includes('synthetic storage exception')),true);
  assert.equal(attempted.filter(x=>x.itemId==='too-large'&&x.phase==='grant').length,0,'capacity failure never mutates any partial stack');
  assert.equal(attempted.filter(x=>x.phase==='capacity').length,4);
  const source=fs.readFileSync(path.resolve(__dirname,'../src/modules/battle/battle.service.ts'),'utf8');
  const xpPayout=source.indexOf('character.xp = Number(character.xp) + Number(battle.xpGain ?? 0)');
  const dropGrant=source.indexOf('await this.grantBattleDropsBestEffort(character, battle, manager);');
  const resolvedMarker=source.indexOf('battle.resolved = true;',dropGrant);
  const resolvedSave=source.indexOf('await battleRepo.save(battle);',resolvedMarker);
  assert.ok(xpPayout>=0&&dropGrant>xpPayout&&resolvedMarker>dropGrant&&resolvedSave>resolvedMarker,'drop granting remains isolated inside the victory transaction before the resolved marker and commit; one failed drop cannot abort the rest of this method');
  const grantMethod=source.slice(source.indexOf('private async grantBattleDropsBestEffort'),source.indexOf('private async applyMasteryRewards'));
  assert.match(grantMethod,/catch \(error\)/,'each individual drop exception is caught and logged');
  assert.match(grantMethod,/continue;/,'capacity rejection continues to the next drop without partial mutation');
  console.log('battle-drop-capacity-isolation: passed drop-by-drop capacity isolation and best-effort payout continuation');
})().catch(error=>{console.error(error);process.exit(1)});
