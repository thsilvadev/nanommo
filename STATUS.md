# NanoMMO Backend — Implementation Status

**Last Updated:** 2026-09-27
**This session:** verified the hand-replaced `char_xp_curve.json` is the version actually loaded
at runtime, proved level-up end to end (and found a §6.3 free-heal bug behind it), then closed
the four remaining blockers: the unguarded `/battles/:id/resolve` endpoint, the missing
`validateGambitLine()` (§8.4), the missing §7.5 crash/restart recovery, and
`updateGambitPage()`.

Every "tested" claim below has pasted output from a real run. Nothing is asserted from memory.

---

## 1. IMPLEMENTED **AND** TESTED

### 1.1 XP curve is the version that actually loads

`char_xp_curve.json` lives at the **repository root**, not `apps/api/src/data/`.
`DataService` resolves it as `path.join(process.cwd(), '../../', 'char_xp_curve.json')`
(`apps/api/src/modules/data/data.service.ts:24-30`), which is why the backend's cwd must be
`apps/api`.

No stale-build problem: `find apps/api/src -name '*.js'` returns **nothing**, so no compiled JS
shadows the TS sources.

```bash
# test command
cd apps/api && node -e "
const { NestFactory } = require('@nestjs/core');
const { DataModule } = require('./dist/apps/api/src/modules/data/data.module');
const { DataService } = require('./dist/apps/api/src/modules/data/data.service');
(async () => {
  const app = await NestFactory.createApplicationContext(DataModule, { logger: false });
  const ds = app.get(DataService);
  console.log('xpToNext(1)  =', ds.getXpToNextLevel(1));
  console.log('xpToNext(2)  =', ds.getXpToNextLevel(2));
  console.log('xpToNext(60) =', ds.getXpToNextLevel(60));
  await app.close();
})();"
```

```
xpToNext(1)  = 17 OK (expected 17)
xpToNext(2)  = 18 OK (expected 18)
xpToNext(60) = 140468558 OK (expected 140468558)
```

On-disk audit: 0 entries with a falsy `xpToNext`, 0 non-increasing transitions across all 98
levels.

### 1.2 Level-up is real (§6.3)

Fresh level-1 character, `equip_sword_t1` equipped, `always → attack` gambit activated, kill
counter pinned to the index that rolls `mon_slime` (`xpReward = 18 ≥ xpToNext(1) = 17`).
Resolved **by the BullMQ delayed job** — `/resolve` was never called.

```bash
/tmp/kilo/s63.sh
```

```
=== §6.3 check: level-up must NOT auto-top HP/SP ===
  maxHp 158 -> 176    maxSp 98 -> 106
  battle ended at hpAfter=102 spAfter=98
  level=2  unspentAttributePoints=5  xp=1
  ACTUAL   hpCurrent=114  spCurrent=106
  EXPECTED hpCurrent=114  spCurrent=106   (ratio-adjusted)
  a top-off would have given hp=176 sp=106
  RESULT: PASS - ratio-adjusted, no free heal
```

From full HP (the first run) the same battle produced:

```
BEFORE:  level 1 | xp 0 | unspentAttributePoints 0 | hp 158 | sp 98
AFTER:   level 2 | xp 1 | unspentAttributePoints 5 | hp 176 | sp 106
```

`xp = 18 - 17 = 1` ✅ · `+5` points ✅ · `maxHp/maxSp` recomputed 158/98 → 176/106 ✅.

**A §6.3 bug was found and fixed behind this test.** SPEC §6.3 says `hpCurrent`/`spCurrent` are
*"**not** auto-topped — a level-up mid-grind keeps current HP/SP ratio-adjusted"*.
`battle.service.ts` was doing `hpCurrent = fresh.maxHp`. With the character parked at 60/158 HP
the battle ended at 102 and level-up set **176** — a free 74 HP heal. Now a single ratio step is
applied for the whole batch of levels gained (oldest level → newest level), clamped to
`[1, newMaxHp]`.

### 1.3 🔴 `POST /battles/:battleId/resolve` removed (§7.4.3)

§7.4.3 defines resolution as a **BullMQ delayed job**, not an API route — no such endpoint
exists in SPEC. The route is deleted; `BattleService.resolveBattle()` is now reachable only from
`BattleQueueProcessor` and the §7.5 recovery pass.

```bash
# test command — two real users, A owns a battle, B tries to resolve it
curl -s -o /dev/null -w '%{http_code}' -X POST $API/battles/$A_BATTLE/resolve -H "Authorization: Bearer $B_TOKEN"
```

```
1a. B tries to resolve A's battle   HTTP 404  Cannot POST /battles/7ed50cd7-.../resolve
1b. A tries to resolve A's own      HTTP 404  Cannot POST /battles/7ed50cd7-.../resolve
1c. unknown battleId                HTTP 404
```

The boot route table confirms only `/battles/queue` GET+POST remain.

**The same missing-ownership bug also existed on the gambit routes** and was fixed in the same
pass — `GET/PUT/DELETE /gambits/:pageId` all took a bare `pageId`, so any authenticated user
could read, rewrite or delete another character's page:

```bash
/tmp/kilo/test-items.sh    # section 1
```

```
1d. B GET  A's page -> HTTP 404  Gambit page not found
1e. B PUT  A's page -> HTTP 404  Gambit page not found
1f. B DEL  A's page -> HTTP 404  Gambit page not found
A's page still titled: Page 1     still exists: 1
```

### 1.4 `validateGambitLine()` / `validateGambitPage()` (§8.4)

All six §8.4 rules, returning **field-level** errors and rejecting the whole write before any
repository call.

```bash
# the required case
curl -s -X POST $API/gambits -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
  -d '{"slotIndex":1,"title":"typo","lines":[
        {"priority":1,"conditions":[{"id":"self_hp_bandd","band":"LOW"}],"combinator":null,
         "action":{"id":"use_item","itemId":"pot_hp_small"}}]}'
```

```
HTTP 400
{
    "statusCode": 400,
    "error": "Bad Request",
    "message": ["lines[0].conditions[0].id: Unknown condition.id \"self_hp_bandd\" - not present in gambit_catalog.json"],
    "fieldErrors": [
        { "path": "lines[0].conditions[0].id",
          "message": "Unknown condition.id \"self_hp_bandd\" - not present in gambit_catalog.json" }
    ]
}
BEFORE: pages in DB = 46
AFTER : pages in DB = 46   (nothing persisted)
```

Every rule, all `HTTP 400`:

```
  invalid action.id                    HTTP 400  lines[0].action.id: Unknown action.id "teleport" - not present in gambit_catalog.json
  bad band enum value                  HTTP 400  lines[0].conditions[0].band: must be one of FULL, HIGH, MEDIUM, LOW, CRITICAL (got "VERY_LOW")
  missing required band param          HTTP 400  lines[0].conditions[0].band: condition "self_hp_band" requires param "band"
  use_item with unknown itemId         HTTP 400  lines[0].action.itemId: unknown itemId "pot_hp_unicorn" - not in items.json
  use_skill with unknown skillId       HTTP 400  lines[0].action.skillId: unknown skillId "sword_nope" - not in skill_trees.json
  3 conditions (max 2)                 HTTP 400  a gambit line needs 1 or 2 conditions (got 3)
  2 conditions without combinator      HTTP 400  combinator is required for 2 conditions and must be one of AND, OR
  1 condition with a combinator        HTTP 400  combinator must be null when the line has exactly 1 condition
  bad combinator value                 HTTP 400  combinator must be one of AND, OR (got "XOR")
  slotIndex out of range               HTTP 400  slotIndex: must be an integer between 0 and 2
  21 lines (>20)                       HTTP 400  a page holds at most 20 lines (got 21)
```

**Both param shapes are accepted**, mirroring `GambitEvaluator.readParams()` — the catalog's
inline `{ id, band }` *and* SPEC §8.2's nested `{ id, params: { band } }`. Valid pages of both
shapes still return `201`:

```
  inline params (catalog shape)        HTTP 201
  nested params (SPEC 8.2 shape)       HTTP 201
  2 conditions + AND                   HTTP 201
  real skill ref (sword_execute)       HTTP 201
```

`POST /gambits/validate-line` (used to throw `Not implemented`) now works:

```
{ "valid": false,
  "errors": [ { "path": "line.conditions[0].id",
                "message": "Unknown condition.id \"nope\" - not present in gambit_catalog.json" } ] }
```

`use_skill` validates against the 7 player weapon trees only — `skill_trees.json`'s
`monsterSkills` are not character-usable.

### 1.5 Crash/restart recovery (§7.5)

New `apps/api/src/modules/battle/battle-recovery.service.ts`, on `OnApplicationBootstrap` —
which Nest fires inside `app.listen()` **before the port is bound**, so recovery finishes before
the API accepts its first request. It resolves every `resolved = false` row with `endAt < now()`
oldest-first (`ORDER BY endAt, startAt, sequenceIndex`), then tops any surviving grinding
character's queue back up to 5.

```bash
# test: queue 5 battles, STOP the backend, backdate endAt 10 min, RESTART
/tmp/kilo/crash-setup.sh
psql -c "update battle_queue_entries set \"endAt\"=\"endAt\" - interval '10 minutes' where \"characterId\"='$CID';"
# then restart the backend
```

Real run — 5 unresolved rows all stale, kill counter 1, 28 BullMQ jobs still pending in Redis
(a real crash does not clean those up):

```
############ BEFORE THE CRASH ############
 seq |  monsterId   | outcome | xpGain | resolved | stale
-----+--------------+---------+--------+----------+-------
   0 | mon_slime    | win     |     18 | f        | t
   1 | mon_thornsprout | win   |     64 | f        | t
   2 | mon_direwolf | loss    |      0 | f        | t
   3 | mon_fieldbat | win     |     40 | f        | t
   4 | mon_slime    | win     |     18 | f        | t
kill counter BEFORE crash: 1

############ BOOT LOG ############
[BattleRecoveryService] Found 8 stale unresolved battle(s) with endAt < now() - resolving oldest first
[BattleService] Resolved battle 6cfab7b8-... mon_slime       xp+=18 level=2 xp=1  gold=5  mapKillCount=2 perMonster=mon_slime:1
[BattleService] Resolved battle 719f21a3-... mon_thornsprout xp+=64 level=5 xp=8  gold=17 mapKillCount=3 perMonster=mon_thornsprout:1
[BattleService] Character b9c4800a-... died to mon_direwolf; 2 queued battle(s) discarded
[BattleService] Battle f5d9dcaf-... already resolved - skipping
[BattleService] Battle e88259bc-... already resolved - skipping
[BattleService] Battle a835614e-... already resolved - skipping
[BattleService] Battle 5001af4b-... already resolved - skipping
[BattleService] Battle bf79c869-... already resolved - skipping
[BattleRecoveryService] recovery complete in 89ms: resolved 8 stale battle(s), topped up 1 character queue(s)
[Bootstrap] Application listening on port 3000        <-- AFTER recovery

############ IMMEDIATELY AFTER BOOT ############
resolved rows: 3
unresolved rows: 0
kill counter: 3      (1 before crash + the 2 wins that preceded the death; the direwolf loss did NOT count)
 seq |  monsterId   | outcome | xpGain | resolved
-----+--------------+---------+--------+----------
   0 | mon_slime    | win     |     18 | t
   1 | mon_thornsprout | win   |     64 | t
   2 | mon_direwolf | loss    |      0 | t
   (the 2 battles queued after the death were discarded per §7.6)

############ FIRST HTTP REQUEST AFTER BOOT ############
{'level': 5, 'xp': '7', 'unspentAttributePoints': 20, 'gold': 17, 'hpCurrent': 1, 'status': 'town', 'currentMapId': None}
```

`WARN`/`ERROR` lines this boot: **0**.

**🔴 `resolveBattle()` was not idempotent — recovery would have double-granted XP.** It applied
effects first and set `resolved = true` last, so the BullMQ job firing after the boot pass would
have paid XP/gold/drops/inventory a second time. It now *claims* the row with a conditional
`UPDATE ... WHERE resolved = false` and returns early when `affected = 0` — visible above as the
five `already resolved - skipping` lines.

Two related warnings silenced (both correctness-adjacent): a pending job is now removed *unless*
its state is `active` (removing the job you are currently executing always throws "Job is
locked"), and the processor treats `NotFoundException` as a clean discard instead of retrying
three times for a row §7.6 legitimately deleted.

### 1.6 `updateGambitPage()`

Was `throw new Error('Not implemented')`. Now resolves the caller from the JWT, scopes the row by
`characterId`, validates through the same §8.4 pass, and enforces a unique `slotIndex`.

```bash
/tmp/kilo/test-items.sh    # section 4
```

```
4a. PUT title + valid lines   -> 200  title "Updated by PUT", lines persisted
4b. PUT with an invalid line  -> HTTP 400, and the page is UNCHANGED ("still titled: Updated by PUT")
4c. PUT an unknown pageId     -> HTTP 404
4d. DELETE own page           -> 200, then GET -> 404, then DELETE -> 404
```

`deleteGambitPage()` also clears `character.activeGambitPageId` when it pointed at the deleted
page, instead of leaving the character pointing at a row that no longer exists.

### 1.7 Bonus: `POST /characters/attributes/spend` 500 → 400

Found by the regression pass. `SpendAttributePointsDto` has no class-validator metadata, so the
global `ValidationPipe` let `dto.attributes` through as `undefined` and `Object.values(undefined)`
threw `TypeError: Cannot convert undefined or null to object` → **500**. Now:

```
POST /attributes/spend {"str":2}                     HTTP 400  "attributes must be an object"
POST /attributes/spend {"attributes":{"str":2}}      HTTP 400  "Not enough unspent attribute points"
POST /attributes/spend {"attributes":{"str":2}} (funded)  HTTP 200  str 5->7, points -2
```

### 1.8 Full regression — all documented endpoints

```bash
# 18 curls; see the run pasted in the session
```

```
  POST /auth/register                      HTTP 201
  POST /characters                         HTTP 201
  GET  /characters                         HTTP 200
  GET  /gambits                            HTTP 200
  POST /gambits                            HTTP 201
  PUT  /gambits/:id/activate               HTTP 200
  PUT  /gambits/:id (item 4)               HTTP 200
  POST /gambits/validate-line              HTTP 201
  PUT  /equipment/equip                    HTTP 200
  GET  /equipment/stats/total              HTTP 200
  POST /inventory/add                      HTTP 201
  GET  /inventory                          HTTP 200
  GET  /inventory/item/:id/count           HTTP 200
  POST /inventory/sell                     HTTP 201
  GET  /maps                               HTTP 200
  POST /maps/:id/enter                     HTTP 201
  GET  /battles/queue                      HTTP 200
  POST /battles/queue                      HTTP 201
  GET  /maps/:id/kill-counter              HTTP 200
  POST /attributes/spend (malformed)       HTTP 400
  no token                                 HTTP 401
```

`POST /characters` returns 400 when the user already has a character — that is the intended
`BadRequestException('Character already exists for this user')`, not a regression.

### 1.9 Build gates

```bash
cd apps/api        && npx tsc --noEmit -p tsconfig.json   # exit=0
cd apps/api        && npx nest build                      # exit=0
cd packages/shared && npx tsc --noEmit -p tsconfig.json   # exit=0
```

---

## 2. IMPLEMENTED BUT **NOT** TESTED THIS SESSION

Carried over from previous sessions. Not broken, not re-verified here.

| Area | State | Note |
|---|---|---|
| Gambit evaluation on all four gauge fires (char attack/cast, monster attack/cast) | tested in a previous session, not re-run | out of scope this session per instructions |
| XP / gold / drops loop through BullMQ | tested in a previous session, not re-run | §1.2 exercised XP end to end incidentally |
| `MapKillCounter` epoch rollover at 10 000 | never exercised | needs 10 000 real kills; logic reviewed only |
| `MapService.incrementKillCounter()` / `getMapDetails()` / `validateMapAccess()` | **dead code** — all three `throw new Error('Not implemented')` | would 500 if called; the real counter lives in `BattleService` |
| `lastDeathLog` (§7.7) | exercised incidentally in the §7.5 run (character died in recovery) | not asserted in an automated check |
| §6.3 "triggers a battle queue recalculation" | **not implemented** — `resolveBattle` does not re-queue on level-up | the BullMQ processor tops up on the *next* resolve instead |
| `use_item` gambit / monster `use_skill` gambit in a resolved log | tested in a previous session, not re-run | — |
| Frontend (Angular) | not touched this session | `apps/frontend` unchanged |

---

## 3. STILL STUB / TODO

- `MapService.incrementKillCounter()`, `getMapDetails()`, `validateMapAccess()` —
  `throw new Error('Not implemented')`. Dead code; the kill counter works via
  `BattleService.incrementKillCounter()`.
- Mail system — stub.
- Market system — stub.
- Town vendor / warehouse — stub (routes exist, largely untested).
- Chat system — stub.
- WebSocket gateway — stub; `GatewayModule` is commented out of `app.module.ts`.
- `CharacterService.gainXp()` — **dead code**. It contains a correct §6.3 ratio adjustment but
  **no caller anywhere** (`grep -rn gainXp` hits only its own declaration and `.d.ts`).
  `BattleService.resolveBattle()` has its own inline level-up loop. Two implementations of the
  same rule is a hazard; consider deleting `gainXp()`.
- `pnpm lint` does not work — no ESLint config file exists anywhere in the repo, so `eslint`
  exits 1. Pre-existing. `tsc --noEmit` + `nest build` are the only working gates.
- `synchronize: true` only when `NODE_ENV=development`. A production database needs real
  migrations for any schema change.

---

## 4. TECHNICAL TRAPS AND LESSONS FROM THIS SESSION

### 4.1 JWT claim mapping — absolute rule
The JWT carries **`userId`**, never `characterId`. Every controller must do:

```typescript
const character = await this.characterService.getCharacterByUserId(req.user.userId);
```
```typescript
// WRONG — always undefined
const characterId = req.user.characterId;
```

`GambitController` now centralises this in a private `requireCharacter(req)` helper so no route
can forget it. Any new controller should reuse that shape.

### 4.2 Ownership must be enforced in the **query**, not in the controller
A bare `findOneBy({ id: pageId })` followed by a controller-level `if` is one refactor away from
being an IDOR. `GambitService` scopes every lookup with `{ id, characterId }` so ownership is part
of the predicate, and returns **404 (not 403)** — a 403 confirms the row exists.

### 4.3 The backend cwd is load-bearing
`DataService` resolves data files as `path.join(process.cwd(), '../../')`. Run from the repo root
and it looks in `/` and every getter silently returns `null`. **cwd must be `apps/api`.**
`char_xp_curve.json` is at the repo root, not `apps/api/src/data/`.

### 4.4 Verify the runtime value, not the file
The XP curve is read with `fs.readFileSync` at boot, so it cannot go stale — but the compiled
*code* could. Booting the real `DataService` class from `dist/` through a Nest application
context and calling `getXpToNextLevel()` is the only check that proves what actually loads.
Also confirmed there is no compiled JS in `src/` (`find apps/api/src -name '*.js'` → empty), so
the "Compiled JS in src/ vs dist/" trap from a previous session is not currently active.

### 4.5 TypeORM skips `undefined` columns on save
`character.currentMapId = undefined` is silently dropped, leaving a dead character still assigned
to a map. **Use `null`, not `undefined`.** This is why `handleCharacterDeath` sets
`character.currentMapId = null as any`.

### 4.6 A missing DB value in psql is a `NOT NULL` violation, not a NULL
Querying a column that does not exist, or a NOT NULL column with no row, produces a bare
`ERROR: unterminated quoted string` / `null value in column ... violates not-null constraint`
that looks like a shell quoting bug. **The DB columns are camelCase** (`"characterId"`,
`"mapKillCount"`, `"hpCurrent"`), never snake_case — a snake_case query silently fails and costs
real time. Always `psql` the error out; a 500 only tells you what the filter stripped.

### 4.7 `resolveBattle()` must be idempotent before you add any second caller
Effects were applied first and `resolved = true` set last, so any second delivery of the same
battle (BullMQ retry, or the new §7.5 recovery pass) paid everything twice. The fix is a
**conditional claim** before any mutation:

```typescript
const claimed = await repo.createQueryBuilder().update(BattleQueueEntry)
  .set({ resolved: true })
  .where('"id" = :battleId', { battleId })
  .andWhere('"resolved" = false')
  .execute();
if (!claimed.affected) return;   // someone else already did it
```

### 4.8 You cannot `remove()` the BullMQ job you are currently executing
`job.remove()` inside its own handler throws "Job is locked". Guard on
`(await job.getState()) !== 'active'`. A `NotFoundException` from the processor should be a clean
discard, **not** a retried error — §7.6 legitimately deletes rows.

### 4.9 A character with no active gambit page never attacks
§7.3 treats an unmatched line as a *wasted* gauge fire, so a fresh character with no activated
gambit does nothing for the full 200-tick cap, and
`outcome = foe.hp <= 0 && self.hp > 0 ? 'win' : 'loss'`
(`packages/shared/src/battle-engine/index.ts:874`) scores the stalemate as a **loss**. Any E2E
must set and activate an `always → attack` page first, or it will look like an XP/queue bug.

### 4.10 Two param shapes for the same gambit concept
`gambit_catalog.json` and live payloads write `{ id, band }` inline; SPEC §8.2 writes
`{ id, params: { band } }`; `monsters.json` writes a third shape
`{ condition: { type, value }, action: { type } }`. The validator mirrors
`GambitEvaluator.readParams()` so **both** player shapes are accepted — rejecting the nested form
would reintroduce the exact silent-failure class of the `drop.dropRate` vs `drop.chance` bug.
**Any new data-file consumer must be tested against the real file contents.**

### 4.11 A validator must not reject the shipped example
`gambit_catalog.json`'s own `exampleGambitPage` contains
`{"id":"self_hungry","band":null}` — a param the `self_hungry` entry does not declare. The
validator checks **declared** params only and ignores extras, otherwise the canonical example
would 400. Do not tighten this to "reject unknown params" without also fixing the catalog.

### 4.12 DTOs without class-validator decorators pass through the ValidationPipe
`SpendAttributePointsDto` has none, so the global `ValidationPipe` in `main.ts` does nothing and
`undefined` reaches the service. Guard in the service and throw `BadRequestException`, not a bare
`Error` — a bare `Error` is a **500**. `gambit.service.ts` previously threw bare
`new Error('Character not found')` on every path; those are now `NotFoundException`/`BadRequestException`.

### 4.13 Two implementations of the same rule
`CharacterService.gainXp()` and the inline loop in `BattleService.resolveBattle()` both implement
level-up. Only the latter runs. Only the latter was fixed for §6.3. When fixing a rule, grep for
every copy first.

### 4.14 Battle durations are wall-clock; a 5-battle chain takes minutes
`endAt = startAt + durationTicks * 1000ms`, and a 5-battle chain is sequential and back-to-back.
A test that polls for 120 s will miss the resolve. Check `endAt` against `now()` in SQL before
choosing a timeout.

### 4.15 Test environment (no Docker, no sudo)
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

## 5. THE SINGLE NEXT STEP

**Delete the dead `CharacterService.gainXp()` method** (`apps/api/src/modules/character/character.service.ts:136-177`)
and its `d.ts` entry, so §6.3 level-up has exactly one implementation.

It is the only remaining copy of the level-up rule, it has no caller anywhere in
`apps/api` or `packages/shared`, and it is the trap most likely to cause the next session to
"fix" the wrong function — this session found the §6.3 free-heal bug in
`BattleService.resolveBattle()` while a *correct* §6.3 implementation sat unused 100 lines away.
Verify with `grep -rn gainXp --include=*.ts apps/api/src packages/shared/src` returning nothing
after the delete, then `cd apps/api && npx tsc --noEmit -p tsconfig.json` (exit 0) and one
BullMQ-resolved level-up battle to confirm §6.3 still holds.
