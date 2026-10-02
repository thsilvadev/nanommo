# Engineering Notes — NanoMMO

Permanent, append-only reference of hard-won technical traps and lessons from
`STATUS.md` sessions. Re-read only when a new bug falls in the same class
(JWT claims, ownership/IDOR, cwd, TypeORM `undefined`, idempotence, etc.).

Last session that added entries: 2026-09-27.

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
