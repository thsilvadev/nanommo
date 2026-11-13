const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(path.join(root, 'apps/api/src/maintenance/cutover-battle-tickrate.ts'), 'utf8');
const startup = fs.readFileSync(path.join(root, 'apps/api/src/modules/battle/battle-recovery.service.ts'), 'utf8');
const compose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');

for (const job of ['resolve-battle', 'queue-battles', 'idle-journal-precombat', 'advance-travel', 'advance-stationary-activity', 'attempt-flee', 'resume-world-activities']) {
  assert.match(source, new RegExp(`'${job}'`), `${job} must be included in the obsolete combat-job allow-list`);
}
for (const preserved of ['complete-cooking', 'complete-crafting']) {
  assert(source.includes(`job.name === '${preserved}'`) || source.includes(`'${preserved}'`), `${preserved} persisted jobs must be preserved and documented`);
}
assert.match(source, /BATTLE_QUEUE_MAINTENANCE_ONLY !== 'true'/);
assert.match(source, /CONFIRM_QUEUE_CONSUMERS_STOPPED !== '1'/);
assert.match(source, /CONFIRM_BATTLE_TICKRATE_CUTOVER !== '500MS'/);
assert.match(source, /args.includes\('--execute'\)/);
assert.match(source, /if \(!execute && args.length === 0\) return false/);
assert.match(source, /await queue\.pause\(false\)/);
assert.match(source, /pausedCounts\.active/);
assert.match(source, /await job\.remove\(\)/);
assert.match(source, /battleRepo\.createQueryBuilder\(\)\.delete\(\)/);
assert.match(source, /status: 'town'/);
assert.match(source, /currentMapId: 'map_town'/);
assert.match(source, /pendingMapTransition: null/);
assert.match(source, /travelIntent: null/);
assert.match(source, /gatheringCycle:/);
assert.match(source, /encounterCycle:/);
assert.match(startup, /log/);
assert.match(startup, /tickDurationMs/);
assert.match(startup, /Startup refuses to replay or project mixed-clock battles/);
assert.match(compose, /env_file:\s+- \.env/);
console.log('battle-tickrate-cutover-safety: dry-run, explicit guard, targeted job allow-list, preserved Town work and fail-closed startup checks passed');
