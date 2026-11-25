# Arena: monster models by map and neighbours — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep only the monsters the player can meet soon in memory (current map + neighbours), fully ready (parsed, shaders linked, textures on the GPU) before they appear; release the rest. Replaces "every monster on the loading screen" (`preloadMonsterModels`, ~418 MB of decoded textures).

**Architecture:** A pure function picks the species of a map and its neighbours from `maps.json`. `monster-model.ts` gains a reference-counted file cache: `warmMonsterSpecies(ids)` parses what is missing, `releaseMonsterFilesExcept(ids)` frees parsed files (geometry, materials, textures) that no live model uses and that are not wanted. A root service `ArenaMonsterWarmup` drives both from the character's current map (loading screen first, then every map change). The arena runtime links shaders **and uploads textures** for the wanted set (`renderer.initTexture`).

**Tech Stack:** Angular 18 signals, three.js r170 (lazy), Karma.

**Spec:** User decision 2026-11-25 (after the branch review measured 125 monster textures ≈ 418 MB decoded): "2, mapa e vizinhos". Base arena design: `docs/superpowers/specs/2026-11-24-battle-arena-design.md`; previous plan `docs/superpowers/plans/2026-11-25-arena-preload-face-fade.md` (Task 2/3 are replaced here).

## Global Constraints

- Branch `fix/arena-prod-feedback-2` (from `origin/main`, no upstream); small commits; **no push**.
- three.js only via dynamic `import()`; no three.js in initial chunks.
- Karma only via `bash $CLAUDE_JOB_DIR/tmp/ngt.sh <log> '<glob>'` (port 9917). Delete `apps/frontend/.angular/cache` if the disk runs low (it reached ~40 GB).
- Never a capsule while a model loads; never a stall in battle on a species of the current map or a neighbour.
- A preload failure never blocks the game (20 s loading timeout stays).

## Review Focus

1. **Travel through several maps in a row:** each hop warms the new neighbours and releases only what is out of range and not shown; a monster on screen is never released (its textures would go black). → Task 2 test "a model in use is never released".
2. **A queued battle whose species is outside the set** (regenerated queue, raid candidate): it still loads on demand (no capsule, Task 3 of the previous plan) and is not released while queued. → Task 3 test "species in the queue are kept".
3. **Town:** no monsters on the town map; its neighbours (`map_green_grounds_0`, `map_green_grounds_3` for `map_town`) are warmed. → Task 1 test "town warms its border maps".
4. **Unknown map id / catalogue not loaded:** nothing warmed, nothing released, no error. → Task 1 and Task 3 tests.
5. **Party battles:** the shared battle's species come from the same map, so they are in the set. No extra rule.

---

### Task 1: Which species are near

**Files:**
- Create: `apps/frontend/src/app/features/play/arena/arena-monster-set.ts`
- Test: `apps/frontend/src/app/features/play/arena/arena-monster-set.spec.ts`

**Interfaces:**
- Produces: `nearbyMonsterIds(maps: Array<{ id: string; coordinates?: { x: number; y: number }; monsters?: unknown }>, mapId: string | null): string[]` — sorted, unique `mon_*` ids of the map with `mapId` and every map whose coordinates differ by at most 1 on both axes (8-neighbourhood, the map included). From each map's `monsters`: every `monsterId` and every `raid.candidates[].monsterId`. `monsters` is an array in `maps.json`; anything else is ignored. Unknown `mapId` → `[]`.

- [ ] **Step 1: Failing tests** (load the real catalogue in the spec with `(await (await fetch('/data/maps.json')).json()).maps`, which Karma serves from `public/data`):
  - `it('a grind map warms its own species and its neighbours')`: for `map_green_grounds_0` the result contains `mon_slime` and `mon_fieldbat` and every species of each map at Chebyshev distance 1 (compute the expectation in the test from the catalogue with a straightforward loop), and nothing else.
  - `it('town warms its border maps')`: for the town id (`map_town`) the result equals the union of its 8-neighbours' species and is not empty.
  - `it('an unknown map warms nothing')`: `nearbyMonsterIds(maps, 'map_nowhere')` → `[]`; `nearbyMonsterIds([], 'map_town')` → `[]`.
- [ ] **Step 2: Run** `'**/arena-monster-set.spec.ts'` → FAIL (module missing).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(arena): the monster species near a map`.

### Task 2: A reference-counted monster file cache

**Files:**
- Modify: `apps/frontend/src/app/shared/monster-viewer/monster-model.ts` (`loadMonsterThree` cache, `MonsterModel.load`/`dispose`, replace `preloadMonsterModels`)
- Modify: `apps/frontend/src/app/shared/monster-viewer/monster-model.spec.ts`

**Interfaces:**
- Produces: `warmMonsterSpecies(ids: string[], onProgress?: (done: number, total: number) => void): Promise<void>` — parses the files (and, for character-rig species, the clips and weapon gear) of the given `mon_*` ids that are not parsed yet; 4 at a time; a failed file counts as done; skips when WebGL is unavailable.
- Produces: `releaseMonsterFilesExcept(ids: string[]): number` — for every parsed monster file not belonging to `ids` and with no live `MonsterModel` using it, disposes its geometries, materials and textures and drops it from the cache; returns how many files were released. Shared files (`CHARACTER_CLIPS`, weapon gear) are never released.
- Produces: `parsedMonsterFiles(): string[]` (for tests and the warm-up: the URLs currently parsed).
- `MonsterModel.load` takes a reference on its file; `dispose()` gives it back.
- Removes: `preloadMonsterModels` (and its call in `play.component.ts`, replaced in Task 3).

- [ ] **Step 1: Failing tests** in `monster-model.spec.ts` (replace the `preloadMonsterModels` describe):
  - `it('warms only the species it is given')`: `await warmMonsterSpecies(['mon_slime', 'mon_gravelhorn'])`; `parsedMonsterFiles()` contains `slime.glb` and `gravelhorn.glb` URLs and not `wraith.glb`.
  - `it('releases files out of the set, freeing their textures')`: warm `['mon_slime', 'mon_wraith']`; keep a reference to one texture of the parsed wraith (via `MonsterModel.load('mon_wraith')`, read a material map, then `dispose()` the model); spy on that texture's `dispose`; `releaseMonsterFilesExcept(['mon_slime'])` returns ≥ 1, the spy was called, `parsedMonsterFiles()` has no wraith.
  - `it('a model in use is never released')`: `const m = await MonsterModel.load('mon_gravelhorn')`; `releaseMonsterFilesExcept([])` keeps gravelhorn; after `m.dispose()`, the same call releases it.
- [ ] **Step 2: Run** `'**/monster-model.spec.ts'` → FAIL.
- [ ] **Step 3: Implement**: file entries `{ promise, gltf | null, users: number }`; dispose by traversing the parsed scene (geometries, materials, every texture property of each material).
- [ ] **Step 4: Run** `'**/{monster-viewer,arena}/*.spec.ts'` → PASS.
- [ ] **Step 5: Commit** `perf(monsters): reference-counted monster files; warm and release by species`.

### Task 3: Warm by map on loading and on every map change

**Files:**
- Create: `apps/frontend/src/app/features/play/arena/arena-monster-warmup.service.ts`
- Modify: `apps/frontend/src/app/features/play/play.component.ts` (loading task)
- Test: `apps/frontend/src/app/features/play/arena/arena-monster-warmup.service.spec.ts`

**Interfaces:**
- Consumes: `nearbyMonsterIds` (Task 1), `warmMonsterSpecies`, `releaseMonsterFilesExcept` (Task 2), `CharacterStore.character().currentMapId`, `BattleStore.queue()` (each entry's `monsterId` and the `definitionId` of its `log.header.v2Input.actors`).
- Produces: `ArenaMonsterWarmup` (`providedIn: 'root'`):
  - `readonly wanted: Signal<string[]>` — `nearbyMonsterIds(maps, currentMapId)` ∪ queued species, sorted.
  - `preload(onProgress?: PreloadProgress, waitMs = 15_000): Promise<void>` — loading-screen task: waits for the character's map (≤ `waitMs`), then `warmMonsterSpecies(wanted())`.
  - an effect: when `wanted()` changes, `warmMonsterSpecies(next)` then `releaseMonsterFilesExcept(next)`.
  - The maps catalogue is `CatalogService.maps()` (a signal filled by `catalog.load()` at game start; empty until then). `warm`/`release` come through an `ARENA_MONSTER_WARMUP_ENV` token `{ warm, release }` (defaults: Task 2's functions) so the service is tested without WebGL.
- `play.component.ts`: `combinePreloads([town, (p) => warmup.preload(p), face])`.

- [ ] **Step 1: Failing tests** (fake env recording calls; `CatalogService` stub with a `maps` signal):
  - `it('the loading screen warms the map and its neighbours')`: character on `map_green_grounds_0`, fake maps with that map and one neighbour → `warm` called once with both maps' species; preload resolves.
  - `it('a map change warms the new neighbours, then releases what is out of range')`: change `currentMapId` → `warm(next)` then `release(next)` in that order.
  - `it('species in the queue are kept')`: queue entry with `monsterId: 'mon_far'` → `wanted()` includes `mon_far`; `release` is called with a list containing it.
  - `it('no map yet or no catalogue: preload still finishes, nothing released')`.
- [ ] **Step 2: Run** `'**/arena-monster-warmup.service.spec.ts'` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `'**/{arena,monster-viewer}/*.spec.ts'` and `'**/{game-preload.service,party-resource-refresh}.spec.ts'` → PASS.
- [ ] **Step 5: Commit** `perf(arena): warm the monsters near the player, release the rest`.

### Task 4: Textures on the GPU before a species first appears

**Files:**
- Modify: `apps/frontend/src/app/features/play/arena/arena-runtime.ts` (`factory.prepare`, `warmMonsterShaders`)
- Modify: `apps/frontend/src/app/features/play/arena/arena-scene.component.ts` (re-warm when `ArenaMonsterWarmup.wanted()` changes)
- Test: `apps/frontend/src/app/features/play/arena/arena-runtime.spec.ts`

**Interfaces:**
- Produces: `ArenaRuntimeHandle.warmMonsters(ids: string[]): Promise<void>` — for each id, `MonsterModel.load`, upload every texture of its materials with `renderer.initTexture`, `compileAsync`, dispose the model; one species per animation frame (yield with `requestAnimationFrame` between species) so a warm never takes one long frame. Replaces the warm-every-manifest-entry call in the constructor.
- `factory.prepare` also uploads the object's textures (`initTexture`) before `compileAsync`.
- `ArenaSceneComponent`: an effect calls `runtime.warmMonsters(warmup.wanted())` once the runtime exists and whenever `wanted()` changes.

- [ ] **Step 1: Failing test** `it('warmMonsters uploads every texture of the species before it is drawn')`: create the runtime as the existing `arena-runtime.spec.ts` does; spy on `WebGLRenderer.prototype.initTexture`; `await runtime.warmMonsters(['mon_slime'])`; the spy was called at least once per texture of the slime's materials (count them from `MonsterModel.load('mon_slime')`).
- [ ] **Step 2: Run** `'**/arena-runtime.spec.ts'` → FAIL (`warmMonsters` missing).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `'**/arena/*.spec.ts'` → PASS; screenshots `shoot-arena.mjs intro solo_close party_fight` show every model (no capsule).
- [ ] **Step 5: Commit** `perf(arena): upload monster textures before they appear`.

### Task 5: Verify, measure, document

- [ ] **Step 1:** `tsc` app + spec (from `apps/frontend`) → no output.
- [ ] **Step 2:** Full Karma `'**/*.spec.ts'` → all SUCCESS.
- [ ] **Step 3:** `pnpm --filter @nanommo/frontend build --configuration production` → OK; no three.js in initial chunks.
- [ ] **Step 4: Measure memory:** with the preview harness approach (Playwright + Chromium), warm the set of `map_green_grounds_0` and of `map_wastelands_0`; report the decoded texture MB of each set (sum of `width*height*4` of the parsed images) next to the 418 MB of the full set.
- [ ] **Step 5:** STATUS.md entry at the top (2026-11-25) for this branch — the left-handed mirror fix, moonwalk fix, cone fix (with the wraith/Ridgebreaker look change), and this plan — with the exact validation and "not pushed / not verified in the running app". ENGINEERING_NOTES.md: "`mat4.getRotation` is wrong on a non-uniformly scaled matrix: build bone-local TRS directly (tools/monster-assets attachCones)"; "a monster GLB replaced in place stays cached up to a day (`vercel.json`): rename or version it when its content changes". Commit `docs: arena monsters by map, mirror, moonwalk, cones`.
