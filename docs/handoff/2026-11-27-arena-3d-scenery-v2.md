# Handoff: arena scenery v2 — 3D scenery for the other regions (2026-11-27)

## Where we are

Session of 2026-11-27 (see also `docs/handoff/2026-11-27-arena-backdrop-pass.md` and the top entries of `STATUS.md`).

**The problem.** The arena backdrop was three painted planes per region (`sky` 120 m, `far` 70 m, `near` 22 m;
`arena-scenery.ts`), turning with the camera orbit (±70°). three.js draws transparent meshes after every opaque one
whatever their `renderOrder`, so a 3D prop behind the painted `near` plane got the painting over it ("see-through"
rocks). Turned 70°, the camera looks along the prop strip (±90 m in x) and many props are behind that plane.

**What was tried, in order (all with before/after shots):**

| Attempt | Result | Verdict |
|---|---|---|
| `1cd7511`: props discard fragments behind the near plane | props sliced / vanish while dragging the camera | rejected |
| Backdrop in a separate render pass before the 3D world (plan of the backdrop-pass handoff) | front fine; in orbit distant props drawn *over* the painted hedge ("pedras coladas na pintura") | rejected ("horrível"), not committed |
| `22ebc5b` (merge `48b0410`): props shrink whole about their base so they never cross the near layer (`nearLayerScale` in `arena-props.ts`) | no slicing; a few back-row props near the hedge disappear | kept, in production for every region that still has a near layer |
| kwaioua_forest without any painted layer (`3c8e3f2`, merge `cecc069`) | dark night forest, all 3D | **approved — the model for v2** |

**kwaioua_forest v2 (the reference look):**
- No painted layer at all (`NO_PAINTED_LAYERS`, `NO_NEAR_LAYER` in `arena-scenery.ts`).
- Background `#080515` (dark blue-purple), `THREE.Fog` same colour 26–74 m, dimmer lilac light: `arenaLight('kwaioua_forest')`
  with the new optional `background` / `fog` fields, applied by `arena-runtime.ts` when the region changes.
- ~1,400 stars: `ArenaScenery.buildStars` (`THREE.Points`, dome r = 330 m, `fog: false`, denser near the horizon).
- 9 giant standing trunks with buttress roots ("sapopemas"): procedural kind `trunk` (`trunkGeometry()` in `arena-props.ts`,
  30 m × size 1.15–1.7, `even: true` spacing, slight random lean, **no canopy** — it is above every framing).
- Modelled bushes from `assets/arena/props.glb`: `shrub` (170 low clumps 0.7–1.5 + 90 "small trees" 1.9–3.3; the 40/24
  nearest the grid ×2 via `grow`), `fern`, `tuft`, `stump`, `mossrock`; procedural `bush`, `rock`, `twig`, `leaf`, `pebble` kept.
- Estimated ~350k instanced triangles (other regions ~30k). FPS not measured; mobile not checked.

**caete v2 (done, approved, merged 2026-11-27):** a misty *day* rainforest. Background/fog `#a7bca9` 7–56 m (the
mist reaches into the battle), no stars (`ArenaLight.stars`), mossy giant trunks (7 near, 14 in the mist), procedural
`bigleaf` (tropical rosette) and `sprout` (ankle-low ground cover allowed in the battle band), dense undergrowth in
`BEHIND`, plus `arena-atmosphere.ts`: drifting mist wisps and slow glowing motes ("seres de luz"). ~407k tris.
User feedback: "adiciona mais das plantas rasteiras/arbustos, muito mais", "deixa a fog invadir a batalha",
"partículas flutuando muito lenta e suavemente, tipo seres de luz" → then "amei". Next region: forest_ruins.

**All regions v2 (2026-11-27, branch `feat/arena-v2-regions`, one commit per region, NOT merged — awaiting the
user's approval of `debug-logs/arena-v2-prints/`):** the user asked to bring every region to the caete standard
autonomously overnight. forest_ruins (golden forest ruin, sun beams), green_grounds (sunny meadow, sky dome, hills),
menace_hills (dusk dry hills, crags), wastelands (cold waste, snowy peaks, falling snow), ipora_beach (3D sea, palms,
shells/starfish), gods_bridge (sunset dome with a 3D sun, hills across the river), kwaioua_forest (fireflies, fog into
the battle, sprouts). When approved: merge `feat/arena-v2-regions` into local `main` (no push). If the user wants changes
for a region, adjust on the branch and re-shoot that region only.

## The user's taste (learned by iteration — follow it)

- Liked: giant buttressed trunks very close to the arena (only the trunk visible), dark sky, stars, purple tint,
  lots of bushes and "small trees without a trunk" (the Avramania bush model, scaled up) around the grid.
- Disliked: long thin-trunk trees ("não quero mais dessas"); painted layers cutting the scene; props drawn over paintings;
  height-only stretching (grow **uniformly**).
- Wants quick prints ("traga o print rápido") and short iterations; shoot one region, show, adjust.
- Front view (`walk_*`, battle shots) matters most; orbit (`orbit_*_l/_r`) must hold up too.

## Technical map

| What | Where |
|---|---|
| Painted layers, per-region flags, lights/background/fog, stars, bridge | `apps/frontend/src/app/features/play/arena/arena-scenery.ts` |
| Background colour + fog applied on region change, render loop | `arena-runtime.ts` (`apply`, `ARENA_SKY_COLOR`) |
| Prop specs per region (kind, count, colours = per-instance tint, size, depth bands, `even`, `grow`) | `arena-prop-layout.ts` (`PROPS`, bands `BEHIND`/`FRONT`/`DEEP`/`EDGE`/`ALL`) |
| Procedural geometries, instancing, model loading, shrink guard | `arena-props.ts` (`geometryOf`, `trunkGeometry`, `loadModelGeometries`, `nearLayerScale`) |
| Model bake pipeline | `tools/arena-assets/build-arena-props.mjs` (`PROP_MODELS`) → `apps/frontend/public/assets/arena/props.glb` |
| Painted art generator (sky/far/near/ground webp) | `tools/arena-assets/build-arena-art.mjs` |
| Credits | `tools/arena-assets/CREDITS.md` |
| Screenshot harness | `tools/arena-assets/preview/shoot-arena.mjs` + `arena-entry.ts` (shots `walk_<region>`, `orbit_<region>_l/_r`, `solo_approach` (kwaioua), `solo_close` (ipora), `party_fight` (menace), `party_status` (wastelands), `bridge_fight`/`orbit_bridge` (gods_bridge), `ruins` (forest_ruins), `caete`) |
| Specs | `arena-scenery.spec.ts`, `arena-props.spec.ts`, `arena-terrain.spec.ts` (layout rules: standing props outside the flat band |z| > 13.5; every region has a rock/block) |

Rules that bit this session (also in `ENGINEERING_NOTES.md`, last section):
- Transparent meshes always draw after opaque ones. Foliage with `alphaMode: BLEND` → convert to `alphaTest` first.
- Props for a modelled kind need: an entry in `PROP_MODELS`, the kind in `ArenaPropKind` + `MODEL_PROPS`, a rebuild of
  `props.glb`. The region's `pending` waits for `props.glb` (map fade).
- Night fog hides everything past ~45 m from the default camera: props deeper than that only cost triangles.
- The scenery group follows the camera in x; props scroll with `travelled` over an 180 m period (`ARENA_PROP_PERIOD_M`).
  Anything in the `FRONT` band (z 15–26) sits between the camera and the grid: keep it low.
- A region that still has a `near` layer keeps the shrink guard (`layerDistance` 22); one without painted layers uses `Infinity`.

## Assets available

Downloaded to `tools/character-assets/source/arena-props/` (gitignored; authors/licences/URLs in `sources.jsonl`,
thumbnails in `contact.png`). Re-download with the Sketchfab token in `~/.sketchfab_token` (`GET /v3/models/{uid}/download`,
~8 s between calls) if the folder is missing.

| File | Tris | Licence | In props.glb | Fits |
|---|---|---|---|---|
| avr-bush (`shrub`) | 750 | CC0 | yes | everywhere (tint per region) |
| avr-fern (`fern`) | 468 | CC0 | yes | forests, ruins |
| avr-grass (`tuft`) | 330 | CC0 | yes | everywhere (tint green / dry) |
| avr-flowers (`flowers`) | 644 | CC0 | yes | green_grounds |
| avr-stump (`stump`) | 1178 | CC0 | yes | forests |
| avr-deadtree (`deadtree`) | 1486 | CC0 | yes | wastelands, menace_hills |
| avr-rock-mossy (`mossrock`) | 580 | CC0 | yes | forests, ruins |
| coconut-tree | 678 | CC-BY | no | ipora_beach |
| tropical-plant | 708 | CC-BY, **BLEND** | no | caete |
| monstera | 336 | CC-BY, MASK | no | caete |
| dead-bush | 114 | CC-BY, untextured | no | wastelands |
| grass-pack | 130 | CC-BY, untextured, 4 meshes far apart (pick one) | no | dry grass |
| bush-test | 200 | CC-BY, MASK, realistic | no | dry bush (style clash risk) |
| pine-bushes | 1052 | CC-BY, **BLEND**, realistic | no | (style clash risk) |

The Avramania "Low Poly Medieval, CC0" series on Sketchfab has more nature pieces (Oak, Birch, Pine, Pine Sapling,
Oak Sapling, Boulder, Log, Pebbles, Cliff…) in the same flat style. CC-BY ones need a `CREDITS.md` line when used.

## Per-region starting points (what each painted near/far layer shows today)

| Region | near (to replace) | far | Idea for v2 (to confirm with the user) |
|---|---|---|---|
| caete | ferns + dark bushes | dense forest with mist | closest to kwaioua: night/mist forest, monstera/tropical-plant, giant trunks? |
| forest_ruins | ferns, grass, stones | forest | trunks + mossrock + ruin blocks, ferns |
| green_grounds | round bushes + grass blades | green hills with trees | daylight: keep a sky? bushes, flowers, tufts, Avramania Oak/Birch |
| menace_hills | rocks + dry grass | brown hills | dry tufts, deadtree, boulders |
| wastelands | grey rocks + dry grass | rocky waste | deadtree, dead-bush, dry tufts |
| ipora_beach | coconut palms + bushes | sea/horizon | coconut-tree, bushes; the sea is the far layer — keep it? |
| gods_bridge | birds only | distant bridge, hills, sunset water | probably unchanged (no props; river/parapet are 3D already) |

Open question for each daylight region: kwaioua solved the background by going night (dark colour + fog + stars).
A day region needs a sky — e.g. keep only the painted `sky` (opaque, 120 m, nothing reaches it) plus fog in the sky's
horizon colour, and drop `far` + `near`. Show the user one region first.

## How to verify

- `pnpm --filter @nanommo/shared build` first if `packages/shared/dist` is stale.
- Shots: `node tools/arena-assets/preview/shoot-arena.mjs debug-logs/<dir> walk_<region> orbit_<region>_l <battle shot>`
  (~1 min per shot, software WebGL; one region per run). Stitch the PNGs into one image to show the user.
  Do not run Karma at the same time: `arena-performance.spec.ts` (pure-JS timing) fails under CPU load.
- Karma arena: from `apps/frontend`, `CHROME_BIN=/snap/bin/chromium npx ng test --watch=false --browsers=ChromeHeadless --include='src/app/features/play/arena/**/*.spec.ts'` (176 specs); full suite (703).
- `pnpm --filter @nanommo/frontend build --configuration production`.
- After changing `PROP_MODELS`: `node tools/arena-assets/build-arena-props.mjs`.

## Conventions

Branch per change, merge into local `main`, **no push** (the user pushes; `main` deploys). Dated `STATUS.md` entry with
exactly what was validated; traps in `ENGINEERING_NOTES.md`. Reply in Portuguese.

## Prompt for the next session

```
Leia docs/handoff/2026-11-27-arena-3d-scenery-v2.md e continue a v2 do cenário da arena nas outras regiões,
no estilo aprovado da kwaioua_forest (tudo 3D, sem camadas pintadas cortando a cena).

Comece por caete (a mais parecida com kwaioua). Antes de codar, me mostre em poucas linhas o plano visual da
região (fundo/céu, luz, árvores, arbustos, modelos que vai usar dos baixados ou novos a baixar) e pergunte o que
for decisão minha. Depois itere rápido: implemente, tire os prints (walk_caete, orbit_caete_l e o tiro de
batalha da região), me mostre juntos numa imagem e ajuste pelo meu feedback. Só passe para a próxima região
quando eu aprovar a atual.

Cuidado com desempenho (kwaioua já tem ~350 mil triângulos): diga a estimativa por região e corte o que a
neblina ou o enquadramento escondem. Ao fim de cada região aprovada: specs da arena, suíte Karma completa,
build de produção, entrada no STATUS.md, commit numa branch e merge na main local, sem push.
```
