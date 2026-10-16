const assert = require('node:assert/strict');
const { assertSafeMigrationHistory, inspectMigrationHistory } = require('../dist/apps/api/src/database/migration-safety');

assert.doesNotThrow(() => assertSafeMigrationHistory({pendingMigrationNames:[],migrationTableExists:false,appliedMigrationCount:0,applicationTablesExist:true}), 'no-op when nothing is pending');
assert.throws(() => assertSafeMigrationHistory({pendingMigrationNames:['OldMigration','TownReset'],migrationTableExists:false,appliedMigrationCount:0,applicationTablesExist:true}), /Refusing to replay the full historical migration chain/);
assert.throws(() => assertSafeMigrationHistory({pendingMigrationNames:['OldMigration','TownReset'],migrationTableExists:true,appliedMigrationCount:0,applicationTablesExist:true}), /application tables already exist/);
assert.doesNotThrow(() => assertSafeMigrationHistory({pendingMigrationNames:['InitialMigration','TownReset'],migrationTableExists:false,appliedMigrationCount:0,applicationTablesExist:false}), 'a truly fresh database may run the explicit full initial migration chain');
assert.throws(() => assertSafeMigrationHistory({pendingMigrationNames:['TownReset'],migrationTableExists:true,appliedMigrationCount:12,applicationTablesExist:false}), /no recognized application tables exist/, 'recorded migration history without the application schema is an unsafe mismatch');
assert.throws(() => assertSafeMigrationHistory({pendingMigrationNames:['Migration1'],migrationTableExists:false,appliedMigrationCount:0,applicationTablesExist:true}), /baseline/);
assert.doesNotThrow(() => assertSafeMigrationHistory({pendingMigrationNames:['Migration2'],migrationTableExists:true,appliedMigrationCount:12,applicationTablesExist:true}), 'incremental migrations may run against a tracked baseline');

(async()=>{
  let createAttempted=false;let released=false;
  const absentTableDataSource={
    options:{}, migrations:[{name:'OldMigration'},{name:'TownReset'}],
    createQueryRunner(){return {
      async connect(){}, async release(){released=true;}, async hasTable(){return false;},
      async query(){throw new Error('a missing migration table must never be queried or created');},
      async getTables(){return [{name:'characters'},{name:'inventory_items'}];},
      async createTable(){createAttempted=true;throw new Error('must not create tables in read-only audit');},
    };},
    async showMigrations(){createAttempted=true;throw new Error('unsafe TypeORM showMigrations was called');},
  };
  const readOnlyState=await inspectMigrationHistory(absentTableDataSource);
  assert.equal(readOnlyState.migrationTableExists,false);
  assert.deepEqual(readOnlyState.pendingMigrationNames,['OldMigration','TownReset']);
  assert.equal(readOnlyState.applicationTablesExist,true);
  assert.equal(createAttempted,false,'preflight must not call TypeORM showMigrations or create tables');
  assert.equal(released,true,'read-only query runner is always released');

  const tracked={
    options:{}, migrations:[{name:'OldMigration'},{name:'TownReset'}],
    createQueryRunner(){return {
      async connect(){}, async release(){}, async hasTable(){return true;},
      async query(sql){assert.equal(sql,'SELECT "name" FROM "migrations"');return [{name:'OldMigration'}];},
      async getTables(){return [{name:'migrations'},{name:'characters'}];},
    };},
  };
  const trackedState=await inspectMigrationHistory(tracked);
  assert.deepEqual(trackedState.executedMigrationNames,['OldMigration']);
  assert.deepEqual(trackedState.pendingMigrationNames,['TownReset']);
  assert.equal(trackedState.appliedMigrationCount,1);
  console.log('migration-history-safety: passed empty/missing baseline refusal, tracked incremental migrations and strictly read-only preflight');
})().catch(error=>{console.error(error);process.exit(1)});
