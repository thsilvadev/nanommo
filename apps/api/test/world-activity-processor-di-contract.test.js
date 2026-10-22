const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const mapModule = read('apps/api/src/modules/map/map.module.ts');
const townModule = read('apps/api/src/modules/town/town.module.ts');
const processor = read('apps/api/src/modules/map/world-activity.processor.ts');

assert.match(mapModule, /import \{ TownModule \} from '\.\.\/town\/town\.module';/);
const mapImports = mapModule.match(/imports: \[([\s\S]*?)\],\s*controllers:/)?.[1] ?? '';
assert.match(mapImports, /\bTownModule\b/, 'MapModule must import TownModule for WorldActivityProcessor dependency resolution');
assert.match(townModule, /providers: \[TownService\]/);
assert.match(townModule, /exports: \[TownService\]/, 'TownModule must export TownService to importing modules');
assert.match(processor, /private readonly town: TownService/);
assert.match(processor, /await this\.town\.reconcileCooking\(\)/, 'startup recovery must reconcile persisted Cooking sessions');
assert.match(processor, /return this\.town\.completeCooking\(job\.data\.characterId, job\.data\.sessionId\)/, 'complete-cooking jobs must use TownService');

console.log('world-activity-processor-di-contract: MapModule imports TownModule and TownService is exported for Cooking jobs');
