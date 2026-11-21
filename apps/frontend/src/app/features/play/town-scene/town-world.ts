/**
 * Builds a town from its catalogue entry: ground, obstacle primitives, lights
 * and fog. The same obstacle list is rasterised by the shared TownNav, so what
 * you see is what blocks.
 */
import * as THREE from 'three';
import { Mulberry32, TOWN_STAIRS_LENGTH, obstacleRadius, type TownObstacle, type TownSceneDef } from '@nanommo/shared';

/** Sierra's well bell: a pendulum of constant amplitude (radians) and period. */
export const WELL_BELL_AMPLITUDE = 0.3;
export const WELL_BELL_PERIOD_MS = 1600;

export interface TownWorld {
  group: THREE.Group;
  lights: THREE.Light[];
  /** The one light that casts shadows (sun, moon or the Aramaia sunshaft). */
  mainLight: THREE.DirectionalLight | THREE.SpotLight | null;
  fog: THREE.Fog;
  background: THREE.Color;
  /** Animates what moves on its own (campfire flames), from the shared clock. */
  update(nowMs: number): void;
  dispose(): void;
}

const SHADOW_MAP_SIZE = 1024;
/** Point lights sit this high; a campfire's own light sits lower, among the flames. */
const POINT_LIGHT_HEIGHT = 3;
const CAMPFIRE_LIGHT_HEIGHT = 1.2;

/** Campfire flicker (0.7..1): same clock in, same light out, on every client. */
export function campfireFlicker(nowMs: number): number {
  return 0.85 + 0.15 * Math.sin(nowMs * 0.011) * Math.sin(nowMs * 0.0047 + 1.3);
}

interface Palette { wall: string; roof: string; wood: string; leaf: string; stone: string; thatch: string; cloth: string; water: string }

const PALETTES: Record<TownSceneDef['lighting']['preset'], Palette> = {
  night: { wall: '#8b8fa3', roof: '#4b3f63', wood: '#5a4636', leaf: '#2f5a3a', stone: '#7a7f93', thatch: '#8a7a55', cloth: '#7a5a8a', water: '#3d6fa8' },
  day: { wall: '#d8c39a', roof: '#a8553a', wood: '#7a5636', leaf: '#5f9a3e', stone: '#9a9487', thatch: '#c9a85e', cloth: '#c96a4a', water: '#5aa0d8' },
  dusk: { wall: '#b08a5e', roof: '#7a5a34', wood: '#6a4a2c', leaf: '#3f6a2e', stone: '#8a7f6e', thatch: '#b8954e', cloth: '#a8543a', water: '#4a7aa0' },
  sunshaft: { wall: '#8f7a5a', roof: '#6e5c44', wood: '#5a4632', leaf: '#4a6a34', stone: '#8a785c', thatch: '#9a8450', cloth: '#8a4a32', water: '#3a6a80' },
};

export function buildTownWorld(def: TownSceneDef): TownWorld {
  const group = new THREE.Group();
  group.name = `town:${def.mapId}`;
  const owned: Array<{ dispose(): void }> = [];
  const palette = PALETTES[def.lighting.preset] ?? PALETTES.day;
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => {
    const key = color + JSON.stringify(extra);
    let m = materials.get(key);
    if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, flatShading: true, ...extra }); materials.set(key, m); owned.push(m); }
    return m;
  };
  const geo = <T extends THREE.BufferGeometry>(g: T) => { owned.push(g); return g; };

  // Ground.
  const groundTexture = groundCanvasTexture(def);
  owned.push(groundTexture);
  const ground = new THREE.Mesh(
    geo(new THREE.PlaneGeometry(def.size.w, def.size.h)),
    new THREE.MeshStandardMaterial({ map: groundTexture, roughness: 1, metalness: 0 }),
  );
  owned.push(ground.material as THREE.Material);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(def.size.w / 2, 0, def.size.h / 2);
  ground.receiveShadow = true;
  ground.name = 'ground';
  group.add(ground);

  // Grass blended over the ground (one texture for the whole town, drawn just above it).
  const mixTexture = groundMixTexture(def);
  if (mixTexture) {
    owned.push(mixTexture);
    const mixMaterial = new THREE.MeshStandardMaterial({
      map: mixTexture, transparent: true, roughness: 1, metalness: 0, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    owned.push(mixMaterial);
    const overlay = new THREE.Mesh(geo(new THREE.PlaneGeometry(def.size.w, def.size.h)), mixMaterial);
    overlay.rotation.x = -Math.PI / 2;
    overlay.position.set(def.size.w / 2, 0.01, def.size.h / 2);
    overlay.receiveShadow = true;
    overlay.userData['noShadow'] = true;
    overlay.name = 'ground-mix';
    group.add(overlay);
  }

  const animators: Animator[] = [];
  const own = <T extends { dispose(): void }>(item: T) => { owned.push(item); return item; };
  for (const obstacle of def.obstacles) {
    const object = buildObstacle(obstacle, palette, mat, geo, own, animators);
    object.position.set(obstacle.x, 0, obstacle.z);
    // TownNav maps world offsets to local with R(+rot); three's rotation.y = +rot is the inverse map, so mesh and grid agree.
    object.rotation.y = ((obstacle.rot ?? 0) * Math.PI) / 180;
    object.traverse(child => { if ((child as THREE.Mesh).isMesh && !child.userData['noShadow']) { child.castShadow = true; child.receiveShadow = true; } });
    group.add(object);
  }

  // Lights.
  const lights: THREE.Light[] = [];
  const l = def.lighting;
  // Floor keeps characters near dark edges (Aramaia) readable; the catalogue's relative darkness still shows.
  const ambient = new THREE.HemisphereLight(l.ambient, def.ground.accent, Math.max(0.4, l.ambientIntensity * 2.2));
  lights.push(ambient);
  let mainLight: TownWorld['mainLight'] = null;
  if (l.sun) {
    const sun = new THREE.DirectionalLight(l.sun.color, l.sun.intensity * 2);
    const dir = new THREE.Vector3(...l.sun.dir).normalize();
    const center = new THREE.Vector3(def.size.w / 2, 0, def.size.h / 2);
    sun.position.copy(center).addScaledVector(dir, -60);
    sun.target.position.copy(center);
    const half = Math.max(def.size.w, def.size.h) * 0.75;
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 160 });
    lights.push(sun);
    group.add(sun.target);
    mainLight = sun;
  }
  if (l.spot) {
    const spot = new THREE.SpotLight(l.spot.color, l.spot.intensity * 400, l.spot.height * 3, (l.spot.angleDeg * Math.PI) / 180, 0.65, 1.4);
    spot.position.set(l.spot.x, l.spot.height, l.spot.z);
    spot.target.position.set(l.spot.x, 0, l.spot.z);
    group.add(spot.target);
    lights.push(spot);
    mainLight = mainLight ?? spot;
  }
  // A catalogue point light standing on a campfire becomes that fire's flickering light.
  const campfires = def.obstacles.filter(o => o.kind === 'campfire');
  const flickering: Array<{ light: THREE.PointLight; base: number }> = [];
  for (const p of l.points) {
    const point = new THREE.PointLight(p.color, p.intensity * 25, p.range, 1.6);
    const fire = campfires.find(o => Math.hypot(o.x - p.x, o.z - p.z) <= (obstacleRadius(o) ?? 1));
    point.position.set(p.x, fire ? CAMPFIRE_LIGHT_HEIGHT : POINT_LIGHT_HEIGHT, p.z);
    if (fire) { point.name = 'campfire-light'; flickering.push({ light: point, base: point.intensity }); }
    lights.push(point);
  }
  const flames: THREE.Object3D[] = [];
  group.traverse(child => { if (child.name === 'flame') flames.push(child); });
  if (mainLight) {
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    mainLight.shadow.bias = -0.0015;
  }
  for (const light of lights) group.add(light);

  const fog = new THREE.Fog(def.fog.color, def.fog.near, def.fog.far);
  const background = new THREE.Color(def.fog.color);
  return {
    group, lights, mainLight, fog, background,
    update: (nowMs: number) => {
      const k = campfireFlicker(nowMs);
      for (const f of flickering) f.light.intensity = f.base * k;
      for (const [i, flame] of flames.entries()) {
        flame.scale.y = campfireFlicker(nowMs + i * 173);
        flame.rotation.y = Math.sin(nowMs * 0.003 + i * 2.1) * 0.35;
        flame.rotation.z = Math.sin(nowMs * 0.0042 + i * 1.3) * 0.08;
      }
      for (const animate of animators) animate(nowMs);
    },
    dispose: () => {
      for (const item of owned) item.dispose();
      for (const light of lights) (light as THREE.Light & { shadow?: THREE.LightShadow }).shadow?.map?.dispose();
    },
  };
}

type MatFn = (color: string, extra?: THREE.MeshStandardMaterialParameters) => THREE.MeshStandardMaterial;
type GeoFn = <T extends THREE.BufferGeometry>(g: T) => T;
type OwnFn = <T extends { dispose(): void }>(item: T) => T;
/** Moves part of an obstacle from the shared clock (same input, same pose on every client). */
type Animator = (nowMs: number) => void;

const GOLDEN = 0.6180339887;
const frac = (v: number) => v - Math.floor(v);

/** Light streaks on transparent blue: scrolled to make water move. */
function waterTexture(color: string | null): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  if (color) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, size, size);
  } else {
    // Falling streams: soft vertical bands on transparent.
    for (let x = 0; x < size; x += 8) {
      const band = ctx.createLinearGradient(x, 0, x + 8, 0);
      band.addColorStop(0, 'rgba(190,225,255,0)');
      band.addColorStop(0.5, 'rgba(190,225,255,0.85)');
      band.addColorStop(1, 'rgba(190,225,255,0)');
      ctx.fillStyle = band;
      ctx.fillRect(x, 0, 8, size);
    }
  }
  const rng = new Mulberry32('town:water');
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  for (let i = 0; i < 14; i++) {
    ctx.lineWidth = 1 + rng.next() * 2;
    const x = rng.next() * size;
    const y = rng.next() * size;
    const len = 8 + rng.next() * 18;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 3, y + len / 2, x, y + len);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, y = 0): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.y = y;
  return m;
}

/** Low-poly primitive per obstacle kind (footprint = the one TownNav blocks). */
function buildObstacle(o: TownObstacle, p: Palette, mat: MatFn, geo: GeoFn, own: OwnFn, animators: Animator[]): THREE.Object3D {
  const g = new THREE.Group();
  g.name = `obstacle:${o.kind}`;
  const r = obstacleRadius(o) ?? 1;
  const w = o.w ?? r * 2;
  const d = o.d ?? r * 2;
  switch (o.kind) {
    case 'tree':
    case 'tall_tree': {
      const h = o.height ?? (o.kind === 'tall_tree' ? 12 : 5);
      const trunkH = h * (o.kind === 'tall_tree' ? 0.55 : 0.4);
      g.add(mesh(geo(new THREE.CylinderGeometry(r * 0.22, r * 0.32, trunkH, 6)), mat(p.wood), trunkH / 2));
      const crown = o.kind === 'tall_tree'
        ? geo(new THREE.ConeGeometry(r * 2.1, h - trunkH + 1, 7))
        : geo(new THREE.IcosahedronGeometry(r * 1.6, 0));
      g.add(mesh(crown, mat(p.leaf), trunkH + (h - trunkH) / 2));
      break;
    }
    case 'fountain': {
      // Basin with a stone rim and water on top, a column, a bowl that overflows in a falling curtain.
      const top = (o.height ?? 2) + 0.4;
      const surface = 0.5;
      g.add(mesh(geo(new THREE.CylinderGeometry(r, r * 1.05, 0.45, 24)), mat(p.stone), 0.225));
      const rim = mesh(geo(new THREE.TorusGeometry(r * 0.93, Math.max(0.12, r * 0.07), 8, 32)), mat(p.stone), surface);
      rim.rotation.x = Math.PI / 2;
      g.add(rim);
      const basinMap = own(waterTexture(p.water));
      basinMap.repeat.set(3, 3);
      const basinMat = own(new THREE.MeshStandardMaterial({ color: '#ffffff', map: basinMap, roughness: 0.15, emissive: p.water, emissiveIntensity: 0.2, transparent: true, opacity: 0.88 }));
      const basin = mesh(geo(new THREE.CircleGeometry(r * 0.9, 32)), basinMat, surface + 0.02);
      basin.rotation.x = -Math.PI / 2;
      basin.userData['noShadow'] = true;
      g.add(basin);
      g.add(mesh(geo(new THREE.CylinderGeometry(r * 0.16, r * 0.22, top - surface, 8)), mat(p.stone), surface + (top - surface) / 2));
      g.add(mesh(geo(new THREE.CylinderGeometry(r * 0.45, r * 0.3, 0.25, 16)), mat(p.stone), top));
      const bowlWater = mesh(geo(new THREE.CircleGeometry(r * 0.4, 24)), basinMat, top + 0.13);
      bowlWater.rotation.x = -Math.PI / 2;
      bowlWater.userData['noShadow'] = true;
      g.add(bowlWater);
      const curtainMap = own(waterTexture(null));
      curtainMap.repeat.set(3, 1.5);
      const curtainMat = own(new THREE.MeshStandardMaterial({ color: '#ffffff', map: curtainMap, emissive: p.water, emissiveIntensity: 0.3, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
      const curtain = mesh(geo(new THREE.CylinderGeometry(r * 0.45, r * 0.62, top - surface, 24, 1, true)), curtainMat, surface + (top - surface) / 2);
      curtain.name = 'fountain-water';
      curtain.userData['noShadow'] = true;
      g.add(curtain);
      const ringGeo = geo(new THREE.RingGeometry(0.92, 1, 40));
      const ripples = [0, 1, 2].map(() => {
        const ring = mesh(ringGeo, own(new THREE.MeshBasicMaterial({ color: '#e8f6ff', transparent: true, depthWrite: false })), surface + 0.04);
        ring.rotation.x = -Math.PI / 2;
        ring.name = 'fountain-ripple';
        ring.userData['noShadow'] = true;
        g.add(ring);
        return ring;
      });
      animators.push((now) => {
        curtainMap.offset.y = frac(now * 0.0007);
        basinMap.offset.set(frac(now * 0.00004), frac(now * 0.00006));
        ripples.forEach((ring, i) => {
          const phase = frac(now / 2600 + i / ripples.length);
          const radius = r * (0.62 + phase * 0.26);
          ring.scale.set(radius, radius, 1);
          (ring.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - phase);
        });
      });
      break;
    }
    case 'house': {
      // Small per-house variations (wall height, roof shape/height/overhang, colours), fixed by its position.
      const v = houseVariation(o);
      const h = (o.height ?? 5) * v.height;
      const wallH = h * 0.6;
      g.add(mesh(geo(new THREE.BoxGeometry(w, wallH, d)), mat(v.wall(p.wall)), wallH / 2));
      // The roof overhangs every wall and starts a little below their top, so no wall corner pokes out.
      const roofH = (h - wallH) * v.roofHeight;
      const roofW = w + 2 * v.overhang * v.stretchX;
      const roofD = d + 2 * v.overhang * v.stretchZ;
      const roofGeo = geo(v.gable ? gableRoofGeometry(roofW, roofD, roofH) : hipRoofGeometry(roofW, roofD, roofH));
      // Drop the roof below the wall top only as far as the slope still covers the wall line.
      const overhangMin = v.overhang * Math.min(v.stretchX, v.stretchZ);
      const eaveDrop = Math.min(ROOF_EAVE_DROP, (0.5 * roofH * overhangMin) / (Math.min(roofW, roofD) / 2));
      const roofBase = wallH - eaveDrop;
      const roof = mesh(roofGeo, mat(v.roof(p.roof), { side: THREE.DoubleSide }), roofBase);
      roof.name = 'roof';
      g.add(roof);
      if (v.gable) {
        // Close the gable ends with wall under the roof slopes.
        const end = geo(gableEndGeometry(w, d, roofW, roofD, roofH, eaveDrop));
        for (const side of [-1, 1]) {
          const gableEnd = mesh(end, mat(v.wall(p.wall), { side: THREE.DoubleSide }), roofBase);
          if (w >= d) { gableEnd.rotation.y = Math.PI / 2; gableEnd.position.x = side * w / 2; }
          else gableEnd.position.z = side * d / 2;
          g.add(gableEnd);
        }
      }
      g.add(mesh(geo(new THREE.BoxGeometry(Math.min(1.1, w * 0.25), wallH * 0.55, 0.12)), mat(p.wood), wallH * 0.275)).position.z = d / 2 + 0.03;
      break;
    }
    case 'hut': {
      const v = houseVariation(o);
      const h = (o.height ?? 4.5) * v.height;
      const roofH = h * 0.62 * v.roofHeight;
      g.add(mesh(geo(new THREE.CylinderGeometry(r * 0.92, r, h * 0.42, 10)), mat(v.wall(p.wood)), h * 0.21));
      const roof = mesh(geo(new THREE.ConeGeometry(r * (1.18 + v.overhang * 0.15), roofH, 10)), mat(v.roof(p.thatch)), h * 0.42 - 0.08 + roofH / 2);
      roof.name = 'roof';
      g.add(roof);
      break;
    }
    case 'tent': {
      const v = houseVariation(o);
      const h = (o.height ?? 3) * v.height;
      g.add(mesh(geo(new THREE.ConeGeometry(r * 1.1, h, 4)), mat(v.roof(p.cloth)), h / 2));
      break;
    }
    case 'pillar': {
      const h = o.height ?? 6;
      g.add(mesh(geo(new THREE.CylinderGeometry(r * 0.85, r, h, 8)), mat(p.stone), h / 2));
      g.add(mesh(geo(new THREE.BoxGeometry(r * 2.2, 0.4, r * 2.2)), mat(p.stone), h + 0.2));
      break;
    }
    case 'pyramid_wall': {
      const h = o.height ?? 6;
      const tiers = 3;
      for (let i = 0; i < tiers; i++) {
        const shrink = 1 - i * 0.18;
        const tierH = h / tiers;
        g.add(mesh(geo(new THREE.BoxGeometry(Math.max(0.5, w - (1 - shrink) * Math.min(w, d)), tierH, Math.max(0.5, d * shrink))), mat(p.wall), tierH * i + tierH / 2));
      }
      break;
    }
    case 'lamp': {
      const h = o.height ?? 3.2;
      g.add(mesh(geo(new THREE.CylinderGeometry(0.08, 0.12, h, 6)), mat(p.wood), h / 2));
      g.add(mesh(geo(new THREE.OctahedronGeometry(0.28, 0)), mat('#ffd98a', { emissive: '#ffcf7a', emissiveIntensity: 1.6 }), h + 0.1));
      break;
    }
    case 'rock': {
      const rock = mesh(geo(new THREE.DodecahedronGeometry(r, 0)), mat(p.stone), r * 0.45);
      rock.scale.y = 0.6;
      g.add(rock);
      break;
    }
    case 'balcony': {
      // Platform on posts, slatted railing, stairs on the `stairs` side (local frame, like TownNav).
      const h = o.height ?? 3;
      g.add(mesh(geo(new THREE.BoxGeometry(w, 0.3, d)), mat(p.wood), h - 0.15));
      const post = geo(new THREE.BoxGeometry(0.3, h, 0.3));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(post, mat(p.wood), h / 2)).position.set(sx * (w / 2 - 0.2), h / 2, sz * (d / 2 - 0.2));
      const dir: Record<string, [number, number]> = { e: [1, 0], w: [-1, 0], s: [0, 1], n: [0, -1] };
      const [ux, uz] = dir[o.stairs ?? 'e'];
      const railH = 0.9;
      const slat = geo(new THREE.BoxGeometry(0.08, railH, 0.08));
      const edges: Array<{ along: 'x' | 'z'; fixed: number; len: number; stairsSide: boolean }> = [
        { along: 'x', fixed: -d / 2, len: w, stairsSide: uz === -1 },
        { along: 'x', fixed: d / 2, len: w, stairsSide: uz === 1 },
        { along: 'z', fixed: -w / 2, len: d, stairsSide: ux === -1 },
        { along: 'z', fixed: w / 2, len: d, stairsSide: ux === 1 },
      ];
      for (const e of edges) {
        const count = Math.round(e.len / 0.45);
        for (let i = 0; i <= count; i++) {
          const t = -e.len / 2 + (e.len * i) / count;
          if (e.stairsSide && Math.abs(t) < 1.05) continue; // opening for the stairs
          const s = g.add(mesh(slat, mat(p.wood), h + railH / 2)).children.at(-1)!;
          if (e.along === 'x') s.position.set(t, h + railH / 2, e.fixed); else s.position.set(e.fixed, h + railH / 2, t);
        }
        for (const half of e.stairsSide ? [-1, 1] : [0]) {
          const len = e.stairsSide ? e.len / 2 - 1 : e.len;
          const centre = e.stairsSide ? half * (1 + len / 2) : 0;
          const rail = mesh(geo(new THREE.BoxGeometry(e.along === 'x' ? len : 0.12, 0.1, e.along === 'x' ? 0.12 : len)), mat(p.wood), h + railH);
          if (e.along === 'x') rail.position.set(centre, h + railH, e.fixed); else rail.position.set(e.fixed, h + railH, centre);
          g.add(rail);
        }
      }
      const edge = ux !== 0 ? w / 2 : d / 2;
      const steps = Math.max(4, Math.round(h / 0.32));
      const run = TOWN_STAIRS_LENGTH / steps;
      for (let i = 0; i < steps; i++) {
        const stepH = h * (steps - i) / steps;
        const along = edge + run * (i + 0.5);
        const step = mesh(geo(new THREE.BoxGeometry(ux !== 0 ? run : 2, stepH, ux !== 0 ? 2 : run)), mat(p.stone), stepH / 2);
        step.position.set(ux * along, stepH / 2, uz * along);
        g.add(step);
      }
      break;
    }
    case 'tower': {
      // Three tapering stone stretches; battlements only at the very top (never on screen).
      const h = o.height ?? 90;
      const radii = [r, r * 0.86, r * 0.74];
      const tierH = h / radii.length;
      radii.forEach((radius, i) => {
        const next = radii[i + 1] ?? radius * 0.96;
        g.add(mesh(geo(new THREE.CylinderGeometry(next, radius, tierH, 14)), mat(p.stone), tierH * i + tierH / 2));
        g.add(mesh(geo(new THREE.CylinderGeometry(radius + 0.15, radius + 0.15, 0.5, 14)), mat(p.wall), tierH * (i + 1) - 0.25));
      });
      const top = radii.at(-1)! * 0.96;
      const merlon = geo(new THREE.BoxGeometry(0.8, 1.2, 0.8));
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        g.add(mesh(merlon, mat(p.stone), h + 0.6)).children.at(-1)!.position.set(Math.cos(a) * (top - 0.4), h + 0.6, Math.sin(a) * (top - 0.4));
      }
      const door = mesh(geo(new THREE.BoxGeometry(1.4, 2.4, 0.3)), mat('#2a1d14'), 1.2);
      door.position.z = r - 0.1;
      g.add(door);
      break;
    }
    case 'campfire': {
      const stone = geo(new THREE.DodecahedronGeometry(0.22, 0));
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        g.add(mesh(stone, mat(p.stone), 0.12)).children.at(-1)!.position.set(Math.cos(a) * r * 0.85, 0.12, Math.sin(a) * r * 0.85);
      }
      const log = geo(new THREE.CylinderGeometry(0.1, 0.12, r * 1.3, 6));
      for (let i = 0; i < 3; i++) {
        const l = mesh(log, mat(p.wood), 0.16);
        l.rotation.set(Math.PI / 2 - 0.25, (i * Math.PI) / 3, 0, 'YXZ');
        g.add(l);
      }
      const flameDefs: Array<[string, number, number, number, number]> = [
        ['#ff6a1a', 0.45, 1.1, 0, 0], ['#ff9a2e', 0.32, 0.85, 0.15, 0.1], ['#ffd34a', 0.2, 0.6, -0.1, -0.08],
      ];
      // Embers rising in a loose spiral, each on its own phase of the clock.
      const emberGeo = geo(new THREE.OctahedronGeometry(0.09, 0));
      const emberMat = own(new THREE.MeshBasicMaterial({ color: '#ffc04d', toneMapped: false }));
      const embers = Array.from({ length: 10 }, (_, i) => {
        const ember = mesh(emberGeo, emberMat, 0.3);
        ember.name = 'ember';
        ember.userData['noShadow'] = true;
        g.add(ember);
        return { ember, seed: i };
      });
      animators.push((now) => {
        for (const { ember, seed } of embers) {
          const phase = frac(now / 1700 + seed * GOLDEN);
          const angle = seed * 2.399 + phase * 3.2;
          const spread = 0.12 + phase * 0.45;
          ember.position.set(Math.cos(angle) * spread, 0.35 + phase * 2.6, Math.sin(angle) * spread);
          ember.scale.setScalar(Math.max(0.05, 1 - phase));
        }
      });
      for (const [color, radius, height, fx, fz] of flameDefs) {
        const flame = mesh(geo(new THREE.ConeGeometry(radius, height, 7)), mat(color, { emissive: color, emissiveIntensity: 0.9, roughness: 1, toneMapped: false }), 0);
        // Pivot at the base so the flicker grows the flame upwards.
        flame.geometry.translate(0, height / 2, 0);
        flame.position.set(fx, 0.2, fz);
        flame.name = 'flame';
        flame.userData['noShadow'] = true;
        g.add(flame);
      }
      break;
    }
    case 'altar': {
      // Concentric ring stairs up to a round altar; a thin pyramid, a sphere on top, pebbles in orbit.
      const steps = 4;
      const stepH = 0.35;
      const stepIn = Math.min(0.75, (r * 0.5) / steps);
      for (let i = 0; i < steps; i++) {
        const radius = r - stepIn * i;
        g.add(mesh(geo(new THREE.CylinderGeometry(radius, radius, stepH, 40)), mat(i % 2 ? p.wall : p.stone), stepH * i + stepH / 2));
      }
      const deck = stepH * steps;
      const spire = o.height ?? 5;
      const pyramid = mesh(geo(new THREE.ConeGeometry(0.42, spire, 4)), mat(p.stone, { emissive: p.stone, emissiveIntensity: 0.25 }), deck + spire / 2);
      pyramid.rotation.y = Math.PI / 4;
      g.add(pyramid);
      const orbCentre = deck + spire + 0.5;
      g.add(mesh(geo(new THREE.SphereGeometry(0.5, 24, 16)), mat('#ffe39a', { emissive: '#ffcf5a', emissiveIntensity: 0.9, roughness: 0.3 }), orbCentre));
      const pebbleGeo = geo(new THREE.DodecahedronGeometry(0.11, 0));
      const pebbles = Array.from({ length: 7 }, (_, i) => {
        const pebble = mesh(pebbleGeo, mat(p.stone), orbCentre);
        pebble.name = 'altar-pebble';
        g.add(pebble);
        return { pebble, radius: 0.85 + (i % 3) * 0.18, tilt: -0.6 + ((i * GOLDEN) % 1) * 1.2, speed: 0.0011 + (i % 4) * 0.00025, phase: i * 2.399 };
      });
      animators.push((now) => {
        for (const { pebble, radius, tilt, speed, phase } of pebbles) {
          const a = phase + now * speed;
          const x = Math.cos(a) * radius;
          const flatZ = Math.sin(a) * radius;
          pebble.position.set(x, orbCentre + flatZ * Math.sin(tilt), flatZ * Math.cos(tilt));
          pebble.rotation.set(a * 1.7, a * 1.3, 0);
        }
      });
      break;
    }
    case 'well': {
      // Stone well with dark water, two posts, a little gable roof and a bell swinging under it.
      const h = o.height ?? 3;
      g.add(mesh(geo(new THREE.CylinderGeometry(r, r * 1.04, 0.8, 18)), mat(p.stone), 0.4));
      const rim = mesh(geo(new THREE.TorusGeometry(r * 0.88, 0.14, 8, 24)), mat(p.stone), 0.82);
      rim.rotation.x = Math.PI / 2;
      g.add(rim);
      const water = mesh(geo(new THREE.CircleGeometry(r * 0.76, 20)), mat('#1f3a52', { roughness: 0.1, emissive: '#10283a', emissiveIntensity: 0.4 }), 0.81);
      water.rotation.x = -Math.PI / 2;
      g.add(water);
      const post = geo(new THREE.BoxGeometry(0.18, h, 0.18));
      for (const side of [-1, 1]) g.add(mesh(post, mat(p.wood), h / 2)).children.at(-1)!.position.set(side * (r + 0.05), h / 2, 0);
      const beamY = h - 0.25;
      g.add(mesh(geo(new THREE.BoxGeometry(2 * r + 0.5, 0.16, 0.16)), mat(p.wood), beamY));
      const roofW = 2 * r + 1;
      const panel = geo(new THREE.BoxGeometry(roofW, 0.1, 1.05));
      for (const side of [-1, 1]) {
        const half = mesh(panel, mat(p.roof), h + 0.28);
        half.position.z = side * 0.4;
        half.rotation.x = side * 0.6;
        g.add(half);
      }
      // The bell hangs from an arm off the front post, clear of the roof so the town camera sees it.
      const armZ = 1.35;
      const arm = mesh(geo(new THREE.BoxGeometry(0.12, 0.12, armZ)), mat(p.wood), beamY - 0.35);
      arm.position.set(r + 0.05, beamY - 0.35, armZ / 2);
      g.add(arm);
      const pivot = new THREE.Group();
      pivot.name = 'well-bell';
      pivot.position.set(r + 0.05, beamY - 0.42, armZ - 0.12);
      const bellMat = mat('#c9993a', { metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide });
      pivot.add(mesh(geo(new THREE.CylinderGeometry(0.03, 0.03, 0.18, 6)), mat(p.wood), -0.09));
      pivot.add(mesh(geo(new THREE.CylinderGeometry(0.12, 0.26, 0.36, 14, 1, true)), bellMat, -0.36));
      pivot.add(mesh(geo(new THREE.SphereGeometry(0.12, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)), bellMat, -0.18));
      // Clapper: its own little pendulum hung inside the bell's crown.
      const clapper = new THREE.Group();
      clapper.name = 'well-bell-clapper';
      clapper.position.y = -0.2;
      clapper.add(mesh(geo(new THREE.CylinderGeometry(0.012, 0.012, 0.26, 5)), mat('#6b5530', { metalness: 0.4 }), -0.13));
      clapper.add(mesh(geo(new THREE.SphereGeometry(0.06, 8, 6)), mat('#6b5530', { metalness: 0.4 }), -0.3));
      pivot.add(clapper);
      g.add(pivot);
      // A steady pendulum: one sine of constant amplitude, so it never stalls mid-swing (the old
      // sum of two unrelated sines cancelled itself every few seconds). Period from the hanging
      // length (~0.6 m incl. the strap: 2π√(L/g) ≈ 1.6 s). The clapper lags the bell by a
      // quarter of a swing and moves a little further, as a free clapper does.
      animators.push((now) => {
        const phase = (2 * Math.PI * now) / WELL_BELL_PERIOD_MS;
        pivot.rotation.x = WELL_BELL_AMPLITUDE * Math.sin(phase);
        clapper.rotation.x = 0.55 * WELL_BELL_AMPLITUDE * Math.sin(phase - Math.PI / 2);
      });
      break;
    }
    case 'fence': {
      const h = o.height ?? 1;
      g.add(mesh(geo(new THREE.BoxGeometry(w, 0.12, Math.max(0.08, d * 0.5))), mat(p.wood), h * 0.75));
      g.add(mesh(geo(new THREE.BoxGeometry(w, 0.12, Math.max(0.08, d * 0.5))), mat(p.wood), h * 0.35));
      const posts = Math.max(2, Math.round(w / 1.5) + 1);
      const post = geo(new THREE.BoxGeometry(0.14, h, 0.14));
      for (let i = 0; i < posts; i++) g.add(mesh(post, mat(p.wood), h / 2)).position.x = -w / 2 + (w * i) / (posts - 1);
      break;
    }
  }
  return g;
}

/** The roof starts this far below the top of the walls. */
export const ROOF_EAVE_DROP = 0.12;

export interface HouseVariation {
  height: number;
  roofHeight: number;
  overhang: number;
  stretchX: number;
  stretchZ: number;
  gable: boolean;
  wall: (base: string) => string;
  roof: (base: string) => string;
}

/** Deterministic small variations of one house (same house, same look, on every client). */
export function houseVariation(o: Pick<TownObstacle, 'x' | 'z'>): HouseVariation {
  const rng = new Mulberry32(`house:${o.x}:${o.z}`);
  const between = (a: number, b: number) => a + (b - a) * rng.next();
  const height = between(0.92, 1.1);
  const roofHeight = between(0.85, 1.25);
  const overhang = between(0.45, 0.7);
  const stretchX = between(0.9, 1.15);
  const stretchZ = between(0.9, 1.15);
  const gable = rng.next() < 0.45;
  const wallShift = [between(-0.015, 0.015), between(-0.06, 0.06), between(-0.05, 0.05)] as const;
  const roofShift = [between(-0.04, 0.04), between(-0.12, 0.12), between(-0.08, 0.08)] as const;
  const shift = (base: string, [hh, ss, ll]: readonly [number, number, number]) => `#${new THREE.Color(base).offsetHSL(hh, ss, ll).getHexString()}`;
  return { height, roofHeight, overhang, stretchX, stretchZ, gable, wall: (b) => shift(b, wallShift), roof: (b) => shift(b, roofShift) };
}

function triangles(positions: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Hip roof over a w×d rectangle (base at y=0, centred): a ridge along the longer
 * side, trapezoids on the long sides and triangles on the short ones (a square
 * gives a pyramid). Built straight on the rectangle, so it never skews.
 */
export function hipRoofGeometry(w: number, d: number, h: number): THREE.BufferGeometry {
  const alongX = w >= d;
  const a = (alongX ? w : d) / 2;
  const b = (alongX ? d : w) / 2;
  const r = Math.max(0, a - b);
  // Local frame: long axis = u, short = v; map (u, y, v) to (x, y, z).
  const P = (u: number, y: number, v: number) => (alongX ? [u, y, v] : [v, y, u]);
  const c1 = P(-a, 0, -b), c2 = P(a, 0, -b), c3 = P(a, 0, b), c4 = P(-a, 0, b);
  const r1 = P(-r, h, 0), r2 = P(r, h, 0);
  const tris = [
    // long sides
    c1, r1, r2, c1, r2, c2,
    c3, r2, r1, c3, r1, c4,
    // ends
    c2, r2, c3,
    c4, r1, c1,
  ];
  return triangles(tris.flat());
}

/** Gable roof over a w×d rectangle: two slopes meeting at a ridge along the longer side, open ends. */
export function gableRoofGeometry(w: number, d: number, h: number): THREE.BufferGeometry {
  const alongX = w >= d;
  const a = (alongX ? w : d) / 2;
  const b = (alongX ? d : w) / 2;
  const P = (u: number, y: number, v: number) => (alongX ? [u, y, v] : [v, y, u]);
  const c1 = P(-a, 0, -b), c2 = P(a, 0, -b), c3 = P(a, 0, b), c4 = P(-a, 0, b);
  const r1 = P(-a, h, 0), r2 = P(a, h, 0);
  return triangles([c1, r1, r2, c1, r2, c2, c3, r2, r1, c3, r1, c4].flat());
}

/**
 * Wall piece closing one gable end, in the XY plane (x across the house's short
 * side), from the roof base up to just under the slopes.
 */
export function gableEndGeometry(w: number, d: number, roofW: number, roofD: number, roofH: number, drop: number): THREE.BufferGeometry {
  const half = Math.min(w, d) / 2;
  const roofHalf = Math.min(roofW, roofD) / 2;
  const slopeAt = (t: number) => roofH * (1 - Math.abs(t) / roofHalf) - 0.03;
  const shape = new THREE.Shape();
  shape.moveTo(-half, -drop);
  shape.lineTo(half, -drop);
  shape.lineTo(half, slopeAt(half));
  shape.lineTo(0, slopeAt(0));
  shape.lineTo(-half, slopeAt(-half));
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

/**
 * Grass patches over the whole town (not tiled, so no repeating pattern): an
 * alpha mask from smooth value noise, with grass strokes inside the patches.
 */
function groundMixTexture(def: TownSceneDef): THREE.CanvasTexture | null {
  const mix = def.ground.mix;
  if (!mix) return null;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rng = new Mulberry32(`${def.mapId}:ground-mix`);
  // Value noise on a few octaves, from a seeded lattice.
  const octaves = [8, 16, 32].map((cells) => ({ cells, grid: Array.from({ length: (cells + 1) * (cells + 1) }, () => rng.next()) }));
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const noise = (u: number, v: number) => {
    let sum = 0, weight = 0, amp = 1;
    for (const { cells, grid } of octaves) {
      const x = u * cells, y = v * cells;
      const x0 = Math.floor(x), y0 = Math.floor(y);
      const fx = smooth(x - x0), fy = smooth(y - y0);
      const at = (i: number, j: number) => grid[Math.min(cells, j) * (cells + 1) + Math.min(cells, i)];
      const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
      const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
      sum += (top * (1 - fy) + bottom * fy) * amp;
      weight += amp;
      amp *= 0.5;
    }
    return sum / weight;
  };
  const coverage = Math.max(0, Math.min(1, mix.coverage));
  const threshold = 1 - coverage; // noise is ~uniform around 0.5; centre the cut on the coverage
  const cut = 0.5 + (threshold - 0.5) * 0.5;
  const image = ctx.createImageData(size, size);
  const base = new THREE.Color(mix.color);
  const accent = new THREE.Color(mix.accent);
  const alphaAt = new Float32Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const n = noise(i / size, j / size);
    const alpha = Math.max(0, Math.min(1, (n - cut) / 0.12));
    alphaAt[j * size + i] = alpha;
    const k = (j * size + i) * 4;
    const tint = Math.max(0, Math.min(1, (n - cut) * 4));
    image.data[k] = (base.r * (1 - tint) + accent.r * tint) * 255;
    image.data[k + 1] = (base.g * (1 - tint) + accent.g * tint) * 255;
    image.data[k + 2] = (base.b * (1 - tint) + accent.b * tint) * 255;
    image.data[k + 3] = alpha * 255;
  }
  ctx.putImageData(image, 0, 0);
  // Blades: short strokes inside the patches, a few spilling onto the clay at their edges.
  for (let i = 0; i < 9000; i++) {
    const x = rng.next() * size, y = rng.next() * size;
    const alpha = alphaAt[Math.floor(y) * size + Math.floor(x)];
    if (alpha <= 0.05 && rng.next() > 0.04) continue;
    ctx.globalAlpha = (0.2 + rng.next() * 0.35) * Math.max(0.3, alpha);
    ctx.fillStyle = rng.next() < 0.5 ? mix.accent : mix.color;
    ctx.fillRect(x, y, 1, 1 + rng.next() * 1.5);
  }
  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Tiled ground pattern drawn once on a canvas (deterministic per town). */
function groundCanvasTexture(def: TownSceneDef): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rng = new Mulberry32(`${def.mapId}:ground`);
  ctx.fillStyle = def.ground.base;
  ctx.fillRect(0, 0, size, size);
  const accent = def.ground.accent;
  switch (def.ground.pattern) {
    case 'cobblestone': {
      const cell = 32;
      ctx.strokeStyle = accent; ctx.lineWidth = 3;
      for (let y = 0; y < size; y += cell) {
        const offset = (y / cell) % 2 ? cell / 2 : 0;
        for (let x = -cell; x < size + cell; x += cell) {
          ctx.globalAlpha = 0.35 + rng.next() * 0.4;
          ctx.fillStyle = rng.next() < 0.5 ? accent : def.ground.base;
          roundRect(ctx, x + offset + 2, y + 2, cell - 4, cell - 4, 7);
          ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
        }
      }
      break;
    }
    case 'stone': {
      const cell = 64;
      ctx.strokeStyle = accent; ctx.lineWidth = 4;
      for (let y = 0; y < size; y += cell) for (let x = 0; x < size; x += cell) {
        ctx.globalAlpha = 0.25 + rng.next() * 0.35;
        ctx.fillStyle = accent; ctx.fillRect(x, y, cell, cell);
        ctx.globalAlpha = 1; ctx.strokeRect(x + 1, y + 1, cell - 2, cell - 2);
      }
      break;
    }
    case 'grass':
    case 'dirt': {
      const marks = def.ground.pattern === 'grass' ? 900 : 500;
      for (let i = 0; i < marks; i++) {
        ctx.globalAlpha = 0.25 + rng.next() * 0.45;
        ctx.fillStyle = accent;
        const x = rng.next() * size, y = rng.next() * size;
        if (def.ground.pattern === 'grass') ctx.fillRect(x, y, 1.5, 3 + rng.next() * 4);
        else { ctx.beginPath(); ctx.arc(x, y, 1 + rng.next() * 3, 0, Math.PI * 2); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
      break;
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(def.size.w / 6, def.size.h / 6);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
