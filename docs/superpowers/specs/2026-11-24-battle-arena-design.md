# Battle Arena — design

Date: 2026-11-24 · Branch: `feat/battle-arena` · Status: design (awaiting approval)

## Intent

NanoMMO now has 3D animated characters (with gear) and 32 animated 3D monsters, but a battle is still
only a text log plus floating numbers on two side portraits. The player cannot *see* distances,
directions, or movement. The arena is a second view of the world panel that **replays the
server-authoritative battle log as a 3D side-view scene**: combatants on the battle grid, walking,
attacking, casting, getting hit, stunned, frozen, dying. Between battles the party walks over an
endlessly scrolling regional landscape and kneels to gather.

This is the foundation for later work: richer effects (monster `fx` manifest entries: fire, auras,
particles), dynamic zoom, and **PvP**, which must reuse the same arena (team A vs team B, not
"party vs monsters").

## Goals

- A toggle in the map head switches between **Map** (today's map) and **Arena** on non-town maps,
  with a 1 s fade-to-black + 1 s fade-from-black on each switch.
- **Battle scene** that follows the log: positions on the 10×10 grid, movement, attacks, casts with
  cast bars, hits with floating numbers and flash, status visuals, deaths, flee.
- **Walk scene**: party centred, `Walk` loop facing right, ground and background scroll left;
  gathering completion plays a kneeling gather clip.
- Continuous (no fade) walk ↔ battle transitions that fit in a **3 s total budget** (the real minimum gap) between
  queued battles.
- Solo and **party (up to 5 vs up to 10)**, every member rendered with their own appearance and gear.
- Per-region scenery (pre-rendered parallax layers).
- Performance-safe for weak/mobile GPUs even though mobile layout is out of scope.

## Non-goals (MVP)

- Mobile layout/design (mobile is currently discontinued; performance must still be mobile-safe).
- Monster `fx` entries, skill-specific spell VFX, sheathe/unsheathe weapons, victory poses.
- Dynamic in-battle cinematic zoom (only the framing rule below).
- PvP itself (only the team-agnostic structure that allows it).
- Any change to battle simulation, timing, or the queue. The arena is a pure consumer.

## Anti-goals (failure even if it "works")

- The client simulating or predicting combat. The arena only projects the log against server
  timestamps (`startAt`/`endAt`, 500 ms ticks). No `Math.random()` affecting what is shown.
- Opening the arena mid-battle (or returning from a sleeping tab) showing anything other than the
  correct state for *now*.
- A transition that makes the visual drift behind the real queue (walk ↔ battle must never exceed
  the real gap).
- The game freezing or stuttering on modest hardware because a third/fourth WebGL view was added.
- Removing the side-panel portraits: they remain (character + current target, dynamic in
  multi-battles). Only *where the floating numbers/flash appear* changes (see Feedback).

## Facts this design rests on (from the codebase)

- Solo battles run on the **V2 engine** (`simulateBattleV2Solo`, `packages/shared/src/battle-engine/solo-adapter.ts`):
  a **10×10 grid** (`grid.ts`, `BATTLE_GRID_SIZE = 10`), positions `{row, column}`. Character starts at
  row 5 col 0, monster row 5 col 9 (cols 4/5 when both are melee). The old 8-space lane (`index.ts`)
  is legacy.
- Party battles (`apps/api/src/modules/party/shared-battle.service.ts`, frontend `PartyStore.battle`,
  `SharedBattleView`) use the same V2 events with up to 10 actors per team, placed by
  `placeBattleActors` in central rows.
- V2 `ActorEvent` payloads: `target`, `move` (from/to/reason: approach|blinkstrike|push|revive),
  `action` (damage, hit, crit, heal, statusApplied, skillId/itemId), `status` (DoT damage),
  `cast` (skillId, resolvesAtTick), `regen`, `lifecycle` (death). Many events carry `actorStates`
  (hp, sp, position, statusEffects per actor). Solo entries expose them as `log.v2Events` +
  `log.header.v2Input`.
- Existing reusable pieces: `shared/character-animation/animation-state.ts` (pure pose-from-log
  function, clip timings, bow release timing), `shared/character-viewer/*` (rig, gear, asset cache,
  `bow-shot.ts`), `shared/monster-viewer/*` + `monster-animation-state.ts`,
  `shared/battle-hit-feedback.ts` (damage style: character/monster/critical/dot/poison/bleed),
  `shared/battle-timing.ts`, `features/play/town-scene/*` (on-demand three.js runtime pattern,
  `town-view-toggle.component.ts`, `mapViewMode()` auto-switch rule).
- Character clips today: Idle, Walk, CombatIdle, Attack, CastStart, CastLoop, Damage, Damage2, Dead.
  The source pack (`tools/character-assets/source/universal-animation-library`, CC0, not versioned)
  also has unused `Fixing_Kneeling`, `Interact`, `PickUp_Table`, `Sprint_Loop`, `Hit_Head`, among others.
  `animations.glb` is produced by `tools/character-assets/build.mjs`; never hand-edit outputs.
- Statuses in `status_effects.json`: `stun`, `freeze`, `poison`, `burn`, `bleed`, `slow`, `silence`,
  `disarm`, buffs. **There is no `sleep` yet.**
- `SharedBattleView` actors carry **no appearance/gear** today; `town-roster.service.ts` shows the
  pattern for loading `appearance`, `sex`, `heightCm`, `dominantHand` for other characters.
- Queue gap between battles (solo): `calculateEncounterSearchDelayMs` = random 2–6 s + `max(1, playersOnMap)` s,
  so **≥ 3 s** in practice; the user confirmed a **3 s** transition budget. Transitions are scheduled against the *actual* `endAt` → next `startAt`.
- `move` events carry no duration: approach = one-cell step when the movement gauge fills; blinkstrike
  and push are instant multi-cell jumps.
- Flee is not a V2 event: solo shows it as the queue entry's `cancellationReason: 'flee'` + `cancelledAt`
  (`game.store.ts`); party sets the battle's `endAt` to the flee time.
- Frontend `SharedActor` type lacks `position` although the API sends it (and `actorStates` carry it).

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| A | Fully procedural 3D scenery (three.js trees, rocks, mountains per region) | True parallax, free camera; much more art effort, heavier GPU |
| **B (chosen)** | **Simple 3D ground strip (tiling, scrolling texture) + 2–3 pre-rendered painted background layers per region, scrolled at different speeds** | Lightest; a new region = new images; camera must stay near-fixed (strong zoom exposes flat layers) |
| C | Characters as pre-rendered 2D sprites | Lightest of all, but loses gear/appearance variety and existing 3D animation; rejected |

The user chose **B**.

Cross-cutting decision (applies to any approach): the scene is a **pure projection**
`arenaState(battle, now) → { actors: [{id, team, worldPos, facing, clip, clipStartMs, statuses, hp, sp, cast, flashes, numbers}], phase }`,
in the style of `animation-state.ts`, never an incremental event player. This gives correct late
join, tab-sleep recovery, testability without WebGL, and reuse for PvP. The three.js layer only draws it.

## Design


### 1. Toggle and view switching

- Reuse the `town-view-toggle` pattern: one round illustrated button in `.map-head`, above `.map-meta`.
  On non-town maps it toggles **Map ↔ Arena**. Icons: map icon / minimised head of the player's
  character (static render or crop; builder's call). In towns only the existing Map ↔ Town toggle appears.
- Switching is **user-driven**, with one automatic case mirroring the town rule: when the character
  **arrives** at a grind map as its travel **destination**, the view switches to Arena. While
  traveling it never auto-switches, even if a battle starts en route.
- Every user switch: 1 s fade to black, swap, 1 s fade from black. Hidden view's render loop pauses
  (as the town scene does).
- The choice **persists across all non-town maps** (including travel hops) until the character enters
  a town; this extends `mapViewMode`'s per-map rule for the arena.
- On login, or when appearing on a grind map without having traveled to it (e.g. teleport), the view
  opens on **Map**; Arena opens automatically only on arriving at a travel destination.

### 2. Space, camera, scale

- **Grid → world**: column = X (left → right; team A on the left), row = depth Z (row 0 far,
  row 9 near; builder may flip if it reads better). Cells are square and **large**: a medium monster
  uses well under half its cell, so giants can grow **in height** and only slightly overflow
  sideways into neighbours.
- Model scale: a characters' and monsters' real relative size, then clamped so the footprint stays
  ≈ within its cell (width clamp; height free).
- **Camera**: side view, FIFA-like — raised, looking slightly down (roughly 20–30° pitch), perspective
  with a modest FOV. Never a Pokémon-style 3/4 overhead.
- **Framing rule (MVP zoom)**: at battle start, frame the bounding box of occupied cells plus a margin,
  with the full 10×10 as the maximum frame. 1v1 is close; 5v10 shows the whole grid. If anyone moves
  outside the frame, ease the camera out smoothly. No other cinematic zoom. Clamp zoom so the
  flat background layers never read as flat.
- In the walk scene the party is centred horizontally (the framing centre), facing right.

### 3. Walk scene (no battle)

- Party (solo: one character) plays `Walk` facing right in a compact formation at the centre; ground
  texture and background layers scroll left (parallax). Speed is cosmetic.
- **Gathering**: when a gathering completes (gauge full → item received), the gathering member plays a
  one-shot kneel clip (`Fixing_Kneeling`, renamed e.g. `Gather`; alternatives `Interact`/`PickUp_Table`
  if it reads poorly) while scroll pauses for the clip, then resumes walking.
- **Traveling**: same walk scene, background of the current map; on arriving at a map with another
  region, crossfade the layers (no black fade).
- Character not grinding/traveling on a non-town map: still walk (user rule: idle = walking).

### 4. Walk ↔ battle transitions (total budget 3 s, never more than the real gap)

Scheduled against server times of the previous entry's `endAt` and next entry's `startAt`:

1. ~0.9 s: defeated foes finish their death (death starts at the killing tick inside the battle, so
   most of it already happened) and fade/sink out.
2. ~0.9 s: party resumes `Walk`, ground scrolls (this segment stretches when the gap is longer).
3. ~1.2 s before `startAt`: scroll decelerates, next foes enter from the right and party members slide
   to their starting cells, landing exactly at `startAt`.

If the gap is shorter than expected, compress proportionally; the battle at `startAt` must always
start on time.

**Gear refresh**: gear cannot change during a battle but can change between battles. Whenever the
authoritative character (own or party member) shows a gear/appearance change, the walking model is
re-dressed during the walk scene, so the next battle starts with the new gear already visible.

**Party battles**: the server only creates the shared battle when the party's encounter clock is due,
so the client cannot see it in advance. User decision (option a): the backend **exposes the party's
next encounter time** (`dueAt` of the encounter clock) in the party view/realtime snapshot. The walk
decelerates against that time; when the battle arrives, foes run in from the right edge during the
first ~0.5 s, converging onto their real projected positions (never lagging the true state after that).
Solo uses the queue's next `startAt`. Fade to black is **only** for the map ↔ arena toggle and the party wipe.

### 5. Battle scene (projection of the V2 log)

Per actor, from the event stream + `actorStates`:

- **Position**: approach `move` events animate one cell with `Walk` over a duration derived from the
  actor's `moveSpeed` (time for the gauge to fill), capped so it finishes before its next event.
  Blinkstrike = fast dash (`Sprint`, ~150 ms); push = short slide without walk; revive = appear in place. Facing: toward current target.
- **Attack**: `Attack` one-shot timed so the hit lands on the event tick (existing timing rules in
  `animation-state.ts`; bow uses `bow-shot.ts` release + arrow flight). Monsters use
  `monster-animation-state.ts`.
- **Cast**: `cast` event → `CastStart` + `CastLoop` until `resolvesAtTick`, with a **cast bar** over
  the head; resolution plays a generic cast glow on the caster and a generic impact on the target
  (no per-skill VFX in MVP).
- **Hit**: `Damage`/`Damage2` flinch blended; **floating damage number** and **flash** on that 3D
  actor (world-anchored HTML/sprite above the model), styles from `damageFeedbackStyle`.
  Flash colours: character white, monster red (as today); **poison green, burn orange, bleed
  dark red** (much darker than normal hit red).
- **HUD over each combatant**: compact HP bar + SP bar, plus the cast bar while casting.
- **Statuses** (from `statusEffects` in `actorStates`):
  - stun: stars circling the head; body frozen in an odd pose (a held frame of `Hit_Head` or similar).
  - freeze: a ~90% transparent ice-blue crystal block encloses the model; animation paused.
  - sleep (not in the game yet; build the visual now): like stun, with "z..Z..z" instead of stars.
  - poison/burn/bleed: only the coloured damage flash.
  - others (slow, silence, disarm, buffs): no visual in MVP.
- **Death**: `lifecycle` death → `Dead` clip, body stays down for the rest of the battle.
  When **all of team A** dies: party wipe → 1 s fade to black. The server moves each character to its
  own `savedTownMapId` (the user expected the leader's saved town; that is a game-rule question
  outside the arena — the arena just follows the state).
- **Flee**: driven by the entry's flee cancellation (solo: `cancellationReason/cancelledAt`; party:
  `endAt`), not by an event: character turns left, `Sprint`, runs off-screen left. The projection takes
  these fields as input alongside the events.
- Battle end (victory): survivors return to the walk scene via the transition in §4.

### 6. Feedback placement

- Floating numbers + flash appear **in the arena** when it is visible.
- When the arena is **not** visible (map view), the side panels (`character-summary`, `grind-panel`)
  show them exactly as today. One owner at a time, never both.
- Side portraits keep animating as today (character + current target), independent of the arena.

### 7. Data sources

- Solo: `BattleStore.active()` queue entry (`log.v2Events`, `log.header.v2Input`, `startAt`,
  `endAt`), plus the next queue entry for transitions.
- Party: `PartyStore.battle()` (`SharedBattleView`, V2 events + actors).
- **Backend addition**: add each character actor's `appearance`, `sex`, `heightCm`, `dominantHand` and
  **current** visible gear to the shared-battle view (pattern: `town-roster.service.ts`). No migration, no
  snapshot column: gear never changes mid-battle (user), only between battles (see Gear refresh).
- **Backend addition**: expose the party encounter clock's next `dueAt` (see Party battles in §4).
  Add `position` to the frontend `SharedActor` type. Monsters already resolve by `definitionId`.
- Gathering completion: the existing gathering activity/inventory signal used by the activity gauge.
- Normalise solo and party into one `ArenaBattle` input (`teams`, `actors`, `events`, `startAt`,
  `tickMs`) so the projection and renderer never know which source it came from (PvP-ready).

### 8. Scenery (approach B)

Each region = ground texture + 2–3 parallax layers (sky, far, near), generated once by a script
(like `tools/character-assets/build-map-art.mjs`) and shipped as compressed images. Fallback: Green Grounds.

Map ids are `map_<region>_<n>` (e.g. `map_green_grounds_0`); resolve by stripping `map_` and the
numeric suffix. Every current grind map falls into one of the regions below.

| Region | Look |
|---|---|
| `green_grounds` | blue sky with clouds, open grassland with earthy patches, scattered trees (user) |
| `menace_hills` | rocky mountains behind, orange sky (user) |
| `kwaioua_forest` | dense jungle, many trees, closed canopy (user) |
| `wastelands` | barren rocky/snowy highlands, pale overcast sky |
| `caete` | deep humid rainforest, river mist, darker greens |
| `forest_ruins` | forest with mossy stone ruins and columns |
| `ipora_beach` | sand, sea horizon, palms |
| `gods_bridge` | river gorge with an old stone bridge in the background |
| other grind maps | nearest region by name/coordinates, else fallback |

Towns have no arena (`map_town`, `map_outpost`, `map_kwaioua_taba`, `map_aramaia_city`,
`map_emperial_capital_caelum` — anything with `type: 'town'`).

### 9. Performance (mobile-safe)

- three.js loaded on demand only when the arena first opens (like the town scene).
- One renderer for the arena; render loop runs only while visible and the tab is visible.
- Device pixel ratio capped (e.g. ≤ 1.5); shadows as blob decals, not shadow maps.
- Shared GLB/texture cache with the existing viewers (`character-asset-cache`); clone skeletons, do
  not reload per actor.
- 15 actors with skinned meshes: keep draw calls bounded (merged gear where already done), frustum
  culling on; throttle to ~30 fps when the GPU is slow is the builder's call.

### 10. Assets work

- Rebuild `animations.glb` via `tools/character-assets/build.mjs` adding `Gather`
  (`Fixing_Kneeling`), `Sprint` (`Sprint_Loop`), and a stun pose source (`Hit_Head` held frame, or
  another clip if it reads better). Update `CREDITS.md`. All CC0.
- Monsters: existing monster GLB clips; stun/freeze reuse the "freeze the current pose" approach.

## Testing

- Unit tests for the pure projection: positions at arbitrary `now`, late join mid-battle, move
  interpolation, cast windows, death holds, flee, party wipe, transitions compressing to the gap,
  feedback ownership (arena vs panels), view auto-switch rule (arrive vs traveling).
- Region resolver test against the real `maps.json`.
- Run against real catalogue/log shapes (V2 solo and shared battle), not hand-made fixtures only.
- Visual check in the running app (solo 1v1, party 5v10, gathering, travel arrival).

## Left to the builder

Exact camera angles/FOV/cell size; formation offsets in the walk scene; toggle head icon technique;
HTML vs sprite for numbers/bars; generic cast/impact VFX look; background art generation method;
fps throttling; row orientation (far/near).

## Open (after MVP)

Monster `fx` entries, per-skill VFX, sheathe/unsheathe, victory pose, dynamic cinematic zoom,
mobile layout, PvP, `sleep` status itself.
