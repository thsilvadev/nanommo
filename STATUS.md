# NanoMMO Backend — Battle Loop Implementation Status

**Last Updated:** 2026-09-28 (Phase 3 verification — change `grind-loop-phase3-edge-cases`)
**Session Focus:** Build the six Phase 3 edge-case verification scripts and record their results

> **Evidence rule adopted this session.** A verification result is only recorded in this
> document if the script that produced it is committed and re-runnable
> (SPEC delta `grind-loop-verification`, "Edge-case guarantees are covered by re-runnable
> verification scripts"). Every claim in §7 below names the script and the assertion that
> produced it. Claims carried over from earlier sessions that were not re-proven by a
> script are marked **[re-verified 2026-09-28]** or **[carried forward, not re-proven]**.

---

## 0. Executive summary

| Aspect | State | Evidence |
|--------|-------|----------|
| **Core loop (Phase 1–2)** | ✅ verified | `test-phase3-all.js` — every stack-dependent scenario bootstraps a real character and drives the real endpoints |
| **Phase 3 edge cases** | ✅ **143/143 assertions pass**, aggregate exit 0 | `node apps/api/test-phase3-all.js --restart` |
| **Known divergences from SPEC** | ⚠️ 4 confirmed + 1 testability note | §7.7, printed by the scripts as `[DIVERGENCE #n]` |
| **Blocker issues** | none | No scenario failed |
| **New issues found this session** | 2 real defects in *test evidence*, 1 in behaviour | §6 |
| **Tech debt** | ⚠️ 3 items, all pre-existing | §6 |

**Phase 3 is complete.** All six scenarios pass and the suite is re-runnable with
`node apps/api/test-phase3-all.js`.

---

## 1. How to reproduce

```bash
# 1. Build — required; the API runs packages/shared/dist, not the TypeScript source
pnpm build

# 2. Start the stack (backend is published on host :3010, not :3000)
docker compose up --build -d
#    wait for: curl -s -o /dev/null -w '%{http_code}' http://localhost:3010/maps

# 3. Run the suite
cd apps/api
node test-phase3-all.js             # 5 scenarios; crash recovery self-skips
node test-phase3-all.js --restart   # all 6, restarts the backend container twice
```

Individual scenarios:

```bash
node test-phase3-determinism.js                 # engine only, no stack needed for most assertions
node test-phase3-gambits.js
node test-phase3-levelup.js
node test-phase3-death.js
node test-phase3-idempotency.js
PHASE3_RESTART=1 node test-phase3-recovery.js    # gated: restarts the container
```

### Environment variables the scripts honour

| Variable | Default | Effect |
|----------|---------|--------|
| `PHASE3_API_URL` | `http://localhost:3010` | Backend base URL. `test-s63.js`'s hardcoded `:3000` is the container-internal port and is wrong from the host. |
| `PHASE3_API_MIN_INTERVAL_MS` | `13000` | Paces HTTP calls. The API is globally throttled to **5 requests / 60 s** (`app.module.ts:28`, registered as an `APP_GUARD`, so one budget for the whole process). Set to `0` to disable pacing. |
| `PHASE3_RESTART=1` | unset | Enables crash recovery / the restart-race mode. |
| `PHASE3_IDEMPOTENCY_DELAY_MS` | `0` | Gap between the two racing job submissions. `2000` forces serial delivery — the run still passes and prints the overlap outcome. |
| `PGHOST` / `PGPORT` / `PGUSER` / `PGPASSWORD` / `PGDATABASE` | `127.0.0.1` / `5432` / `nanommo` / `nanommo_dev_password` / `nanommo` | Postgres access from the host. `.env` has `DB_HOST=db` / `REDIS_HOST=redis`, which are container-internal names and do not resolve from the host. |

---

## 2. What was built

| File | Role |
|------|------|
| `apps/api/test/helpers/phase3.js` | Shared harness: throttled HTTP, `pg`, `ioredis`, `bull`, character bootstrap, seeded preconditions, assertion tally |
| `apps/api/test-phase3-determinism.js` | SPEC §3.1 / §11.2 — engine purity, stored-battle replay |
| `apps/api/test-phase3-gambits.js` | SPEC §8.4 save-time + §7.2/§7.3 runtime |
| `apps/api/test-phase3-levelup.js` | SPEC §6.3 / §3.4 — level-up mid-queue |
| `apps/api/test-phase3-death.js` | SPEC §7.6 / §6.4 / §7.7 — death |
| `apps/api/test-phase3-idempotency.js` | design.md D4 — exactly-once resolution |
| `apps/api/test-phase3-recovery.js` | SPEC §7.5 — crash recovery |
| `apps/api/test-phase3-all.js` | Aggregate runner (spawns child processes; `--restart` flag) |

**No production code was changed, and no dependency was added.** `bull`, `pg` and `ioredis`
were already direct dependencies of `apps/api`.

---

## 3. Scenario results

All figures from `node apps/api/test-phase3-all.js --restart` on 2026-09-28.

| Scenario | Assertions | Wall clock | Exit |
|----------|-----------|-----------|------|
| determinism | 6/6 | 52 s | 0 |
| gambits | 41/41 | 338 s | 0 |
| levelup | 28/28 | 157 s | 0 |
| death | 32/32 | 525 s | 0 |
| idempotency | 17/17 | 93 s | 0 |
| recovery | 19/19 | 138 s | 0 |
| **total** | **143/143** | **~22 min** | **0** |

Without `--restart`, recovery self-skips with a printed notice and the run reports
`5 ran, 1 skipped, 0 failed`, exit 0. The runner never folds a skipped
scenario into the pass count.

**Gambits and death dominate the wall clock** because the global 5-req/60-s throttler forces
13 s between HTTP calls, and those two scripts make ~35 and ~30 calls respectively. This is
the API's real behaviour, not harness overhead; running against a stack with a raised
`THROTTLE_LIMIT` (and `PHASE3_API_MIN_INTERVAL_MS=0`) cuts the suite to roughly 2 minutes.

---

## 4. Scenario-by-scenario detail

### 4.1 Determinism — `test-phase3-determinism.js`

| Assertion | Result |
|-----------|--------|
| §3.1 identical (snapshot, monster, page, seed) → byte-identical results | ✅ 2917 bytes identical, `outcome=win durationTicks=34 hpAfter=158` |
| The compared fingerprint is non-trivial (log + events included) | ✅ 13 events, header carries `monsterId, seedUsed, characterSnapshot, monsterSnapshot` |
| A different seed changes the simulation (non-vacuity control) | ✅ `34 ticks` vs `41 ticks` |
| No `Math.random()` in `packages/shared/src` code | ✅ 12 files scanned with comments stripped, 0 matches |
| §3.4 re-simulating a stored battle's `seedUsed` + `characterSnapshot` reproduces the persisted log | ✅ 2414 bytes identical for a real API-built entry |
| §3.4 the stored log header records the seed that reproduces it | ✅ `header.seedUsed` matches the `seedUsed` column |

**The non-vacuity control is verified against a deliberately broken engine.** The
"a different seed changes the simulation" assertion compares only *produced* output
(`events`, `outcome`, `durationTicks`, `hpAfter`, `spAfter`, `itemsConsumed`) — not the log
header, which echoes the seed string back verbatim. With `Mulberry32(seed)` hardcoded to a
constant in the built bundle, the suite drops to **4/6** and the control fails with
`both seeds produced identical output (outcome=win ticks=34 hpAfter=158 events=13)`. The
dist was restored afterwards; `packages/shared/dist` is unmodified.

### 4.2 Gambit validation — `test-phase3-gambits.js`

**Save-time (§8.4), over `PUT /gambits/:pageId`.** All eight rejection cases answer 400 with a
non-empty `fieldErrors` array naming the offending path, **and leave the stored page
byte-identical** — the second half is asserted by re-reading with `GET /gambits/:pageId`, since
a status code alone cannot prove the write never reached the repository.

| Rule | Submitted | Status | `fieldErrors[].path` | Page unchanged |
|------|-----------|--------|---------------------|----------------|
| >20 lines | 21 lines | 400 | `lines` | ✅ |
| condition arity | 3 conditions | 400 | `lines[0].conditions` | ✅ |
| 2 conditions, null combinator | 2 conditions | 400 | `lines[0].combinator` | ✅ |
| 1 condition, non-null combinator | 1 condition | 400 | `lines[0].combinator` | ✅ |
| unknown action | `summon_dragon` | 400 | `lines[0].action.id` | ✅ |
| out-of-enum band | `band: 'ANGRY'` | 400 | `lines[0].conditions[0].band` | ✅ |
| unknown item | `use_item pot_imaginary` | 400 | `lines[0].action.itemId` | ✅ |
| unknown skill | `use_skill sword_katana_slash` | 400 | `lines[0].action.skillId` | ✅ |
| **control: a valid page is accepted** | 4 legal lines | 200 | — | 4 lines stored and read back |

**Runtime (§7.2/§7.3), through the engine.**

| Assertion | Result |
|-----------|--------|
| §7.3 step 4 condition-true-but-illegal `use_item` is skipped and the next line runs | ✅ first event is `attack` at tick 5; 0 `use_item` events; 0 consumed |
| §7.2 the shared `item:potion` category gates a *different* potion | ✅ distinct `use_item` gaps `[6]` against a 3-tick cast-gauge period — a per-item cooldown would have fired every 3 ticks |
| §7.2 no two potion uses closer than the 5-tick `POTION_COOLDOWN` | ✅ minimum gap 6 |
| §7.2 control: with the priority-1 potion out of stock the priority-2 line fires on the first cast fire | ✅ `pot_sp_small` at tick 2 |
| §7.3 with two legal lines the higher priority executes, the lower never fires | ✅ 25 `defend`, 0 `wait`; max 1 character action per tick |
| §7.3 an out-of-stock-potion page saved over HTTP produces no `use_item` in the queued battle | ✅ 0 of 30 events |

### 4.3 Level-up mid-queue — `test-phase3-levelup.js`

**Single level-up, seeded so the resolve crosses exactly one threshold.**

| Assertion | Result |
|-----------|--------|
| The seeded first entry is a `win` | ✅ `mon_slime`, kill counter pinned to the scanned index |
| level increments by exactly the thresholds crossed | ✅ 1 → 2 (`xp=16` + `xpGain=18`, `xpToNext(1)=17`) |
| `unspentAttributePoints` += 5 per level | ✅ 0 → 5 |
| maxHp / maxSp recomputed upward | ✅ 158 → 176 and 98 → 106 |
| `hpCurrent` = `round(hpAfter × newMax/oldMax)`, clamped | ✅ 169 (ratio 1.11392) |
| `spCurrent` = `round(spAfter × newMax/oldMax)`, clamped | ✅ 106 (ratio 1.08163) |
| `hpCurrent` strictly below the new maxHp — not topped up | ✅ 169/176 = 96.0 % |
| `xp` is toward-next-level; the loop subtracted `xpToNext` once | ✅ 17 |
| The 4 surviving entries each had a BullMQ job before the resolve | ✅ 4/4 (captured **pre**-resolve) |
| Every surviving entry was discarded by the level-up | ✅ all 4 ids gone |
| The rebuilt chain was simulated against the new stats | ✅ `characterSnapshot.maxHp=176` vs the discarded chain's 158 |
| No BullMQ job remains for the discarded entries | ✅ 0 of 4 |
| Each rebuilt entry has a job; `GET /battles/queue` returns 5 | ✅ 5/5 and 5 |

**Multi-level, two thresholds in one resolve** (level 10, `mon_thornsprout`, +64 XP):
2 thresholds crossed → level 12, `unspentAttributePoints` 0 → 10, `hpCurrent` 234 matches the
single-step ratio.

### 4.4 Death — `test-phase3-death.js`

| Assertion | Result |
|-----------|--------|
| The setup is coherent: the killing blow is `sequenceIndex 0` and the only loss | ✅ 1 loss, 5 unresolved (1 killing + 4 survivors) |
| `status` → `town`; `currentMapId` → `null` | ✅ `null` explicitly (TypeORM skips `undefined` on save, so the explicit `null` matters) |
| `hpCurrent` → exactly 1 | ✅ |
| Every remaining unresolved entry deleted with the death | ✅ 0 of 4 remain; the rows are **deleted**, not marked resolved |
| No BullMQ job survives for the deleted entries | ✅ 0 of 4 (captured pre-resolve) |
| XP loss = `floor(xpToNextLevel(L) × 0.05)`, applied once | ✅ level 10, seeded 25, `floor(30 × 0.05)=1` → 24 |
| XP seeded **below** the penalty lands on exactly 0, never negative | ✅ level 20, seeded 1, `floor(73 × 0.05)=3` → 1−3 = −2 → clamped to 0 |
| The character is never de-leveled by a death | ✅ level 20 stays level 20 |
| `lastDeathLog` holds the killing battle's full log | ✅ monsterId matches, marker `death-1`, 27 events, `header` present |
| A second death **overwrites** rather than appends | ✅ second character carries only `death-2` |
| No new battles queued after the death | ✅ observed for the full duration of the longest discarded battle + 20 s |
| The character stays in town for the whole window | ✅ the processor's own top-up is gated on `status === 'grinding' && currentMapId` |
| Nothing pending in BullMQ for this character | ✅ 0 entries, 0 jobs |

### 4.5 Idempotency — `test-phase3-idempotency.js`

Two `resolve-battle` jobs are injected for the same `battleId` with **different** `jobId`s
(reusing the id would make BullMQ keep only one job and stage no race at all).

| Assertion | Result |
|-----------|--------|
| The staged entry is a `win` | ✅ `mon_fieldbat`/`mon_slime` depending on the scanned index |
| xp reflects exactly one `xpGain` after the §4.2 level-up loop | ✅ 0 + 89 → xp 15 at level 5; a double application gives xp 10 at level 9 |
| `unspentAttributePoints` += 5 per level gained | ✅ 0 → 20; a double application would grant 40 |
| gold += exactly one `goldGain` | ✅ |
| each drop added exactly once | ⚠️ see caveat below |
| `map_kill_counters.map_kill_count` += exactly 1 | ✅ |
| consumed items decremented exactly once, clamped at stock | ✅ e.g. `[{"pot_hp_small": 4}]` → 12 → 8; total removed equals the simulated consumption, never negative |
| the conditional claim matches 1 row, then 0 rows | ✅ asserted directly: 1 then 0 |
| a claimed row disappears from the live queue read path | ✅ |
| total quantity removed equals the simulated consumption, counted once | ✅ e.g. 12 → 1 with `quantity: 11`; a double application would remove 22 |
| **the losing caller logged `already resolved - skipping`** | ✅ 1 skip line; exactly 1 `Resolved battle` line |

**The overlap is real, not assumed.** The script greps `docker compose logs backend` for
`already resolved - skipping` and fails if absent, so an exit 0 cannot come from two
sequential resolves wearing a concurrency test's clothes. Every run observed the contention.

**Restart-race mode** (`PHASE3_RESTART=1 node test-phase3-idempotency.js`): the container is
stopped after the jobs are submitted, so on boot the §7.5 recovery pass and the delayed jobs
contend. **17/17, exit 0, overlap observed.**

**Drop caveat, recorded in the output:** the entry this race used rolled zero drops, so the
`add-drop` branch was not exercised. XP, gold, level-up points, the kill counter and the
inventory decrement all prove single application; a drop-bearing entry is still needed to
close the drop path.

### 4.6 Crash recovery — `test-phase3-recovery.js` (gated on `PHASE3_RESTART=1`)

**Ordered application.** The chain is normalised before the restart so ordering is
*observable*: all wins, `hpAfter` strictly decreasing `[150, 120, 90, 60, 30]`, `spAfter`
`[90, 75, 60, 45, 30]`, distinct `goldGain` `[1,2,3,4,5]`, and `xpGain` 0. The reason is
recorded in the script: the chain the API produces *cannot* answer the ordering question —
a level-up mid-recovery deletes and rebuilds the rest of the chain (observed as "1 of 6 rows
resolved"), consecutive wins regen HP to the maximum so every `hpAfter` is identical
(observed `[156, 156, 156, 0, 0]`), and a loss truncates the chain. Each row's own `log` is
left untouched, so log-based assertions still see real engine output.

| Assertion | Result |
|-----------|--------|
| the `hpAfter` values are distinct enough for order to be observable | ✅ `[150, 120, 90, 60, 30]` — every permutation gives a different final HP |
| the chain contains no loss | ✅ 5 wins |
| the chain grants no XP, so no level-up can truncate it | ✅ |
| entries applied **sequentially**: `hpCurrent` = the last entry's `hpAfter` in `endAt` order | ✅ 30 |
| `spCurrent` = the last entry's `spAfter` | ✅ 30 |
| every stale entry marked resolved | ✅ 5/5 |
| gold advanced by the **sum** — a double application would double it | ✅ 15, not 30 |
| the kill counter advanced once per entry | ✅ 0 → 5 |
| backend logged `SPEC §7.5 crash recovery complete` with a non-zero count | ✅ resolved counts `[5, 5, 5]` |
| each entry paid out exactly once (one `Resolved battle` line each) | ✅ `1, 1, 1, 1, 1` |
| a still-alive character on a map is topped back up to 5 | ✅ 5 entries, sequenceIndex 0–4 |
| the topped-up chain used post-recovery stats | ✅ `characterSnapshot.maxHp=158` |

**Death resolved by recovery.**

| Assertion | Result |
|-----------|--------|
| routed to town, not topped up | ✅ `status=town`, `currentMapId=null` |
| `hpCurrent` → 1 | ✅ |
| left with 0 unresolved entries | ✅ after an 8 s settle window |
| XP loss applied exactly once | ✅ 12 → 11, not 10 |
| `lastDeathLog` written by the recovery pass | ✅ correct monsterId and marker |

---

## 5. Phase 1–2 loop (carried forward, re-verified where a script touches it)

| Component | State | Evidence this session |
|-----------|-------|----------------------|
| Registration → auto-created character | ✅ | every scenario bootstraps through it |
| Email verification gate | ✅ | bypassed via `UPDATE users SET "emailVerified" = true` — the column is camelCase, **not** `email_verified` as the task prose assumed |
| Map entry + `queueBattles(5)` | ✅ | [re-verified 2026-09-28] — gambits, levelup, death, idempotency, recovery all build a real 5-deep chain |
| XP curve loading | ✅ | [re-verified 2026-09-28] — `xpToNext(1)=17`, `xpToNext(10)=30`, `xpToNext(20)=73` read from `char_xp_curve.json` |
| Level-up +5 points, ratio HP/SP | ✅ | [re-verified 2026-09-28] — see §4.3 |
| Queue discard + rebuild on level-up | ✅ | [re-verified 2026-09-28] — see §4.3 |
| Death → town, HP 1, XP loss, chain discarded | ✅ | [re-verified 2026-09-28] — see §4.4 |
| Gambit save-time validation (6 rules) | ✅ | [re-verified 2026-09-28] — see §4.2 |
| Gambit runtime evaluation | ✅ | [re-verified 2026-09-28] — see §4.2 |
| Recovery pass on boot | ✅ | [re-verified 2026-09-28] — see §4.6 |
| Idempotent resolution | ✅ | [re-verified 2026-09-28] — see §4.5 |
| Determinism / no `Math.random()` | ✅ | [re-verified 2026-09-28] — see §4.1 |
| WebSocket battle events | ❌ not implemented, not in scope | `design.md` non-goals exclude WS events from this change; no scenario covers them |

---

## 6. Issues

### 6.1 Confirmed SPEC divergences (recorded, not fixed — no production changes this session)

These are printed by the scripts as `[DIVERGENCE #n]` on every run, so they cannot be lost.

**#1 — Death XP penalty: `floor` vs `round`, and an undefined clamp.**
SPEC §6.4 says `round(xpToNextLevel(L) × 0.05)` with a clamp at `cumulativeXp[level-1]`. The
code uses `Math.floor` and clamps the result at 0 (`battle.service.ts:533-534`). At level 10
that is 1 XP where `round` gives 2. The `cumulativeXp` clamp is **undefined under the §4.2
toward-next-level model** that `characters.xp` actually holds, so this is a spec-internal
inconsistency, not only a code bug. `max(0, …)` is what actually prevents a de-level.
*Open question, carried from `design.md`: fix the SPEC or the code?*

**#2 — Resolve marks rows resolved instead of deleting them.**
`resolveBattle()` marks rows resolved and re-saves them (`battle.service.ts:502`), against
§7.4.3's "on resolve, the row is deleted". The recovery pass therefore re-reads rows a
previous resolve already applied, which is exactly why the conditional claim matters there.
§7.6 death *does* delete the rest of the chain, so the two paths disagree.

**#3 — Level-up ratio computed with an empty equipment argument.**
`battle.service.ts:462-463` passes `{}` to `calculateDerivedStats`, while
`buildCharacterSnapshot()` (`battle.service.ts:144-160`) passes real `equipmentStats`. On an
equipped character the scaled HP is off by the equipment contribution. Masked in the suite
because the fixture characters are unequipped.

**#4 — Multi-level scaling is one step, and the question is unobservable.**
The code applies one ratio step from the pre-first-level stats to the post-last-level stats
(`battle.service.ts:453-472`). The suite measures the alternative: the two readings differed by
**0–1 HP**, because `maxHp = floor(80 + VIT*12 + level*18)` is *linear* in level, so
compounding telescopes to the same product and only the `Math.round` at each intermediate step
can differ. With the current formulas the "one step or compounded" decision is **not
observable** in `hpCurrent`, and becomes observable only if `maxHp`/`maxSp` ever gains a
non-linear level term. *This resolves the open question in `design.md` empirically: the choice
is currently unobservable, so it can be deferred safely.*

**#5 (testability note, not a divergence) — the shared potion cooldown is invisible at
default DEX.** `castGaugeThreshold(dex) = max(3, 8 − floor(dex × 0.05))`, so at the default
`dex=5` the cast gauge fires every 8 ticks while the potion category cooldown is 5 ticks — it
has always expired before the next fire. The shared-category assertion therefore uses a
`dex=100` fixture (3-tick cast period). It is a property of the engine, not of any character
the API currently builds with low DEX and a potion gambit.

### 6.2 Test-evidence defects found and fixed this session

These were real bugs — in the *evidence*, not the product — and each one had produced a
misleading green result before.

| # | Defect | Why the earlier evidence was wrong |
|---|--------|--------------------------------------|
| 1 | `bull` v3 stores jobs as a flat `bull:<queue>:<id>` key, with **no** `:id:`/`:data:` suffixes, and **retains** the key after completion (no `removeOnComplete`). | `test-s63.js` scans for those suffixes, so it *always* observed zero jobs. Its `orphaned jobs: 0` output was never evidence of anything. The harness now counts membership of the `wait`/`active`/`delayed`/`paused` lists. |
| 2 | Pinned a fixed `mapKillCount` in the idempotency scenario. | The monster at index N comes from `rngForIndex(charId:mapId:epoch, N)`, so index 0 is a slime for one character and a direwolf for the next. One run staged a **loss**, routing the resolve into `handleCharacterDeath()` and never touching xp/gold/drops. The scenario now scans for a suitable index. |
| 3 | Seeded progression, then built the queue from the pre-seed bootstrap chain. | A delayed bootstrap job fired in between and rewrote `hpCurrent` (seeded 80, arrived as 192). Draining afterwards cannot close the window, because an `active` job cannot be removed. Scenarios now seed first and enter the map once. |
| 4 | Compared inventory maps by exact object equality. | `inventoryService.removeItem()` **deletes** the stack row once the quantity reaches 0, so a battle that drains the last potion leaves no row rather than a row of zeroes. "Absent" and "0" are the same state, and the strict comparison reported it as a double-deduction failure. Now compared per item with absent treated as 0, plus a total-removed cross-check. |

### 6.3 Pre-existing issues carried forward

| # | Issue | Severity | Note |
|---|-------|----------|------|
| 1 | `maxHp: null` on the attribute-allocation response | Low (cosmetic) | DTO does not compute derived stats. The suite reads maxHp/maxSP from Postgres instead, since `GET /characters` also omits them. |
| 2 | Level-1 characters lose most Green Grounds fights organically | Medium (balance) | Not a code defect. A level-1 character with an `always → attack` gambit is genuinely too weak, so every scenario pins the kill counter or seeds progression. |
| 3 | No gambit page → no legal action on any gauge | Medium (design) | With `activeGambitPageId = null` the engine hits the 200-tick stalemate valve and records a `loss`. Any character auto-created by registration has an active page (slots 0–2 are created empty and slot 0 is activated by `createCharacter`), so this only bites a hand-edited row. Worth a guard. |
| 4 | `pnpm --filter @nanommo/api lint` cannot run | Low (tooling) | `ESLint couldn't find a configuration file` — no eslint config resolves in `apps/api`. Pre-existing: it fails identically with this change's files removed, and its glob `{src,test}/**/*.ts` does not target the new `.js` scripts either way. Not a regression from this change. |

### 6.4 Limits of what the suite can prove

Recorded so a future green run is not over-read:

- **"Never topped up" is demonstrable on HP but not SP.** Every winning Green Grounds fight
  lasts ≥ 33 ticks and `spRegenPerTick` is 3, so `spAfter` is always `maxSp` before the
  level-up runs and the ratio step lands exactly on the new maximum. The SP *formula* is
  asserted exactly; the "strictly below max" half needs a fight shorter than the regen window,
  which no winnable Green Grounds encounter provides.
- **The drop branch of idempotency is unexercised** (the raced entry rolled no drops).
- **`lastDeathLog` overwrite is observed across two characters**, each of which died once. A
  character cannot die twice without re-entering a map, so a same-character double death is a
  separate scenario.
- **The recovery pass is global.** The scenario deletes other characters' unresolved rows first
  (145 on a dirty database) so the ordering assertion is unambiguous; on a shared database that
  deletion is worth knowing about before running it.

---

## 7. Still stub / TODO (outside loop scope)

| Module | Status | Note |
|--------|--------|------|
| **ChatService** | Stub (`throw new Error('Not implemented')`) | Future: server-side message persistence |
| **MailService** | Stub | Separate from `MailerService` (auth emails) |
| **TownService** | Stub | Vendor, warehouse, NPC interactions |
| **MarketService** | Stub (not started) | Buy/sell orders, order matching |
| **WebSocket gateway** | Not integrated | Socket.IO infrastructure exists but no battle events are emitted. `design.md` lists WebSocket events (`battleResolved`, `characterDied` per §16.2) as an explicit **non-goal** of this change, alongside the balance pass, the `maxHp: null` DTO issue and the stubbed services. There is consequently **no WS scenario in the suite, and WS event delivery remains unverified** — open for a Phase 4 change. |

---

## 8. Architecture notes

- **Port mapping:** the backend runs on `:3000` inside the container and is published on host
  `:3010`. `test-s63.js`'s hardcoded `http://localhost:3000` is wrong from the host.
- **`.env` names are container-internal:** `DB_HOST=db`, `REDIS_HOST=redis`. Scripts use
  `127.0.0.1:5432` / `127.0.0.1:6379` (the published ports) and read credentials from
  `PG*` env vars.
- **Email table:** `users` (plural); the verification column is `"emailVerified"`.
- **Queue response:** `GET /battles/queue` returns a bare array, not `{entries: [...]}`.
- **`GET /characters`** returns a single object (not an array) and omits `maxHp`/`maxSp`.
- **The resolver's contract is "fired after `endAt`", not "fired exactly at `endAt`."** That is
  what makes rewriting `endAt` into the past and injecting a job a legitimate way to shorten an
  in-game battle in a test.
- **Level-gated maps are checked at enter time**, so a scenario needing one must seed the level
  before `POST /maps/:mapId/enter`, not after.

---

## 9. Change state

| Item | State |
|------|-------|
| Change | `grind-loop-phase3-edge-cases` |
| `openspec validate grind-loop-phase3-edge-cases --strict` | ✅ `Change 'grind-loop-phase3-edge-cases' is valid` |
| All 33 tasks | ✅ complete |
| Spec delta | `grind-loop-verification` — 7 requirements, 30 scenarios |
| Production code changed | none |
| Dependencies added | none |

**Status: Phase 3 complete. 143/143 assertions pass; the suite is re-runnable with
`node apps/api/test-phase3-all.js`. WebSocket event delivery remains unverified and is
scoped out of this change.**
