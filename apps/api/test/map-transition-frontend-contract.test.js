const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const mapHtml = read('apps/frontend/src/app/features/play/map-board.html');
const mapCss = read('apps/frontend/src/styles.css');
const components = read('apps/frontend/src/app/features/play/components.ts');
const grindHtml = read('apps/frontend/src/app/features/play/grind-info.html');
const characterDto = read('packages/shared/src/dto/index.ts');
const characterService = read('apps/api/src/modules/character/character.service.ts');
const migration = read('apps/api/src/database/migrations/1799500000000-SavedTownWaypoint.ts');
const mapService = read('apps/api/src/modules/map/map.service.ts');

assert(mapHtml.includes('waiting for battle to end to move...'));
assert(mapHtml.includes('/project/destination_pinpoint.png'));
assert(mapHtml.includes('/project/T_waypoint.png'));
assert(mapHtml.includes('<polyline [attr.points]="destinationRoutePoints()" />'));
assert(mapCss.includes('animation: destination-dashes'));
assert(mapCss.includes('.map-panel .town-waypoint') && mapCss.includes('left: 50%;\n  top: 50%;\n  transform: translate(-50%, -50%);'), 'saved Town waypoint is centered inside its tile');
assert(components.includes('Math.abs(a.x-b.x)+Math.abs(a.y-b.y)===1'), 'route uses cardinally adjacent map nodes');
assert(components.includes('candidate.isClickable!==false'), 'route traverses only clickable map nodes');
assert(components.includes('if(!previous.has(destination.id))return []'), 'disconnected topology does not fabricate a path');
assert(components.includes("this.api.post<any>(`/maps/${id}/enter`,{requestedAt})"));
assert(components.includes('this.routeOriginMapId.set(origin)'), 'route preview preserves the location the player clicked from, even when this map click teleports immediately');
assert(components.includes('const routeOriginId=this.routeOriginMapId()'));
assert(components.includes('private clearDestinationPreview(){this.destinationMapId.set(null);this.routeOriginMapId.set(null)}'), 'destination pin and animated route are cleared after authoritative arrival');
assert(components.includes('if(requestedDestination&&(c.currentMapId===requestedDestination||c.status===\'town\'))'), 'authoritative destination arrival takes precedence over stale pending transition metadata');
assert(components.includes('if(target&&c.currentMapId===target){'), 'transition polling clears preview on arrival even while battle continues');
assert(components.includes("'/maps/save-town'"));
assert(grindHtml.includes('Save here') && grindHtml.includes('Saved ✔'));
assert(characterDto.includes('pendingMapTransition?'));
assert(characterDto.includes('savedTownMapId!'));
assert(characterService.includes('pendingMapTransition: character.pendingMapTransition ?? null'));
assert(characterService.includes('savedTownMapId: character.savedTownMapId ?? null'));
assert(migration.includes('ADD COLUMN IF NOT EXISTS "savedTownMapId"'));
assert(migration.includes("SET \"savedTownMapId\" = 'map_town' WHERE \"savedTownMapId\" IS NULL"), 'existing characters default to Sierra Village');
assert(migration.includes(`ALTER COLUMN "savedTownMapId" SET DEFAULT 'map_town'`), 'database default is repaired if the column already exists');
assert(mapService.includes("reason: map.type === 'town' ? 'town_request' : 'map_request'"));

const publicAssets = [
  ['project/destination_pinpoint.png', 'apps/frontend/public/project/destination_pinpoint.png'],
  ['project/T_waypoint.png', 'apps/frontend/public/project/T_waypoint.png'],
];
for (const [source, packaged] of publicAssets) {
  const sourcePath = path.join(root, source);
  const publicPath = path.join(root, packaged);
  const builtPath = path.join(root, 'apps/frontend/dist/frontend/browser', source);
  assert.equal(hash(sourcePath), hash(publicPath), `${source} must be byte-identical in frontend public assets`);
  assert(fs.existsSync(builtPath), `${source} must exist in production build output`);
  assert.equal(hash(sourcePath), hash(builtPath), `${source} must be byte-identical in production output`);
}

console.log('map-transition-frontend-contract: pending message, BFS route, destination pin, saved-Town UI, DTO/migration and production asset parity passed');
