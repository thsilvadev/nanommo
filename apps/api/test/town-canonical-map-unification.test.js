const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const parse = relative => JSON.parse(read(relative));

function allSourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    if (entry.isDirectory()) out.push(...allSourceFiles(rel));
    else if (/\.(ts|html)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

function run() {
  const backendCatalog = parse('monsters.json');
  const frontendCatalog = parse('apps/frontend/public/data/monsters.json');
  const backendTowns = backendCatalog.maps.filter(m => m?.isTown === true || m?.id === 'map_town');
  const frontendTowns = frontendCatalog.maps.filter(m => m?.isTown === true || m?.id === 'map_town');

  assert.equal(backendTowns.length, 1, 'backend catalog must contain exactly one Town entry');
  assert.equal(backendTowns[0].id, 'map_town');
  assert.equal(backendTowns[0].isTown, true);
  assert.equal(frontendTowns.length, 1, 'frontend map mirror must contain exactly one Town entry');
  assert.deepEqual(frontendTowns[0], backendTowns[0], 'frontend Town map must match backend catalog');

  const board = read('apps/frontend/src/app/features/play/map-board.html');
  assert.equal((board.match(/class="town-center"/g) || []).length, 1, 'MapBoard must contain exactly one dedicated Town node');
  assert.match(board, /\*ngFor="let tile of grindMaps"/);
  assert.doesNotMatch(board, /\*ngFor="let tile of maps"/);
  assert.match(board, /\(click\)="enterTown\(\)"/);

  const components = read('apps/frontend/src/app/features/play/components.ts');
  assert.match(components, /townMap=m\.find\(x=>x\?\.id===TOWN_MAP_ID&&x\?\.isTown===true\)/);
  assert.match(components, /grindMaps=m\.filter\(x=>x\?\.isTown!==true&&x\?\.id!==TOWN_MAP_ID\)/);
  assert.doesNotMatch(components, /class TownCenter/);

  const frontendSources = allSourceFiles('apps/frontend/src');
  const productionText = frontendSources.map(read).join('\n');
  assert.doesNotMatch(productionText, /\/maps\/map_town\/enter/);
  assert.doesNotMatch(productionText, /\/play\/town/);
  assert.equal(fs.existsSync(path.join(root, 'apps/frontend/src/app/features/play/town-center.html')), false);
  assert.equal(fs.existsSync(path.join(root, 'apps/frontend/src/app/features/play/town-center.css')), false);

  const mapService = read('apps/api/src/modules/map/map.service.ts');
  assert.match(mapService, /map\.id === TOWN_MAP_ID \|\| map\.isTown/);
  assert.match(mapService, /if \(map\.isTown \|\| map\.id === TOWN_MAP_ID\) return false/);
  assert.match(mapService, /if \(character\.currentMapId === TOWN_MAP_ID\)/);
  assert.match(mapService, /Never run grind cleanup\/sequence-reset logic against the canonical Town location/);

  const townService = read('apps/api/src/modules/town/town.service.ts');
  assert.match(townService, /character\.currentMapId !== TOWN_MAP_ID \|\| character\.pendingMapTransition !== null \|\| character\.status !== 'town'/);

  console.log('town-canonical-map-unification.test.js: 18 assertions passed');
}

try { run(); } catch (error) { console.error(error); process.exit(1); }
