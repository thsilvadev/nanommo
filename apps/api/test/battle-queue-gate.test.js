const assert = require('node:assert/strict');
const { BattleQueueGateService } = require('../dist/apps/api/src/modules/battle/battle-queue-gate.service');

function redisMock() {
  const values=new Map();
  return {
    values,
    async set(key,value,...args){if(args.includes('NX')&&values.has(key))return null;values.set(key,String(value));return 'OK';},
    async get(key){return values.get(key)??null;},
    async eval(_script,numKeys,key,token,arg){
      if(values.get(key)!==String(token))return 0;
      if(String(_script).includes('pexpire'))return 1;
      if(String(_script).includes('del')){values.delete(key);return 1;}
      if(Number(arg)>0)return 1;
      return 0;
    },
  };
}
async function run(){
  const redis=redisMock();
  const first=new BattleQueueGateService(redis);
  assert.equal(await first.isLocallyReady(),false);
  await first.acquireStartupLease();
  await first.closeForStartup();
  await assert.rejects(()=>first.assertReadyForProcessing(),/gate is closed/);
  await first.markReady();
  await first.assertReadyForProcessing();
  await first.releaseStartupLease();

  // The global Redis key may be open from a different instance, but local
  // recovery is independently required before this processor can run.
  const second=new BattleQueueGateService(redis);
  await assert.rejects(()=>second.assertReadyForProcessing(),/gate is closed/);
  await second.acquireStartupLease();
  await second.closeForStartup();
  await assert.rejects(()=>first.assertReadyForProcessing(),/gate is closed/,'shared closed gate pauses already-ready replicas');
  await second.markReady();
  await second.assertReadyForProcessing();
  await first.assertReadyForProcessing();
  await second.releaseStartupLease();
  assert.equal(redis.values.has('battle:queue:startup-lock'),false,'lease is released with token-safe compare-and-delete');
  console.log('battle-queue-gate: passed local/shared fail-closed checks and serialized startup lease');
}
run().catch(error=>{console.error(error);process.exit(1)});
