const assert = require('node:assert/strict');
const { BattleRecoveryService } = require('../dist/apps/api/src/modules/battle/battle-recovery.service');

function harness({failPresence=false,pendingMigrations=false}={}) {
  const calls=[];let activeReads=0;let ready=false;let closed=false;let lease=false;
  const queueGate={
    async acquireStartupLease(){assert.equal(lease,false);lease=true;calls.push('lease-acquired');},
    async closeForStartup(){closed=true;ready=false;calls.push('gate-closed');},
    async markReady(){assert.equal(lease,true);assert.equal(closed,true);ready=true;closed=false;calls.push('gate-open');},
    async releaseStartupLease(){lease=false;calls.push('lease-released');},
    isLocallyReady(){return ready;},
  };
  const bullQueue={
    async pause(global){assert.equal(global,false);closed=true;calls.push('queue-paused');},
    async getJobCounts(){calls.push('active-count');activeReads++;return {active:activeReads===1?1:0};},
    async resume(global){assert.equal(global,false);assert.equal(ready,true,'readiness must open while queue is still paused');closed=false;calls.push('queue-resumed');},
    async getJobs(){return [];},async getJob(){return null;},async add(){throw new Error('unexpected queue add');},
  };
  const characterRepo={async find(){return [];},async save(row){return row;}};
  const dataSource={options:{},
    migrations: pendingMigrations ? [{name:'AppliedMigration'},{name:'PendingMigration'}] : [{name:'AppliedMigration'}],
    createQueryRunner(){return {async connect(){},async release(){},async hasTable(){return true;},async query(){return [{name:'AppliedMigration'}];},async getTables(){return [{name:'migrations'},{name:'characters'}];}};},
  };
  const battleQueueRepo={async find(){return [];},async findOne(){return null;},async delete(){return {affected:0};}};
  const presence={async reconcileAllPresenceOrThrow(){calls.push('presence-reconciled');if(failPresence)throw new Error('simulated Redis presence outage');},enablePeriodicReconciliation(){calls.push('presence-periodic-enabled');}};
  const svc=Object.create(BattleRecoveryService.prototype);
  Object.assign(svc,{queueGate,bullQueue,characterRepo,battleQueueRepo,dataSource,mapPresenceService:presence,dataService:{getMapById:()=>null},battleService:{},logger:{log(){},warn(){},error(){}}});
  return {svc,calls,queueGate,bullQueue,get ready(){return ready},get closed(){return closed},get lease(){return lease}};
}
(async()=>{
  const h=harness();
  await h.svc.onApplicationBootstrap();
  assert.equal(h.ready,true);assert.equal(h.closed,false);assert.equal(h.lease,false);
  assert.ok(h.calls.indexOf('queue-paused')<h.calls.indexOf('presence-reconciled'));
  assert.ok(h.calls.indexOf('active-count')<h.calls.indexOf('presence-reconciled'),'active jobs must drain before reconciliation begins');
  assert.ok(h.calls.indexOf('gate-open')<h.calls.indexOf('queue-resumed'),'queue resumes only after authoritative recovery');
  assert.equal(h.calls.filter(x=>x==='presence-reconciled').length,3,'presence rebuilt before stale recovery, after stale recovery, and after top-up');

  const failed=harness({failPresence:true});
  await assert.rejects(()=>failed.svc.onApplicationBootstrap(),/simulated Redis presence outage/);
  assert.equal(failed.ready,false,'gate remains closed on recovery failure');
  assert.equal(failed.closed,true,'global queue remains paused on recovery failure');
  assert.equal(failed.calls.includes('queue-resumed'),false,'failed recovery must never resume Bull consumers');
  assert.equal(failed.lease,false,'exclusive lease is released even on failure');

  const migrationPending=harness({pendingMigrations:true});
  await assert.rejects(()=>migrationPending.svc.onApplicationBootstrap(),/Pending TypeORM migrations detected/);
  assert.equal(migrationPending.ready,false,'pending migrations keep the worker gate closed');
  assert.equal(migrationPending.closed,true,'queue remains globally paused until the explicit audited migration');
  assert.equal(migrationPending.calls.includes('queue-resumed'),false,'pending migrations never resume queue processors');
  assert.equal(migrationPending.calls.includes('presence-reconciled'),false,'data reconciliation does not touch schema-dependent rows while migrations are pending');

  const previousMaintenance=process.env.BATTLE_QUEUE_MAINTENANCE_ONLY;
  const previousConfirmation=process.env.CONFIRM_QUEUE_CONSUMERS_STOPPED;
  process.env.BATTLE_QUEUE_MAINTENANCE_ONLY='true';process.env.CONFIRM_QUEUE_CONSUMERS_STOPPED='1';
  try {
    const maintenance=harness();
    const result=await maintenance.svc.runStoppedConsumerReconciliation();
    assert.deepEqual(result,{removedRows:0,resolvedBattles:0,toppedUp:0});
    assert.equal(maintenance.ready,false,'offline maintenance never opens the gate');
    assert.equal(maintenance.closed,true,'offline maintenance intentionally leaves the global queue paused');
    assert.equal(maintenance.calls.includes('queue-resumed'),false,'maintenance cannot resume workers');
    assert.equal(maintenance.lease,false,'maintenance releases the lease after reconciliation');
    assert.equal(maintenance.calls.filter(x=>x==='presence-reconciled').length,3);
  } finally {
    if(previousMaintenance===undefined)delete process.env.BATTLE_QUEUE_MAINTENANCE_ONLY;else process.env.BATTLE_QUEUE_MAINTENANCE_ONLY=previousMaintenance;
    if(previousConfirmation===undefined)delete process.env.CONFIRM_QUEUE_CONSUMERS_STOPPED;else process.env.CONFIRM_QUEUE_CONSUMERS_STOPPED=previousConfirmation;
  }
  console.log('battle-queue-recovery-lifecycle: passed drain-before-repair and fail-closed failure-path checks');
})().catch(error=>{console.error(error);process.exit(1)});
