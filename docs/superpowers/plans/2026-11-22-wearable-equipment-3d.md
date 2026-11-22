# Equipamentos vestíveis em 3D — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every non-accessory equipment item (49) gets a wearable 3D visual that shows on the Character Summary portrait, the town player card and every character in the town scene, for existing characters too.

**Architecture:** An offline pipeline (`tools/character-assets/gear/`) turns free source models into gear bound to our 65-bone skeleton (retarget of rigged models, auto-skin of static ones, region extraction, rigid pieces), packs every texture into one atlas and writes four files (`gear-male.glb`, `gear-female.glb`, `gear-rigid.glb`, `gear-atlas.webp`) plus `manifest.json`. The frontend preloads them behind a loading screen; a shared runtime hides covered body regions and fuses each character's gear into one skinned mesh with one material. The API adds the six equipped slots to the town roster.

**Tech Stack:** Node 22 + `@gltf-transform/*` 4.1.1 + `gl-matrix` + `sharp` (pipeline); three.js + Angular 18 signals (frontend); NestJS + TypeORM raw SQL (API); Playwright + `/snap/bin/chromium` (contact sheets, perf gate).

**Spec:** `docs/superpowers/specs/2026-11-22-wearable-equipment-3d-design.md` (read it first; tables of sources per item live there).

## Global Constraints

- Free assets only. Anything not CC0/CC-BY goes into `UNLICENSED_ASSETS_README.txt` at repo root; every CC-BY/CC0 asset gets a line in `apps/frontend/public/assets/character/gear/CREDITS.md` (author, URL, license, changes).
- Sources live in `tools/character-assets/source/` (gitignored, never committed). Sketchfab token: `~/.sketchfab_token` (never copied into the repo or logs).
- Generated files in `apps/frontend/public/assets/character/gear/` are committed and never hand-edited; rerunning the build over the same sources yields byte-identical output.
- Body = neck-down set (chest + legs + gloves); never hood/hat/boots. Gear never contains skin triangles.
- Target skeleton: `body-<sex>.glb`, 65 joints, UE names, T-pose rest. Gear skinned meshes use the **body's joint order** so `skinIndex` is directly the body skeleton index.
- Budgets: Body ≤ 6000 triangles; head/cape/shoes ≤ 2000; weapon ≤ 1500; atlas ≤ 4096²; whole `gear/` folder ≤ 12 MB.
- Town: +1 draw call per character for all gear. Perf gate: 200 T3 characters, frame time ≤ 1.25× the 200 bare-character baseline.
- No migration, no DB/schema change, no deploy, no push to `main`. Work on branch `feat/wearable-equipment-3d`.
- Creator shows no gear (`equipment` not passed).
- Tests: API = direct-execution Node scripts (`node apps/api/test/<file>.test.js` after building shared + api). Pipeline = `node tools/character-assets/gear/test/<file>.test.mjs`. Frontend = Karma (`CHROME_BIN=/snap/bin/chromium npx ng test --watch=false --include='<glob>'` from `apps/frontend`) plus `npx tsc -p tsconfig.spec.json --noEmit`.
- **User review checkpoints** (tasks marked 🔍): render the contact sheet, send it to the user, and do not mark the slot done until they approve. Code work may continue meanwhile.

## Review Focus

1. Character with an item that has no visual in the manifest (future item, stale client) → that slot renders nothing, no exception, other gear still shows.
2. Equipment change while a town character is still building (async load) → the final look matches the latest equipment, no leaked mesh/geometry.
3. Left-handed character with a two-handed weapon / off-hand shield → weapons land in the correct physical hands in town and portrait (same rule as `resolveHandAttachments`).
4. Gear preload fails or is slow (offline CDN) → loading screen gives up after 20 s and enters the game; gear slots stay empty until the files load.
5. Same equipment set on many characters → the fused geometry is built once and shared (cache key = sex + sorted visual ids); disposing one character does not dispose the shared geometry.

---

## File Structure

**Pipeline** (`tools/character-assets/gear/`)
- `lib/skeleton.mjs` — read target skeleton from `body-<sex>.glb`; write it into another document.
- `lib/bones.mjs` — source bone name normalisation + alias table (from spike).
- `lib/retarget.mjs` — rigged source → our rest pose + our weights (from `spike/retarget.mjs`).
- `lib/autoskin.mjs` — static source → posed-body weight transfer + un-pose (from `spike/autoskin.mjs`).
- `lib/regions.mjs` — bone → body region; triangle filters (head, feet, region keep, stray, skin, drop regex).
- `lib/rigid.mjs` — extract a node subtree as a rigid piece normalised to a pivot/axis/length.
- `lib/atlas.mjs` — pack textures/flat colours into one atlas, remap UVs, apply tint.
- `lib/simplify.mjs` — triangle-budget reduction (meshoptimizer via `@gltf-transform/functions` `simplify`).
- `gear.config.mjs` — one entry per visual + `ITEMS` map itemId → visual id.
- `build-gear.mjs` — orchestrator; writes the four files + manifest + build report.
- `fetch-sources.mjs` — clones KayKit repos and downloads the Sketchfab UIDs listed in the config.
- `test/*.test.mjs` — Node assertion tests on synthetic glTFs.
- `../preview/shoot-gear.mjs`, `../preview/gear-entry.js` — contact sheets (promoted spike harness); `../preview/gear-stress.mjs` — perf gate.

**Frontend** (`apps/frontend/src/app/`)
- `shared/character-viewer/gear-manifest.ts` — manifest types + `GEAR_ASSET_VERSION`.
- `shared/character-viewer/gear-regions.ts` — body region of each bone; visible-body geometry.
- `shared/character-viewer/gear-merge.ts` — fuse a character's gear into one SkinnedMesh.
- `shared/character-viewer/grip.ts` — `gripMatrix()` moved out of `character-rig.ts`.
- `shared/character-viewer/character-asset-cache.ts` — `gear()` loader.
- `shared/character-viewer/character-rig.ts`, `character-viewer.types.ts`, `character-viewer.component.ts` — equipment input.
- `features/play/character-portrait.ts`, `features/play/components.ts`, `features/play/town-scene/town-player-card.component.ts` — pass equipment.
- `features/play/town-scene/town-character.ts`, `town-runtime.ts` — wear gear, warm gear.
- `features/play/game-loading-screen.component.ts` + `play.component.{ts,html}` — loading screen.

**Shared/API**
- `packages/shared/src/town/town-scene.types.ts` — `TownRosterEntry.equipment`.
- `apps/api/src/modules/presence/town-roster.service.ts` — read six slots.
- `apps/api/test/town-roster.test.js`, `apps/api/test/gear-manifest-coverage.test.js`.

---

### Task 1: Pipeline core — skeleton, bones, retarget, regions

Promote the spike's retarget into tested library code.

**Files:**
- Create: `tools/character-assets/gear/lib/{skeleton,bones,retarget,regions}.mjs`
- Create: `tools/character-assets/gear/test/fixtures.mjs` (builds synthetic glTF documents in memory)
- Create: `tools/character-assets/gear/test/retarget.test.mjs`, `test/regions.test.mjs`
- Modify: `tools/character-assets/package.json` (script `"gear:test": "node --test gear/test/"`)

**Interfaces:**
- Produces:
  - `readTargetSkeleton(sex: 'male'|'female') → Promise<Target>`; `Target = { joints: {name, parent: string|null, local: {t,r,s}, world: mat4, ibm: mat4}[], index: Map<string, number>, pos(name): vec3 }`
  - `writeSkeleton(doc: Document, target: Target) → { skin: Skin, root: Node }` (joint order = `target.joints` order)
  - `normalizeBoneName(name: string) → string`; `mapSourceBones(joints: Node[]) → Map<Node, string /*target*/>`
  - `retargetSkinned(doc: Document, target: Target, opts: { drop?: RegExp; scale?: Record<string, {f: number; perp: boolean}> }) → { primitives: Primitive[]; dominant: Map<Primitive, Int32Array /*target joint per vertex*/>; report: { mapped: number; missing: string[] } }` — rewrites POSITION/NORMAL/JOINTS_0/WEIGHTS_0 in place to target rest pose + target joints; throws `Error('missing key bones: ...')` when any of pelvis, Head, upperarm_l/r, lowerarm_l/r, hand_l/r, thigh_l/r, calf_l/r, foot_l/r is unmapped.
  - `REGION_OF_BONE(name: string) → Region`; `type Region = 'head'|'neck'|'torso'|'upperarms'|'forearms'|'hands'|'thighs'|'calves'|'feet'` (pelvis/spine/clavicle/root → torso; upperarm → upperarms; lowerarm → forearms; hand + fingers → hands; thigh → thighs; calf → calves; foot/ball/ball_leaf → feet; neck_01 → neck; Head → head).
  - `filterTriangles(prim: Primitive, keep: (tri: [number, number, number]) => boolean) → number /*kept*/`
  - `strayFilter(positions: Float32Array) → (tri) => boolean` (rejects any vertex with y > 2.1, y < -0.3, |x| > 1.3, |z| > 1.0 — the spike's box).

- [ ] **Step 1: Write failing tests**

`retarget.test.mjs` builds a two-sided Mixamo-named skeleton (`mixamorig:Hips`, `Spine`, `Neck`, `Head`, `LeftArm`… with the source standing 2× taller and facing −Z) with a quad weighted 100% to `mixamorig:LeftForeArm`, runs `retargetSkinned` against the real male target, and asserts:
```js
assert.equal(report.missing.length, 0);
// the quad's centroid lies within 3 cm of the midpoint of our lowerarm_l → hand_l segment
assert.ok(dist(centroid, mid(target.pos('lowerarm_l'), target.pos('hand_l'))) < 0.03);
// all weights land on lowerarm_l
assert.deepEqual(uniqueJoints(prim), [target.index.get('lowerarm_l')]);
assert.throws(() => retargetSkinned(docWithoutHead, target, {}), /missing key bones: Head/);
```
plus `normalizeBoneName('Thigh.R.001_048') === 'thigh.r'`, `normalizeBoneName('mixamorig:LeftUpLeg_016') === 'leftupleg'`, `normalizeBoneName('bip L UpperArm_08') === 'biplupperarm'`.

`regions.test.mjs`: `REGION_OF_BONE('middle_02_l') === 'hands'`, `REGION_OF_BONE('ball_leaf_r') === 'feet'`, `REGION_OF_BONE('clavicle_r') === 'torso'`; `filterTriangles` with a stray vertex at y = 3 removes exactly that triangle.

- [ ] **Step 2: Run tests — expect FAIL (modules missing)**

Run: `cd tools/character-assets && npm run gear:test` → FAIL, `Cannot find module '../lib/retarget.mjs'`.

- [ ] **Step 3: Implement the four modules**

Port `spike/retarget.mjs` (same algorithm: global facing from thighs, height scale `k`, per-bone head-to-head + shortest-arc rotation + clamped axial stretch 0.75–1.35, `--scale` per-bone shrink about its joint, nearest mapped bone fallback for orphan bones). Improve facing: use the average of (thigh_l − thigh_r) and (upperarm_l − upperarm_r), flattened on Y.

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm run gear:test` → all pass.

- [ ] **Step 5: Commit**

```bash
git add tools/character-assets/gear tools/character-assets/package.json
git commit -m "feat(character-assets): biblioteca de retarget de roupas para o nosso esqueleto"
```

### Task 2: Pipeline — auto-skin, rigid pieces, atlas, simplify

**Files:**
- Create: `tools/character-assets/gear/lib/{autoskin,rigid,atlas,simplify}.mjs`
- Create: `tools/character-assets/gear/test/{autoskin,rigid,atlas}.test.mjs`
- Modify: `tools/character-assets/package.json` (devDependency `meshoptimizer` pinned to the version `@gltf-transform/functions@4.1.1` expects)

**Interfaces:**
- Consumes: `Target`, `writeSkeleton`, `REGION_OF_BONE` (Task 1).
- Produces:
  - `autoskinStatic(doc: Document, target: Target, opts: { armDeg?: number; legDeg?: number; rotYDeg?: number }) → { primitives: Primitive[]; dominant: Map<Primitive, Int32Array> }` (spike algorithm: pose our arms down by `armDeg`, fit by height and bbox centre, 4-nearest posed-body vertices with 1/(d+0.005) weights, un-pose by inverse blended skin matrix).
  - `extractRigid(doc: Document, nodeName: string, opts: { pivot?: [x,y,z]; up?: 'x'|'y'|'z'|'-x'|'-y'|'-z'; length?: number }) → Document` — one node, mesh baked in its own space, pivot at origin, long axis +Y scaled to `length` metres when given (same convention as `build.mjs` `WEAPON_SOURCES`).
  - `packAtlas(entries: { id: string; image: Buffer | null; color?: [r,g,b]; tint?: string; size: 256|512|1024 }[]) → Promise<{ png: Buffer; size: number; rects: Map<string, {x,y,w,h} /*0..1*/> }>` — shelf packing sorted by size, deterministic; flat-colour entries get an 8×8 swatch; `tint` multiplies the image (hex colour).
  - `remapUVs(prim: Primitive, rect) → void` (UVs wrapped into [0,1] with `fract` first; swatch entries set every UV to the swatch centre).
  - `simplifyTo(doc: Document, maxTriangles: number) → Promise<number /*final*/>`.

- [ ] **Step 1: Write failing tests**
  - `autoskin.test.mjs`: a static box placed over our male `lowerarm_l` in T-pose (`armDeg = 0`) gets dominant joint `lowerarm_l` on ≥ 90% of vertices; with `armDeg = 60` and the box placed over the lowered forearm, the un-posed box centroid lies within 4 cm of the T-pose forearm midpoint.
  - `rigid.test.mjs`: a 2 m tall cylinder node with `pivot = [0, 1, 0]`, `length = 0.5` ends with bbox y ∈ [−0.25, 0.25] ±1 mm.
  - `atlas.test.mjs`: two 512 images + one colour swatch pack into a 1024 atlas; rects do not overlap; packing the same input twice yields identical PNG bytes; a UV of (1.25, −0.5) remaps inside its rect.

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm run gear:test` → FAIL on missing modules.

- [ ] **Step 3: Implement the four modules** (port `spike/autoskin.mjs`; `simplifyTo` uses `simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.01 })` iterating the ratio down until under budget).

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit** — `feat(character-assets): auto-skin, peças rígidas, atlas e redução de malha`

### Task 3: Build orchestrator, config for Body + Ranger/Peasant boots, contact sheets 🔍

**Files:**
- Create: `tools/character-assets/gear/gear.config.mjs`, `gear/build-gear.mjs`, `gear/fetch-sources.mjs`
- Create: `tools/character-assets/preview/shoot-gear.mjs`, `tools/character-assets/preview/gear-entry.js` (from `spike/shoot.mjs`, `spike/entry.js`)
- Create: `tools/character-assets/gear/test/build.test.mjs`
- Output: `apps/frontend/public/assets/character/gear/{gear-male.glb,gear-female.glb,gear-rigid.glb,gear-atlas.webp,manifest.json,CREDITS.md}`
- Create: `UNLICENSED_ASSETS_README.txt` (root)

**Interfaces:**
- Consumes: everything in Tasks 1–2.
- Produces (manifest, consumed by Tasks 7–11 and the API coverage test):
```ts
interface GearManifest {
  version: number;                         // bump on every rebuild that changes files
  atlas: string;                           // 'gear-atlas.webp'
  items: Record<string, string>;           // itemId -> visualId
  visuals: Record<string, GearVisual>;
}
type GearVisual =
  | { slot: 'body'|'shoes'|'head'|'cape'; kind: 'skinned'; covers: Region[]; hidesHair?: boolean; hidesBeard?: boolean }
  | { slot: 'head'|'cape'|'mainHand'|'offHand'; kind: 'rigid'; bone: string; transform: { male: number[]; female: number[] } /*16, column-major, bone space*/; covers?: Region[]; hidesHair?: boolean; hidesBeard?: boolean; weaponType?: string };
```
  Skinned visual `v` = mesh named `v` in `gear-<sex>.glb`; rigid visual `v` = node named `v` in `gear-rigid.glb`. Bows contain a child mesh named `BowString`.
- Config entry shape (`gear.config.mjs` default export `{ VISUALS, ITEMS, SOURCES }`):
```js
VISUALS['body-ranger'] = { slot: 'body', method: 'parts', source: 'quaternius:Ranger', parts: ['Body','Legs','Arms'],
  removeMaterials: ['Skin'], covers: ['torso','upperarms','forearms','thighs','calves'], size: 1024, maxTris: 6000 };
VISUALS['body-handpainted-knight'] = { slot: 'body', method: 'retarget', source: 'sketchfab:42b1d37bce974d48bca12a3f9a7d1136',
  drop: /Handle|Bone\./, scale: { hand: 0.55, clavicle: 0.5, upperarm: '0.75p' },
  covers: ['torso','upperarms','forearms','hands','thighs','calves'], size: 1024, maxTris: 6000 };
```
  Methods: `parts` | `retarget` | `autoskin` | `region` (`from: <visualId-like source spec>`, `keepRegions: Region[]`, `maxY?`) | `rigid` (`node`, `pivot`, `up`, `length`, `bone`, per-sex `offset`/`rotDeg`/`scale`). Optional per entry: `removeSkin: { uvRects?: [x,y,w,h][], materials?: string[] }`, `tint`, `size`, `maxTris`.
  `SOURCES` maps source keys to paths (`quaternius:Ranger` → `tools/npc-assets/source/modular-character-outfits-fantasy/.../Modular Parts/<Sex>_Ranger_<Part>.gltf`; `sketchfab:<uid>` → `source/sketchfab/<uid>/model.glb`; `kaykit:<pack>:<file>:<node>`; `weapons:<File>.obj`).
- `build-gear.mjs [--only <visualId,...>] [--review <slot>]` — `--review` runs `preview/shoot-gear.mjs` and writes `tools/character-assets/preview/screenshots/gear-<slot>.png` (male + female × Idle 0.3 s yaw 20°, Attack 0.35 s yaw 60°, Walk 0.4 s yaw 90°, CastLoop 0.3 s, Sit 0.5 s yaw 40°).
- Build report printed and written to `gear/build-report.json`: per visual triangles, atlas rect size; total folder bytes; fails the build (exit 1) when a budget from Global Constraints is exceeded.

- [ ] **Step 1: Write failing test** `build.test.mjs`: runs `build-gear.mjs --only body-ranger,body-peasant` into a temp `OUT` (env `GEAR_OUT`) and asserts: manifest has both visuals with `kind: 'skinned'`; `gear-male.glb` contains meshes named `body-ranger` and `body-peasant`, each skinned with 65 joints whose names equal `body-male.glb`'s joint names in order; no primitive uses a material named `Skin`; every UV in `[0,1]`; two consecutive runs produce identical bytes for all files.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** `fetch-sources.mjs` (git clone the two KayKit repos into `source/kaykit-*`; download each `sketchfab:` UID in the config using `~/.sketchfab_token`, skipping ones already present), `gear.config.mjs` with the **six Body visuals** (user-approved order: phys T1 Ranger, T2 `7f59a7b0…` with `scale: { calf: '1.18p', thigh: '1.08p' }`, T3 `42b1d37b…` as above; magic T1 Peasant, T2 `01d1bacb…` with `drop: /Prop/`, T3 `10771a1d…` with `drop: /STAFF|HAT/`) and **two shoes** (`shoes-ranger` = Ranger `Feet`, `shoes-peasant` = Peasant `Feet`, `covers: ['feet']`), the `ITEMS` entries for `equip_body_*` (6), `equip_shoes_traveler_t1 → shoes-ranger`, `equip_shoes_earth_t2 → shoes-peasant`, and `build-gear.mjs`. Bare-skin removal for the robes: robe T2 forearms and mage T3 hands via `removeSkin.uvRects` measured on their textures; those visuals then omit `forearms`/`hands` from `covers`. Ankle fringes on the robes: drop triangles whose every vertex has y < 0.12 m (`maxY` filter on the feet band).
- [ ] **Step 4: Run test — expect PASS;** run `node gear/build-gear.mjs --review body` and `--review shoes`; inspect the sheets for: no bare source skin, no ankle fringes, no knee pinch on T2 phys, T3 pauldrons/gloves proportional.
- [ ] **Step 5: Write `CREDITS.md` and `UNLICENSED_ASSETS_README.txt`** (every source used so far; the README explains the rule and lists none if all are CC0/CC-BY). Add the `gear` build to `tools/character-assets/README.md` (sources table incl. Sketchfab UIDs + the token file).
- [ ] **Step 6: Commit** — `feat(character-assets): build de gear com Body e botas Ranger/Peasant`
- [ ] **Step 7: 🔍 Send `gear-body.png` and `gear-shoes.png` to the user.** Body slot is done only after approval; apply requested changes via config and rerun.

### Task 4: Head and cape visuals 🔍

**Files:** Modify `tools/character-assets/gear/gear.config.mjs`; regenerate outputs.

**Interfaces:** Consumes `rigid`/`region`/`parts` methods. Produces manifest visuals for all `equip_head_*` (6) and `equip_cape_*` (6).

- [ ] **Step 1: Add head visuals** per the spec table: phys T1 Ranger `Head_Hood` (`method: 'parts'`, skinned, `hidesHair: true`), T2 KayKit `Knight.glb:Knight_Helmet`, T3 KayKit `Skeleton_Warrior.glb:Skeleton_Warrior_Helmet`; magic T1 `Skeleton_Rogue.glb:Skeleton_Rogue_Hood`, T2 `Mage.glb:Mage_Hat`, T3 `Skeleton_Mage.glb:Skeleton_Mage_Hat` — rigid on `Head`. KayKit heads are chibi: per-sex `scale` so the helmet's inner width matches our head width (measure our `Head` region bbox in `body-<sex>.glb`), `offset` so it sits on the crown; helmets `hidesHair: true, hidesBeard: <full helm>`.
- [ ] **Step 2: Add cape visuals**: phys T1 `Rogue.glb:Rogue_Cape`, T2 `Barbarian.glb:Barbarian_Cape`, T3 `Knight.glb:Knight_Cape`; magic T1 `Skeleton_Rogue.glb:Skeleton_Rogue_Cape`, T2 `Mage.glb:Mage_Cape`, T3 `method: 'region'` from `autoskin` of `sketchfab:89b4d671…` keeping the cape triangles (back band: triangles whose centroid z < body back plane − 2 cm and y between 0.25 and 1.55 m). Rigid capes on `spine_03`, tilted back so the hem clears the thighs in Walk and Sit (check on the sheet).
- [ ] **Step 3: Extend `build.test.mjs`**: manifest contains a visual for every `equip_head_*` and `equip_cape_*`; every rigid transform has 16 finite numbers for both sexes.
- [ ] **Step 4: Run** `npm run gear:test` → PASS; `node gear/build-gear.mjs --review head` and `--review cape`.
- [ ] **Step 5: Commit** — `feat(character-assets): elmos, chapéus e capas`
- [ ] **Step 6: 🔍 Send `gear-head.png`, `gear-cape.png`.** Rejected piece → find a free replacement (Sketchfab search API, CC0/CC-BY first), add to config/credits, re-send.

### Task 5: Remaining shoes (elemental) 🔍

**Files:** Modify `gear.config.mjs`.

- [ ] **Step 1: Add five `region` shoe visuals** (`keepRegions: ['feet']` plus calf triangles with all vertices y < 0.32 m; `covers: ['feet']`): `water_t2` from `7f59a7b0…` tint `#4f8fd6`; `fire_t3` from `42b1d37b…` tint `#e0662b`; `shadow_t3` from `10771a1d…` tint `#5b3a7a`; `wind_t4` from autoskin `89b4d671…` tint `#9fe0b0`; `holy_t4` from autoskin `208e3863…` (`armDeg: 60`) tint `#f2d27a`. Map the five `equip_shoes_*` items.
- [ ] **Step 2: Extend `build.test.mjs`**: all 7 `equip_shoes_*` mapped; every shoe mesh's vertices have y < 0.36 m.
- [ ] **Step 3: Run tests → PASS; `--review shoes`.**
- [ ] **Step 4: Commit** — `feat(character-assets): botas elementais`
- [ ] **Step 5: 🔍 Send `gear-shoes.png`.**

### Task 6: Weapons per item 🔍

**Files:** Modify `gear.config.mjs`; Modify `tools/character-assets/build.mjs` only if a shared OBJ reader is extracted (keep `weapons/*.glb` untouched until Task 9 stops using them).

- [ ] **Step 1: Add 25 weapon visuals** per the spec table (`rigid`, `slot: 'mainHand'|'offHand'`, `weaponType`, `bone: 'hand_r'` — the runtime moves it to the physical hand; grip convention: origin at the grip, long axis +Y, lengths dagger 0.36, knife 0.28, sword 0.95, greatsword 1.45, bow 1.25, staff 1.6, rod 0.55, shield 0.62 (along its face), rune 0.22). Medieval Weapons OBJ reused through the same reader as `build.mjs`. Bows: the string is exported as a child mesh named `BowString` (for OBJ bows, the `White` material primitive). Reduce `e2c5a467…` (36k tris) to ≤ 1500.
- [ ] **Step 2: Extend `build.test.mjs`**: all 19 mainHand + 6 offHand items mapped; every bow visual has a `BowString` child; every weapon's bbox max dimension within ±5% of its type length.
- [ ] **Step 3: Run tests → PASS; `--review weapons`** (sheet: each weapon in hand, Idle + Attack, using `grip.ts` from Task 8 once it exists — until then the harness's simple hand attach).
- [ ] **Step 4: Commit** — `feat(character-assets): armas por item`
- [ ] **Step 5: 🔍 Send `gear-weapons.png`.**

### Task 7: Town roster carries all equipped slots (API + shared) and manifest coverage test

**Files:**
- Modify: `packages/shared/src/town/town-scene.types.ts:86-110`
- Modify: `apps/api/src/modules/presence/town-roster.service.ts:57-58,98-99,360-382`
- Test: `apps/api/test/town-roster.test.js`; Create: `apps/api/test/gear-manifest-coverage.test.js`

**Interfaces:**
- Produces:
```ts
export const VISIBLE_EQUIPMENT_SLOTS = ['head', 'body', 'cape', 'shoes', 'mainHand', 'offHand'] as const;
export type VisibleEquipmentSlot = typeof VISIBLE_EQUIPMENT_SLOTS[number];
export type VisibleEquipment = Partial<Record<VisibleEquipmentSlot, string>>; // itemIds
// TownRosterEntry gains:
equipment?: VisibleEquipment;
```
  `mainHandItemId` / `offHandItemId` stay (filled as today).

- [ ] **Step 1: Write failing tests.** In `town-roster.test.js`, give a fake character equipped rows for all six slots plus `accessoryLeft`, and assert the roster entry has `equipment` deep-equal to the six slots (no accessory) and still `mainHandItemId`. Make the fake `characterRepo.query` answer both the roster SQL and `rowOf`'s SQL from the same in-memory `equipped` array (the SQL text must contain `equipped_items`). `gear-manifest-coverage.test.js`: every `items.json` equipment with `slot !== 'accessory'` has `manifest.items[id]`, each mapped visual exists, and `manifest.atlas` + the three GLBs exist on disk.
- [ ] **Step 2: Build and run — expect FAIL**: `pnpm --filter @nanommo/shared build && pnpm --filter @nanommo/api build && node apps/api/test/town-roster.test.js` → assertion on `equipment`.
- [ ] **Step 3: Implement**: roster query replaces the two hand subselects with one `(SELECT json_object_agg(e.slot, e."itemId") FROM equipped_items e WHERE e."characterId" = c.id AND e.slot IN ('head','body','cape','shoes','mainHand','offHand')) AS "equipment"`; `rowOf` selects the same six slots; entry builder sets `equipment` and derives `mainHandItemId/offHandItemId` from it.
- [ ] **Step 4: Run both tests — expect PASS** (coverage test passes once Tasks 3–6 outputs exist; until then it lists the missing items — that list must be empty before Task 12).
- [ ] **Step 5: Commit** — `feat(town): roster envia os seis slots de equipamento visíveis`

### Task 8: Frontend gear runtime — manifest, regions, grip, merge

**Files:**
- Create: `apps/frontend/src/app/shared/character-viewer/gear-manifest.ts`, `gear-regions.ts`, `gear-merge.ts`, `grip.ts`
- Create: `apps/frontend/src/app/shared/character-viewer/gear-merge.spec.ts`, `gear-regions.spec.ts`
- Modify: `character-asset-cache.ts` (add `gear()`), `character-rig.ts` (use `grip.ts`)

**Interfaces:**
- Consumes: manifest shape (Task 3), `VisibleEquipment` (Task 7), `BodyAsset.fists` (`body-asset.ts`).
- Produces:
```ts
// gear-manifest.ts
export const GEAR_ASSET_VERSION = 1; // bump with manifest.version
export type { GearManifest, GearVisual, Region } ; // mirror of Task 3
export interface LoadedGear { manifest: GearManifest; atlas: THREE.Texture; skinned: Record<Sex, Map<string, THREE.SkinnedMesh>>; rigid: Map<string, THREE.Object3D> }
// character-asset-cache.ts
gear(): Promise<LoadedGear>   // memoised; loads `gear/manifest.json?v=`, the 3 GLBs and the atlas (sRGB, flipY=false)
// gear-regions.ts
export function boneRegion(name: string): Region;                       // same table as the pipeline
export function visibleBodyGeometry(sex: Sex, body: THREE.SkinnedMesh, covered: ReadonlySet<Region>): THREE.BufferGeometry; // index subset, cached per (sex, sorted covered); head/neck never hidden
// grip.ts
export function gripMatrix(fist: Fist, type: HandWeaponType): THREE.Matrix4; // body moved verbatim from CharacterRig.gripMatrix
// gear-merge.ts
export interface GearPlan { visuals: string[]; covered: Set<Region>; hidesHair: boolean; hidesBeard: boolean; weapons: { side: 'right'|'left'; visual: string; type: HandWeaponType }[] }
export function planGear(gear: LoadedGear, equipment: VisibleEquipment, item: (id: string) => { weaponType?: string } | undefined, dominantHand: 'right'|'left'): GearPlan; // unknown item / missing visual -> skipped
export function mergedGearGeometry(gear: LoadedGear, sex: Sex, body: BodyAsset, plan: GearPlan, opts: { includeWeapons: boolean }): THREE.BufferGeometry | null; // cached per (sex, includeWeapons, sorted visuals+sides); null when nothing to draw
export function gearMesh(geometry: THREE.BufferGeometry, gear: LoadedGear, skeleton: THREE.Skeleton, bindMatrix: THREE.Matrix4): THREE.SkinnedMesh; // shared material per page, name 'Gear', frustumCulled=false
```
  Rigid visuals are baked into bind space as `bodyBindWorld(bone) × transform[sex]` (weapons: `bodyBindWorld(hand) × gripMatrix(fist, type)`) with `skinIndex = boneIndex`, `skinWeight = (1,0,0,0)`. Physical hands from `resolveHandAttachments(dominantHand, main, off)` (already used by the viewer component).

- [ ] **Step 1: Write failing specs.** `gear-regions.spec.ts`: on the real male body, hiding `{torso, thighs}` removes ≥ 90% of triangles whose dominant bone is `spine_02` and keeps every `Head`-dominant triangle; the same call twice returns the same geometry object. `gear-merge.spec.ts` (with a fake `LoadedGear` built from two tiny skinned meshes and one rigid box on `Head`): `planGear` skips `'equip_unknown'` without throwing; merged geometry vertex count = sum of parts; rigid box vertices have `skinIndex[0] === index of 'Head'` and weight 1; same plan → same geometry instance (cache); left-handed + `{mainHand: sword}` puts the sword on `left`.
- [ ] **Step 2: Run — expect FAIL**: `CHROME_BIN=/snap/bin/chromium npx ng test --watch=false --include='**/gear-*.spec.ts'` from `apps/frontend`.
- [ ] **Step 3: Implement** the four files and `gear()`; replace `CharacterRig.gripMatrix` body with a call to `grip.ts` (no behaviour change: the existing `character-viewer.component.spec.ts` must still pass).
- [ ] **Step 4: Run specs + `npx tsc -p tsconfig.spec.json --noEmit` — expect PASS.**
- [ ] **Step 5: Commit** — `feat(viewer): runtime de gear (manifesto, regiões do corpo, fusão em uma malha)`

### Task 9: Portrait and player card wear gear

**Files:**
- Modify: `shared/character-viewer/character-viewer.types.ts` (`ViewerConfig.equipment?: VisibleEquipment`)
- Modify: `shared/character-viewer/character-viewer.component.ts` (input `equipment = input<VisibleEquipment | null>(null)`, passed into the config)
- Modify: `shared/character-viewer/character-rig.ts` (`apply()`: load `gear()`, build plan, replace body geometry with `visibleBodyGeometry`, add/replace the `Gear` mesh, hide hair/beard per plan, load weapons by **visual** from `gear.rigid` instead of `weapons/<type>.glb`, keeping procedural staff/rod/rune only as fallback when the visual is missing; `bowParts` finds the mesh named `BowString`)
- Modify: `features/play/character-portrait.ts` (`portraitEquipment(equipment rows) → VisibleEquipment`), `features/play/components.ts` (pass `[equipment]`), `features/play/town-scene/town-player-card.component.ts` (pass `entry().equipment`, falling back to the two hand ids)
- Test: `character-viewer.component.spec.ts`, `character-portrait.spec.ts`, `town-player-card` spec if present

- [ ] **Step 1: Failing tests**: `portraitEquipment([{slot:'body', itemId:'equip_body_phys_t1'}, {slot:'accessoryLeft', itemId:'x'}])` deep-equals `{ body: 'equip_body_phys_t1' }`; viewer spec with `equipment: { body: 'equip_body_phys_t3' }` → rig has a child mesh named `Gear` and the `Body` mesh index count is lower than without equipment; with `equipment: null` there is no `Gear` mesh (creator path); bow visual: `rig.bowDrawn()` still reaches 1 during an attack (existing bow test adapted to the new asset).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.** Changing equipment on an existing rig removes the old `Gear` mesh (geometry is shared — never dispose cached geometry; dispose nothing else) and restores full body geometry when no slot covers anything.
- [ ] **Step 4: Run specs + tsc — PASS.** Visual check with `node tools/character-assets/preview/shoot.mjs` using a config with full T3 equipment.
- [ ] **Step 5: Commit** — `feat(viewer): retrato e cartão do jogador vestem o equipamento`

### Task 10: Town characters wear gear

**Files:**
- Modify: `features/play/town-scene/town-character.ts` (`build()` + `setEntry()`), `town-runtime.ts` (`warmTownAssets` also awaits `cache.gear()`)
- Test: `features/play/town-scene/town-character.spec.ts` (create if absent)

**Interfaces:** Consumes `planGear`, `mergedGearGeometry(..., { includeWeapons: true })`, `gearMesh`, `visibleBodyGeometry` (Task 8), `TownRosterEntry.equipment` (Task 7).

- [ ] **Step 1: Failing spec**: a `TownCharacter` built for an entry with `equipment: { body, shoes, head, cape, mainHand, offHand }` has exactly one mesh named `Gear` and no `weapon:*` children; hair is absent when the head visual `hidesHair`; `setEntry` with a different `equipment` rebuilds the `Gear` mesh (old one removed); two characters with identical equipment share `Gear.geometry`; an NPC (`opts.npc`) never gets gear; `setEntry` arriving before the first build finishes ends with the newest equipment (Review Focus 2).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement.** Equipment key = sorted JSON of `entry.equipment`; `setEntry` compares keys and re-dresses without rebuilding the body.
- [ ] **Step 4: Run specs + tsc — PASS.**
- [ ] **Step 5: Commit** — `feat(town): personagens da cidade vestem o equipamento`

### Task 11: Loading screen + preload, caching, perf gate

**Files:**
- Create: `features/play/game-loading-screen.component.ts` (standalone; progress bar 0–100%, localized "Loading…"/"Carregando…" via `LocaleService`)
- Modify: `features/play/play.component.{ts,html}` (show the screen until `preload` settles or 20 s pass), `features/play/town-scene/town-scene.types.ts` (`preloadTownScene` reports progress through an optional callback `(done: number, total: number) => void`)
- Modify: `vercel.json` (`/assets/character/gear/*` same cache headers as `/assets/character/*`); `character-asset-cache.ts` uses `?v=${GEAR_ASSET_VERSION}`
- Create: `tools/character-assets/preview/gear-stress.mjs`
- Test: `features/play/play.component.spec.ts` (or new `game-loading-screen.component.spec.ts`)

- [ ] **Step 1: Failing spec**: with a `TOWN_SCENE_ENV.preload` that never resolves, the loading screen is visible, and after `jasmine.clock().tick(20_000)` it is gone and the play shell is shown (Review Focus 4); with a preload resolving immediately the screen disappears on the next tick.
- [ ] **Step 2: Run — FAIL. Step 3: Implement. Step 4: Run — PASS.**
- [ ] **Step 5: Perf gate.** `gear-stress.mjs` bundles `gear-merge.ts` + `gear-regions.ts` with esbuild (like `shoot.mjs`), renders 200 animated characters on a 20×10 grid twice — bare and with full T3 equipment (half male, half female, mixed phys/magic) — measures `renderer.info.render.calls` and median frame time over 300 frames in `/snap/bin/chromium`. Pass: draw calls per character ≤ bare + 1 and median frame time ≤ 1.25× bare. Record the numbers in STATUS. If frame time fails: add LOD1 (build `simplifyTo` 50% per visual into `gear-<sex>-lod1.glb`, used by town characters in `lod === 'low'`) and re-measure.
- [ ] **Step 6: Commit** — `feat(play): tela de carregamento com pré-carregamento do gear`

### Task 12: Item icons match the approved models 🔍

**Files:** Modify `apps/frontend/assets/ui/items/svg/equipment/<id>.svg` and `svg-noframe/equipment/<id>.svg` for every item whose approved model differs from its icon.

- [ ] **Step 1:** For each approved slot, render a front-facing turntable still of each visual (`shoot-gear.mjs --still`), list the items whose icon silhouette/colours no longer match (e.g. `equip_head_magic_t2` helm → wizard hat).
- [ ] **Step 2:** Redraw those SVGs in the existing icon style (same viewBox, frame, stroke weight, palette approach as the current files) to match silhouette and main colours of the model.
- [ ] **Step 3:** `pnpm --filter @nanommo/frontend build --configuration production` (known CSS-budget warnings only).
- [ ] **Step 4: Commit** — `art(icons): ícones de equipamento no formato dos modelos 3D`
- [ ] **Step 5: 🔍 Send a before/after icon sheet to the user.**

### Task 13: Docs and final verification

**Files:** `STATUS.md` (dated entry at top: what changed, every command run and its result, "no migration, nothing deployed"), `ARCHITECTURE.md` (decision: offline gear pipeline + atlas + per-character fused mesh), `ENGINEERING_NOTES.md` (traps: gear joint order must equal body joint order; never dispose cached gear geometry; bump `GEAR_ASSET_VERSION` with the manifest; Sketchfab sources need the token; body region hiding is by dominant bone), `tools/character-assets/README.md`.

- [ ] **Step 1:** Delete `tools/character-assets/spike/` (never committed).
- [ ] **Step 2: Full verification:**
```bash
cd tools/character-assets && npm run gear:test
pnpm --filter @nanommo/shared build && pnpm --filter @nanommo/api build
node apps/api/test/town-roster.test.js && node apps/api/test/gear-manifest-coverage.test.js
cd apps/frontend && npx tsc -p tsconfig.spec.json --noEmit && CHROME_BIN=/snap/bin/chromium npx ng test --watch=false
pnpm --filter @nanommo/frontend build --configuration production
```
Expected: all pass (pre-existing known-stale failures listed in CLAUDE.md excluded and named in STATUS).
- [ ] **Step 3: Commit** — `docs: equipamentos vestíveis em 3D`
