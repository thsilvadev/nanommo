const assert = require('node:assert/strict');
const { GambitService } = require('../dist/apps/api/src/modules/gambit/gambit.service');
(async()=>{
 const persisted={id:'page',characterId:'hero',slotIndex:0,title:'Page 1',lines:[{action:'original'}]};
 const repo={find:async()=>{const stale=structuredClone(persisted);persisted.lines=[{action:'newly saved'}];return [stale]},save:async page=>Object.assign(persisted,page),update:async(criteria,patch)=>Object.assign(persisted,patch)};
 const service=new GambitService(repo,{}, {}, {});
 await service.getGambitPages('hero');
 assert.equal(persisted.lines[0].action,'newly saved','listing pages must not overwrite a concurrent save while renaming the starter page');
 const character={id:'hero',activeGambitPageId:'old',gold:100};
 const characterRepo={findOne:async()=>structuredClone(character),update:async(criteria,patch)=>Object.assign(character,patch),save:async snapshot=>Object.assign(character,snapshot)};
 const activation=new GambitService({findOne:async()=>({id:'second',characterId:'hero'})},characterRepo,{}, {runFutureCombatMutation:async(id,mutation)=>{character.gold=200;return mutation()}});
 await activation.activateGambitPage('hero','second');
 assert.equal(character.activeGambitPageId,'second');assert.equal(character.gold,200,'activation must not save an old character snapshot over concurrent changes');
 console.log('gambit persistence regression passed');
})().catch(error=>{console.error(error);process.exitCode=1});
