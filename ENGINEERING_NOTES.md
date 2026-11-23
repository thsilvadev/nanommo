# Engineering Notes — NanoMMO

Permanent, append-only reference of hard-won technical traps and lessons from
`STATUS.md` sessions. Re-read only when a new bug falls in the same class
(JWT claims, ownership/IDOR, cwd, TypeORM `undefined`, idempotence, etc.).

Last session that added entries: 2026-11-19.

---

## 4.1 JWT claim mapping — absolute rule

The JWT carries **`userId`**, never `characterId`. Every controller must do:

```typescript
const character = await this.characterService.getCharacterByUserId(req.user.userId);
```
```typescript
// WRONG — always undefined
const characterId = req.user.characterId;
```

`GambitController` centralises this in a private `requireCharacter(req)` helper so no route
can forget it. Any new controller should reuse that shape.

## 4.2 Ownership must be enforced in the **query**, not in the controller

A bare `findOneBy({ id: pageId })` followed by a controller-level `if` is one refactor away from
being an IDOR. `GambitService` scopes every lookup with `{ id, characterId }` so ownership is part
of the predicate, and returns **404 (not 403)** — a 403 confirms the row exists.

## 4.3 The backend cwd is load-bearing

`DataService` resolves data files as `path.join(process.cwd(), '../../')`. Run from the repo root
and it looks in `/` and every getter silently returns `null`. **cwd must be `apps/api`.**
`char_xp_curve.json` is at the repo root, not `apps/api/src/data/`.

## 4.4 Verify the runtime value, not the file

The XP curve is read with `fs.readFileSync` at boot, so it cannot go stale — but the compiled
*code* could. Booting the real `DataService` class from `dist/` through a Nest application
context and calling `getXpToNextLevel()` is the only check that proves what actually loads.
Also confirmed there is no compiled JS in `src/` (`find apps/api/src -name '*.js'` → empty), so
the "Compiled JS in src/ vs dist/" trap from a previous session is not currently active.

## 4.5 TypeORM skips `undefined` columns on save

`character.currentMapId = undefined` is silently dropped, leaving a dead character still assigned
to a map. **Use `null`, not `undefined`.** This is why `handleCharacterDeath` sets
`character.currentMapId = null as any`.

## 4.6 A missing DB value in psql is a `NOT NULL` violation, not a NULL

Querying a column that does not exist, or a NOT NULL column with no row, produces a bare
`ERROR: unterminated quoted string` / `null value in column ... violates not-null constraint`
that looks like a shell quoting bug. **The DB columns are camelCase** (`"characterId"`,
`"mapKillCount"`, `"hpCurrent"`), never snake_case — a snake_case query silently fails and costs
real time. Always `psql` the error out; a 500 only tells you what the filter stripped.

## 4.7 `resolveBattle()` must be idempotent before you add any second caller

Effects were applied first and `resolved = true` set last, so any second delivery of the same
battle (BullMQ retry, or the §7.5 recovery pass) paid everything twice. The fix is a
**conditional claim** before any mutation:

```typescript
const claimed = await repo.createQueryBuilder().update(BattleQueueEntry)
  .set({ resolved: true })
  .where('"id" = :battleId', { battleId })
  .andWhere('"resolved" = false')
  .execute();
if (!claimed.affected) return;   // someone else already did it
```

## 4.8 You cannot `remove()` the BullMQ job you are currently executing

`job.remove()` inside its own handler throws "Job is locked". Guard on
`(await job.getState()) !== 'active'`. A `NotFoundException` from the processor should be a clean
discard, **not** a retried error — §7.6 legitimately deletes rows.

## 4.9 A character with no active gambit page never attacks

§7.3 treats an unmatched line as a *wasted* gauge fire, so a fresh character with no activated
gambit does nothing for the full 200-tick cap, and
`outcome = foe.hp <= 0 && self.hp > 0 ? 'win' : 'loss'`
(`packages/shared/src/battle-engine/index.ts:874`) scores the stalemate as a **loss**. Any E2E
must set and activate an `always → attack` page first, or it will look like an XP/queue bug.

## 4.10 Two param shapes for the same gambit concept

`gambit_catalog.json` and live payloads write `{ id, band }` inline; SPEC §8.2 writes
`{ id, params: { band } }`; `monsters.json` writes a third shape
`{ condition: { type, value }, action: { type } }`. The validator mirrors
`GambitEvaluator.readParams()` so **both** player shapes are accepted — rejecting the nested form
would reintroduce the exact silent-failure class of the `drop.dropRate` vs `drop.chance` bug.
**Any new data-file consumer must be tested against the real file contents.**

## 4.11 Food automation is outside Gambits

The obsolete `self_hungry` condition was removed from the shipped Gambit catalog. Food remains a generic `use_item` action, while automatic feeding is handled by the server-authoritative Diet/Auto Feed system. Do not reintroduce a Gambit condition as an Auto Feed substitute.

## 4.12 DTOs without class-validator decorators pass through the ValidationPipe

`SpendAttributePointsDto` has none, so the global `ValidationPipe` in `main.ts` does nothing and
`undefined` reaches the service. Guard in the service and throw `BadRequestException`, not a bare
`Error` — a bare `Error` is a **500**. `gambit.service.ts` previously threw bare
`new Error('Character not found')` on every path; those are now `NotFoundException`/`BadRequestException`.

## 4.13 Two implementations of the same rule

`CharacterService.gainXp()` and the inline loop in `BattleService.resolveBattle()` both implement
level-up. Only the latter runs. Only the latter was fixed for §6.3. When fixing a rule, grep for
every copy first. **Update:** as of 2026-09-27 the dead `CharacterService.gainXp()` was deleted
(see §5), so §6.3 level-up now has exactly one implementation at
`battle.service.ts:436-473`.

## 4.14 Battle durations are wall-clock; a 5-battle chain takes minutes

`endAt = startAt + durationTicks * 1000ms`, and a 5-battle chain is sequential and back-to-back.
A test that polls for 120 s will miss the resolve. Check `endAt` against `now()` in SQL before
choosing a timeout.

## 4.15 Test environment (no Docker, no sudo)

```bash
# PostgreSQL 16 — fresh cluster, no root needed
/usr/lib/postgresql/16/bin/initdb -D /tmp/kilo/pgdata -U nanommo --auth=trust
/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/kilo/pgdata -o "-p 5432 -k /tmp/kilo" -l /tmp/kilo/pg.log start
psql -h 127.0.0.1 -p 5432 -U nanommo -d postgres -c "create database nanommo;"

# Redis 7.2.5 — built from source into /tmp
curl -sSL -o redis.tar.gz https://download.redis.io/releases/redis-7.2.5.tar.gz
tar xzf redis.tar.gz && cd redis-7.2.5 && make -j"$(nproc)" MALLOC=libc
/tmp/kilo/build/redis-7.2.5/src/redis-server --port 6379 --daemonize yes --dir /tmp/kilo/redis --logfile /tmp/kilo/redis.log

# Backend — cwd MUST be apps/api, NODE_ENV=development enables synchronize:true
cd apps/api
set -a; . /tmp/kilo/test.env; set +a
node dist/apps/api/src/main.js
```

`NODE_ENV=development` is required for `synchronize: true` in `app.module.ts`.

---

## 4.16 `requeueBattlesAfterLevelUp()` race condition — production mitigations and future triggers

**Bug**: `requeueBattlesAfterLevelUp(characterId)` has no internal concurrency guard. If invoked twice in parallel for the same `characterId`, both calls execute the full `DELETE` (all unresolved queue entries) + `queueBattles()` (rebuild 5-deep chain) sequence. The second call's `DELETE` removes the first call's newly created entries, so the final state has 5 entries (not 10), but the work is done twice. No unhandled errors, no duplicate final entries, but race condition exists. Discovered via artificial `Promise.all` test calling the private function directly.

**Two premises that prevent this from firing in production today:**

1. **Single-threaded call paths (observed/tested in code):**
   - BullMQ Processor uses default `concurrency=1` — `@Processor('battle-queue')` at `battle-queue.processor.ts:11` with no concurrency parameter; `BullModule.registerQueue` at `battle.module.ts:28-37` does not set `defaultJobOptions.concurrency`. Only one `resolve-battle` job runs per worker process at a time.
   - Recovery pass uses sequential `for...of` with `await` at `battle-recovery.service.ts:77-80` — each `resolveBattle()` completes before the next starts. No `Promise.all`/`Promise.allSettled`.

2. **Atomic claim in `resolveBattle()` (inferred by analogy, not reproduced with real dual-worker test):**
   - `resolveBattle()` at `battle.service.ts:371-380` uses a conditional `UPDATE ... WHERE resolved=false` to claim the battle row atomically. If multiple workers in *separate processes* somehow pick up the same battle, the second sees `affected=0` and returns early. This protects XP/gold/drops idempotency (ENGINEERING_NOTES.md §4.7), and by extension would prevent double `requeueBattlesAfterLevelUp()` since it's called from inside `resolveBattle()` after the claim. **This path has never been exercised with a real test of two concurrent workers.**

**Future trigger warning — re-read this entry before any change that:**
- (i) Sets processor `concurrency > 1` (e.g., `@Processor('battle-queue', { concurrency: 5 })`)
- (ii) Parallelizes the recovery pass loop (e.g., `Promise.all(stale.map(...))`)
- (iii) Creates a new code path calling `requeueBattlesAfterLevelUp()` or `resolveBattle()` outside the two mapped callers (`battle-queue.processor.ts:33` and `battle-recovery.service.ts:79`)

---

## 4.17 `CharacterRig` = one WebGLRenderer per instance

`CharacterRig` (portrait, creator) creates its own `WebGLRenderer`, scene and camera per character. It is fine for one or two viewers and wrong for crowds: browsers cap live WebGL contexts (~16) and drop the oldest. Anything that shows many characters (the Town scene) must render them in one shared scene (`features/play/town-scene/town-runtime.ts`) and share assets through `CharacterAssetCache`. A `BodyAsset` is mutable (deformed vertices, skin canvas, single-parent root, mixer): never hand the same instance to two consumers — `CharacterAssetCache.body(sex)` returns a new one per call; only raw files are shared. A rig's `dispose()` must free only what it owns (never `ImageBitmap.close()` a cached image).

## 4.18 The Town roster includes offline characters

Town presence is **not** socket presence: the roster lists every character whose `currentMapId` is that Town and who is not travelling, online or offline (offline = asleep). Do not use it for "players online" — the indicator above the chat still uses `chat:connectedUsers` / online presence. Any new code path that starts or ends a trip, or moves a character in or out of a Town, must call `TownRosterService.syncCharacter(id, previousMapId)` after commit, or viewers keep a frozen character until they resync. `previousMapId` is tri-state: a map id, `null` (certainly not in a Town) or `undefined` (unknown — never re-joins a lazy entry, which would teleport it to the spawn).

## 4.19 `ping` is not a clock

The gateway `ping` handler is a plain keep-alive returning `'pong'`; it carries no time. Client code that needs server time (Town movement) must use `ServerClockService` (`time:sync` acks `{serverNow}`). Also: `rngForIndex(seed, k)` forks by advancing k steps — O(k). Never call it with epoch-derived indices (Town legs use a hash-seeded `Mulberry32` per leg instead).

## 4.20 Socket refresh race

A page refresh can connect the new socket before the old one's `disconnect` runs. Gateway `handleDisconnect` must ignore a socket that is no longer `connectedSockets.get(characterId)`; otherwise it clears online presence and Redis subscribers of the live socket (and, for Towns, puts a connected character to sleep).

## 4.21 The Town walk grid is 2D: footprints must include stairs, and nothing climbs

`TownNav` rasterises footprints on one 2D grid. A `balcony` blocks its `w×d` platform **and** its stairs strip (2 u wide, `TOWN_STAIRS_LENGTH` = 2.5 u, on the `stairs` side in the local frame before `rot`: e = +x, w = −x, s = +z, n = −z). An NPC with `y > 0` is drawn on the platform but its spot is a blocked cell: the validator checks the balcony's stairs foot instead (free, reachable, POI within 3 u). Grid cells are blocked by their centre, so a stairs foot exactly on a cell edge can land inside a neighbouring house — check it with `node scripts/validate-town-scenes.js`.

## 4.22 NPC outfits and costume pieces: bind space, not the posed bone

- Outfit meshes from `/assets/npcs/outfit-*.glb` must be rebound to the body's bones **by name** (`new Skeleton(ourBones, outfit.boneInverses)`); a plain `clone()` of a skinned mesh keeps drawing at its source bones (this also applies to skinned pack props like the chest — use `SkeletonUtils.clone`).
- Pin costume pieces in the bone's **bind** space (`boneInverses`), not from the bone's world position in the Idle pose: Idle tilts the head and torso, and offsets measured on the bind pose land wrong. Head pieces start from the eyes' centre (`Eyes` mesh bounds).
- The catalogue's mustache and other facial overlays are painted on the face texture by the portrait compositor; the Town does not compose them.
- Recolouring textures runs on the main thread when a Town opens: keep it byte math on a small canvas (512 px) and cached; `THREE.Color` per pixel over 1024² textures cost seconds.

## 4.23 Pinning to a posed bone: aim in world space, then convert to the model's frame

`bone.getWorldPosition()` is a world position. Assigning it to a child of the model only works while the model sits at the origin with no rotation. NPCs are dressed asynchronously, after they were placed in the town, so a piece set that way landed at twice the NPC's spot (William's backpack floated outside Caelum). Compute the world target, `model.add(piece)`, then `piece.position.copy(model.worldToLocal(target))`, and only then `bone.attach(piece)`. Do not premultiply the model's world rotation into a piece that is already its child.

## 4.24 Non-uniform scale after rotation skews primitives

`Object3D` applies scale in its own (rotated) frame: a 4-sided cone rotated 45° and scaled differently in x/z is a rhombus, not a rectangle. Build the shape on the target rectangle instead (see `hipRoofGeometry`).

## 4.25 `vercel.json` header sources are path-to-regexp, not regex

`(?:…)` and escaped dots inside an unnamed group throw "Invalid group". Use a named parameter with a custom pattern (`/:file(chunk-.*|main-.*)`) and check new sources with `path-to-regexp@3` (in `node_modules/.pnpm`) before pushing: an invalid source fails the Vercel deploy.

## 4.26 Town occlusion must be checked in perspective

The town camera has a low FOV but is close (18–70 u): a parallel-ray check (from the NPC along the view direction) passed an Aramaia NPC that a 7 u pillar hid at the closest zoom with the camera panned 1.5 u away. `npc-occlusion.ts` casts rays to real camera positions over a grid of panned targets at both zoom limits; use it (via `npc-occlusion.spec.ts`) whenever an NPC spot or a tall obstacle moves.

## 4.27 Anything that freezes a Town pose must anchor it

`/sleep` and emotes hold `positionAt(stateWithoutIt, at)`. If the write that ends or changes them also replaces the state underneath (a new seed, a cleared `move`), the "held" point is recomputed from a different history and the character teleports. Write an anchor `move` from the current pose to itself (see `TownRosterService.emote`), or carry the pose into `wakeFrom` (see `wakeState`).

## 4.28 The UAL sitting clip is a chair pose

`Sitting_*` in the Universal Animation Library keeps the thighs level at ~0.56 m with the pelvis 0.34 m behind the feet. Played on open ground, the character sits in the air. `/sit` adds a stool (top 0.46 m, 0.25 m behind; measured by forward kinematics on `body-*.glb` + `animations.glb`). Re-measure if the clip or the bodies change.

## 4.29 Character assets outlive deploys in the browser

`/assets/character/*` and `/assets/npcs/*` are cached for a day plus a week of stale-while-revalidate (`vercel.json`), so after a deploy players run new code against old asset files. Code must tolerate the previous version of an asset (a new clip is optional, never required), and a rebuilt file must be requested under a new URL (`ANIMATIONS_ASSET = 'animations.glb?v=N'`: bump N). Requiring the new `Dance`/`Sit` clips made every body fail to load for anyone with the old `animations.glb` cached.

## 4.30 Anything that ticks inside the Angular zone re-checks the whole app

zone.js turns every `setInterval`, `setTimeout`, `requestAnimationFrame` and DOM listener callback run inside the zone into an app-wide change detection, and most components are not `OnPush`. A render loop created in the zone cost 60 full checks per second. Start loops, polls and high-rate listeners with `NgZone.runOutsideAngular` and expose what the UI needs as signals. For wall-clock UI, read `UiClockService.now` instead of adding a timer. Regression tests: `town-scene.component.spec.ts`, `ui-clock*.spec.ts`.

## 4.31 Methods in `*ngFor` must not build new objects on every call

`*ngFor` without `trackBy` tracks by identity. A template method that returns fresh objects (`itemTooltipLines` used to) makes Angular destroy and recreate those DOM nodes on every change detection pass, even for hidden tooltips: 332 nodes per pass for a 40-item inventory. Memoize (see `CatalogService.memoTooltip`), use a `computed`, or track by index/id. `inventory-grid-performance.spec.ts` asserts zero DOM mutations for an unchanged pass.

## 4.32 Never animate elements that carry a CSS `filter`

A `filter` (blur especially) on an element whose transform animates is re-rendered every frame, and in Firefox it also keeps the animation off the compositor. The fog of war (~300 blurred, animated layers) cost ~40% of a core with the map open and ran at ~8 fps in software compositing. Bake the filtered result into an image once (`fog-sprites.ts`) and animate the image.

## 4.33 Component stylesheets have a hard 6 kB budget

`angular.json` fails the production build (and so the Vercel deploy) when any component stylesheet passes 6 kB. `map-board.css` is at the limit: put new map-board rules in `styles.css`, scoped under `app-map-board`.


## 4.34 Gear skinned meshes must keep the body's joint order

`gear-merge.ts` copies `skinIndex` from `gear-<sex>.glb` straight onto the body's skeleton. The gear build (`tools/character-assets/gear/lib/skeleton.mjs → writeSkeleton`) writes our 65 joints in the order of `body-<sex>.glb`'s skin; if the body files are ever rebuilt with another joint order, rebuild the gear too or every piece binds to the wrong bones.

## 4.35 Never dispose gear geometry or materials from a character

`mergedGearGeometry`, `visibleBodyGeometry` and `gearMaterial` return objects cached page-wide and shared by every character wearing the same set (that is what keeps a 200-player town at +0.25 draw calls per character). Removing a character only removes its `Gear` mesh; disposing its geometry or material blanks every other character.

## 4.36 Bump `GEAR_ASSET_VERSION` and rebuild the gear together

`/assets/character/*` is cached for a day plus a week of stale-while-revalidate. The GLBs and the atlas are cache-busted by `manifest.version` (a content hash, including transforms), but the manifest itself is fetched with `?v=GEAR_ASSET_VERSION` (`gear-manifest.ts`): bump it whenever `node tools/character-assets/gear/build-gear.mjs` changes `manifest.json`, or clients keep the old manifest pointing at hashes that no longer exist.

## 4.37 Shells hide the skin under them by band, not by region

Boot liners and the knee-to-mid-shin legging sit 2 mm off the skin; without hiding the skin under them they z-fight. The manifest carries per-sex `hide` bands (`{ region: 'calves', minY, maxY }`, bind-pose heights) and the runtime rule is: a vertex hides if its region is covered or it lies inside a band (a calves band also takes the knee's thigh vertices); a triangle hides when all three vertices do. Never simplify a shell: any simplification error lets the skin poke through.

## 4.38 The gear atlas must stay near-lossless

Lossy WebP subsamples chroma (4:2:0) and smears small flat-colour swatches into their neighbours: the Dark Knight's black armour turned teal. `encodeAtlas` uses `nearLossless`; `gear/test/build.test.mjs` checks those colours on the real build.

## 4.39 GLTFLoader renames duplicate node names

Three bows in `gear-rigid.glb` all have a `BowString` child; after loading they are `BowString`, `BowString_1`, `BowString_2`. Find the string with `bowString()` (prefix match), never `getObjectByName('BowString')`.

## 4.40 Gear sources need a Sketchfab token

`node tools/character-assets/gear/fetch-sources.mjs` downloads the Sketchfab models with the API token in `~/.sketchfab_token` (never in the repo). Every non-CC0/CC-BY source must be listed in `UNLICENSED_ASSETS_README.txt` (the build regenerates it).

## Music promise/fade ownership — 2026-11-22

Do not use a shared boolean cleared by every asynchronous `audio.play()` completion: an old map's promise can release a newer track's pending guard. Compare the audio element identity before clearing it. All music fades, including stop fades, must share the same cancellable frame owner. Volume changes must stop the outgoing crossfade element too; changing only the current element allows old music or captured fade values to escape Settings. The music transition tests use manually advanced RAF frames and deferred play promises to cover these races deterministically.

## Durable action feedback and stale confirmations — 2026-11-22

- A root tracker outlives editors. A local request flag is not proof that the currently mounted editor knows its saved draft; maintain per-instance request identities when restoring queued Gambits.
- Confirmation must bypass GET coalescing: a resource request started before terminal acknowledgement can return the pre-action snapshot. Compare returned character/inventory revisions with installed revisions before dismissing indicators.
- Do not discard an applied attribute response merely because an older resource event advanced a local request generation. Server stateVersion determines ordering.
- Cache terminal HTTP results against delayed pending-list responses. Unknown network outcomes keep the same idempotency key; absence from a bounded history is not success. All active-page changes share one conflict domain.

## 3D viewer inputs must compare by value — 2026-11-23

Realtime snapshots replace `character`/`inventory` objects on every battle, so anything derived from them (`appearance`, `portraitEquipment()`, hand types) is a new reference each time even when nothing changed. `CharacterViewerComponent.config` compares structurally (`sameConfig`); any new viewer input must stay JSON-serializable, or the comparison must learn about it. Otherwise each snapshot rebuilds the whole model (skin canvas, deformation, gear) and the grind freezes.

## Stance changes invalidate activity search reservations — 2026-11-23

Rebuilding `BattleQueueEntry` rows is insufficient when a solo `encounter_clocks` reservation survives. Gathering may project many avoided candidates before reserving an actual battle minutes ahead; Hunting then inherits that deadline through `reservedEncounter`. Cancel only a real stance change with no started encounter, inside the existing character lock and transaction. Ordinary loadout edits and repeated same-stance clicks retain their search identity. Regression uses the real queue generator and clock service, with a ten-minute reservation, and verifies normal Hunting timing, immutable active fights and Gathering journal delivery. The Gathering gauge remains valid in Hunting too.

A failed town gear download must not set `dressedKey`. Keep the prior outfit and let an identical later roster update retry; only completed dressing (or an intentional empty outfit) settles the key.
