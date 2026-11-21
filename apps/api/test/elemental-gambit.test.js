const assert=require('node:assert/strict');
const {GambitService}=require('../dist/apps/api/src/modules/gambit/gambit.service');
const {GambitEvaluator}=require('../../../packages/shared/dist');
const catalog=require('../../../gambit_catalog.json');
(async()=>{
 const service=new GambitService(null,null,{getGambitCatalog:()=>catalog},null);
 for(const [oldElement,newElement]of [['light','holy'],['lightning','wind'],['ice','water']]){
  for(const nested of [true,false]){
   const node={id:'foe_element_weak',...(nested?{params:{element:oldElement}}:{element:oldElement})};
   const lines=[{priority:1,conditions:[node],action:{id:'attack'}}];
   assert.equal((await service.validateGambitPage(lines)).valid,true,`${oldElement} remains writable`);
   const saved=service.canonicalizeLines(lines)[0].conditions[0];assert.equal(nested?saved.params.element:saved.element,newElement);assert.equal(nested?node.params.element:node.element,oldElement,'canonicalization must not mutate caller drafts');
  }
 }
 assert.equal(GambitEvaluator.evaluateCondition({id:'foe_element_weak',params:{element:'fire'}},{},{element:'earth'}),true);
 assert.equal(GambitEvaluator.evaluateCondition({id:'foe_element_weak',params:{element:'ice'}},{},{element:'fire'}),true);
 console.log('elemental Gambit: canonical weaknesses and legacy saved parameters remain valid');
})().catch(error=>{console.error(error);process.exitCode=1});
