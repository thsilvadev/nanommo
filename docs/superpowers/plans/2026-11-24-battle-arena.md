# Battle Arena Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Map ↔ Arena view on non-town maps that replays the authoritative V2 battle log (solo and party, up to 5 vs 10) as a 3D side-view scene, with a scrolling walk scene between battles.

**Architecture:** Everything the arena shows is computed by pure, three.js-free functions of `(ArenaBattle, nowMs)` in `features/play/arena/` (normalisation, positions, actions/feedback, phase/transitions, region, camera framing). A lazily-loaded three.js `ArenaRuntime` only draws those frames, reusing `TownCharacterFactory`/`TownCharacter` for many dressed characters in one scene and a renderer-free `MonsterModel` extracted from the monster viewer. Two small backend additions feed party battles (character visuals, next encounter time).

**Tech Stack:** Angular 18 (standalone, signals), three.js (on demand), NestJS 10, `@nanommo/shared`, sharp (asset scripts), Karma/Jasmine, Node assertion scripts.

**Spec:** `docs/superpowers/specs/2026-11-24-battle-arena-design.md`

## Global Constraints

- Server authority: the arena never simulates combat; it projects `startAt`/`endAt` + V2 events. No `Math.random()` in anything that decides what is shown (cosmetic noise must be seeded, e.g. `mulberry32Seed`).
- Tick = 500 ms; convert with `packages/shared/src/battle-engine/time.ts` helpers / `battle.tickDurationMs`, never hard-coded tick counts.
- Grid is 10×10 (`BATTLE_GRID_SIZE`); column = X (team A left), row = depth Z.
- Walk ↔ battle transitions: **total budget 3 s** (outro 900 ms + walk + intro 1200 ms), compressed when the real gap is shorter; the battle always starts at `startAt`.
- Map ↔ Arena toggle fade: 1 s to black + 1 s from black. Party wipe: 1 s fade to black. No other fades.
- three.js only loaded when the arena first opens; render loop only while arena visible and `document.visibilityState === 'visible'`; device pixel ratio capped at 1.5; blob shadows, no shadow maps.
- Assets: CC0 only; generated outputs (`public/assets/character/*`, `public/assets/arena/*`) are rebuilt by their scripts, never hand-edited; record origin in `CREDITS.md`.
- No migrations; never run migrations, mutate a DB, deploy, or push to `main`. Work on `feat/battle-arena`.
- UI strings through `LocaleService.t()` with en + pt entries.
- Build `@nanommo/shared` before api/frontend/tests (`pnpm --filter @nanommo/shared build`).
- Frontend spec run: from `apps/frontend`, `CHROME_BIN=/snap/bin/chromium npx ng test --watch=false --browsers=ChromeHeadless --include='<glob>'`. Type-check: `npx tsc -p tsconfig.spec.json --noEmit`.
- Docs in step: each task that changes behaviour adds to a dated `STATUS.md` entry (newest at top) at the end (Task 12); new traps → `ENGINEERING_NOTES.md`.

## Review Focus

1. **Opening the arena mid-battle / after a sleeping tab** — the frame for `now` must equal the frame reached by playing from the start (positions, deaths, HP). Test: Task 4 `late join equals continuous`.
2. **Gap shorter than the budget** (clock skew, 3 s gap with drift) — outro/intro compress proportionally, battle still starts exactly at `startAt`. Test: Task 6 `compresses into a 1.5 s gap`.
3. **Party battle known only at/after `startAt`** (socket late by up to ~1 s, or `nextEncounterAt` null) — foes run in over ≤ 500 ms and then match the true projection; no lag after that. Test: Task 6 `late party battle converges`.
4. **Flee / cancelled entry** — no actor stuck mid-move or in CombatIdle after `cancelledAt`; the fleeing character leaves left. Test: Task 4 `flee exits left`.
5. **Missing visuals** (character with `appearance = null`, monster without a manifest entry/GLB, WebGL unavailable) — placeholder capsule / hidden toggle, never a crash or blank scene. Tests: Task 10 `missing monster model falls back`, Task 8 `no webgl hides arena toggle`.

---

## File Structure

New, `apps/frontend/src/app/features/play/arena/`:

| File | Responsibility |
|---|---|
| `arena.types.ts` | Shared types (no three.js import) |
| `arena-battle.ts` | Normalise solo queue entry / `SharedBattleView` → `ArenaBattle` |
| `arena-positions.ts` | Per-actor position, facing, hp/sp, statuses, death, flee at `now` |
| `arena-actions.ts` | Attack/cast/hit timing, floating numbers + flash list; `projectArenaBattle` |
| `arena-phase.ts` | Walk / outro / intro / battle / wipe scheduling, gather, scroll speed |
| `arena-region.ts` | `mapId` → region id + asset paths |
| `arena-camera.ts` | Grid → world, camera framing |
| `arena-view-mode.ts` | Map/Town/Arena view rule (replaces `mapViewMode` use in map-board) |
| `arena-toggle.component.ts` | Round Map ↔ Arena button (head icon) |
| `arena-feedback-owner.service.ts` | Who shows floating numbers/flash: arena or side panels |
| `arena-runtime.ts` | three.js scene (lazy) |
| `arena-actor-views.ts` | three.js per-actor objects: character/monster adapters, HUD anchors, status FX |
| `arena-scenery.ts` | Ground strip + parallax layers |
| `arena-scene.component.ts/.html/.css` | Angular host: stores → projection → runtime; HTML HUD (bars, numbers) |

Modified: `shared/character-animation/animation-state.ts`, new `shared/character-animation/apply-animation-state.ts`, `shared/character-viewer/character-rig.ts`, `features/play/town-scene/town-character.ts`, `shared/monster-viewer/monster-viewer.component.ts` + new `shared/monster-viewer/monster-model.ts`, `shared/battle-hit-feedback.ts`, `features/play/components.ts` + `map-board.html/.css`, `core/party-projection.ts`, `core/party.store.ts`, `apps/api/src/modules/party/shared-battle.service.ts`, `party.service.ts`, `packages/shared/src/battle-engine/actors.ts` (export rows table), `tools/character-assets/build.mjs`, new `tools/arena-assets/build-arena-art.mjs`.

---

### Task 1: New character clips (Gather, Sprint, Stun)

**Files:**
- Modify: `tools/character-assets/build.mjs:171-173` (clip rename map), `apps/frontend/public/assets/character/CREDITS.md`, `apps/frontend/src/app/shared/character-viewer/character-asset-cache.ts:22`
- Test: `tools/character-assets/check-clips.mjs` (new)

**Interfaces:**
- Produces: `animations.glb` containing `Gather` (from `Fixing_Kneeling`), `Sprint` (from `Sprint_Loop`), `Stun` (from `Hit_Head`, kept as its own clip; `Damage2` stays too). `ANIMATIONS_ASSET = 'animations.glb?v=3'`.

- [ ] **Step 1: Write `check-clips.mjs`** — reads `apps/frontend/public/assets/character/animations.glb` (parse GLB JSON chunk as the builder already does), asserts the clip set ⊇ `['Idle','Walk','Attack','Damage','Dead','CombatIdle','CastStart','CastLoop','Damage2','Gather','Sprint','Stun']`, prints each clip's duration (seconds, 3 decimals), exits 1 on a miss.
- [ ] **Step 2: Run** `node tools/character-assets/check-clips.mjs` → FAIL listing `Gather, Sprint, Stun`.
- [ ] **Step 3: Add the three entries** to the rename map (`Fixing_Kneeling: 'Gather', Sprint_Loop: 'Sprint'`, and emit `Hit_Head` a second time as `Stun`); run `cd tools/character-assets && npm run build`; bump `ANIMATIONS_ASSET` to `?v=3`; add the three source names to the `animations.glb` row in `CREDITS.md`.
- [ ] **Step 4: Run** `node tools/character-assets/check-clips.mjs` → PASS; note the printed `Gather`/`Sprint`/`Stun` durations for Task 2.
- [ ] **Step 5: Commit** `feat(character-assets): Gather, Sprint and Stun clips`.

### Task 2: Renderer-free animation application + new clip states

**Files:**
- Create: `apps/frontend/src/app/shared/character-animation/apply-animation-state.ts`
- Modify: `shared/character-animation/animation-state.ts:14-41`, `shared/character-viewer/character-rig.ts:640-703` (delegate), `features/play/town-scene/town-character.ts` (`CLIPS`, new `drive`)
- Test: `shared/character-animation/apply-animation-state.spec.ts`, existing `character-viewer.component.spec.ts`, `town-character.spec.ts`

**Interfaces:**
- Produces:
  - `BaseClip = 'Idle' | 'Walk' | 'CombatIdle' | 'Sprint'`; `OneShotClip = 'Attack' | 'Dead' | 'Gather' | 'Stun'`; `CLIP_SECONDS` gains `Gather`, `Sprint`, `Stun` (values printed in Task 1).
  - `AnimationState.freezeAtMs?: number` — when set, every clip is evaluated at `min(nowMs, freezeAtMs)` (freeze/stun hold).
  - `interface AnimatedBody { actions: Map<string, THREE.AnimationAction>; weights: Map<string, number>; mixer: THREE.AnimationMixer; animatedAtMs: number | null }`
  - `applyAnimationState(body: AnimatedBody, state: AnimationState, nowMs: number): void` — the exact blend now in `CharacterRig.animate` (base loop by wall clock, overlay one-shot/cast, hit sine weight, weights summing to 1, fades), minus the bow pose. `Stun` as a one-shot holds at `STUN_HOLD_SECONDS` (exported const, = 40 % of the `Stun` clip) instead of playing through.
  - `TownCharacter` constructor option `{ arena?: boolean }`: loads `['Idle','Walk','CombatIdle','Sprint','Attack','Dead','Gather','Stun','CastStart','CastLoop','Damage','Damage2']` instead of the town `CLIPS`; new method `drive(state: AnimationState, nowMs: number, x: number, z: number, yaw: number): void` that positions the object and calls `applyAnimationState`; `bones(): Map<string, THREE.Bone> | null` for the bow pose.

- [ ] **Step 1: Write failing spec** `apply-animation-state.spec.ts` using a real `AnimationMixer` on a tiny skinned stub with one-track clips named as above:
  - `base Walk alone has weight 1` → `clipWeight('Walk') ≈ 1`, others 0 (first frame snaps).
  - `oneShot Attack at its middle` → Attack weight 1, time ≈ `0.5 * CLIP_SECONDS.Attack`.
  - `weights sum to 1 during a hit` → Σ effective weights ≈ 1 (±1e-6).
  - `freezeAtMs holds time` → clip times at now=freeze+2000 equal those at freeze.
  - `Stun holds its pose` → Stun time = `STUN_HOLD_SECONDS` at +0.1 s and +5 s.
- [ ] **Step 2: Run** spec → FAIL (module missing).
- [ ] **Step 3: Implement** `applyAnimationState` by moving the body of `CharacterRig.animate` (excluding `bowShot`/`poseBowShot`); `CharacterRig.animate` calls it then does the bow pose. Extend clip unions/constants; `BASE_CLIPS`/`OVERLAY_CLIPS` include the new names but tolerate their absence (`actions.get` miss → skip) so the rig works with older GLBs in tests.
- [ ] **Step 4: Add `arena` option + `drive()` to `TownCharacter`**; town path unchanged.
- [ ] **Step 5: Run** `--include='**/{apply-animation-state,character-viewer.component,town-character,animation-state}.spec.ts'` → PASS.
- [ ] **Step 6: Commit** `refactor(animation): renderer-free applyAnimationState; Sprint/Gather/Stun states`.

### Task 3: `ArenaBattle` model and normalisers

**Files:**
- Create: `features/play/arena/arena.types.ts`, `features/play/arena/arena-battle.ts`
- Modify: `core/party-projection.ts:2-16` (add `position`, `character?` to `SharedActor`; `nextEncounterAt?` handled in Task 9)
- Test: `features/play/arena/arena-battle.spec.ts`

**Interfaces:**
- Produces (in `arena.types.ts`):
```ts
export type ArenaTeam = 'a' | 'b';
export interface ArenaCell { row: number; column: number }
export interface ArenaCharacterLook { sex: Sex; heightCm: number; appearance: CharacterAppearance; dominantHand: 'right'|'left'; equipment: VisibleEquipment; refinement: VisibleRefinement | null; mainHandType: HandWeaponType | null; offHandType: HandWeaponType | null }
export interface ArenaActorDef { id: string; team: ArenaTeam; kind: 'character'|'monster'|'pet'; name: string; start: ArenaCell; maxHp: number; maxSp: number; hp: number; sp: number; monsterId: string | null; look: ArenaCharacterLook | null; attackStyle: AttackStyle; moveSpeed: number | null }
export interface ArenaEvent { tick: number; actorId: string; targetIds: string[]; action: string; payload: Record<string, any>; actorStates?: Record<string, { hp: number; sp: number; position?: ArenaCell; statusEffects?: Array<{ id?: string; type?: string }> }> }
export interface ArenaBattle { id: string; startAtMs: number; endAtMs: number; tickMs: number; actors: ArenaActorDef[]; events: ArenaEvent[]; flee: { atMs: number } | null; outcome: 'win'|'loss'|null; selfId: string; mapId: string; receivedAtMs?: number /* party: when the client first saw it (Task 6) */ }
```
- `fromSoloEntry(entry: BattleQueueEntry, self: { id: string; look: ArenaCharacterLook | null; attackStyle: AttackStyle }): ArenaBattle | null` — actors from `entry.log.header.v2Input.actors`, events from `entry.log.v2Events`; null if either is absent (legacy V1 entry). Flee from `cancellationReason === 'flee'` + `cancelledAt`. Monster `attackStyle` via `monsterAttackStyle(manifest entry)` supplied by caller later — here default `'melee'` and accept an optional `monsterStyle: (monsterId) => AttackStyle` third argument.
- `fromSharedBattle(view: SharedBattleView, selfId: string, monsterStyle?: (id: string) => AttackStyle): ArenaBattle` — flee when `view.state === 'fled'` (check the actual state string in `shared-battle.service.ts`; use `endAt` as `atMs`).

- [ ] **Step 1: Generate real-shape fixtures** (Karma can't run the engine): a one-off Node script `features/play/arena/fixtures/make-fixtures.mjs` using `packages/shared/dist` writes `solo-v2.json` (`simulateBattleV2Solo`, a real monster from `monsters.json`, an `always → attack` gambit page) and `party-v2.json` (`simulateBattleV2`, 2 characters vs 3 monsters, placed with `placeBattleActors`), wrapped in the queue-entry / `SharedBattleView` shapes. Commit script + JSON.
- [ ] **Step 1b: Write failing spec** using those fixtures:
  - `solo: two actors, character team a at {5,0}` (or `{5,4}` when both melee — assert whichever the fixture produced against `v2Input`).
  - `solo: legacy entry without v2Events → null`.
  - `solo flee → flee.atMs === Date.parse(cancelledAt)`.
  - `party: actor count 5 and teams split 2/3`, `startAtMs/tickMs` from view.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(arena): ArenaBattle model from solo and party battles`.

### Task 4: Positions, facing, HP/SP, statuses, death, flee

**Files:**
- Create: `features/play/arena/arena-positions.ts`
- Test: `features/play/arena/arena-positions.spec.ts`

**Interfaces:**
- Consumes: `ArenaBattle`.
- Produces:
```ts
export type ArenaStatusVisual = 'stun' | 'freeze' | 'sleep';
export interface ArenaActorPose { id: string; column: number; row: number; facing: 1 | -1; moving: 'walk' | 'dash' | 'slide' | null; hp: number; sp: number; statuses: ArenaStatusVisual[]; statusSinceMs: Partial<Record<ArenaStatusVisual, number>>; deadAtMs: number | null; fleeing: { sinceMs: number } | null }
export function arenaPositions(battle: ArenaBattle, nowMs: number): ArenaActorPose[];
export const ARENA_DASH_MS = 150; export const ARENA_SLIDE_MS = 250; export const ARENA_FLEE_SPEED_CELLS_PER_S = 6;
```
- Rules: approach `move` animates from `payload.from` to `payload.to` ending at the event time, duration = min(time since the actor's previous event, `moveDurationMs(moveSpeed, tickMs)`), where `moveDurationMs` = ticks for the movement gauge to reach 200 at `moveSpeed` per tick (fallback 2 ticks); blinkstrike → `dash` over `ARENA_DASH_MS`; push → `slide` over `ARENA_SLIDE_MS`; revive → snap. HP/SP/status from the latest `actorStates` at or before now (fallback to defs). `facing` = sign(target column − own column) using the latest `target` event / `actorStates[*].targetId`, default team a = 1, team b = −1. `statuses` = ids in `statusEffects` mapped `stun→stun`, `freeze→freeze`, `sleep→sleep`; others ignored. Death = first `lifecycle` event with `payload.reason` in (`damage`,`status`) for that actor, cleared by a later `revive` move. Flee (team a characters, `battle.flee`): from `flee.atMs`, facing −1, column decreases at `ARENA_FLEE_SPEED_CELLS_PER_S` (may go below 0 = off-screen).

- [ ] **Step 1: Write failing spec** (fixtures from Task 3 + small hand-built battles for edge cases):
  - `start positions at startAt` equal `defs.start`.
  - `approach move ends on its tick`: at event time → `column === to.column`; halfway through its window → strictly between.
  - `late join equals continuous`: for 20 sampled `now` values, `arenaPositions(b, t)` deep-equals the result of calling it at every 50 ms up to `t` and taking the last (the function is pure, so this pins no hidden state; also assert no `Date.now` use by calling with a far-future `now` and comparing with `endAtMs`).
  - `dead stays dead`: after the lifecycle event `deadAtMs` is set and position frozen.
  - `stun visible while in statusEffects` and gone after `status_ended`.
  - `flee exits left`: 1 s after `flee.atMs`, column = start − 6 and facing −1.
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS.
- [ ] **Step 5: Commit** `feat(arena): positions, facing, hp/sp, statuses, death and flee projection`.

### Task 5: Actions, hits, feedback; `projectArenaBattle`

**Files:**
- Create: `features/play/arena/arena-actions.ts`
- Modify: `shared/battle-hit-feedback.ts` (export a `flashColor` helper)
- Test: `features/play/arena/arena-actions.spec.ts`

**Interfaces:**
- Consumes: `arenaPositions`, `CLIP_SECONDS`, `BOW_RELEASE_FRACTION`, `ARROW_FLIGHT_SECONDS`, `MONSTER_ATTACK_LEAD_MS`, `MONSTER_IMPACT_FRACTION`, `damageFeedbackStyle`.
- Produces:
```ts
export interface ArenaFeedback { key: string; targetId: string; atMs: number; text: string; style: DamageFeedbackStyle | 'heal' | 'miss'; flash: ArenaFlash | null }
export interface ArenaCastBar { startedAtMs: number; endsAtMs: number; skillId: string }
export interface ArenaActorFrame extends ArenaActorPose { anim: AnimationState; cast: ArenaCastBar | null; projectile: { fromId: string; toId: string; launchAtMs: number; hitAtMs: number } | null }
export interface ArenaFrame { actors: ArenaActorFrame[]; feedback: ArenaFeedback[]; wiped: boolean; ended: boolean }
export const ARENA_FEEDBACK_MS = 1100;
// in battle-hit-feedback.ts (so panels and arena agree):
export type ArenaFlash = 'white' | 'red' | 'green' | 'orange' | 'darkred';
export function flashColor(event: { action?: string; status?: string; crit?: boolean }, targetIsSelfTeam: boolean): ArenaFlash;
export function projectArenaBattle(battle: ArenaBattle, nowMs: number): ArenaFrame;
```
- Rules: generalise `characterAnimationState`/`monsterAnimationState` per `actorId` (same timing: melee swing starts on the hit and is sped up to fit before the next action; bow opens early so the arrow lands on the hit; monsters lead by `MONSTER_ATTACK_LEAD_MS`; `cast` event opens a cast bar until `resolvesAtTick`). `anim.base`: `Walk` while `moving==='walk'`, `Sprint` while dash or fleeing, else `CombatIdle`; `Dead` one-shot from `deadAtMs`; `Stun` one-shot + `freezeAtMs` while stunned/asleep; `freezeAtMs = statusSinceMs.freeze` while frozen. Feedback: one entry per damaging `action`/`status` event (`damage > 0`), miss when `hit === false`, heal when `healAmount > 0`, visible for `ARENA_FEEDBACK_MS` after `atMs`. Flash: team-a target white, team-b target red; status damage poison → green, burn → orange, bleed → darkred (overrides). `wiped` = all team-a actors dead; `ended` = `nowMs >= endAtMs` or flee.

- [ ] **Step 1: Write failing spec:**
  - `melee attack peaks on the hit tick` (`anim.oneShot.clip === 'Attack'`, `startedAtMs === hit time`).
  - `bow arrow lands on the hit`: `projectile.hitAtMs === hit time`, `launchAtMs === hit − ARROW_FLIGHT_SECONDS*1000`.
  - `cast bar spans cast → resolve`.
  - `poison tick flashes green`, `burn orange`, `bleed darkred`, `hit on own team white`, `hit on monster red`.
  - `feedback expires after 1100 ms`.
  - `stunned actor holds Stun with freezeAtMs`.
  - `wipe when every team-a actor is dead` (party fixture variant).
- [ ] **Step 2–4:** FAIL → implement → PASS (also re-run `battle-hit-feedback.spec.ts`).
- [ ] **Step 5: Commit** `feat(arena): action, cast, hit and feedback projection`.

### Task 6: Phases and transitions (walk / outro / intro / battle / wipe)

**Files:**
- Create: `features/play/arena/arena-phase.ts`
- Modify: `packages/shared/src/battle-engine/actors.ts:22` — export `CENTRAL_DEPLOYMENT_ROWS` (the existing `rows` table) and use it in place.
- Test: `features/play/arena/arena-phase.spec.ts`

**Interfaces:**
- Produces:
```ts
export const ARENA_OUTRO_MS = 900; export const ARENA_INTRO_MS = 1200; export const ARENA_TRANSITION_BUDGET_MS = 3000; export const ARENA_PARTY_RUN_IN_MS = 500; export const ARENA_GATHER_MS = /* CLIP_SECONDS.Gather*1000 */;
export interface ArenaTimelineInput { nowMs: number; current: ArenaBattle | null; previous: ArenaBattle | null; next: ArenaBattle | null; nextStartAtMs: number | null; party: Array<{ id: string; look: ArenaCharacterLook | null }>; gatherAtMs: number | null }
export type ArenaPhaseKind = 'walk' | 'outro' | 'intro' | 'battle' | 'wipe';
export interface ArenaSceneFrame { phase: ArenaPhaseKind; scroll: number /* 0..1 of walk speed */; frame: ArenaFrame /* actors incl. walkers */; fade: number /* 0..1 black, wipe only */ }
export function walkFormation(count: number): ArenaCell[]; // column 4.5, rows = CENTRAL_DEPLOYMENT_ROWS[min(count,5)]
export function arenaScene(input: ArenaTimelineInput): ArenaSceneFrame;
```
- Rules: `battle` when `current` and `startAtMs ≤ now < endAtMs` (or until flee exit). `outro` for `[previous.endAtMs, +ARENA_OUTRO_MS·k)`: dead foes sink/fade (`frame` keeps them with an `exitProgress` 0..1 — add `exit?: number` to `ArenaActorFrame`), party `CombatIdle` → `Walk`, scroll ramps 0→1. `intro` for `[next.startAtMs − ARENA_INTRO_MS·k, next.startAtMs)`: scroll 1→0, foes slide from column 11.5 to start cells, party slides from `walkFormation` to start cells, all landing exactly at `startAtMs`. `k = min(1, gap / (OUTRO+INTRO))` (gap = next start − previous end); walk fills the rest. Party with only `nextStartAtMs` (battle not known yet): scroll decelerates over the intro window with no foes; when the battle arrives after its `startAtMs`, foes are drawn interpolating from column 11.5 to their **projected** position over `ARENA_PARTY_RUN_IN_MS` from the arrival time (pass `arrivedAtMs` in `next`/`current` via an optional `receivedAtMs` on `ArenaBattle`). `walk`: party at `walkFormation`, base `Walk`, scroll 1, except a `Gather` one-shot for self while `gatherAtMs ≤ now < gatherAtMs + ARENA_GATHER_MS` (scroll 0). `wipe`: from the death time of the last team-a actor + `CLIP_SECONDS.Dead`, `fade` 0→1 over 1000 ms.

- [ ] **Step 1: Write failing spec:**
  - `3 s gap: outro 900, walk 900, intro 1200` (phase at +0.1 s, +1.2 s, +2.0 s).
  - `compresses into a 1.5 s gap`: outro 600, intro 900, no walk; at `startAtMs` phase is `battle` and every actor is on its start cell.
  - `foes land exactly at startAt` (positions at `startAtMs − 1` within 0.01 cells of start).
  - `late party battle converges`: battle received 800 ms after `startAt`; at receive+250 ms foes are between 11.5 and projected; at receive+500 ms they equal `projectArenaBattle` positions.
  - `gather pauses scroll`.
  - `wipe fades to black`.
- [ ] **Step 2–4:** FAIL → implement → PASS. Rebuild shared (`pnpm --filter @nanommo/shared build`) and run `node apps/api/test/` group-battle tests that import `placeBattleActors` (grep `placeBattleActors` in `apps/api/test` and run each) → PASS.
- [ ] **Step 5: Commit** `feat(arena): walk/battle transitions within a 3 s budget`.

### Task 7: Regions, scenery art, camera framing

**Files:**
- Create: `features/play/arena/arena-region.ts`, `features/play/arena/arena-camera.ts`, `tools/arena-assets/build-arena-art.mjs`, `tools/arena-assets/README.md`, `apps/frontend/public/assets/arena/<region>/{sky,far,near,ground}.webp`
- Test: `arena-region.spec.ts`, `arena-camera.spec.ts`

**Interfaces:**
- Produces:
```ts
export type ArenaRegionId = 'green_grounds'|'menace_hills'|'kwaioua_forest'|'wastelands'|'caete'|'forest_ruins'|'ipora_beach'|'gods_bridge';
export function arenaRegionOf(mapId: string | null | undefined): ArenaRegionId; // strip /^map_/ and /_\d+$/; unknown → 'green_grounds'
export function arenaRegionAssets(region: ArenaRegionId): { sky: string; far: string; near: string; ground: string };
export const ARENA_CELL_M = 2.4; export const ARENA_CAMERA_PITCH_DEG = 25; export const ARENA_CAMERA_FOV_DEG = 30;
export function cellToWorld(cell: { row: number; column: number }): { x: number; z: number }; // x = (column − 4.5)·CELL, z = (row − 4.5)·CELL
export function frameCells(cells: ArenaCell[], aspect: number): { targetX: number; targetZ: number; distance: number }; // bbox + 1 cell margin, min 4×3 cells, max full 10×10
export function monsterScale(nativeWidthM: number, nativeHeightM: number): number; // keep real size; clamp so width ≤ 1.1·CELL
```
- Art script: sharp + SVG composition, seeded (`mulberry32`) shapes per region following the spec table (sky gradient + clouds; far silhouettes; near foliage/rocks; tiling ground 512×512). Layers 2048×512 webp, horizontally tileable (assert left/right column equality in the script).

- [ ] **Step 1: Failing specs:**
  - `every grind map in public/data/maps.json resolves to a listed region` (fetch the mirror in the spec; assert none falls to fallback except ids not starting with the 8 prefixes — expect zero).
  - `map_menace_hills_2 → menace_hills`, `map_gods_bridge → gods_bridge`, `null → green_grounds`.
  - `1v1 frames closer than 5v10` (distance smaller), `5v10 never exceeds full grid`.
  - `monsterScale clamps a 6 m wide dragon to 2.64 m width but keeps a 0.8 m slime at 1`.
- [ ] **Step 2–4:** FAIL → implement → PASS. Run `node tools/arena-assets/build-arena-art.mjs`; verify 32 files exist and view 2 of them (Read the webp) for sanity.
- [ ] **Step 5: Commit** `feat(arena): regions, parallax art and camera framing`.

### Task 8: View mode, toggle, fade, feedback ownership

**Files:**
- Create: `features/play/arena/arena-view-mode.ts`, `arena-toggle.component.ts`, `arena-feedback-owner.service.ts`
- Modify: `features/play/components.ts:161-246` (MapBoard: view state), `map-board.html`, `map-board.css`, `shared/battle-hit-feedback.ts` (respect owner), `core/locale` strings (`Arena`, `Map`)
- Test: `arena-view-mode.spec.ts`, `arena-toggle.component.spec.ts`, `battle-hit-feedback.spec.ts`

**Interfaces:**
- Produces:
```ts
export type WorldView = 'map' | 'town' | 'arena';
export function worldViewMode(input: { inTown: boolean; mapId: string | null; townChoice: { mapId: string; mode: 'map'|'town' } | null; arenaChoice: 'map' | 'arena' | null; webgl: boolean }): WorldView;
export function arenaChoiceAfter(prev: { mapId: string | null; inTown: boolean; traveling: boolean; destinationMapId: string | null }, next: { mapId: string | null; inTown: boolean; traveling: boolean; isGrind: boolean }, choice: 'map'|'arena'|null): 'map'|'arena'|null;
@Injectable({ providedIn: 'root' }) export class ArenaFeedbackOwner { readonly arenaVisible: WritableSignal<boolean> }
```
- Rules: town → existing town rule unchanged; non-town → `arenaChoice ?? 'map'`; WebGL unavailable → always `'map'` and the toggle is hidden. `arenaChoiceAfter`: entering a town clears it (null); arriving (traveling true → false) on the travel destination grind map sets `'arena'`; hops while traveling keep it; login/teleport (no prior state or not traveling) keeps null → map. Toggle: same round button style as `town-view-toggle`, icon map SVG ↔ a 30 px head crop (`app-character-viewer framing="bust"` would add a WebGL context — use instead a static `<img>` of `/assets/ui/arena-view-head.svg`, a generic helmeted head icon drawn for this task). Fade: an overlay div in `.viewport` animating opacity 0→1 (1 s), swap, 1→0 (1 s); the swap happens at the black peak. `BattleHitFeedbackDirective` skips numbers/flash while `owner.arenaVisible()` is true.

- [ ] **Step 1: Failing specs:**
  - `non-town default is map`, `arena choice persists across hops while traveling`, `arriving at destination grind map opens arena`, `entering a town clears the arena choice`, `login on a grind map opens map`, `no webgl hides arena toggle` (`worldViewMode(...webgl:false) === 'map'` and component renders no button).
  - `panel feedback suppressed while arena visible` (directive spec: set signal true → no floating number element after a damage event).
- [ ] **Step 2–4:** FAIL → implement (MapBoard keeps the town toggle in towns; arena toggle only on non-town maps, placed in `.map-head` before `.map-meta`) → PASS.
- [ ] **Step 5: Commit** `feat(arena): Map/Arena toggle, fade and feedback ownership`.

### Task 9: Backend — party character looks and next encounter time

**Files:**
- Modify: `apps/api/src/modules/party/shared-battle.service.ts:141-176` (`publicBattle`), `apps/api/src/modules/party/party.service.ts:~92` (state), `apps/frontend/src/app/core/party-projection.ts`, `core/party.store.ts:13`
- Test: `apps/api/test/party-arena-visuals.test.js` (new, Node assertion script)

**Interfaces:**
- Produces: in `publicBattle` actors of `kind === 'character'` gain `look: { sex, heightCm, appearance, dominantHand, equipment, refinement }` loaded in **one** query for all character actor ids using the `json_object_agg` equipped-items pattern from `town-roster.service.ts:112-113` (`VISIBLE_EQUIPMENT_SLOTS`); null `appearance` → `look: null`. Party state gains `nextEncounterAt: string | null` = `dueAt` of the party's `encounter_clocks` row with `status='searching'` (`ownerKind='party'`). Frontend: `SharedActor.look?: …`, `SharedActor.position?: ArenaCell`, `PartyState.nextEncounterAt?: string | null` stored as `PartyStore.nextEncounterAt` signal. Hand types resolved client-side with `portraitHandTypes`.

- [ ] **Step 1: Write failing Node test**: construct `SharedBattleService` via `Object.create(SharedBattleService.prototype)` with `db.query` stubbed to return (1) one shared battle row with 1 character + 1 monster actor, (2) the look row; assert character actor has `look.equipment.mainHand === 'item_x'`, monster actor has no `look`, and exactly 2 queries ran. Second case: party state builder returns `nextEncounterAt` ISO string from a stubbed clock row; null when none.
- [ ] **Step 2: Run** `pnpm --filter @nanommo/shared build && pnpm --filter @nanommo/api build && node apps/api/test/party-arena-visuals.test.js` → FAIL.
- [ ] **Step 3: Implement** (no migration; read-only columns).
- [ ] **Step 4: Run** the new test + `node apps/api/test/party-flee-boundary.test.js` and any `party-*.test.js` not needing a DB → PASS; `pnpm --filter @nanommo/api lint`.
- [ ] **Step 5: Commit** `feat(party): expose character looks and next encounter time for the arena`.

### Task 10: `MonsterModel` (renderer-free monster)

**Files:**
- Create: `shared/monster-viewer/monster-model.ts`
- Modify: `shared/monster-viewer/monster-viewer.component.ts` (use `MonsterModel`)
- Test: `shared/monster-viewer/monster-model.spec.ts`, existing `monster-viewer.component.spec.ts`

**Interfaces:**
- Produces:
```ts
export class MonsterModel {
  static load(three: Three, monsterId: string, deps: { manifest: Record<string, MonsterManifestEntry>; loadGltf: (url: string) => Promise<GLTF>; characterFactory?: TownCharacterFactory }): Promise<MonsterModel>;
  readonly object3d: THREE.Object3D; readonly nativeSize: { width: number; height: number };
  drive(state: MonsterAnimationState, nowMs: number): void; // the clip logic currently inside the viewer's frame loop
  dispose(): void;
}
export function placeholderMonster(three: Three): MonsterModel; // grey capsule, Idle bob only
```
- `rig: 'char'` monsters are built with `TownCharacter` (`arena: true`) from `entry.character` when a factory is given. Shared GLB cache (one load per file per page).

- [ ] **Step 1: Failing spec**: `loads a native monster and exposes its clips` (use an existing small monster GLB, e.g. the slime file in `public/assets/monsters`), `missing monster model falls back` (unknown id → placeholder, no throw), `drive Dead holds last frame`.
- [ ] **Step 2–4:** FAIL → extract → PASS, and `monster-viewer.component.spec.ts` still PASS.
- [ ] **Step 5: Commit** `refactor(monster-viewer): renderer-free MonsterModel`.

### Task 11: `ArenaRuntime` (three.js)

**Files:**
- Create: `features/play/arena/arena-runtime.ts`, `arena-actor-views.ts`, `arena-scenery.ts`
- Test: `features/play/arena/arena-runtime.spec.ts` (WebGL; `pending()` when `isWebglAvailable()` is false)

**Interfaces:**
- Consumes: `arenaScene` frames (Task 6), `cellToWorld`/`frameCells`/`monsterScale` (Task 7), `TownCharacterFactory`/`TownCharacter.drive` (Task 2), `MonsterModel` (Task 10), `poseBowShot`.
- Produces:
```ts
export interface ArenaRuntimeHandle {
  setRegion(region: ArenaRegionId): void;          // crossfades layers over 600 ms
  render(scene: ArenaSceneFrame, nowMs: number, looks: Map<string, ArenaActorDef>): void; // diff actors by id: create/dispose views
  screenAnchors(): Map<string, { x: number; y: number; visible: boolean }>; // head anchor per actor, CSS px, for the HTML HUD
  setActive(active: boolean): void; resize(): void; dispose(): void;
}
export async function createArenaRuntime(host: HTMLElement, init: { assetBase: string; catalogUrl?: string; onContextLost: () => void }): Promise<ArenaRuntimeHandle>;
```
- Scenery: ground = one `PlaneGeometry` 40×(10·CELL+8) m with the region ground texture, `RepeatWrapping`, UV offset advanced by `scroll · ARENA_WALK_SPEED_M_S (1.4) · dt`; sky/far/near = camera-facing planes at increasing depth scrolled at 0.05/0.25/0.6 × ground speed. Blob shadow = shared transparent radial-gradient disc under each actor.
- Status FX (in `arena-actor-views.ts`): stun = 5 small star sprites orbiting the head anchor; sleep = "z", "Z", "z" sprites rising in a loop; freeze = `BoxGeometry` around the model bbox, `MeshPhysicalMaterial({ color:'#bfe9ff', transparent:true, opacity:0.1, roughness:0.1, transmission:0 })` + edges `LineSegments` at opacity 0.35. Flash = per-actor emissive tint override for 120 ms in the `ArenaFlash` colour (`white #ffffff`, `red #ff3b3b`, `green #4dff6a`, `orange #ff9a2e`, `darkred #6b0000`). Projectile = reuse the arrow mesh from `bow-shot.ts` (export its builder) flying on a shallow arc.
- Camera: perspective, `ARENA_CAMERA_FOV_DEG`, pitched `ARENA_CAMERA_PITCH_DEG` looking down at `frameCells(...)` computed at each battle's `startAtMs` from occupied cells (walk phase: frame of `walkFormation`); if any live actor's cell leaves the frame, ease to the new `frameCells` over 800 ms; never per-frame jitter.
- Generic cast/impact VFX: while `cast` is set, a soft additive glow ring at the caster's feet (team colour gold/purple); at a skill hit, a 250 ms expanding additive sprite burst at the target's chest anchor. No per-skill variants.
- Characters face ±X by yaw; team-b monsters face −X. Dead/exiting actors sink 0.6 m and fade via material opacity during `exit`.
- Performance: one `WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })`, `setPixelRatio(min(devicePixelRatio, 1.5))`, no shadow maps, `TownLod 'low'` animation stepping when ≥ 10 actors, loop stops on `setActive(false)` and on `visibilitychange` hidden.

- [ ] **Step 1: Failing spec** (headless Chrome has WebGL via SwiftShader): `renders a 1v1 frame and creates two actor views`, `removing an actor disposes its view` (geometry count returns to baseline), `screen anchors exist for every visible actor`, `setActive(false) stops the loop` (`isRendering()` false).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(arena): three.js runtime, scenery, actor views and status effects`.

### Task 12: `ArenaSceneComponent` wiring, HUD, verification, docs

**Files:**
- Create: `features/play/arena/arena-scene.component.ts/.html/.css`
- Modify: `map-board.html` (host the component like `app-town-scene`, kept mounted once opened, hidden otherwise), `features/play/components.ts`, `STATUS.md`, `ARCHITECTURE.md` (dated decision: projection-only arena), `ENGINEERING_NOTES.md` (traps found)
- Test: `arena-scene.component.spec.ts`

**Interfaces:**
- Consumes: `BattleStore.queue()/active()`, `PartyStore.battle()/nextEncounterAt()/members()`, `CharacterStore.character()` (gear + `gatheringCycle.cycleIndex`), `InventoryStore.equipment()` (self look via `portraitEquipment`/`portraitRefinement`/`portraitHandTypes`), `ServerClockService` (now), `CatalogService`, monster manifest (`loadMonsterManifest`, `monsterAttackStyle`), `ArenaFeedbackOwner`.
- Produces: `<app-arena-scene [active]="viewMode()==='arena'" [mapId]="…">`.
- Rules: build `ArenaBattle` for current/previous/next (solo: queue entries sorted by `sequenceIndex` around `now`; party: `PartyStore.battle()` + `nextEncounterAt`, stamping `receivedAtMs` when a new battle id appears); `gatherAtMs` = server-now when `gatheringCycle.cycleIndex` increases (self only); looks re-read every frame from stores so a gear change between battles re-dresses the walker (`TownCharacter.setEntry` when its equipment key changes, only outside `battle` phase). HUD (HTML overlay positioned from `screenAnchors()`): name, HP bar, SP bar, cast bar (`(now − startedAtMs)/(endsAtMs − startedAtMs)`), floating numbers from `frame.feedback` reusing the side panels' number CSS classes (`character-damage`, `monster-damage`, `critical`, `dot`, `poison`, `bleed` + new `burn`, `heal`, `miss`). `owner.arenaVisible.set(active && runtime ready)`. The rAF loop runs outside the Angular zone; HUD updates via signals at most 30 Hz.

- [ ] **Step 1: Failing component spec** with a fake `createArenaRuntime` (inject via token like `TOWN_SCENE_ENV`): `renders one HUD per actor with HP and SP bars`, `floating number appears for a damage event in the arena and not in the panel`, `gear change during walk re-dresses before the next battle` (fake runtime receives updated look before `startAtMs`), `party battle without look renders a placeholder actor`.
- [ ] **Step 2–4:** FAIL → implement → PASS. Then the full arena suite: `--include='**/arena/**/*.spec.ts'` plus `battle-hit-feedback`, `town-character`, `character-viewer.component`, `monster-viewer.component` specs → PASS; `npx tsc -p tsconfig.spec.json --noEmit`; `pnpm --filter @nanommo/frontend build --configuration production` (known CSS-budget warnings OK).
- [ ] **Step 5: Visual check in the running app** (`docker-compose up -d db redis`, api `dev` from `apps/api`, frontend `start`): solo 1v1 on `map_green_grounds_0` (walk → intro → battle → outro), a melee+bow character, a stun/freeze-capable monster, gathering stance, travel arrival auto-switch, toggle fade, a party 2+ vs monsters. Screenshot each; fix what reads wrong.
- [ ] **Step 6: Docs** — `STATUS.md` dated entry (what changed, exact validation run, "no migrations written or run"); `ARCHITECTURE.md` decision; `ENGINEERING_NOTES.md` traps.
- [ ] **Step 7: Commit** `feat(arena): battle arena view`.
