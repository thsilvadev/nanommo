# Design

Source documents: `docs/superpowers/specs/2026-11-17-cidade-viva-design.md` (approved design) and `docs/superpowers/plans/2026-11-17-cidade-viva.md` (implementation plan).

## Movement is a pure function, not a simulation

`positionAt(def, nav, {seed, sleeping, wakeFrom}, tMs)` (`packages/shared/src/town/town-wander.ts`). Time is cut into legs of `TOWN_LEG_MS = 24000` aligned to a global epoch with a per-seed phase. Leg `k` walks from `dest(k-1)` to `dest(k)` and waits there facing the POI's `lookAt`. `dest(k)` depends only on `(seed, k)`:

- PRNG per leg: `new Mulberry32(mulberry32Seed("seed:salt:k"))` — O(1). `rngForIndex(seed, k)` advances k steps and k ≈ epochMs/24000, so it is not used here.
- POIs are weighted; consecutive legs never share one (even legs pick freely, odd legs exclude both even neighbours).
- 25 % of legs are short strolls within 6 u of the previous leg's POI point.
- Offsets are drawn in a square and rejected outside the disc (no trigonometry), and rotated rectangles use exact cos/sin for multiples of 90°, so the walk grid and poses are identical on every JS engine.
- Paths: Dijkstra distance fields per target cell (8 neighbours, √2 diagonals, no corner cutting), descended and string-pulled with an exact grid traversal for line of sight. Fields and paths are cached.
- Sleep freezes the pose at `sleeping.at`. Waking sets a new seed and `wakeFrom = {x, z, at}`; the wake leg starts from there (or the next leg, when less than half a leg remains).

## Roster: Postgres decides presence, Redis keeps town state

Presence is `currentMapId` is a Town scene AND `travelIntent IS NULL` AND `pendingMapTransition IS NULL`, online or offline. Redis keeps only Town state (`town:state:{mapId}` → `{seed, sleeping, wakeFrom, lastSeenAt}`, `town:where` → mapId). A character with no stored state gets a lazy, deterministic one (seed from `characterId`, asleep since `lastSeenAt`), so no backfill or migration is needed.

`syncCharacter(id, previousMapId?)` is idempotent and is called after commit wherever a character may enter or leave a Town: map presence sync (arrivals/transitions), `MapService.travel` (trip start/cancel) and the party outbox publisher (party trips, moves, arrivals). `previousMapId` is tri-state (a map id / `null` = not in a Town / `undefined` = unknown, never re-join a lazy entry).

Socket presence: connect → wake, disconnect → sleep. A disconnect from a socket that is no longer the character's current one (fast refresh) is ignored entirely.

Deltas share the map-presence pub/sub channel tagged `kind:'town'` and are re-emitted to `map:{mapId}`. Nothing is sent per tick.

## Rendering

One `WebGLRenderer` per Town scene; three.js and the runtime are a lazy chunk created through `TOWN_SCENE_ENV`. Town characters are light clones of one prepared template body per sex (shared geometry, no per-face deformation — invisible at Town distances), with their own material, a 256 px skin per (sex, skin tone) from `CharacterAssetCache.skinTexture`, cloned hair, and an `AnimationMixer` playing `Idle` / `Walk` / `Dead`. Asleep characters hold the last `Dead` frame with the mixer stopped; characters far from the camera or off-screen animate at 10 Hz and hide their name plate. Only the main light casts shadows (1024 map); character shadows can be switched off with `TOWN_CHARACTER_SHADOWS`.

`CharacterAssetCache` shares raw files (glTF, images, the animation library) between every viewer and the Town; anything a character mutates comes from `body(sex)`, which returns a new instance each call.

## Server clock

`time:sync` acks `{serverNow}`; the client keeps the median of 5 samples of `serverNow + RTT/2 − local`, seeded by the roster's `serverNow`. `ping` stays a plain keep-alive.
