const assert = require('node:assert/strict');
const { selectAuditedBaselinePrefix } = require('../dist/apps/api/src/database/migration-baseline');

const names=['First1770000000000','Second1797000000000','MonsterCatalogMapOverhaul1798000000000','TownReset1799000000000','MasteryReconcile1799100000000'];
assert.deepEqual(selectAuditedBaselinePrefix(names,'Second1797000000000'),[
  {name:'First1770000000000',timestamp:1770000000000},
  {name:'Second1797000000000',timestamp:1797000000000},
]);
assert.throws(()=>selectAuditedBaselinePrefix(names,'TownReset1799000000000'),/may only record an audited legacy schema prefix/);
assert.throws(()=>selectAuditedBaselinePrefix(names,'Missing1780000000000'),/Unknown migration baseline boundary/);
assert.throws(()=>selectAuditedBaselinePrefix(['MigrationWithoutTimestamp'],'MigrationWithoutTimestamp'),/no 13-digit timestamp suffix/);
console.log('migration-baseline-selection: passed chronological prefix selection and forward-migration exclusion');
