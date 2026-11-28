// Arena screenshot harness (bundled by shoot-arena.mjs): real runtime, real battle fixtures.
import { defaultAppearance } from '@nanommo/shared';
import { createArenaRuntime, type ArenaActorVisual, type ArenaRuntimeHandle, type ArenaView } from '../../../apps/frontend/src/app/features/play/arena/arena-runtime';
import { arenaBattleOffset, arenaScene, arenaWalkColumn, type ArenaTimelineInput } from '../../../apps/frontend/src/app/features/play/arena/arena-phase';
import { fromSharedBattle, fromSoloEntry } from '../../../apps/frontend/src/app/features/play/arena/arena-battle';
import type { ArenaBattle, ArenaCharacterLook } from '../../../apps/frontend/src/app/features/play/arena/arena.types';
import { ARENA_REGIONS, type ArenaRegionId } from '../../../apps/frontend/src/app/features/play/arena/arena-region';
import { arenaPropLayout } from '../../../apps/frontend/src/app/features/play/arena/arena-prop-layout';
import { renderFace } from '../../../apps/frontend/src/app/features/play/arena/character-face-render';
import { SOLO_V2_ENTRY } from '../../../apps/frontend/src/app/features/play/arena/fixtures/solo-v2.fixture';
import { PARTY_V2_VIEW } from '../../../apps/frontend/src/app/features/play/arena/fixtures/party-v2.fixture';

const looks: Record<string, ArenaCharacterLook> = {
  archer: { sex: 'male', heightCm: 181, appearance: { ...defaultAppearance(), hair: 2, hairColor: 1, facialHair: 1 }, dominantHand: 'right', equipment: { head: 'equip_head_phys_t2', body: 'equip_body_phys_t3', cape: 'equip_cape_phys_t3', shoes: 'equip_shoes_holy_t4', mainHand: 'equip_bow_t1' }, refinement: null, mainHandType: 'bow', offHandType: null },
  knight: { sex: 'male', heightCm: 186, appearance: { ...defaultAppearance(), hair: 1 }, dominantHand: 'right', equipment: { head: 'equip_head_phys_t2', body: 'equip_body_phys_t3', cape: 'equip_cape_phys_t3', shoes: 'equip_shoes_holy_t4', mainHand: 'equip_sword_t3', offHand: 'equip_shield_t2' }, refinement: null, mainHandType: 'sword', offHandType: 'shield' },
  mage: { sex: 'female', heightCm: 168, appearance: { ...defaultAppearance(), hair: 3, hairColor: 4 }, dominantHand: 'right', equipment: { head: 'equip_head_magic_t2', body: 'equip_body_magic_t2', mainHand: 'equip_staff_t2' }, refinement: null, mainHandType: 'staff', offHandType: null },
};

/** The solo entry as the API sends it: the snapshot has no characterId, so the log names the self actor 'character'. */
const PROD_SOLO_ENTRY = { ...JSON.parse(JSON.stringify(SOLO_V2_ENTRY).replace(/"char-self"/g, '"character"')), characterId: 'char-self' };
const solo = (): ArenaBattle => fromSoloEntry(PROD_SOLO_ENTRY, { id: 'char-self', look: looks['archer'], attackStyle: 'bow' })!;
function party(): ArenaBattle {
  const b = fromSharedBattle(PARTY_V2_VIEW, 'char-self');
  for (const a of b.actors) if (a.id === 'char-self') a.look = looks['knight']; else if (a.id === 'char-ally') a.look = looks['mage'];
  return b;
}
/** The party battle with status effects pinned on (stun on the wolf, freeze on a slime, sleep on the other). */
function statuses(): ArenaBattle {
  const b = party();
  const pin: Record<string, string> = { 'monster:mon_direwolf:0': 'stun', 'monster:mon_slime:1': 'freeze', 'monster:mon_slime:2': 'sleep' };
  b.events = b.events.map((e) => ({ ...e, actorStates: e.actorStates && Object.fromEntries(Object.entries(e.actorStates).map(([id, s]) => [id, pin[id] && s.hp > 0 ? { ...s, statusEffects: [{ type: pin[id] }] } : s])) }));
  return b;
}
const visualsOf = (b: ArenaBattle) => new Map<string, ArenaActorVisual>(b.actors.map((a) => [a.id, { id: a.id, team: a.team, kind: a.kind, name: a.name, look: a.look, monsterId: a.monsterId }]));

interface Shot { battle: () => ArenaBattle; region: ArenaRegionId; at: (b: ArenaBattle) => number; mode: 'battle' | 'walk' | 'intro' | 'outro' | 'chain'; party?: string[]; view?: Omit<ArenaView, 'selfId' | 'focusId'>;
  /** Walk the scenery so the region's first prop of `kind` stands `x` metres right of the camera at the shot. */
  propAt?: { kind: string; x: number } }
const SHOTS: Record<string, Shot> = {
  walk: { battle: solo, region: 'green_grounds', mode: 'walk', at: (b) => b.startAtMs - 6000 },
  walk_green_grounds: { battle: solo, region: 'green_grounds', mode: 'walk', at: (b) => b.startAtMs - 6000 },
  walk_menace_hills: { battle: solo, region: 'menace_hills', mode: 'walk', at: (b) => b.startAtMs - 6000 },
  walk_kwaioua_forest: { battle: solo, region: 'kwaioua_forest', mode: 'walk', at: (b) => b.startAtMs - 6000 },
  walk_wastelands: { battle: solo, region: 'wastelands', mode: 'walk', at: (b) => b.startAtMs - 6000 },
  walk_caete: { battle: solo, region: 'caete', mode: 'walk', at: (b) => b.startAtMs - 6000 },
  walk_forest_ruins: { battle: solo, region: 'forest_ruins', mode: 'walk', at: (b) => b.startAtMs - 6000 },
  walk_ipora_beach: { battle: solo, region: 'ipora_beach', mode: 'walk', at: (b) => b.startAtMs - 6000 },
  walk_gods_bridge: { battle: solo, region: 'gods_bridge', mode: 'walk', at: (b) => b.startAtMs - 6000 },
  intro: { battle: solo, region: 'green_grounds', mode: 'intro', at: (b) => b.startAtMs - 500 },
  solo_approach: { battle: solo, region: 'kwaioua_forest', mode: 'battle', at: (b) => b.startAtMs + 9 * 500 + 380 },
  solo_close: { battle: solo, region: 'ipora_beach', mode: 'battle', at: (b) => b.startAtMs + 26 * 500 + 420 },
  party_fight: { battle: party, region: 'menace_hills', mode: 'battle', at: (b) => b.startAtMs + 5 * 500 + 30, party: ['char-self', 'char-ally'] },
  party_status: { battle: statuses, region: 'wastelands', mode: 'battle', at: (b) => b.startAtMs + 3 * 500, party: ['char-self', 'char-ally'] },
  bridge_fight: { battle: party, region: 'gods_bridge', mode: 'battle', at: (b) => b.startAtMs + 5 * 500 + 30, party: ['char-self', 'char-ally'] },
  ruins: { battle: party, region: 'forest_ruins', mode: 'battle', at: (b) => b.startAtMs + 1 * 500, party: ['char-self', 'char-ally'] },
  outro: { battle: solo, region: 'green_grounds', mode: 'outro', at: (b) => b.endAtMs + 600 },
  caete: { battle: solo, region: 'caete', mode: 'battle', at: (b) => b.startAtMs + 30 * 500 + 200 },
  // The player's orbit (click and drag) at its limits: the painted scenery must still fill the view.
  orbit_left: { battle: party, region: 'menace_hills', mode: 'battle', at: (b) => b.startAtMs + 5 * 500 + 30, party: ['char-self', 'char-ally'], view: { zoom: 0.6, yawDeg: -70, pitchDeg: 12 } },
  orbit_right: { battle: party, region: 'kwaioua_forest', mode: 'battle', at: (b) => b.startAtMs + 5 * 500 + 30, party: ['char-self', 'char-ally'], view: { zoom: 0.6, yawDeg: 70, pitchDeg: 12 } },
  orbit_high: { battle: party, region: 'caete', mode: 'battle', at: (b) => b.startAtMs + 5 * 500 + 30, party: ['char-self', 'char-ally'], view: { zoom: 0.6, yawDeg: 30, pitchDeg: 60 } },
  orbit_bridge: { battle: party, region: 'gods_bridge', mode: 'battle', at: (b) => b.startAtMs + 5 * 500 + 30, party: ['char-self', 'char-ally'], view: { zoom: 0.6, yawDeg: -70, pitchDeg: 5 } },
  // Party battle → outro → walk → intro → the same battle again 6 s later (nobody walks back).
  chain_end: { battle: party, region: 'green_grounds', mode: 'chain', at: (b) => b.endAtMs - 100, party: ['char-self', 'char-ally'] },
  chain_outro: { battle: party, region: 'green_grounds', mode: 'chain', at: (b) => b.endAtMs + 700, party: ['char-self', 'char-ally'] },
  chain_walk: { battle: party, region: 'green_grounds', mode: 'chain', at: (b) => b.endAtMs + 3000, party: ['char-self', 'char-ally'] },
  chain_intro: { battle: party, region: 'green_grounds', mode: 'chain', at: (b) => b.endAtMs + CHAIN_GAP - 600, party: ['char-self', 'char-ally'] },
  chain_start: { battle: party, region: 'green_grounds', mode: 'chain', at: (b) => b.endAtMs + CHAIN_GAP + 1500, party: ['char-self', 'char-ally'] },
};
// Green Grounds' rare fence on the near side of the grid: passing in front of the walker, and of a walking party.
SHOTS['walk_green_grounds_fence'] = { ...SHOTS['walk_green_grounds'], propAt: { kind: 'fence', x: 0.5 } };
SHOTS['party_walk_green_grounds_fence'] = { ...SHOTS['chain_walk'], propAt: { kind: 'fence', x: -1.5 } };
SHOTS['high_green_grounds'] = { battle: party, region: 'green_grounds', mode: 'battle', at: (b) => b.startAtMs + 5 * 500 + 30, party: ['char-self', 'char-ally'], view: { zoom: 0, yawDeg: 20, pitchDeg: 50 } };
// Every region seen from both orbit limits (scenery must stay solid when the camera turns): orbit_<region>_l / _r.
for (const region of ARENA_REGIONS) for (const [side, yawDeg] of [['l', -70], ['r', 70]] as const) {
  SHOTS[`orbit_${region}_${side}`] = { battle: party, region, mode: 'battle', at: (b) => b.startAtMs + 5 * 500 + 30, party: ['char-self', 'char-ally'], view: { zoom: 0.6, yawDeg, pitchDeg: 10 } };
}
const CHAIN_GAP = 6000;
const chained = new WeakMap<ArenaBattle, ArenaBattle>();
function nextOf(b: ArenaBattle): ArenaBattle {
  let n = chained.get(b);
  if (!n) { n = { ...b, id: `${b.id}:next`, startAtMs: b.endAtMs + CHAIN_GAP, endAtMs: b.endAtMs + CHAIN_GAP + (b.endAtMs - b.startAtMs) }; chained.set(b, n); }
  return n;
}
function chainInput(now: number, prev: ArenaBattle, party: ArenaTimelineInput['party']): ArenaTimelineInput {
  const next = nextOf(prev);
  const offset = arenaBattleOffset(arenaWalkColumn(prev, 0), next);
  const current = now < prev.endAtMs ? prev : now >= next.startAtMs ? next : null;
  return {
    nowMs: now, current, previous: now >= prev.endAtMs ? prev : null, next: now < next.startAtMs ? next : null, nextStartAtMs: next.startAtMs,
    party, selfId: 'char-self', gatherAtMs: null, offsets: { previous: 0, current: current === next ? offset : 0, next: offset },
  };
}

let runtime: ArenaRuntimeHandle | null = null;
(window as any).shoot = async (name: string) => {
  if (name === 'face') return shootFace();
  const shot = SHOTS[name];
  const battle = shot.battle();
  const visuals = visualsOf(battle);
  const partyIds = shot.party ?? ['char-self'];
  const party = partyIds.map((id) => ({ id, look: battle.actors.find((a) => a.id === id)!.look }));
  const input = (now: number): ArenaTimelineInput => shot.mode === 'chain' ? chainInput(now, battle, party) : ({
    nowMs: now, current: shot.mode === 'battle' || shot.mode === 'outro' ? battle : null, previous: shot.mode === 'outro' ? battle : null,
    next: shot.mode === 'intro' ? battle : null, nextStartAtMs: shot.mode === 'intro' ? battle.startAtMs : null,
    party, selfId: 'char-self', gatherAtMs: null,
  });
  runtime ??= await createArenaRuntime(document.getElementById('host')!, { assetBase: '/assets/character/', catalogUrl: '/data/appearance_catalog.json', onContextLost: () => undefined });
  const target = shot.at(battle);
  // Warm up where every actor of the shot already exists (battle shots: after the start), so models load.
  const warm = shot.mode === 'chain' ? Math.max(battle.endAtMs - 1500, target - 2000) : shot.mode === 'battle' || shot.mode === 'outro' ? Math.max(target - 1500, battle.startAtMs + 1) : shot.mode === 'walk' ? target - 1500 : Math.max(target - 1500, battle.startAtMs - 1100);
  let clock = warm;
  runtime.setSource((now) => ({ scene: arenaScene(input(now)), visuals, region: shot.region }));
  runtime.setView({ focusId: null, selfId: 'char-self', zoom: 0, yawDeg: 0, pitchDeg: 12, ...shot.view });
  // Let every model load and dress, then replay the last 1.5 s at 60 fps (crossfades, camera ease).
  for (let i = 0; i < 80; i++) { runtime.renderOnce(clock); await new Promise((r) => setTimeout(r, 100)); }
  // Painted layers load asynchronously: never shoot a region before its scenery is in.
  for (let i = 0; i < 300 && !runtime.sceneryReady(shot.region); i++) { runtime.renderOnce(clock); await new Promise((r) => setTimeout(r, 100)); }
  if (shot.propAt) {
    // Scenery-local x of a prop is ((u - travelled) mod 180) - 90, travelled = walked + camera x; the last 1.5 s still walks on.
    const prop = arenaPropLayout(shot.region).find((p) => p.kind === shot.propAt!.kind);
    const scenery = (runtime as any).scenery;
    const walkOn = shot.mode === 'walk' || shot.mode === 'chain' ? 1.4 * (target - clock) / 1000 : 0;
    if (prop) scenery.walked = prop.u - 90 - shot.propAt.x - scenery.group.position.x - walkOn;
  }
  const actorsAtWarm = arenaScene(input(clock)).frame.actors.map((a) => `${a.id}@${a.column.toFixed(1)},${a.row.toFixed(1)}`);
  for (; clock < target; clock = Math.min(target, clock + 1000 / 60)) runtime.renderOnce(clock);
  runtime.renderOnce(target);
  const anchors = [...runtime.screenAnchors()].map(([id, a]) => `${id}:${Math.round(a.x)},${Math.round(a.y)},${a.visible}`);
  const cam = (runtime as any).camera.position, sc = (runtime as any).scenery;
  return { actors: runtime.actorCount(), actorsAtWarm, anchors, camera: [cam.x, cam.y, cam.z].map((v: number) => +v.toFixed(1)), sceneryX: +sc.group.position.x.toFixed(1), walked: +sc.walked.toFixed(1) };
};
/** The arena toggle's picture: the archer's bare face (the look wears a helmet; the face must not). */
async function shootFace(): Promise<object> {
  const archer = looks['archer'];
  const url = await renderFace({ sex: archer.sex, heightCm: archer.heightCm, appearance: archer.appearance, dominantHand: archer.dominantHand }, '/data/appearance_catalog.json');
  const host = document.getElementById('host')!;
  host.innerHTML = `<div style="display:flex;gap:40px;align-items:center;padding:40px;background:#2b2233;height:100%;box-sizing:border-box">
    <img src="${url}" style="width:384px;height:384px;image-rendering:auto;background:#555" />
    <span style="width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:radial-gradient(circle at 50% 38%,#3a2c46 0%,#1c1524 62%,#0e0a13 100%);box-shadow:0 0 0 2px #d9a441">
      <img src="${url}" style="width:34px;height:34px;border-radius:50%;object-fit:cover" /></span></div>`;
  await new Promise((r) => setTimeout(r, 200));
  return { bytes: url.length };
}
(window as any).shots = [...Object.keys(SHOTS), 'face'];
