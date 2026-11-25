// Arena screenshot harness (bundled by shoot-arena.mjs): real runtime, real battle fixtures.
import { defaultAppearance } from '@nanommo/shared';
import { createArenaRuntime, type ArenaActorVisual, type ArenaRuntimeHandle } from '../../../apps/frontend/src/app/features/play/arena/arena-runtime';
import { arenaScene, type ArenaTimelineInput } from '../../../apps/frontend/src/app/features/play/arena/arena-phase';
import { fromSharedBattle, fromSoloEntry } from '../../../apps/frontend/src/app/features/play/arena/arena-battle';
import type { ArenaBattle, ArenaCharacterLook } from '../../../apps/frontend/src/app/features/play/arena/arena.types';
import type { ArenaRegionId } from '../../../apps/frontend/src/app/features/play/arena/arena-region';
import { SOLO_V2_ENTRY } from '../../../apps/frontend/src/app/features/play/arena/fixtures/solo-v2.fixture';
import { PARTY_V2_VIEW } from '../../../apps/frontend/src/app/features/play/arena/fixtures/party-v2.fixture';

const looks: Record<string, ArenaCharacterLook> = {
  archer: { sex: 'male', heightCm: 181, appearance: { ...defaultAppearance(), hair: 2, hairColor: 1, facialHair: 1 }, dominantHand: 'right', equipment: { head: 'equip_head_phys_t2', body: 'equip_body_phys_t3', cape: 'equip_cape_phys_t3', shoes: 'equip_shoes_holy_t4', mainHand: 'equip_bow_t1' }, refinement: null, mainHandType: 'bow', offHandType: null },
  knight: { sex: 'male', heightCm: 186, appearance: { ...defaultAppearance(), hair: 1 }, dominantHand: 'right', equipment: { head: 'equip_head_phys_t2', body: 'equip_body_phys_t3', cape: 'equip_cape_phys_t3', shoes: 'equip_shoes_holy_t4', mainHand: 'equip_sword_t3', offHand: 'equip_shield_t2' }, refinement: null, mainHandType: 'sword', offHandType: 'shield' },
  mage: { sex: 'female', heightCm: 168, appearance: { ...defaultAppearance(), hair: 3, hairColor: 4 }, dominantHand: 'right', equipment: { head: 'equip_head_magic_t2', body: 'equip_body_magic_t2', mainHand: 'equip_staff_t2' }, refinement: null, mainHandType: 'staff', offHandType: null },
};

const solo = (): ArenaBattle => fromSoloEntry(SOLO_V2_ENTRY, { id: 'char-self', look: looks['archer'], attackStyle: 'bow' })!;
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

interface Shot { battle: () => ArenaBattle; region: ArenaRegionId; at: (b: ArenaBattle) => number; mode: 'battle' | 'walk' | 'intro'; party?: string[] }
const SHOTS: Record<string, Shot> = {
  walk: { battle: solo, region: 'green_grounds', mode: 'walk', at: (b) => b.startAtMs - 6000 },
  intro: { battle: solo, region: 'green_grounds', mode: 'intro', at: (b) => b.startAtMs - 500 },
  solo_approach: { battle: solo, region: 'kwaioua_forest', mode: 'battle', at: (b) => b.startAtMs + 9 * 500 + 380 },
  solo_close: { battle: solo, region: 'ipora_beach', mode: 'battle', at: (b) => b.startAtMs + 26 * 500 + 420 },
  party_fight: { battle: party, region: 'menace_hills', mode: 'battle', at: (b) => b.startAtMs + 5 * 500 + 30, party: ['char-self', 'char-ally'] },
  party_status: { battle: statuses, region: 'wastelands', mode: 'battle', at: (b) => b.startAtMs + 3 * 500, party: ['char-self', 'char-ally'] },
  ruins: { battle: party, region: 'forest_ruins', mode: 'battle', at: (b) => b.startAtMs + 1 * 500, party: ['char-self', 'char-ally'] },
  caete: { battle: solo, region: 'caete', mode: 'battle', at: (b) => b.startAtMs + 30 * 500 + 200 },
};

let runtime: ArenaRuntimeHandle | null = null;
(window as any).shoot = async (name: string) => {
  const shot = SHOTS[name];
  const battle = shot.battle();
  const visuals = visualsOf(battle);
  const partyIds = shot.party ?? ['char-self'];
  const party = partyIds.map((id) => ({ id, look: battle.actors.find((a) => a.id === id)!.look }));
  const input = (now: number): ArenaTimelineInput => ({
    nowMs: now, current: shot.mode === 'battle' ? battle : null, previous: null,
    next: shot.mode === 'intro' ? battle : null, nextStartAtMs: shot.mode === 'intro' ? battle.startAtMs : null,
    party, selfId: 'char-self', gatherAtMs: null,
  });
  runtime ??= await createArenaRuntime(document.getElementById('host')!, { assetBase: '/assets/character/', catalogUrl: '/data/appearance_catalog.json', onContextLost: () => undefined });
  const target = shot.at(battle);
  // Warm up where every actor of the shot already exists (battle shots: after the start), so models load.
  const warm = shot.mode === 'battle' ? Math.max(target - 1500, battle.startAtMs + 1) : Math.max(target - 1500, battle.startAtMs - 1100);
  let clock = warm;
  runtime.setSource((now) => ({ scene: arenaScene(input(now)), visuals, region: shot.region }));
  // Let every model load and dress, then replay the last 1.5 s at 60 fps (crossfades, camera ease).
  for (let i = 0; i < 80; i++) { runtime.renderOnce(clock); await new Promise((r) => setTimeout(r, 100)); }
  const actorsAtWarm = arenaScene(input(clock)).frame.actors.map((a) => `${a.id}@${a.column.toFixed(1)},${a.row.toFixed(1)}`);
  for (; clock < target; clock = Math.min(target, clock + 1000 / 60)) runtime.renderOnce(clock);
  runtime.renderOnce(target);
  const anchors = [...runtime.screenAnchors()].map(([id, a]) => `${id}:${Math.round(a.x)},${Math.round(a.y)},${a.visible}`);
  return { actors: runtime.actorCount(), actorsAtWarm, anchors };
};
(window as any).shots = Object.keys(SHOTS);
