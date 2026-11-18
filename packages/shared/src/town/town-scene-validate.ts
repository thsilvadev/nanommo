import { TownNav, balconyContains, balconyStairsFoot } from './town-nav';
import { TOWN_OBSTACLE_KINDS, type TownSceneDef } from './town-scene.types';

export const TOWN_MIN_FREE_CELLS = 2500;
export const TOWN_MIN_POIS = 16;
/** Every NPC stands within this distance of a POI, so players "go to the NPC". */
export const TOWN_NPC_POI_MAX_DIST = 3;

interface MapsCatalogLike { maps?: { id: string; type?: string; npcIds?: string[] }[] }

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Validates `town_scenes.json` against `maps.json`. Returns human-readable
 * errors (empty when valid). Shared by the API boot (DataService), the
 * catalogue validator script and the contract tests.
 */
export function validateTownScenes(catalog: unknown, mapsCatalog: MapsCatalogLike | null | undefined): string[] {
  const errors: string[] = [];
  const towns = (catalog as { towns?: TownSceneDef[] } | null)?.towns;
  if (!Array.isArray(towns)) return ['town_scenes.json must define a towns array'];
  const maps = new Map((mapsCatalog?.maps ?? []).map(m => [m.id, m]));
  const seen = new Set<string>();

  for (const def of towns) {
    const id = def?.mapId;
    const at = `town scene ${id}`;
    if (!id || seen.has(id)) { errors.push(`Duplicate or missing town scene mapId: ${id}`); continue; }
    seen.add(id);
    const map = maps.get(id);
    if (!map) { errors.push(`${at}: mapId does not exist in maps.json`); continue; }
    if (map.type !== 'town') errors.push(`${at}: map is not a town`);
    if (!Number.isInteger(def.size?.w) || !Number.isInteger(def.size?.h) || def.size.w < 8 || def.size.h < 8) {
      errors.push(`${at}: size must be integer w/h >= 8`);
      continue;
    }
    const badObstacle = (def.obstacles ?? []).find(o => !TOWN_OBSTACLE_KINDS.includes(o?.kind) || !isNum(o.x) || !isNum(o.z)
      || (o.kind === 'balcony' && (!isNum(o.w) || !isNum(o.d) || !isNum(o.height) || !['n', 's', 'e', 'w'].includes(o.stairs as string))));
    if (!Array.isArray(def.obstacles) || badObstacle) { errors.push(`${at}: invalid obstacle ${JSON.stringify(badObstacle)}`); continue; }
    if (!isNum(def.spawn?.x) || !isNum(def.spawn?.z)) { errors.push(`${at}: spawn must have x/z`); continue; }

    const nav = new TownNav(def);
    const cell = (x: number, z: number) => Math.floor(z) * def.size.w + Math.floor(x);
    const free = (x: number, z: number) => !nav.blocked(Math.floor(x), Math.floor(z));
    if (nav.freeCellCount() < TOWN_MIN_FREE_CELLS) errors.push(`${at}: only ${nav.freeCellCount()} free cells (< ${TOWN_MIN_FREE_CELLS})`);
    if (!free(def.spawn.x, def.spawn.z)) errors.push(`${at}: spawn is blocked`);
    const reach = nav.reachableFrom(def.spawn.x, def.spawn.z);

    const pois = Array.isArray(def.pointsOfInterest) ? def.pointsOfInterest : [];
    if (pois.length < TOWN_MIN_POIS) errors.push(`${at}: ${pois.length} points of interest (< ${TOWN_MIN_POIS})`);
    const poiIds = new Set<string>();
    for (const poi of pois) {
      if (!poi?.id || poiIds.has(poi.id)) errors.push(`${at}: duplicate or missing POI id ${poi?.id}`);
      poiIds.add(poi?.id);
      if (!isNum(poi?.x) || !isNum(poi?.z) || !isNum(poi.radius) || poi.radius <= 0 || !isNum(poi.weight) || poi.weight <= 0) {
        errors.push(`${at}: POI ${poi?.id} needs numeric x/z and positive radius/weight`);
        continue;
      }
      if (!free(poi.x, poi.z)) errors.push(`${at}: POI ${poi.id} is blocked`);
      else if (!reach.has(cell(poi.x, poi.z))) errors.push(`${at}: POI ${poi.id} is unreachable from spawn`);
    }

    const npcIds = new Set(map.npcIds ?? []);
    const spots = def.npcSpots ?? {};
    for (const npcId of npcIds) {
      const spot = spots[npcId];
      if (!spot || !isNum(spot.x) || !isNum(spot.z) || !isNum(spot.facing)) { errors.push(`${at}: NPC ${npcId} has no npcSpot`); continue; }
      if (spot.y != null && (!isNum(spot.y) || spot.y < 0)) { errors.push(`${at}: NPC ${npcId} spot y must be a number >= 0`); continue; }
      if (isNum(spot.y) && spot.y > 0) {
        // Up on a balcony: the spot itself is blocked ground; players walk to the stairs foot.
        const balcony = def.obstacles.find(o => balconyContains(o, spot.x, spot.z));
        if (!balcony) { errors.push(`${at}: NPC ${npcId} is elevated (y=${spot.y}) but not on a balcony`); continue; }
        const foot = balconyStairsFoot(balcony);
        if (!free(foot.x, foot.z)) errors.push(`${at}: NPC ${npcId} balcony stairs foot is blocked`);
        else if (!reach.has(cell(foot.x, foot.z))) errors.push(`${at}: NPC ${npcId} balcony stairs foot is unreachable from spawn`);
        if (!pois.some(p => Math.hypot(p.x - foot.x, p.z - foot.z) <= TOWN_NPC_POI_MAX_DIST)) {
          errors.push(`${at}: NPC ${npcId} has no POI within ${TOWN_NPC_POI_MAX_DIST}u of its balcony stairs foot`);
        }
        continue;
      }
      if (!free(spot.x, spot.z)) errors.push(`${at}: NPC ${npcId} spot is blocked`);
      else if (!reach.has(cell(spot.x, spot.z))) errors.push(`${at}: NPC ${npcId} spot is unreachable from spawn`);
      if (!pois.some(p => Math.hypot(p.x - spot.x, p.z - spot.z) <= TOWN_NPC_POI_MAX_DIST)) {
        errors.push(`${at}: NPC ${npcId} has no POI within ${TOWN_NPC_POI_MAX_DIST}u`);
      }
    }
    for (const npcId of Object.keys(spots)) if (!npcIds.has(npcId)) errors.push(`${at}: npcSpot ${npcId} is not an NPC of this town`);
  }
  return errors;
}
