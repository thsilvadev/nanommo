# Design

## Sleep

`TownState` in Redis gains `sleptByCommand`. `/sleep` sets it; `setOnline()` now only updates `lastSeenAt` and `online`. A stored state with `sleeping` but without `sleptByCommand` predates this change (offline sleep): `parseState()` turns it into `{sleeping: null, wakeFrom: pose at sleeping.at}` — deterministic, so every client shows the character standing up where it lay and walking on. Lazy states (no Redis entry) are awake.

## Selection

`TownStore.selectedCharacterId` (cleared on map change/leave); `selectedCharacter` is derived from the live roster, so a player who leaves simply disappears from the card. `VendorStore.selectNpc(id)` clears the selected player; selecting a player calls `selectNpc('')`. `MapBoard.townSelection` derives one `TownPick` (player first, else the selected NPC) and passes it to the scene, which forwards it to `TownRuntime.setSelection()`; each `TownCharacter` adds/removes a blue ring (same geometry as the gold self ring, slightly larger and higher).

The avatar card reuses `CharacterViewerComponent` with a fixed `{ base: 'Idle' }` animation and `portraitHandTypes()` over the roster's hand item ids.

## Switching and preload

The inactive view was unmounted: going back to the Town recreated the renderer, the world, every NPC (outfits, recolouring, props) and every character. Now `<app-town-scene>` lives for as long as the character is in a Town; `active=false` hides it (`visibility: hidden`, so it keeps its size) and stops the RAF loop. `TownSceneEnv.preload` → `preloadTownScene()` runs once per page from `PlayComponent` on the first `connected` (in `requestIdleCallback`). Persistence across reloads is left to the HTTP cache (`vercel.json`): `immutable` for hashed bundles, 1 day + 7 days stale-while-revalidate for `/assets/character|npcs` (unhashed names, so not immutable).

## Roofs

The old roof was a 4-sided cone rotated 45° and then scaled non-uniformly: the scale applies in the cone's rotated frame, so any non-square house got a rhombus roof. New geometry is built on the rectangle itself: a hip roof (ridge along the long side, `a − b` long) or a gable roof with wall-coloured gable ends. `houseVariation()` is seeded by the house position (`Mulberry32('house:x:z')`).

## Costume pin

`pin()` used the bone's world position as a model-local position. It only worked while the model sat at the origin; since outfits are dressed asynchronously, the NPC is already placed in the town, and the piece landed at twice its spot. It now aims in world space and converts with `model.worldToLocal()`.
