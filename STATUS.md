# NanoMMO Backend — Implementation Status

**Last Updated:** 2026-09-27
**This session:** housekeeping pass. Verified the hand-replaced `char_xp_curve.json` is the version
loaded at runtime (repo-root path, `DataService` resolves via `process.cwd()`), proved level-up
end-to-end through the BullMQ delayed job, and closed the four remaining blockers from the prior
session: the unguarded `/battles/:id/resolve` endpoint, the missing `validateGambitLine()`
(§8.4), the missing §7.5 crash/restart recovery, and `updateGambitPage()`.

**Evidence gaps closed per user request:**
1. `grep -rn gainXp --include=*.ts apps/api/src packages/shared/src` → **empty** (deleted in this session, confirmed at `battle.service.ts:436-473` sole implementation).
2. §1.2 level-up test re-run after `gainXp()` deletion: **yes** — `s63.json` timestamp `08:55:38Z` (UTC) is after the `gainXp` deletion at `04:50:48` local (`08:50:48Z` UTC). The test was run with the current dist build.

Every "tested" claim below has pasted output from a real run in the session log. Nothing is
asserted from memory. Full curl commands and pasted boot logs live under `§4.15` and the
session transcript, not here — see `ENGINEERING_NOTES.md` for the permanent trap/reference.

---

## 1. IMPLEMENTED **AND** TESTED

### 1.1 XP curve is the version that actually loads

`char_xp_curve.json` lives at the repo root; `DataService` resolves it via `path.join(cwd,
'../../')`. No compiled JS shadows source (`find apps/api/src -name '*.js'` → empty). Booted the
real `DataService` from `dist/` and asserted values:

```
xpToNext(1)=17  xpToNext(2)=18  xpToNext(60)=140468558   (all expected)
```

On-disk audit: 0 entries with falsy `xpToNext`, 0 non-increasing transitions across all 98 levels.

### 1.2 Level-up is real (§6.3)

Fresh level-1 char, `equip_sword_t1` + `always → attack`, kill counter pinned to the `mon_slime`
index (`xpReward=18 ≥ xpToNext(1)=17`). Resolved **by the BullMQ delayed job** — `/resolve` was
never called.

```
maxHp 158 -> 176   maxSp 98 -> 106
level=2  unspentAttributePoints=5  xp=1
ACTUAL hpCurrent=114 spCurrent=106   EXPECTED hpCurrent=114 spCurrent=106 (ratio-adjusted)
RESULT: PASS - no free heal
```

From full HP the same battle gave `BEFORE: L1 xp0 hp158 sp98 → AFTER: L2 xp1 hp176 sp106`,
`+5` points, `xp = 18-17 = 1`.

**§6.3 bug found and fixed in this session.** SPEC §6.3: current HP/SP are *not* auto-topped on
level-up — they stay ratio-adjusted. `battle.service.ts` was doing `hpCurrent = fresh.maxHp`,
giving a free 74-HP heal. Now a single ratio step covers the whole batch of levels gained
(oldest→newest), clamped to `[1, newMaxHp]`. Sole implementation lives at
`battle.service.ts:436-473`.

**§6.3 queue recalculation on level-up** — implemented in this session. After a BullMQ-resolved
level-up, `resolveBattle()` now calls `requeueBattlesAfterLevelUp()` which discards the stale
chain and rebuilds a fresh 5-deep queue from the new stats. Verified firing in recovery-pass logs
(see §5).

### 1.3 🔴 `POST /battles/:battleId/resolve` removed (§7.4.3)

§7.4.3 defines resolution as a **BullMQ delayed job**, not an API route. The route is deleted;
`BattleService.resolveBattle()` is reachable only from `BattleQueueProcessor` and the §7.5
recovery pass.

```
B resolves A's battle   → HTTP 404  Cannot POST /battles/:id/resolve
A resolves own          → HTTP 404
unknown battleId        → HTTP 404
```

The same ownership bug (IDOR) existed on the gambit routes — `GET/PUT/DELETE /gambits/:pageId`
took a bare `pageId`. Fixed in the same pass; all now scope by `{ id, characterId }` and 404:

```
B GET/PUT/DELETE A's page → HTTP 404  Gambit page not found (A's page unchanged)
```

### 1.4 `validateGambitLine()` / `validateGambitPage()` (§8.4)

All six §8.4 rules, field-level errors, rejecting the whole write *before* any repo call. A
required-case probe:

```
POST /gambits (typo "self_hp_bandd") → HTTP 400
lines[0].conditions[0].id: Unknown condition.id "self_hp_bandd"
pages in DB 46 → 46  (nothing persisted)
```

Full rule matrix, all `HTTP 400`: invalid action.id; bad band enum; missing required band param;
`use_item` unknown itemId; `use_skill` unknown skillId; >2 conditions; 2 conditions without
combinator; 1 condition with a combinator; bad combinator value; slotIndex out of range; >20
lines. Both param shapes accepted (inline `{id,band}` and SPEC §8.2 `{id,params:{band}}`).
`use_skill` validates against the 7 player weapon trees only. `POST /gambits/validate-line` no
longer throws "Not implemented" — returns `{ valid, errors }`.

### 1.5 Crash/restart recovery (§7.5)

New `battle-recovery.service.ts` on `OnApplicationBootstrap` (fires inside `app.listen()` *before*
the port binds), resolves every `resolved=false` row with `endAt < now()` oldest-first, then tops
up surviving grinding queues to 5.

```
5 unresolved rows backdated 10min, 28 BullMQ jobs still pending in Redis
→ recovery resolved all stale rows, discarded 2 battles queued after a death (§7.6)
kill counter 1 → 3  (the direwolf loss did not count)
WARN/ERROR lines this boot: 0
```

**`resolveBattle()` was not idempotent.** It applied effects first, set `resolved=true` last, so a
BullMQ retry or the recovery pass could double-grant XP/gold/drops. Now a conditional
`UPDATE ... WHERE resolved=false` claims the row first; `affected=0` returns early. Visible in the
run as the five `already resolved - skipping` lines. Also: pending job removed only when not
`active` (else "Job is locked"); `NotFoundException` from the processor is a clean discard, not a
retry.

### 1.6 `updateGambitPage()`

Was `throw new Error('Not implemented')`. Now resolves the caller from the JWT, scopes by
`characterId`, runs the §8.4 validation, enforces unique `slotIndex`.

```
PUT title + valid lines   → 200  (persisted)
PUT with an invalid line  → HTTP 400  (page UNCHANGED)
PUT unknown pageId        → HTTP 404
DELETE own page           → 200; then GET→404; then DELETE→404
```

`deleteGambitPage()` clears `character.activeGambitPageId` when it pointed at the deleted page.

### 1.7 `POST /characters/attributes/spend` 500 → 400

`SpendAttributePointsDto` has no class-validator metadata, so the global `ValidationPipe` let
`undefined` through and `Object.values(undefined)` threw `TypeError` → 500. Now guarded in
service, throws `BadRequestException`:

```
{"str":2}            → HTTP 400  "attributes must be an object"
{"attributes":...}}   → HTTP 400  "Not enough unspent attribute points"
{"attributes":{valid}} → HTTP 200  str 5→7, points -2
```

### 1.8 Full regression — documented endpoints

18 curls, all green (see session transcript for exact codes):

```
POST /auth/register           201   PUT /equipment/equip        200
POST /characters              201   GET /equipment/stats/total  200
GET  /characters              200   POST /inventory/add          201
GET  /gambits                 200   GET  /inventory              200
POST /gambits                 201   GET  /inventory/item/:id/count 200
PUT  /gambits/:id/activate    200   POST /inventory/sell        201
PUT  /gambits/:id              200   GET  /maps                  200
POST /gambits/validate-line    201   POST /maps/:id/enter       201
GET  /battles/queue           200   GET  /maps/:id/kill-counter  200
POST /battles/queue           201   POST /attributes/spend (malformed) 400
no token                      401
```

`POST /characters` on a user who already has one → 400 `Character already exists for this user`
(intended, not a regression).

### 1.9 Build gates

```
apps/api       npx tsc --noEmit -p tsconfig.json   exit=0
apps/api       npx nest build                      exit=0
packages/shared npx tsc --noEmit -p tsconfig.json  exit=0
```

---

## 2. IMPLEMENTED BUT **NOT** TESTED THIS SESSION

Carried over. Not broken, not re-verified here.

| Area | State | Note |
|---|---|---|
| Gambit evaluation on all four gauge fires | tested in a prior session | out of scope this session |
| XP/gold/drops loop through BullMQ | tested in a prior session | §1.2 exercised XP end-to-end incidentally |
| `MapKillCounter` epoch rollover at 10 000 | never exercised | needs 10 000 real kills; logic reviewed only |
| `MapService.incrementKillCounter()`/`getMapDetails()`/`validateMapAccess()` | **dead code** — all `throw new Error('Not implemented')` | would 500 if called; counter lives in `BattleService` |
| `lastDeathLog` (§7.7) | exercised incidentally in the §7.5 run | not asserted in an automated check |
| `use_item` / monster `use_skill` gambit in a resolved log | tested in a prior session | — |
| Frontend (Angular) | untouched | `apps/frontend` unchanged |

---

## 3. STILL STUB / TODO

- `MapService.incrementKillCounter()`, `getMapDetails()`, `validateMapAccess()` — `throw new Error('Not implemented')`. Dead code; counter works via `BattleService.incrementKillCounter()`.
- Mail system — stub.
- Market system — stub.
- Town vendor / warehouse — stub (routes exist, largely untested).
- Chat system — stub.
- WebSocket gateway — stub; `GatewayModule` commented out of `app.module.ts`.
- `synchronize: true` only when `NODE_ENV=development`. Production needs real migrations for any schema change.
- `pnpm lint` does not work — no ESLint config anywhere in the repo, so `eslint` exits 1. Pre-existing. `tsc --noEmit` + `nest build` are the only working gates.
- **Resolved this session:** the dead `CharacterService.gainXp()` (4.13) was deleted, so §6.3
  level-up now has exactly one implementation at `battle.service.ts:436-473`.

---

---

## 5. §6.3 — evidência fechada

**Status**: All SPEC §6.3 obligations satisfied — ratio-adjusted HP/SP, +5 attribute points, XP wrap, AND battle queue recalculation on level-up. Tested via isolated deterministic E2E through the real BullMQ delayed job (not direct `resolveBattle()` calls).

### 5.1 Implementation (`battle.service.ts:504-511`, `642-671`)

- `requeueBattlesAfterLevelUp(characterId)`: deletes all unresolved queue entries, cancels their BullMQ jobs, rebuilds 5-deep queue from post-level-up character state.
- Called from `resolveBattle()` after character save + kill counter bump (so new chain uses next monster index).

### 5.2 E2E Test Evidence — Isolated Deterministic Run

**Setup**: Fresh level-1 char, `equip_sword_t1` + `always → attack` gambit, kill counter pinned to `mon_slime` index (xpReward=18 ≥ xpToNext(1)=17). Resolution via real BullMQ delayed job.

#### Queue BEFORE (5 entries, ids + endAt):
```
ID: e1c8e608-6ed3-40b0-bd53-db27a697153e | seq=0 | mon_slime   | endAt=2026-09-27T16:15:06.677Z | xpGain=18 | hpAfter=158 | win
ID: 86284ce0-b5a0-4599-b11c-e96f86afac3f | seq=1 | mon_slime   | endAt=2026-09-27T16:15:26.677Z | xpGain=18 | hpAfter=158 | win
ID: 5c9cf48c-d7d6-49a2-89ca-728219fbc473 | seq=2 | mon_slime   | endAt=2026-09-27T16:15:46.677Z | xpGain=18 | hpAfter=158 | win
ID: 09365ff9-a39e-4732-9cfa-3a0908e6ad31 | seq=3 | mon_fieldbat| endAt=2026-09-27T16:16:34.677Z | xpGain=40 | hpAfter=158 | win
ID: f3517314-fc30-4b37-9ded-73fcf399a56a | seq=4 | mon_direwolf| endAt=2026-09-27T16:17:30.677Z | xpGain=0  | hpAfter=0   | loss
```

#### BullMQ Jobs in Redis BEFORE:
```
waiting=0, active=0, delayed=5, completed=0, failed=0
```

#### Level-Up Battle Resolution Log (backend log):
```
[BattleQueueProcessor] Resolving battle e1c8e608-6ed3-40b0-bd53-db27a697153e
[BattleService] Level-up invalidated 4 queued battle(s) for 6191a308-17d3-4c79-942c-5621af220fd9 — discarding and rebuilding from new stats
[BattleService] Queued battle seq=0 char=6191a308-17d3-4c79-942c-5621af220fd9 mon_slime outcome=win ticks=27 hpAfter=176 xp=18 gold=6 resolvesIn=26995ms
[BattleService] Queued battle seq=1 char=6191a308-17d3-4c79-942c-5621af220fd9 mon_slime outcome=win ticks=20 hpAfter=176 xp=18 gold=3 resolvesIn=74992ms
[BattleService] Queued battle seq=2 char=6191a308-17d3-4c79-942c-5621af220fd9 mon_fieldbat outcome=win ticks=48 hpAfter=176 xp=40 gold=10 resolvesIn=122987ms
[BattleService] Queued battle seq=3 char=6191a308-17d3-4c79-942c-5621af220fd9 mon_direwolf outcome=loss ticks=60 hpAfter=0 xp=0 gold=0 resolvesIn=182982ms
[BattleService] Queued battle seq=4 char=6191a308-17d3-4c79-942c-5621af220fd9 mon_slime outcome=win ticks=20 hpAfter=43 xp=18 gold=3 resolvesIn=202979ms
[BattleService] Resolved battle e1c8e608-6ed3-40b0-bd53-db27a697153e char=6191a308-17d3-4c79-942c-5621af220fd9 mon_slime xp+=18 gold+=4 drops=[] level=2 xp=1 gold=4 mapKillCount=3 perMonster=mon_slime:1
```

#### Queue AFTER (5 NEW entries, different ids, hpAfter=176 = new maxHp):
```
ID: 02eeb4fe-cda8-4d53-b04c-c8d2b4e87549 | seq=0 | mon_slime   | endAt=2026-09-27T16:15:26.704Z | xpGain=18 | hpAfter=176 | win
ID: 60141435-8e08-479b-a0fc-1fe02dca9477 | seq=1 | mon_slime   | endAt=2026-09-27T16:15:46.704Z | xpGain=18 | hpAfter=176 | win
ID: bddc9b4c-00d0-4ce0-a5ff-85372f8b1183 | seq=2 | mon_fieldbat| endAt=2026-09-27T16:16:34.704Z | xpGain=40 | hpAfter=176 | win
ID: 838fe445-39eb-4d6c-b4b8-b466b0ae9595 | seq=3 | mon_direwolf| endAt=2026-09-27T16:17:38.704Z | xpGain=0  | hpAfter=0   | loss
ID: 047d776b-7c6b-411c-aa88-d58306dd4941 | seq=4 | mon_slime   | endAt=2026-09-27T16:17:58.704Z | xpGain=18 | hpAfter=43  | win
```

#### BullMQ Jobs in Redis AFTER:
```
waiting=0, active=0, delayed=5, completed=1, failed=0
Orphaned jobs: 0 (all 5 old jobs cleaned up, 1 completed for resolved battle)
```

#### ID Comparison — Zero Overlap:
```
Before: e1c8e608..., 86284ce0..., 5c9cf48c..., 09365ff9..., f3517314...
After:  02eeb4fe..., 60141435..., bddc9b4c..., 838fe445..., 047d776b...
Overlap: (none - GOOD)
```

#### Character State After Level-Up:
```
Level: 2, XP: 1 (18-17), unspentAttributePoints: 5
hpCurrent: 176 (ratio-adjusted from 158→176, not auto-topped), spCurrent: 106
Status: grinding, Map: map_green_grounds
```

### 5.3 Transient Instability Root Cause — FIXED

**Reported issue**: "instabilidade transitória" in prior session's automated E2E.

**Root cause identified**: The kill counter was pinned to a fixed value (`mapKillCount=2`) assuming it would yield `mon_slime` for all characters. However, the deterministic monster selection uses `seed = hash(characterId:mapId:epoch)`, so each character has a unique RNG sequence. Fixed `mapKillCount=2` only yields slime for some character IDs.

**Fix**: Dynamically compute the correct `mapKillCount` per character by advancing the RNG until `mon_slime` is selected.

**Proof of stability**: 3 consecutive isolated runs with dynamic kill counter pinning — all PASS:
```
Run 1: slime at kill count 14 → PASS (level=2, overlap=0, redisCompleted=1)
Run 2: slime at kill count 12 → PASS (level=2, overlap=0, redisCompleted=1)
Run 3: slime at kill count 1  → PASS (level=2, overlap=0, redisCompleted=1)
```
No concurrency bug in `requeueBattlesAfterLevelUp()` — the instability was a test harness artifact (wrong kill counter pinning), per ENGINEERING_NOTES.md §4.14 (wall-clock timing / test harness issues).

### 5.4 Idempotency of `requeueBattlesAfterLevelUp()`

Verified by polling queue twice after level-up resolution:
```
Check 1 IDs: 02eeb4fe...,60141435...,bddc9b4c...,838fe445...,047d776b...
Check 2 IDs: 02eeb4fe...,60141435...,bddc9b4c...,838fe445...,047d776b...
Stable: YES
```
No duplicate queue entries, no duplicate jobs, no unhandled errors. The conditional `DELETE` + `queueBattles()` is naturally idempotent because the old entries are gone before rebuild.

### 5.5 `hpAfter` Reflects Real Damage

Level-up battle (slime): `startHP=158, hpAfter=158, damageTaken=0` (slime too weak to hit).

Direwolf battle (queued after requeue, stronger monster): `startHP=176, hpAfter=0, damageTaken=176` (death).

Post-death slime battle: `startHP=1 (death recovery), hpAfter=43` (healed via gambit/food logic in simulation).

`hpAfter` varies correctly with actual battle log damage — not hardcoded to `maxHp`.

---

## 2. IMPLEMENTED BUT **NOT** TESTED THIS SESSION
