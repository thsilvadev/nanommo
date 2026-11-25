# Arena: monster preload, character face on the toggle, white fade on map change — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No hitch while playing: every monster model is downloaded and parsed on the loading screen, shaders compile before a model enters the arena, models appear only when ready (no grey capsule); the arena toggle shows the player's own 3D face; a map change in the arena fades to white and back into the new scene.

**Architecture:** The loading screen (`GamePreloadService`) runs one combined preload: the existing town warm-up, a new monster warm-up (`preloadMonsterModels`), and the face snapshot (`CharacterFaceService`). The arena runtime compiles every parsed monster when it is created, and `ArenaActorView` commits a model only after its shaders are compiled. The white fade is a pure function of the last map change and `now`, applied by the arena component like the existing party-wipe overlay.

**Tech Stack:** Angular 18 (standalone, signals), three.js (lazy chunks), Karma/Jasmine.

**Spec:** No separate design doc (the user skipped it and asked for the plan directly). Decisions, from the conversation of 2026-11-25:
- Preload option **A**: all monsters on the loading screen; the loading may get longer, gameplay must never hitch. Measured on this machine: parsing all 31 GLBs (39 MB) ≈ 0.7 s; downloads come from the HTTP cache after the first visit once `vercel.json` caches `/assets/monsters`.
- Face: rendered **client-side during loading** with the portrait rig, **no helmet** (rendered bare: no equipment at all, so hair shows), cached in the browser keyed by the look; no database, no upload endpoint.
- White fade: **only in the arena** (grind view), ~0.5 s to white, swap to the new scene, ~0.5 s back.
- Field bat keeps walking (user's choice); bee/mosquito already fly (`78e028d`).
- Base design of the arena: `docs/superpowers/specs/2026-11-24-battle-arena-design.md`.

## Global Constraints

- Branch `fix/arena-prod-feedback`; small commits; **no push** (push to `main` deploys production).
- three.js stays out of the initial bundle: new three.js code is reached only through dynamic `import()` (as `preloadTownScene` and `loadMonsterThree` do).
- Karma only with the isolated config: `bash $CLAUDE_JOB_DIR/tmp/ngt.sh <log> '<glob>'` (port 9917, `CHROME_BIN=/snap/bin/chromium`); type-check with `npx tsc -p tsconfig.app.json --noEmit` and `tsconfig.spec.json` from `apps/frontend`.
- A preload failure or a slow CDN never blocks the game (`GAME_PRELOAD_TIMEOUT_MS` = 20 000 stays); what is unfinished keeps loading in the background.
- Browser storage access is wrapped in try/catch; the game works without it.
- Visual changes get screenshots with `tools/arena-assets/preview/shoot-arena.mjs`.
- UI strings localized (en/pt) through `LocaleService` (`apps/frontend/src/app/core/locale.service.ts`).

## Review Focus

1. **First visit on a slow connection hits the 20 s timeout:** the game opens; a monster whose model is still downloading appears only once ready (never a capsule, never a pop from capsule to model). → Task 3 test "a loading monster shows nothing until its model is compiled".
2. **Storage blocked / quota full / private window:** the face is still rendered and shown for this session; nothing throws. → Task 4 test "storage that throws".
3. **The look changes (new appearance):** the cached face is not reused; a new one is rendered. → Task 4 test "a different look renders again".
4. **Two map changes in a row (travel through a waypoint):** the fade does not flash twice or show the middle map; it ends on the last map. → Task 5 test "a second change during the fade".
5. **No WebGL / no appearance yet:** monster preload and face are skipped, the toggle keeps the SVG head, loading still finishes. → Task 2 and Task 4 tests.

---

### Task 1: Cache monster assets across reloads

**Files:**
- Modify: `vercel.json` (headers)
- Test: create `apps/api/test/vercel-monster-cache.test.js` (a direct-execution Node assertion script, like the other source-contract tests there)

**Interfaces:**
- Produces: `/assets/monsters/*.glb` served with `public, max-age=86400, stale-while-revalidate=604800` (same as character assets). `manifest.json` is **not** in the rule (it must stay fresh so a new GLB set is never paired with an old manifest; cf. the stale `animations.glb` incident in STATUS.md).

- [ ] **Step 1: Write the failing test** in `vercel-monster-cache.test.js`: read the repo-root `vercel.json`; turn each header `source` into a RegExp (`'^' + source.replace(/:\w+\(([^)]*)\)/g, '($1)') + '$'`); assert some source matches `/assets/monsters/fieldbat.glb` with Cache-Control `public, max-age=86400, stale-while-revalidate=604800`, and no source matches `/assets/monsters/manifest.json`. Print `ok` at the end.
- [ ] **Step 2: Run** `node apps/api/test/vercel-monster-cache.test.js`; expect an AssertionError (no rule matches monsters).
- [ ] **Step 3: Add the header rule** `{ "source": "/assets/monsters/(.*)\\.glb", "headers": [{ "key": "Cache-Control", "value": "public, max-age=86400, stale-while-revalidate=604800" }] }`. (No other test pins `vercel.json`: checked 2026-11-25.)
- [ ] **Step 4: Run it**; expect `ok`.
- [ ] **Step 5: Commit** `perf(arena): cache monster models across reloads`.

### Task 2: Preload every monster model on the loading screen

**Files:**
- Modify: `apps/frontend/src/app/shared/monster-viewer/monster-model.ts` (add `preloadMonsterModels`)
- Modify: `apps/frontend/src/app/features/play/game-preload.service.ts` (add `combinePreloads`)
- Modify: `apps/frontend/src/app/features/play/play.component.ts:82` (start the combined preload)
- Test: `apps/frontend/src/app/shared/monster-viewer/monster-model.spec.ts`, `apps/frontend/src/app/features/play/game-preload.service.spec.ts` (both exist)

**Interfaces:**
- Produces: `preloadMonsterModels(onProgress?: (done: number, total: number) => void): Promise<void>` — once per page (memoised promise, reset on rejection); skips everything when `isWebglAvailable()` is false; for each manifest entry with a `file` and `rig !== 'char'`: `loadMonsterThree().gltf(MONSTER_ASSETS + file)`; entries with `rig === 'character'` also warm `CHARACTER_CLIPS` and, when `weapon` is set, `loadMonsterWeaponGear()`. At most 4 files in flight. One failed file counts as done and never rejects the whole preload.
- Produces: `combinePreloads(tasks: Array<(onProgress?: PreloadProgress) => Promise<void>>): (onProgress?: PreloadProgress) => Promise<void>` — runs all in parallel; reports `done`/`total` as the sums of each task's latest report; a task that rejects counts as finished.

- [ ] **Step 1: Write the failing tests.**
  - `monster-model.spec.ts` → `it('preloads every monster file once and reports progress up to the total')`: call `preloadMonsterModels(cb)`; expect the last report `done === total`, `total` = number of manifest entries with `file` and `rig !== 'char'` (read `/assets/monsters/manifest.json` in the test); a second call returns the same promise (`toBe`); afterwards `MonsterModel.load('mon_gravelhorn')` resolves in < 50 ms (parsed file reused).
  - `game-preload.service.spec.ts` → `it('combinePreloads sums progress and survives a failing task')`: two fake tasks (one reports 1/2 then 2/2, the other reports 0/3, 3/3 then rejects); expect a report `(2+3, 2+3)` at the end and the combined promise to resolve.
- [ ] **Step 2: Run** `bash $CLAUDE_JOB_DIR/tmp/ngt.sh t2 '**/{monster-model,game-preload.service}.spec.ts'`; expect FAIL (functions missing).
- [ ] **Step 3: Implement** both functions as specified; in `play.component.ts` start `this.gamePreload.start(combinePreloads([townPreload, preloadMonsterModels, face]))` where `townPreload` is today's `townScene.preload` (skipped when undefined) and `face` is Task 4's `CharacterFaceService.preload` (until Task 4 lands, pass only the first two).
- [ ] **Step 4: Run** the two specs; expect PASS. Then `party-resource-refresh.spec.ts` (it stubs `gamePreload`/`townScene`): expect PASS.
- [ ] **Step 5: Commit** `perf(arena): preload every monster model on the loading screen`.

### Task 3: Compile before showing; no grey capsule while loading

**Files:**
- Modify: `apps/frontend/src/app/features/play/arena/arena-actor-views.ts` (`ArenaActorView` constructor, `loadMonster`, `swap`)
- Modify: `apps/frontend/src/app/features/play/arena/arena-runtime.ts` (warm compile at creation)
- Test: `apps/frontend/src/app/features/play/arena/arena-actor-views.spec.ts`

**Interfaces:**
- Consumes: `TownCharacterFactory.prepare?: (object: THREE.Object3D) => Promise<unknown>` (already set by the runtime to `renderer.compileAsync`).
- Produces: `ArenaActorView` shows **nothing** (an empty posable, height 1.7 for the HUD anchor) while a character or monster model is loading; the grey capsule only when there is nothing to load (`look === null`, no `monsterId`, or `MonsterModel.loadOrPlaceholder` returned a placeholder). A loaded monster is committed only after `factory.prepare(model.object3d)` settles (resolve or reject).
- Produces: in `ArenaRuntime` constructor, after `factory.prepare` is set: `void warmMonsterShaders(prepare)` — for every manifest entry already parsed (Task 2), `MonsterModel.load(id)` then `prepare(model.object3d)` then `model.dispose()`, sequentially, never throwing.

- [ ] **Step 1: Write the failing tests** in `arena-actor-views.spec.ts`:
  - `it('a loading monster shows nothing until its model is compiled')`: factory stub `{ prepare: () => gate }` where `gate` is a promise you resolve by hand; manifest `Promise.resolve({})` so `loadMonster` uses `MonsterModel.loadOrPlaceholder('mon_gravelhorn')` (real file); after `await` of the load (poll `view.update` up to 5 s), expect no visible `Mesh` under `view.object3d` other than the shadow/ring; resolve `gate`, `update` again, expect a visible skinned mesh.
  - `it('a monster with no model shows the grey capsule')`: `monsterId: 'mon_does_not_exist'`; after load, a `CapsuleGeometry` mesh is visible.
- [ ] **Step 2: Run**, expect FAIL (today the capsule shows while loading and the model commits without compiling).
- [ ] **Step 3: Implement**: an `EmptyPosable` (group, `ready = true`, `height()` 1.7, no meshes) as the initial posable when a model will load; `PlaceholderPosable` only for the nothing-to-load cases and for a placeholder result; in `loadMonster`, `await this.factory.prepare?.(model.object3d)?.catch(() => undefined)` before `swap` (factory may be `null` in tests: guard). Add `warmMonsterShaders` in `arena-runtime.ts`.
- [ ] **Step 4: Run** `'**/arena/*.spec.ts'`; expect PASS. Screenshot: `node tools/arena-assets/preview/shoot-arena.mjs $CLAUDE_JOB_DIR/tmp/fix/t3 intro solo_close` — models present, no capsule.
- [ ] **Step 5: Commit** `fix(arena): models appear only when ready, shaders compiled first`.

### Task 4: The player's 3D face on the arena toggle

**Files:**
- Modify: `apps/frontend/src/app/shared/character-viewer/character-viewer.types.ts:14` (`ViewerFraming` gains `'face'`)
- Modify: `apps/frontend/src/app/shared/character-viewer/character-rig.ts` (`updateCamera` for `'face'`; new `snapshot()`)
- Create: `apps/frontend/src/app/features/play/arena/character-face.service.ts`
- Modify: `apps/frontend/src/app/features/play/arena/arena-toggle.component.ts` (use the face)
- Modify: `apps/frontend/src/app/features/play/play.component.ts` (add the face task to the combined preload)
- Test: `apps/frontend/src/app/shared/character-viewer/character-viewer.component.spec.ts` (where the rig is tested), `character-face.service.spec.ts` (create), `arena-toggle.component.spec.ts`

**Interfaces:**
- Produces: `CharacterRig.snapshot(size: number): string` — renders one frame at `size`×`size` CSS px and returns `renderer.domElement.toDataURL('image/png')` in the same task as the render (no `preserveDrawingBuffer` needed).
- Produces: framing `'face'`: like `'bust'` (follows the Head bone) with `half = 0.14` and `centreBelowEyes = 0.03`, model yaw 0 (facing the camera). Tune by screenshot; the face (eyes to chin, hair) fills a round 30 px crop.
- Produces: `CharacterFaceService` (`providedIn: 'root'`):
  - `readonly url: Signal<string | null>` — data URL of the face, null until known.
  - `preload(onProgress?: PreloadProgress): Promise<void>` — waits (≤ 15 s) for `CharacterStore.character()` with `appearance` and `sex`; key = `JSON.stringify({ v: 1, sex, heightCm, appearance })`; storage `localStorage['nanommo.face']` holds `{ key, url }`; on a hit sets `url` and stops; on a miss renders with `ViewerConfig { sex, heightCm, appearance, hands: { right: null, left: null }, dominantHand, interactive: false, framing: 'face', equipment: null, refinement: null }` (no equipment: no helmet) in a 128×128 off-screen host (`position:fixed; left:-10000px`), `snapshot(128)`, disposes the rig, stores and sets `url`. Skipped when `isWebglAvailable()` is false. Every storage access in try/catch. Renderer creation goes through an injectable `CHARACTER_FACE_RENDER` token (default: dynamic import of `character-rig`) so the service is tested without WebGL.
  - also re-renders when the character's look key changes after loading (an `effect`), at most once per key.
- Produces: `ArenaToggleComponent` shows `face.url()` in a round crop when set and the target is the arena; otherwise today's SVG.

- [ ] **Step 1: Write the failing tests.**
  - `character-viewer.component.spec.ts` → `it('face framing snapshots a PNG of the head')`: apply a bare config with `framing: 'face'`; `snapshot(64)` starts with `data:image/png;base64,` and is longer than 2 000 chars.
  - `character-face.service.spec.ts` (fake render token counting calls, returning `'data:image/png;base64,AAA'`):
    - `it('renders once and reuses the stored face on the next load')`: two service instances (fresh `TestBed`) with the same look → render called once, both `url()` equal.
    - `it('a different look renders again')`: change `appearance.hair` → render called twice.
    - `it('storage that throws still yields a face for this session')`: `spyOn(localStorage, 'getItem').and.throwError('blocked')`, same for `setItem` → `url()` set, no rejection.
    - `it('no appearance or no WebGL: no render, preload still finishes')`.
  - toggle spec → `it('shows the player face when it is known')`: provide `CharacterFaceService` stub with `url = signal('data:image/png;base64,AAA')`; on the map the `img` `src` is that URL; with `url = signal(null)` it is `arena-view-head.svg`.
- [ ] **Step 2: Run** `'**/{character-viewer.component,character-face.service,arena-toggle.component}.spec.ts'`; expect FAIL.
- [ ] **Step 3: Implement** as specified; the toggle's face `img` gets `border-radius: 50%; object-fit: cover; width: 34px; height: 34px`. Add the face task to `combinePreloads` in `play.component.ts`.
- [ ] **Step 4: Run** the specs; expect PASS. Screenshot the toggle: render the face with the arena harness look `archer` (helmet in its gear) via a small addition to `tools/arena-assets/preview/arena-entry.ts` (`window.face()` returning the data URL) and save it as `$CLAUDE_JOB_DIR/tmp/fix/t4-face.png`; the face shows hair, no helmet.
- [ ] **Step 5: Commit** `feat(arena): the toggle shows the player's own face`.

### Task 5: Fade to white on a map change (arena only)

**Files:**
- Create: `apps/frontend/src/app/features/play/arena/arena-map-fade.ts`
- Modify: `apps/frontend/src/app/features/play/arena/arena-scene.component.ts`, `.html`, `.css`
- Test: `apps/frontend/src/app/features/play/arena/arena-map-fade.spec.ts`, `arena-scene.component.spec.ts`

**Interfaces:**
- Produces (pure): `ARENA_MAP_FADE_IN_MS = 500`, `ARENA_MAP_FADE_OUT_MS = 500`;
  `interface ArenaMapChange { atMs: number; fromMapId: string | null; toMapId: string }`;
  `arenaMapFade(change: ArenaMapChange | null, nowMs: number): { white: number; mapId: string | null }` — `white` rises 0→1 over the first 500 ms, falls 1→0 over the next 500 ms; `mapId` is `fromMapId` before the peak and `toMapId` from the peak on; `{ white: 0, mapId: change?.toMapId ?? null }` outside the window.
- Produces (component): an effect on the character's `currentMapId` records `ArenaMapChange` (`fromMapId` = the map **shown** at that instant, `arenaMapFade(previous, now).mapId`, so a second change mid-fade starts from what is on screen); `inputs(now).mapId` uses `arenaMapFade(...).mapId`; `refreshHud` writes `white` to a new `#flash` overlay (`background: #fff`, same layering as `.arena-wipe`). The first map seen (no previous) records no change.

- [ ] **Step 1: Write the failing tests.**
  - `arena-map-fade.spec.ts`:
    - `it('fades to white, swaps the map at the peak, fades back')`: change at 1000 from `a` to `b` → at 1250 `{ white≈0.5, mapId: 'a' }`; at 1500 `{ white: 1, mapId: 'b' }`; at 1750 `white≈0.5, 'b'`; at 2000 `{ 0, 'b' }`.
    - `it('a second change during the fade ends on the last map without showing the middle one')`: component-level rule expressed purely — second change at 1600 with `fromMapId = arenaMapFade(first, 1600).mapId` (`'b'`) to `'c'` → at 2100 mapId `'c'`; at no sampled time (every 50 ms from 1600 to 2600) is `white` 0 while mapId is `'b'`.
  - `arena-scene.component.spec.ts` → `it('a map change whitens the arena and swaps the scene at the peak')`: mount at map `map_green_grounds_2`; set `currentMapId` to `map_ipora_beach_1` at `now`; at `now + 250`: `inputs(now + 250).mapId` is the old map and after `refreshHud()` the flash overlay opacity is `'0.5'`; at `now + 600` `mapId` is the new one.
- [ ] **Step 2: Run** `'**/{arena-map-fade,arena-scene.component}.spec.ts'`; expect FAIL.
- [ ] **Step 3: Implement** as specified (the scenery's own crossfade still runs behind the white; that is fine).
- [ ] **Step 4: Run** `'**/arena/*.spec.ts'`; expect PASS.
- [ ] **Step 5: Commit** `feat(arena): fade to white on a map change`.

### Task 6: Verify, document

- [ ] **Step 1:** `npx tsc -p tsconfig.app.json --noEmit && npx tsc -p tsconfig.spec.json --noEmit` (from `apps/frontend`) → no output.
- [ ] **Step 2:** Full suite `bash $CLAUDE_JOB_DIR/tmp/ngt.sh full '**/*.spec.ts'` → `TOTAL: N SUCCESS`, 0 failed.
- [ ] **Step 3:** `pnpm --filter @nanommo/frontend build --configuration production` → succeeds; the known CSS-budget/CommonJS warnings only; initial bundle unchanged in size class (no three.js in `main-*`).
- [ ] **Step 4:** Measure the loading: a Playwright run against `ng serve` is optional; at minimum re-run `$CLAUDE_JOB_DIR/tmp/parse/run.mjs` and report parse time.
- [ ] **Step 5:** STATUS.md: one dated entry at the top (2026-11-25) for the whole branch (bug group, adjustments, this plan), stating exactly what ran, that nothing was pushed or deployed, and what was **not** verified in the running app. ENGINEERING_NOTES.md: append "the solo log names the self actor `character` (no `characterId` in the API snapshot); never match a solo actor by character id" and "map transitions bump `gatheringCycle.cycleIndex`; a gather is an increment on the same map". Commit `docs: arena production feedback fixes`.
