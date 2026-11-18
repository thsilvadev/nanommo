/**
 * Builds a town from its catalogue entry: ground, obstacle primitives, lights
 * and fog. The same obstacle list is rasterised by the shared TownNav, so what
 * you see is what blocks.
 */
import * as THREE from 'three';
import { Mulberry32, TOWN_STAIRS_LENGTH, obstacleRadius, type TownObstacle, type TownSceneDef } from '@nanommo/shared';

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

  for (const obstacle of def.obstacles) {
    const object = buildObstacle(obstacle, palette, mat, geo);
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
      for (const [i, flame] of flames.entries()) flame.scale.y = campfireFlicker(nowMs + i * 173);
    },
    dispose: () => {
      for (const item of owned) item.dispose();
      for (const light of lights) (light as THREE.Light & { shadow?: THREE.LightShadow }).shadow?.map?.dispose();
    },
  };
}

type MatFn = (color: string, extra?: THREE.MeshStandardMaterialParameters) => THREE.MeshStandardMaterial;
type GeoFn = <T extends THREE.BufferGeometry>(g: T) => T;

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, y = 0): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.y = y;
  return m;
}

/** Low-poly primitive per obstacle kind (footprint = the one TownNav blocks). */
function buildObstacle(o: TownObstacle, p: Palette, mat: MatFn, geo: GeoFn): THREE.Object3D {
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
      g.add(mesh(geo(new THREE.CylinderGeometry(r, r * 1.05, 0.7, 16)), mat(p.stone), 0.35));
      g.add(mesh(geo(new THREE.CylinderGeometry(r * 0.88, r * 0.88, 0.1, 16)), mat(p.water, { roughness: 0.2, emissive: p.water, emissiveIntensity: 0.15 }), 0.62));
      g.add(mesh(geo(new THREE.CylinderGeometry(r * 0.16, r * 0.22, (o.height ?? 2) + 0.4, 8)), mat(p.stone), ((o.height ?? 2) + 0.4) / 2));
      g.add(mesh(geo(new THREE.CylinderGeometry(r * 0.45, r * 0.35, 0.25, 12)), mat(p.stone), (o.height ?? 2) + 0.4));
      break;
    }
    case 'house': {
      const h = o.height ?? 5;
      const wallH = h * 0.6;
      g.add(mesh(geo(new THREE.BoxGeometry(w, wallH, d)), mat(p.wall), wallH / 2));
      const roof = mesh(geo(new THREE.ConeGeometry(Math.hypot(w, d) / 2 * 1.05, h - wallH, 4, 1)), mat(p.roof), wallH + (h - wallH) / 2);
      roof.rotation.y = Math.PI / 4;
      roof.scale.set(w / Math.hypot(w, d) * Math.SQRT2, 1, d / Math.hypot(w, d) * Math.SQRT2);
      g.add(roof);
      g.add(mesh(geo(new THREE.BoxGeometry(Math.min(1.1, w * 0.25), wallH * 0.55, 0.12)), mat(p.wood), wallH * 0.275)).position.z = d / 2 + 0.03;
      break;
    }
    case 'hut': {
      const h = o.height ?? 4.5;
      g.add(mesh(geo(new THREE.CylinderGeometry(r * 0.92, r, h * 0.42, 10)), mat(p.wood), h * 0.21));
      g.add(mesh(geo(new THREE.ConeGeometry(r * 1.25, h * 0.62, 10)), mat(p.thatch), h * 0.42 + h * 0.31));
      break;
    }
    case 'tent': {
      const h = o.height ?? 3;
      g.add(mesh(geo(new THREE.ConeGeometry(r * 1.1, h, 4)), mat(p.cloth), h / 2));
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
