const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const shared = read('packages/shared/src/world-activity.ts');
const mapService = read('apps/api/src/modules/map/map.service.ts');
const battleService = read('apps/api/src/modules/battle/battle.service.ts');
const components = read('apps/frontend/src/app/features/play/components.ts');
const mapHtml = read('apps/frontend/src/app/features/play/map-board.html');
const mapCss = read('apps/frontend/src/app/features/play/map-board.css');

assert.match(shared, /findSavedTownWaypointIndex/);
assert.match(shared, /index > 0 && index < route\.length - 1/, 'saved Town origin/final destination must not count as intermediate waypoints');
assert.match(mapService, /findSavedTownWaypointIndex\(route as any\[\], character\.savedTownMapId\)/);
assert.match(mapService, /kind: savedTownTeleport \? 'saved-town-teleport' : routeViaSavedTown \? 'saved-town-route-teleport' : 'route'/);
assert.match(mapService, /if \(intent\.kind === 'saved-town-route-teleport'\)/);
assert.match(mapService, /const continuedRoute = target\s*\?\s*findCardinalRoute\(this\.dataService\.getMaps\(\), waypointId, target\.id\)/);
assert.ok(mapService.indexOf('const startedBattle = unresolved.find') < mapService.indexOf("if (intent.kind === 'saved-town-route-teleport')"), 'started-battle gate must run before the waypoint teleport');
assert.match(battleService, /character\.travelIntent\.kind === 'saved-town-route-teleport' \|\| character\.travelIntent\.viaSavedTownWaypoint === true/);
assert.match(battleService, /savedTownWaypointTravel\.kind = 'saved-town-route-teleport'/, 'death after the first waypoint re-enters the recomputation path');
assert.match(battleService, /savedTownWaypointTravel\.waypointMapId = respawnTownId/);
assert.match(battleService, /savedTownWaypointTravel\.routeMapIds = \[\]/, 'death after this special route must recompute from the respawn Town');
assert.match(components, /this\.activityProgress\(\)\/100/, 'the pin is driven by the gauge percentage');
assert.match(components, /pinArrivalStorageKey/, 'the arrived edge survives refresh for this UI');
assert.match(mapHtml, /\[style\.left\.px\]="locationPinPosition\(\)\.x"/);
assert.match(mapHtml, /\[style\.top\.px\]="locationPinRenderY\(\)"/, 'the visual alignment correction is isolated from the authoritative route position');
assert.match(mapHtml, /\[style\.animation\]="character\.character\(\)\?\.travelIntent \? 'none' : null"/);
assert.doesNotMatch(mapCss, /\.location-pin\.traveling/);
assert.ok(fs.existsSync(path.join(root, 'apps/frontend/src/app/features/play/location-pin-motion.spec.ts')));

console.log('saved-town-route-warp-contract: waypoint gates, battle/death continuity, and gauge-driven visual pin assertions passed');
