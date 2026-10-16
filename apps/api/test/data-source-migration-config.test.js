const assert = require('node:assert/strict');
const { AppDataSource } = require('../dist/apps/api/src/database/data-source');

assert.equal(AppDataSource.options.synchronize,false,'schema synchronization must remain disabled');
assert.equal(AppDataSource.options.migrationsRun,false,'normal DataSource initialization must not auto-run migrations');
assert.ok(Array.isArray(AppDataSource.options.entities) && AppDataSource.options.entities.length>0);
assert.ok(Array.isArray(AppDataSource.options.migrations) && AppDataSource.options.migrations.length>0);
assert.equal(AppDataSource.isInitialized,false,'importing migration tooling never connects to or mutates the database');
console.log('data-source-migration-config: passed explicit migrations, no synchronize/auto-run, and import is connection-free');
