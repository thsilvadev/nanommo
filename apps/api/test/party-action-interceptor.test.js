const assert=require('node:assert/strict');
const {PartyActionInterceptor}=require('../dist/apps/api/src/modules/party/party-action.interceptor');
const {lastValueFrom}=require(require.resolve('rxjs',{paths:[require.resolve('@nestjs/common')]}));
(async()=>{
 const req={user:{userId:'user'},params:{pageId:'page'},headers:{},body:{clientRequestId:'retry',title:'Healing',slotIndex:2,lines:[{action:{id:'attack'}}]}};
 let sent;
 const party={enqueue:async(...args)=>{sent=args;return {actions:[{id:'newer',clientRequestId:'other',status:'applied'},{id:'original',clientRequestId:'retry',status:'pending'}]}}};
 const interceptor=new PartyActionInterceptor(party,{getCharacterByUserId:async()=>({id:'char'}),getCharacterDtoById:async()=>({id:'char',stateVersion:1})},{getInventory:async()=>[]},{getEquipment:async()=>[]});
 const ctx={getType:()=> 'http',switchToHttp:()=>({getRequest:()=>req}),getClass:()=>({name:'GambitController'}),getHandler:()=>({name:'updateGambitPage'})};
 const response=await lastValueFrom(interceptor.intercept(ctx,{handle(){throw Error('should enqueue')}}));
 assert.deepEqual(sent[3],{pageId:'page',title:'Healing',slotIndex:2,lines:req.body.lines});
 assert.equal(response.intent.id,'original','retry must return the status of its own request, even when later commands exist');
 console.log('party-action-interceptor: request identity and complete gambit update passed');
})().catch(e=>{console.error(e);process.exitCode=1});
