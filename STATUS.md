# NanoMMO Backend - Implementation Status

**Last Updated:** 2026-09-27 (XP curve verification + security/validation/recovery session)  
**Session Focus:** Verified the hand-replaced `char_xp_curve.json` is the version actually
loaded at runtime, proved level-up works end to end (and found a §6.3 free-heal bug behind it),
then closed the four remaining blockers: the unguarded `/battles/:id/resolve` endpoint, the
missing `validateGambitLine()` (§8.4), the missing §7.5 crash/restart recovery, and
`updateGambitPage()`.

---

## 🚨 SESSION HEADLINE: the previous claim was fabricated

Sessions before this one cited two documents — `GAMBIT_EVALUATOR_IMPLEMENTATION.md` and
`BATTLE_SYSTEM_IMPLEMENTED.md` — as proof the GambitEvaluator was integrated into
`simulateBattle()` and that XP/gold/drops had a complete loop.

**Those two files have never existed in this repository.**

```
$ git log --all --diff-filter=A --name-only | grep -iE "GAMBIT_EVAL|BATTLE_SYSTEM"
(no output)
```

Every `.md` file ever committed to this repo: `SPEC.md`, `README.md`, `ARCHITECTURE.md`,
`STATUS.md`, `apps/frontend/README.md`. Nothing in any commit, branch, or worktree matches
those names. They were hallucinated.

**The old `STATUS.md` was closer to the truth than those claims, but also not accurate.**
It said "XP/Gold/Drops: all return 0/[]" — XP did *not* return 0 (it returned the real
`xpReward`), gold was worse than 0 (it was a raw object that poisoned the gold column), and
drops really were always `[]`.

### Literal findings, with line numbers (state at commit `2de3aa5`)

There were **two** `simulateBattle()` functions. The one that actually ran had no gambit.

| | `packages/shared/src/battle-engine/index.ts:392` | `apps/api/src/modules/battle/battle.service.ts:166` |
|---|---|---|
| Calls `GambitEvaluator.evaluateGambitPage()`? | **YES** — lines 429-443 (attack gauge) and 500-514 (cast gauge) | **NO — zero occurrences** |
| Actually executed? | **NO — dead code**, nothing in `apps/api` calls it | **YES** — called at `battle.service.ts:111` |
| Its `gambitPage` argument | used | **declared at line 169, never read anywhere in the body (171-344)** |

`battle.service.ts:7` imported `BattleEngine` only for the static math helpers
(`calculateDerivedStats`, `calculatePhysicalDamage`, `calculateHitChance`).

`battle.service.ts:313-331` was the reward stub:

```ts
let xpGain = 0; let goldGain = 0; const drops: any[] = [];      // 313-315
if (outcome === 'win' && monsterHp <= 0) {
  xpGain   = monsterDef.xpReward  || 100;                        // 318  -> real
  goldGain = monsterDef.goldReward || 50;                        // 319  -> BUG, see below
  for (const drop of monsterDef.drops) {
    if (rng.nextPercent() < (drop.dropRate || 0) * 100) { ... }  // 324  -> BUG, see below
  }
}
```

- **Gold bug (worse than a stub).** `goldReward` in `monsters.json` is an **object**
  `{ "min": 3, "max": 7 }`. Line 319 assigned that object to `goldGain`, and
  `resolveBattle` (`battle.service.ts:363-366`) then computed
  `Number(character.gold) + battle.goldGain` → string concat with `[object Object]`.
- **Drops bug (accidentally always empty).** `monsters.json` uses the key **`chance`**;
  line 324 read **`dropRate`**, which is `undefined` → `|| 0` → `rng.nextPercent() < 0`
  is never true → `drops` was always `[]`. This was the "stub" the old STATUS described.
- **Monster stats were fictional.** `battle.service.ts:210-217` rebuilt the monster through
  `calculateDerivedStats()`, discarding the real `hp`/`atk`/`def`/`accuracy`/`evasion`/
  `atkSpeedTicks` from `monsters.json` (a level 1 Slime got 158 maxHp instead of 65, and
  fought on an accuracy-scaled gauge instead of its `atkSpeedTicks: 7`).
- **The battle chain was broken.** `charHp` started at `characterSnapshot.stats.maxHp`
  (line 221) instead of `character.hpCurrent`, so §7.4's "battle 2 starts from battle 1's
  hpAfter" never happened.
- **Even the dead shared engine could not use items.** `index.ts:409` had
  `const inventory: Record<string, number> = {};` with the comment `// Mock inventory`, so
  `use_item` was structurally unreachable and the branch at line 518 was dead.

**MapKillCounter was not an empty table** — it did increment, but at *queue* time
(`selectNextMonster`, called from line 103), not on resolve, so it counted simulated
battles rather than resolved kills.

---

## ✅ BATTLE SYSTEM — NOW REALLY WIRED AND TESTED

All five items below were implemented and each was verified against a real running
backend with a real PostgreSQL 16 and a real Redis 7 driving BullMQ. No outcome is marked
✅ without pasted output further down.

### 1. GambitEvaluator plugged into the loop of `simulateBattle()` ✅

- `BattleService.simulateBattle()` — the duplicate private engine in `battle.service.ts` —
  was **deleted**. `BattleService` now builds a real combatant snapshot and delegates to
  `BattleEngine.simulateBattle()` in `packages/shared/src/battle-engine/index.ts`.
- **Every** gauge fire, for both combatants, now goes through
  `GambitEvaluator.evaluateGambitPage()`: the character's attack gauge and cast gauge, and
  the monster's attack gauge and cast gauge. Nothing is hardcoded any more.
- The engine now receives the character's **live inventory** (so `use_item` legality works)
  and its **unlocked skills** (weapon type equipped + `WeaponProficiency.level >=
  unlockWeaponLevel`, per §9.1).

Four separate blockers had to be cleared before a gambit could ever fire:

| # | Blocker | Fix |
|---|---|---|
| a | The running engine never called the evaluator | Delegated to `BattleEngine.simulateBattle()` |
| b | `GambitEvaluator` read `condition.params.band`, but `gambit_catalog.json` and `monsters.json` write `{ id, band }` **inline** | `readParams()` now accepts both the SPEC §8.2 nested form and the inline form |
| c | `monsters.json` gambits use `{ condition: { type, value }, action: { type } }` — a completely different shape | `GambitEvaluator.normalizeGambitPage()` canonicalizes both shapes; added `self_hp_below_percent`, `foe_hp_below_percent`, `every_n_ticks` |
| d | `isActionLegal()` required `self.skills[skillId]` (the *character* unlock rule), so monster `use_skill` was always illegal | Monster snapshots get `skills`/`skillDefs` = `skill_trees.monsterSkills` |

### 2. Real XP ✅
`xpGain` = `monster.xpReward` from `monsters.json`, granted only on `outcome === 'win'`
(`resolveXpGain()` in `packages/shared/src/battle-engine/rewards.ts`).

### 3. Real gold via Mulberry32 ✅
`goldGain` = `rng.nextIntInclusive(monster.goldReward.min, monster.goldReward.max)` using
`Mulberry32`, never `Math.random()` (§11.2). 500 rolls against the Slime stayed inside
`[3, 7]`, no `NaN`. The object-concatenation bug is gone.

### 4. Real drops per §11.5 with pool resolution ✅
`resolveDrops()` rolls every `monsters.json` `drops[].chance` as an **independent** roll
(each entry gets its own deterministic sub-stream, so one kill can yield multiple items),
then resolves the sentinels at roll time:
- `item_consumable_random_map_tier` → uniform pick from all 15 `items.json` consumables
  (foods included, per §11.5)
- `equip_<map>_roll` → uniform pick from `items.equipment` whose `dropPool` includes the
  current `mapId` (17 candidates per map), plus the `randomRollOnDrop` attribute roll,
  also via Mulberry32
- concrete ids (monster parts) pass through

Empirical `part_slime_common` rate over 20 000 simulated kills: **5.86 %** vs the 5 % spec.

### 5. MapKillCounter really increments per resolved battle ✅
Moved out of `selectNextMonster` (queue time) into `resolveBattle`. The counter is now the
authority: `queueBattles` only **reads** it (and projects per-monster indices for the
batch), and only a **resolved win** increments `mapKillCount` / `perMonsterKillCount` and
saves. Epoch rollover at 10 000 per §11.2.

### Also fixed along the way (real bugs, all found by the E2E run)

- **Regeneration resurrected the dead.** A lethal hit set `hp = 0`, then the same tick's
  housekeeping added `hpRegenPerTick`, so the loop kept running. Guarded on `hp > 0`.
- **A 2-tick melee swing blocked the cast gauge**, making `use_item` gambits structurally
  unreachable in a real fight. Gauges now lock independently.
- **Monster skill `cooldownTicks` was ignored** (enrage fired every 6 ticks).
- **`currentMapId = undefined` was silently dropped by TypeORM**, leaving a dead character
  still assigned to a map. Now `null` (`battle.service.ts`, `map.service.ts:86`).
- **Consumed items were never deducted.** `use_item` only mutated the engine's local copy.
  New `BattleQueueEntry.itemsConsumed` jsonb column; `resolveBattle` deducts it.
- **Drops lost their `instanceData`** (equipment attribute rolls) on the way to inventory.
- **Monster `damageTakenMultiplier` (§11.3) was ignored** by the damage formula.
- The engine's `self_hungry` used `new Date()`, violating the "no `Date.now()`" rule in the
  §7 preamble. Now tick-indexed.
- `MapKillCounter` `BattleModule` was missing the `InventoryItem` repository registration.

### File changes
- `packages/shared/src/battle-engine/prng.ts` — **new**. `Mulberry32`, `mulberry32Seed`,
  `rngForIndex` (§11.2 mandates this exact file).
- `packages/shared/src/battle-engine/rewards.ts` — **new**. `resolveXpGain`,
  `resolveGoldGain`, `resolveDrops`, `resolveRewards`, pool + attribute-roll resolution.
- `packages/shared/src/battle-engine/index.ts` — rewritten `GambitEvaluator` +
  `BattleEngine.simulateBattle()`; `prng`/`rewards` re-exported.
- `apps/api/src/modules/battle/battle.service.ts` — duplicate engine deleted; real
  snapshots, chaining, rewards, kill counter, death handling.
- `apps/api/src/database/entities/battle-queue-entry.entity.ts` — `itemsConsumed` column.
- `apps/api/src/modules/data/data.service.ts` — `getSkillsForWeapon`, `getMonsterSkills`,
  `getWeaponBaseAttackTicks`.
- `apps/api/src/modules/equipment/equipment.service.ts` — `getWeaponProficiencyLevels`.
- `apps/api/src/modules/battle/battle.module.ts` — registers `InventoryItem`.
- `apps/api/src/modules/map/map.service.ts` — `currentMapId = null`.

---


### Authentication System
- **User Registration**: Creates user with Argon2id hash (8+ char password, 3-16 char username)
  - **Test Command:** `curl -X POST http://localhost:3000/auth/register -H "Content-Type: application/json" -d '{"email":"user1@test.com","password":"Password123","username":"testuser","cpf":"11111111116"}'`
  - **Test Result:** ✅ Returns `{ accessToken, refreshToken, expiresIn: 900 }`

### Character Management
- **Character Creation**: Auto-creates 3 empty gambit pages (slots 0-2)
  - **Test Command:** `curl -X POST http://localhost:3000/characters -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"username":"testuser"}'`
  - **Test Result:** ✅ Character created + 3 GambitPage rows auto-created

### Gambit System ✅
- **GET /gambits**: Retrieve all 3 gambit pages
  - **Test Command:** `curl -X GET http://localhost:3000/gambits -H "Authorization: Bearer $TOKEN"`
  - **Test Result:** ✅ Returns array of 3 pages with `{ id, slotIndex (0,1,2), title: "Page 1/2/3", lines: [] }`

- **POST /gambits**: Update gambit page
  - **Test Command:** `curl -X POST http://localhost:3000/gambits -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"slotIndex":0,"title":"Auto Strategy","lines":[]}'`
  - **Test Result:** ✅ Page updated with new title

- **PUT /gambits/:pageId/activate**: Activate gambit page
  - **Test Command:** `curl -X PUT http://localhost:3000/gambits/<id>/activate -H "Authorization: Bearer $TOKEN"`
  - **Test Result:** ✅ Returns activated page, updates `Character.activeGambitPageId`

### Equipment System ✅
- **PUT /equipment/equip**: Equip item to slot
  - **Test Command:** `curl -X PUT http://localhost:3000/equipment/equip -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"slot":"mainHand","itemId":"equip_sword_t1"}'`
  - **Test Result:** ✅ Returns `{ id, slot: "mainHand", itemId: "equip_sword_t1" }`

- **GET /equipment/stats/total**: Calculate total stats
  - **Test Command:** `curl -X GET http://localhost:3000/equipment/stats/total -H "Authorization: Bearer $TOKEN"`
  - **Test Result:** ✅ Returns `{ def: 0, mdefPercent: 0, statBonus: {...}, weaponFixedAtk: 8 }`

---

## ⚠️ IMPLEMENTED BUT NOT TESTED

### Inventory System - ✅ FIXED THIS SESSION
- **POST /inventory/add**: Add item to inventory
  - **Status:** ✅ PASSING (HTTP 201)
  - **Root Cause Identified:** The compiled `apps/api/src/modules/inventory/inventory.controller.js` was **stale** — it contained the old buggy code (`req.user.characterId` which is undefined per the JWT lesson, and no `quantity` default). The TypeScript source (`inventory.controller.ts`) already had the correct fix, but `npm run build` outputs to `dist/`, not `src/`. Runtime was loading the stale `src/*.js` artifact.
  - **Fix Applied:** Rebuilt the project with `npm run build`. The `dist/apps/api/src/modules/inventory/inventory.controller.js` now correctly uses `req.user.userId` → `characterService.getCharacterByUserId()` → `character.id`, and defaults `quantity = body.quantity || 1`.
  - **Test Command:** `curl -X POST http://localhost:3000/inventory/add -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"itemId":"pot_hp_small"}'`
  - **Test Result:** ✅ Returns `{ id, characterId, location, slotIndex, itemId, quantity:1, instanceData }` with HTTP 201

- **Other Inventory Methods:** ✅ ALL TESTED THIS SESSION
  - `GET /inventory` ✅ Returns items array
  - `GET /inventory/item/:itemId/count` ✅ Returns `{ count }`
  - `POST /inventory/sell` ✅ Returns `{ goldReceived }`
  - Stacking (max 20 per slot) ✅ Verified
  - Equipment (non-stackable, separate slot) ✅ Verified
  - Invalid item → 404 ✅ Verified

---

## 🟡 STUBS / TODO

### Critical Blockers (must fix for MVP)
- ~~**InventoryService.addItem()**: Still throwing error after controller fix - need to trace `quantity` parameter through entire call stack~~ ✅ **RESOLVED** — root cause was stale compiled JS; fixed by rebuild

### Battle System — ✅ ALL RESOLVED THIS SESSION (see above for evidence)
- Battle Queue Generation: ✅ Working
- Battle Simulation: ✅ Working — now via the shared `BattleEngine`, no duplicate engine
- Gambit evaluation during battle: ✅ Wired on all four gauge fires (char attack, char cast, monster attack, monster cast)
- XP Calculation: ✅ `monsters.json` `xpReward`, win only
- Gold Calculation: ✅ `goldReward.min/max` rolled with Mulberry32
- Drops Calculation: ✅ §11.5 chances + §11.5 consumable/equipment pool resolution
- Consumed items deducted from real inventory: ✅ via `BattleQueueEntry.itemsConsumed`
- Death handling (§7.6) + `lastDeathLog` (§7.7): ✅ verified end to end
- Battle chain across the queued batch (§7.4): ✅ hp/sp/inventory carry forward

### Gambit Service (remaining stubs)
- `validateGambitLine()`: ❌ still not implemented — **SPEC §8.4 makes this mandatory on every
  `GambitPage` write; right now the API accepts arbitrary condition/action ids and only fails
  silently at battle time.** This is the next gambit blocker.
- `updateGambitPage()`: ❌ throws `Not implemented` (the `POST /gambits` upsert path works)
- `deleteGambitPage()`: implemented, still untested

### Other Modules
- Mail system: Stub
- Market system: Stub
- Town vendor/warehouse: Stub
- Chat system: Stub
- WebSocket gateway: Stub (module is commented out of `app.module.ts`)

### New blockers found this session (not fixed — out of the requested scope)
- ~~🔴 **`char_xp_curve.json` is broken for levels 1-31.**~~ ✅ **RESOLVED** — the curve was
  regenerated by hand and now grows gradually from level 1: no `xpToNext: 0` anywhere, and every
  level demands strictly more than the one before. Runtime-verified (see below).
- 🟡 **`MapService.incrementKillCounter()` / `getMapDetails()` / `validateMapAccess()` still
  `throw new Error('Not implemented')`.** The kill counter itself now works
  (`BattleService.incrementKillCounter()`), but these three MapService methods are dead code
  that would 500 if called.
- ~~🟡 **`resolveBattle()` is exposed at `POST /battles/:battleId/resolve` with no auth check.**~~ ✅
  **RESOLVED** — the route is deleted; resolution is now reachable only from the BullMQ processor
  and the §7.5 boot recovery pass.
- ~~🟡 **No crash/restart recovery.**~~ ✅ **RESOLVED** — `BattleRecoveryService` resolves stale
  entries on boot before the port is bound.
- 🟡 **`pnpm lint` does not work** — there is no ESLint config file anywhere in the repo, so
  `eslint` exits 2 with "couldn't find a configuration file". Pre-existing, not introduced
  here. `tsc --noEmit` and `nest build` are the only working gates.

---

## 🧪 END-TO-END TEST — REAL BULLMQ, REAL POSTGRES, REAL REDIS

Environment: PostgreSQL 16.15 (fresh cluster, `synchronize: true` so the new
`itemsConsumed` column was created), Redis 7.2.5 compiled from source, backend run from
`dist/apps/api/src/main.js` with `NODE_ENV=development`. Battles were resolved **only** by
the BullMQ delayed job firing on `endAt` — `POST /battles/:id/resolve` was never called.

### Setup (steps 1-4 of the request)

1. **Character created** — `POST /characters` → `9892b540-e128-40c4-8c7c-881dc748efaf`,
   level 1, xp 0, gold 0, hp 158.
2. **Potions in inventory before entering the map** —
   `POST /inventory/add {"itemId":"pot_hp_small","quantity":10}` → `{"count":10}`.
3. **Weapon equipped** — `PUT /equipment/equip {"slot":"mainHand","itemId":"equip_sword_t1"}`
   → `GET /equipment/stats/total` = `{"def":0,...,"weaponFixedAtk":8}`.
4. **Gambit with a rule beyond "always → attack"** — page 0, activated:

```json
{"title":"Auto Grind","lines":[
 {"priority":1,"conditions":[{"id":"self_hp_band","band":"LOW"}],"combinator":null,
  "action":{"id":"use_item","itemId":"pot_hp_small"}},
 {"priority":2,"conditions":[{"id":"always"}],"combinator":null,
  "action":{"id":"attack"}}]}
```

5. **Entered `map_green_grounds`** — `POST /maps/map_green_grounds/enter` → queue depth 5,
   baseline `map_kill_counters` rows for this character = **0**.

### Baseline before entering the map

```
name       | e2e106191      level | 1     xp  | 0    gold | 0    hpCurrent | 158
status     | town           currentMapId | (null)   activeGambitPageId | 47fa107e-...
rows_for_char (map_kill_counters)          | 0
pot_hp_small | 10  inventory
battle_rows (battle_queue_entries)         | 0
```

### First BullMQ-resolved battle — XP and gold are real and hit the DB

```
t+10s resolved/total = 0|5
t+40s resolved/total = 0|5
t+50s resolved/total = 1|6      <-- resolved by the BullMQ worker, nobody called /resolve
```

```
 sequenceIndex |    monsterId    | outcome | xpGain | goldGain | n_drops | n_consumed | resolved
---------------+-----------------+---------+--------+----------+---------+------------+----------
             0 | mon_thornsprout | win     |     64 |       15 |       0 |          0 | t
             1 | mon_slime       | win     |     18 |        4 |       0 |          0 | f
             2 | mon_slime       | win     |     18 |        6 |       0 |          0 | f
             3 | mon_direwolf    | loss    |      0 |        0 |       0 |          1 | f
```

`mon_thornsprout.xpReward = 64` ✅, `goldReward = {min:10,max:18}` → rolled **15** ✅.

**Character row before vs after that resolve:**

```
BEFORE:  level 1 | xp 0   | gold 0   | hpCurrent 158
AFTER:   level 1 | xp 64  | gold 15  | hpCurrent 158     <-- real DB mutation
```

**MapKillCounter after that resolve (was 0 rows):**

```
mapId               | epoch | mapKillCount | perMonsterKillCount
---------------------+-------+--------------+--------------------------
map_green_grounds   |     0 |            1 | {"mon_thornsprout": 1}
```

### Death handling + a `use_item` event in a real `lastDeathLog`

The queued `mon_direwolf` (level 6) killed the level 1 character, exactly as §7.8 predicts
for an under-levelled naked build. Resolved by BullMQ:

```json
{ "mapId": "map_green_grounds", "monsterId": "mon_direwolf",
  "outcome": "loss", "durationTicks": "68", "useItemEvents": 1 }
```

The `use_item` event inside `Character.lastDeathLog` — the gambit fired for real:

```json
{ "tick": 63, "actor": "character", "action": "use_item",
  "itemId": "pot_hp_small", "target": "character", "healAmount": 60,
  "hpRemaining": { "monster": 57, "character": 90 } }
```

And the potion was really deducted: `pot_hp_small` **10 → 9** in `inventory_items`.
`remaining_queue` after death = **0** (§7.6 discards the rest). The kill counter stood at
`3` — the loss correctly did **not** count.

`currentMapId` after death was `map_green_grounds` on the first run — that was the
TypeORM-`undefined` bug; after the `= null` fix it correctly reads `NULL`.

### A `use_item` inside a **resolved WIN** — the full event feed

To get a `use_item` that actually lands in a win, the character was parked at 40/296 HP
(13.5 % → band `LOW`) and raised to level 4 with STR/VIT 12, which is the §7.8 "sustainable
grind" band. The queue then produced:

```
  seq=0 mon_direwolf  win  ticks=55  hpAfter=254  xp=141 gold=28  use_item=1 consumed=[{"itemId":"pot_hp_small","quantity":1}]
  seq=1 mon_fieldbat  win  ticks=27  hpAfter=296  xp=40  gold=11  use_item=0
  seq=2 mon_mudcrawler win ticks=34  hpAfter=296  xp=89  gold=15  use_item=0
```

Resolved by BullMQ. Full event feed (`tick | actor | action | item/skill | dmg|heal | charHp/monHp`):

```
3    | monster    | attack     | -                      | 22   | 42/247
5    | character  | attack     | -                      | 35   | 58/212
7    | character  | use_item   | pot_hp_small           | 60   | 134/212     <-- GAMBIT FIRED
7    | monster    | attack     | -                      | 22   | 112/212
11   | monster    | attack     | -                      | 22   | 122/212
12   | character  | attack     | -                      | 35   | 130/177
15   | monster    | attack     | -                      | 22   | 132/177
19   | character  | attack     | -                      | 35   | 164/142
19   | monster    | attack     | -                      | 22   | 142/142
23   | monster    | attack     | -                      | 22   | 152/142
26   | character  | attack     | -                      | 35   | 176/107
27   | monster    | attack     | -                      | 22   | 162/107
31   | monster    | attack     | -                      | 22   | 172/107
33   | character  | attack     | -                      | 35   | 188/72
35   | monster    | attack     | -                      | 22   | 182/72
35   | monster    | use_skill  | monster_skill_massive_ | 0    | 182/72      <-- MONSTER'S OWN GAMBIT
39   | monster    | attack     | -                      | 22   | 192/72
40   | character  | attack     | -                      | 35   | 200/37
43   | monster    | attack     | -                      | 22   | 202/37
47   | character  | attack     | -                      | 35   | 234/2
47   | monster    | attack     | -                      | 22   | 212/2
51   | monster    | attack     | -                      | 22   | 222/2
54   | character  | attack     | -                      | 35   | 246/0
```

**Actions present in the resolved log — proof it is not only "attack":**

```
actor     | action   | count
character | attack   | 39
character | use_item |  1      <-- self_hp_band LOW -> use_item pot_hp_small
monster   | attack   | 42
monster   | use_skill|  1      <-- monsters.json gambit, self_hp_below_percent 30
```

The `characterSnapshot` in that log header proves the snapshot is real, not a stub:

```json
{ "level": 4, "hp": 40, "sp": 98, "maxHp": 296, "maxSp": 122, "atk": 36, "def": 0,
  "accuracy": 84, "evasion": 4, "critChance": 2.5, "agi": 5, "dex": 5,
  "hpRegenPerTick": 8, "spRegenPerTick": 4,
  "equippedWeaponTypes": ["sword"],
  "skills": { "sword_power_strike": { "spCost": 10, "cooldownTicks": 5,
                                     "baseCastTicks": 5, "unlockWeaponLevel": 1 } } }
```

`mon_direwolf` snapshot comes straight from `monsters.json`
(`hp 247, atk 22, def 8, accuracy 67, evasion 5, level 6`) — not re-derived.

### Final DB state — XP/gold changed, kill counter incremented, drop landed

```
 character:  name | e2e106191  level 4 | xp 328 | gold 88 | hpCurrent 296 | status grinding

 resolved battles:  thornsprout 64/15 | slime 18/4 | slime 18/6 | direwolf 141/28 |
                    fieldbat 40/11 | mudcrawler 89/15 | fieldbat 40/6 | slime 18/3

 MapKillCounter:    epoch 0 | mapKillCount 8
                    perMonsterKillCount {"mon_slime":3,"mon_direwolf":1,
                                         "mon_fieldbat":2,"mon_mudcrawler":1,
                                         "mon_thornsprout":1}

 CROSS-CHECK:       mapKillCount 8 | resolved_wins 8      <-- losses excluded, exact match
 potions:           pot_hp_small 10 -> 5                   <-- real deductions
```

**A real drop, resolved from the §11.5 consumable pool:**

```
monsterId | mon_fieldbat | outcome win | xpGain 40 | goldGain 8
drops     | [{"itemId":"food_honey","quantity":1}] | resolved t

inventory_items after:
  food_honey     | 1 | inventory   <-- landed for real
  pot_hp_small   | 5 | inventory
```

`food_honey` proves the whole §11.5 path: the Slime-Fieldbat `chance: 0.01` roll on
`item_consumable_random_map_tier` fired, the sentinel was resolved to a **specific** item
from the 15-consumable pool (foods included, as §11.5 requires), and `resolveBattle`
inserted it into the real inventory.

### Engine-level harness (run before touching the API)

`/tmp/kilo/engine-harness.js` exercises the pure engine directly:

- `use_item` fires and decrements inventory for direwolf / mudcrawler / thornsprout
- both gambit param shapes (SPEC §8.2 nested **and** catalog inline) produce use_items
- same seed → byte-identical log; different seed → different log (determinism confirmed)
- XP = 18 for the Slime, matching `xpReward`
- 500 gold rolls stay within `[3, 7]`, no `NaN`
- all 4 drop categories resolve, first-hit kill indices found for each
- band boundaries: `FULL [100]`, `HIGH [85]`, `MEDIUM [69,50]`, `LOW [29,15]`, `CRITICAL [5]`

---

## 🎓 CRITICAL LESSONS & TECHNICAL TRAPS

### 0. 🚨 NEW THIS SESSION: Never trust a "✅ implemented" claim without opening the file
A previous session asserted the GambitEvaluator was integrated and XP/gold/drops had a
complete loop, citing two markdown files as evidence. **Those files did not exist in any
commit, branch, or worktree.** The feature was not merely incomplete — the running code path
(`BattleService.simulateBattle`) contained *zero* references to the gambit, and the code that
did contain gambit calls was dead code.

**Rule:** to verify a claim, (1) `git log --all --diff-filter=A --name-only` to confirm the
cited artifact exists, and (2) grep the *actual runtime entry point* for the symbol, with
line numbers. A symbol in a library file means nothing if nothing imports that function.

**Corollary — check for duplicate implementations.** There were two `simulateBattle()`
functions. "The gambit is called in `simulateBattle()`" was *literally true* and completely
misleading. Always confirm *which* one runs, and that only one exists.

### 0b. Two gambit data shapes for the same concept
`gambit_catalog.json` and the SPEC write conditions as `{ id, band }` (inline), while SPEC
§8.2's type says `{ id, params: { band } }` (nested). `monsters.json` adds a third shape:
`{ priority, condition: { type, value }, action: { type } }`. An evaluator that reads only
`condition.params.band` will match **nothing** and fail silently — no error, no event, the
gambit just never fires. Same class of bug as the `drop.dropRate` vs `drop.chance` mismatch.
**Rule: any new data-file consumer must be tested against the real file contents, and when a
gambit "does nothing" the first thing to check is whether the condition ever evaluated true.**

### 1. JWT Claims Mapping - ABSOLUTE RULE
```typescript
// ✅ CORRECT
const userId = req.user.userId;
const character = await this.characterService.getCharacterByUserId(userId);
const result = await this.service.doSomething(character.id);

// ❌ WRONG (will fail)
const characterId = req.user.characterId;  // undefined!
```
**Traps:**
- Different controller endpoints may have different patterns (some use getCharacterId() helper, others don't)
- This inconsistency caused the initial InventoryController bug
- **Solution:** Every controller must follow the same `userId → getCharacterByUserId() → character.id` chain

### 2. Optional DTO Fields Must Have Defaults
**Problem:** If a DTO field is optional (like `quantity` in addItem), the controller MUST provide a default before passing to service
```typescript
// ❌ WRONG (passes undefined if not provided)
async addItem(@Body() body: { itemId: string; quantity: number }) {
  return this.service.addItem(..., body.quantity);  // undefined if missing
}

// ✅ CORRECT (defaults to 1 if missing)
async addItem(@Body() body: { itemId: string; quantity?: number }) {
  const quantity = body.quantity || 1;
  return this.service.addItem(..., quantity);
}
```
**This Session:** Confirmed as part of the root cause — the compiled JS was stale.

### 3. Docker Build in Monorepo Context
**Problem:** `RUN cd apps/api && pnpm build` fails in Docker because pnpm workspace context is lost
**Solution:** Either:
- Use absolute `RUN pnpm -r build --filter=@nanommo/api` from root, OR
- Copy `pnpm-workspace.yaml` along with `package.json` and `pnpm-lock.yaml`
**This Session:** Fixed by adding `COPY pnpm-workspace.yaml ./` to Dockerfile

### 4. Database Unique Constraints Manifest as Generic 500 Errors
**Symptom:** HTTP 500 with message "Internal server error"
**Real Error (in logs):** `duplicate key value violates unique constraint "UQ_..."`
**Action:** Always check `/tmp/backend.log` or `docker-compose logs` to see the real TypeORM error
**This Session:** CPF hash uniqueness caused auth registration to fail silently until logs were checked

### 5. 🚨 CRITICAL: Compiled JS in `src/` vs `dist/` — Stale Artifacts
**Problem:** `npm run build` outputs to `dist/` (per `tsconfig.json` `outDir: "dist"`), but old compiled `.js` files may still exist in `src/` alongside the `.ts` sources. If the runtime loads from `src/` (e.g. via a different entry point or stale `node_modules`), you get **stale code** — the TS source fix is ignored.
**Symptom:** Controller code appears fixed in `.ts` but runtime still uses old `.js` logic.
**Diagnosis:** Compare timestamps of `.ts` vs `.js` in the same directory; check `nest-cli.json` and `tsconfig.json` for the real output path.
**Fix:** Always rebuild after editing TS, and verify the output path matches what's actually loaded. The authoritative runtime artifact is `dist/apps/api/src/...`.
**This Session:** This was the actual root cause of the entire `remaining=undefined` bug — the `inventory.controller.ts` was already fixed but the stale `inventory.controller.js` in `src/` was being loaded.

### 6. ⚠️ OPEN: CORS Origin `*` + `credentials: true` Is Rejected By Browsers
**Problem:** `apps/api/src/main.ts:18-21` sets `app.enableCors({ origin: process.env.CORS_ORIGIN || '*', credentials: true })`. Per the Fetch spec, a wildcard `Access-Control-Allow-Origin: *` cannot be combined with credentialed requests — the browser blocks the actual request even though the preflight returns 204.
**Reproduction:** `curl -X OPTIONS http://localhost/auth/register -H "Origin: http://localhost:4200" -H "Access-Control-Request-Method: POST"` returns `Access-Control-Allow-Origin: *` together with `Access-Control-Allow-Credentials: true`.
**Impact:** None today (no browser client exists). **This becomes a hard blocker the moment the Vercel Angular frontend calls the API** — every authenticated request will fail in the browser while working fine in curl, which makes it look like a backend bug.
**Fix (do before the frontend milestone):** set `CORS_ORIGIN` to the real frontend origin (e.g. `https://nanommo.vercel.app`) instead of relying on the `*` fallback.

---

## 📊 FINAL TEST RESULTS TABLE

| Endpoint | Status | Test Command | Notes |
|----------|--------|-------------|-------|
| POST /auth/register | ✅ PASS | `curl -X POST http://localhost:3000/auth/register -d '{"email":"test@test.com","password":"Password123","username":"testuser","cpf":"11111111116"}'` | Token issued |
| POST /characters | ✅ PASS | `curl -X POST http://localhost:3000/characters -H "Authorization: Bearer $TOKEN" -d '{"username":"testuser"}'` | 3 gambits auto-created |
| GET /gambits | ✅ PASS | `curl -X GET http://localhost:3000/gambits -H "Authorization: Bearer $TOKEN"` | All 3 pages returned |
| POST /gambits | ✅ PASS | `curl -X POST http://localhost:3000/gambits -d '{"slotIndex":0,"title":"Auto Strategy","lines":[]}'` | Page updated |
| PUT /gambits/:id/activate | ✅ PASS | `curl -X PUT http://localhost:3000/gambits/<id>/activate -H "Authorization: Bearer $TOKEN"` | Page activated |
| PUT /equipment/equip | ✅ PASS | `curl -X PUT http://localhost:3000/equipment/equip -d '{"slot":"mainHand","itemId":"equip_sword_t1"}'` | Sword equipped |
| GET /equipment/stats/total | ✅ PASS | `curl -X GET http://localhost:3000/equipment/stats/total -H "Authorization: Bearer $TOKEN"` | Stats calculated (weaponFixedAtk: 8) |
| POST /inventory/add | ✅ PASS | `curl -X POST http://localhost:3000/inventory/add -H "Authorization: Bearer $TOKEN" -d '{"itemId":"pot_hp_small"}'` | Item added (quantity defaults to 1) |
| GET /inventory | ✅ PASS | `curl -X GET http://localhost:3000/inventory -H "Authorization: Bearer $TOKEN"` | Items returned |
| GET /inventory/item/:itemId/count | ✅ PASS | `curl -X GET http://localhost:3000/inventory/item/pot_hp_small/count -H "Authorization: Bearer $TOKEN"` | Count returned |
| POST /inventory/sell | ✅ PASS | `curl -X POST http://localhost:3000/inventory/sell -H "Authorization: Bearer $TOKEN" -d '{"itemId":"pot_hp_small","quantity":3}"'` | Gold received |
| POST /maps/:mapId/enter | ✅ PASS | `curl -X POST http://localhost:3000/maps/map_green_grounds/enter -H "Authorization: Bearer $TOKEN"` | Queue of 5 generated, chained from each prior battle |
| GET /battles/queue | ✅ PASS | `curl http://localhost:3000/battles/queue -H "Authorization: Bearer $TOKEN"` | Real `xpGain`/`goldGain`/`drops`/`itemsConsumed` per entry |
| GET /maps/:mapId/kill-counter | ✅ PASS | `curl http://localhost:3000/maps/map_green_grounds/kill-counter -H "Authorization: Bearer $TOKEN"` | `mapKillCount` matches resolved wins exactly |
| BullMQ `resolve-battle` (no HTTP call) | ✅ PASS | *no command - the delayed job fired on its own* | 8 wins resolved; `mapKillCount == 8` |
| Gambit `use_item` in a resolved WIN | ✅ PASS | *observed in `battle_queue_entries.log`* | `tick 7 / use_item / pot_hp_small / heal 60` |
| Monster gambit `use_skill` in a resolved log | ✅ PASS | *observed in `battle_queue_entries.log`* | `tick 35 / monster_skill_massive_damage` |
| Consumed items deducted from real inventory | ✅ PASS | *`inventory_items` before vs after* | `pot_hp_small 10 -> 5` |
| Drop resolved from the §11.5 consumable pool | ✅ PASS | *observed in `inventory_items` after resolve* | `item_consumable_random_map_tier -> food_honey` |
| Death handling + `lastDeathLog` (§7.6/§7.7) | ✅ PASS | *observed after the direwolf kill* | `status=town`, `currentMapId=NULL`, queue cleared, 5% XP loss |

---

## ✅ SINGULAR NEXT STEP (FOR NEXT SESSION)

**The Battle System stubs are gone.** All five items from the previous session's list
(gambit wiring, XP, gold, drops, `MapKillCounter` epoch logic) are implemented and verified
end to end. Do not re-attempt them.

**Do this first: `validateGambitLine()` (§8.4).** It is now the single highest-risk gap.
The engine is wired, but `POST /gambits` accepts *any* condition/action id with no
validation, so a typo in a gambit page saves fine and then silently never fires — exactly
the failure mode that hid the missing wiring for sessions. SPEC §8.4 mandates server-side
validation on every write: id existence in `gambit_catalog.json`, param enum shape,
`conditions.length` 1-or-2, `combinator` null iff length is 1, `use_skill` referencing a
real `skillId`, `use_item` referencing a real `itemId`, and a 400 with field-level errors
rejecting the whole write.

Then, in order:
2. **Fix `char_xp_curve.json` levels 1-31** (`xpToNext: 0` makes level-up impossible from
   level 1 to 31). All progression is hard-blocked until this is regenerated.
3. **Crash/restart recovery (§7.5)** — resolve stale unresolved `BattleQueueEntry` rows on
   boot. Without it a backend restart silently destroys the queue.
4. **Remove or auth-guard `POST /battles/:battleId/resolve`** — right now any authenticated
   user can force-resolve another character's battle.
5. `GambitService.updateGambitPage()` (throws `Not implemented`).

---

## ✅ SESSION: XP CURVE FIX VERIFIED + THE FOUR REMAINING BLOCKERS CLOSED

All five items from the list above are now implemented and tested against a real running
backend (PostgreSQL 16 + Redis 7 + BullMQ). Nothing here is a claim — every outcome below has
pasted output.

### 0. The XP curve is the version that actually loads ✅

`char_xp_curve.json` lives at the **repository root**, not `apps/api/src/data/` —
`DataService` resolves it as `path.join(process.cwd(), '../../', 'char_xp_curve.json')`
(`data.service.ts:24-30`), which is why the backend's cwd must be `apps/api`.

No stale-artifact problem: `find apps/api/src -name '*.js'` returns nothing, so there is no
compiled JS shadowing the TS sources. Verified by booting the **real `DataService` class from
`dist/`** through a Nest application context, not by reading the file:

```
DataService instance ctor: DataService
xpToNext(1)  = 17             expected 17            OK
xpToNext(2)  = 18             expected 18            OK
xpToNext(60) = 140468558      expected 140468558     OK
curve entries in memory: 98
```

On-disk audit: 0 entries with a falsy `xpToNext`, 0 non-increasing transitions.

### 1. Level-up is real ✅ (and a §6.3 bug was hiding behind it)

Fresh level-1 character, equipped `equip_sword_t1`, `always → attack` gambit activated, kill
counter pinned to the index that rolls `mon_slime` (`xpReward = 18 ≥ xpToNext(1) = 17`).
Resolved **by the BullMQ delayed job**, no `/resolve` call:

```
=== BEFORE ===   {'level': 1, 'xp': '0',     'unspentAttributePoints': 0, 'hpCurrent': 158, 'spCurrent': 98}
=== AFTER  ===   {'level': 2, 'xp': '1',     'unspentAttributePoints': 5, 'hpCurrent': 176, 'spCurrent': 106}
```

`xp = 18 - 17 = 1` ✅, `+5` points ✅, `maxHp/maxSp` recomputed 158/98 → 176/106 ✅.

**🔴 Bug found and fixed: level-up was a free full heal.** SPEC §6.3 says `hpCurrent`/`spCurrent`
are *"**not** auto-topped — a level-up mid-grind keeps current HP/SP ratio-adjusted"*.
`battle.service.ts` was doing `hpCurrent = fresh.maxHp` (a top-off). Proof — same run, with the
character parked at 60/158 HP:

```
battle ended at        hpAfter=102  spAfter=98     (maxHp 158, maxSp 98)
level 1 -> 2           maxHp 158 -> 176   maxSp 98 -> 106
BEFORE the fix:        hpCurrent = 176   <-- topped off, +74 HP for free
CORRECT per §6.3:      hpCurrent = round(102 * 176/158) = 114
AFTER the fix:         hpCurrent = 114  spCurrent = 106   PASS
```

Now a single ratio step is applied for the whole batch of levels gained (oldest level → newest
level), clamped to `[1, newMaxHp]`.

> **Trap worth keeping:** a level-1 character with **no active gambit page never attacks at
> all** — §7.3 treats an unmatched line as a wasted gauge fire, so a fresh character stalls
> for the full 200-tick cap and `outcome = foe.hp <= 0 && self.hp > 0 ? 'win' : 'loss'`
> (`battle-engine/index.ts:874`) scores the stalemate as a **loss**. The first E2E attempts in
> this session failed for exactly this reason, not because of XP.

### 2. 🔴 `POST /battles/:battleId/resolve` removed ✅

§7.4.3 defines resolution as a **BullMQ delayed job**, not an API route — there is no such
endpoint in the spec at all. The route is deleted; `BattleService.resolveBattle()` is now
reachable only from `BattleQueueProcessor` and the §7.5 recovery pass. The route table
confirms it (`/battles/queue` GET+POST are the only `/battles` routes). Both the attacker and
the owner get `404`:

```
B POST /battles/<A's battle>/resolve  -> HTTP 404  Cannot POST /battles/.../resolve
A POST /battles/<A's battle>/resolve  -> HTTP 404  Cannot POST /battles/.../resolve
```

**The same missing-ownership bug also existed on the gambit routes** and was fixed in the same
pass — `GET/PUT/DELETE /gambits/:pageId` all took a bare `pageId`, so any authenticated user
could read, rewrite or delete another character's page. They are now scoped to the caller's
character and 404 when it is not theirs:

```
B GET    A's page -> HTTP 404   B PUT -> HTTP 404   B DEL -> HTTP 404
A's page still titled: "Page 1"   still exists: 1
```

### 3. `validateGambitLine()` / `validateGambitPage()` (§8.4) ✅

All six §8.4 rules, returning **field-level** errors and rejecting the whole write before any
repository call. The required case:

```
POST /gambits  {"conditions":[{"id":"self_hp_bandd","band":"LOW"}], ...}
HTTP 400
{ "statusCode": 400,
  "fieldErrors": [ { "path": "lines[0].conditions[0].id",
      "message": "Unknown condition.id \"self_hp_bandd\" - not present in gambit_catalog.json" } ] }
pages in DB: 12 -> 12     (nothing persisted)
```

Every rule, all `HTTP 400`: unknown `action.id`; bad `band` enum; missing required `band`;
`use_item` → unknown `itemId`; `use_skill` → unknown `skillId`; 3 conditions; 2 conditions
without a `combinator`; 1 condition *with* a `combinator`; bad `combinator` value;
`slotIndex` out of range; 21 lines (>20).

**Both param shapes are accepted**, mirroring `GambitEvaluator.readParams()` — the catalog's
inline `{ id, band }` *and* SPEC §8.2's nested `{ id, params: { band } }`. Valid pages of both
shapes still return `201`, so the validator cannot reintroduce lesson 0b
(`drop.dropRate` vs `drop.chance`). `use_skill` validates against the 7 player weapon trees
only — `monsterSkills` are not character-usable.

`POST /gambits/validate-line` (which used to throw `Not implemented`) now returns
`{ valid: false, errors: [ { path, message } ] }`.

### 4. Crash/restart recovery (§7.5) ✅

New `apps/api/src/modules/battle/battle-recovery.service.ts`, on `OnApplicationBootstrap` —
which Nest fires inside `app.listen()` **before the port is bound**, so recovery finishes
before the API accepts its first request. It resolves every `resolved = false` row with
`endAt < now()` oldest-first (`ORDER BY endAt, startAt, sequenceIndex`), then tops any
surviving grinding character's queue back up to 5.

Test: 5 battles with `endAt` backdated 10 minutes, **10 BullMQ jobs still pending in Redis**
(a real crash does not clean those up), then restart:

```
[BattleRecoveryService] Found 5 stale unresolved battle(s) with endAt < now() - resolving oldest first
[BattleService] Resolved ... mon_slime      xp+=18 level=2  xp=1
[BattleService] Resolved ... mon_thornsprout xp+=64 level=5  xp=8
[BattleService] Character ... died to mon_direwolf; 2 queued battle(s) discarded
[BattleRecoveryService] recovery complete in 47ms: resolved 5 stale battle(s)
[Bootstrap] Application listening on port 3000          <-- AFTER recovery
--- first HTTP request, and the character is already recovered ---
{'level': 5, 'xp': '7', 'unspentAttributePoints': 20, 'status': 'town', 'currentMapId': None}
```

§7.6 death handling ran correctly from inside recovery: the 2 battles queued *after* the death
were discarded, `mapKillCount = 4` (loss excluded), `lastDeathLog` written.

**🔴 `resolveBattle()` was not idempotent — recovery would have double-granted XP.** It
applied effects first and set `resolved = true` last, so the BullMQ job firing after recovery
would have paid the XP/gold/drops/inventory a second time. It now *claims* the row with a
conditional `UPDATE ... WHERE resolved = false` and returns early when `affected = 0`:

```
[BattleService] Battle edccab57-... already resolved - skipping
[BattleService] Battle 88ff423f-... already resolved - skipping
resolved | count   ->  t: 5   f: 5     (5 recovered, 5 newly queued - NOT 10 resolved)
mapKillCount 5 == resolved wins 5
```

Two related warnings silenced (both were correctness-adjacent, not cosmetic): a pending job is
now removed *unless* it is `active` (removing the job you are currently executing always throws
"Job is locked"), and the processor treats `NotFoundException` as a clean discard instead of
retrying three times for a row §7.6 legitimately deleted.

### 5. `updateGambitPage()` ✅

Was `throw new Error('Not implemented')`. Now resolves the caller from the JWT, scopes the row
by `characterId`, validates via the same §8.4 pass, and enforces a unique `slotIndex`:

```
PUT /gambits/:pageId {title, lines}      -> 200, title + lines persisted
PUT /gambits/:pageId {invalid line}      -> 400, and the page is UNCHANGED ("still titled: Updated by PUT")
PUT /gambits/<unknown id>                -> 404
DELETE /gambits/:pageId                  -> 200, then GET -> 404, then DELETE -> 404
```

`deleteGambitPage()` also clears `character.activeGambitPageId` when it pointed at the deleted
page, instead of leaving the character pointing at a row that no longer exists.

### 6. Bonus fix found by the regression pass

`POST /characters/attributes/spend` returned **500** on a malformed body:
`SpendAttributePointsDto` has no class-validator metadata, so the global `ValidationPipe` let
`dto.attributes` through as `undefined` and `Object.values(undefined)` threw. Now 400
`"attributes must be an object"`. The valid shape `{"attributes":{"str":2}}` was always fine.

### Regression check

All 18 endpoints from the table above still return their documented status
(register/characters/gambits/activate/equipment/inventory/maps/battles-queue/kill-counter), and
`GET /characters` without a token is still 401.

### File changes this session

- `apps/api/src/modules/battle/battle.controller.ts` — removed `POST :battleId/resolve`.
- `apps/api/src/modules/battle/battle.service.ts` — §6.3 ratio adjustment; idempotent
  `resolveBattle` with row claim; conditional job removal.
- `apps/api/src/modules/battle/battle-recovery.service.ts` — **new**, §7.5 boot recovery.
- `apps/api/src/modules/battle/battle-queue.processor.ts` — `NotFoundException` = clean discard.
- `apps/api/src/modules/battle/battle.module.ts` — registers `BattleRecoveryService`.
- `apps/api/src/modules/gambit/gambit.service.ts` — `validateGambitLine`/`validateGambitPage`
  (§8.4), `updateGambitPage`, ownership-scoped delete, `NotFoundException` instead of bare
  `Error`.
- `apps/api/src/modules/gambit/gambit.controller.ts` — ownership on all `:pageId` routes.
- `apps/api/src/modules/character/character.service.ts` — 400 instead of 500 on a malformed
  `attributes` body.
- `char_xp_curve.json` (repo root) — regenerated, levels 1-98 all populated.

---

## Infrastructure Status

- **NestJS Build:** ✅ `npx nest build` succeeds from `apps/api`
- **Typecheck:** ✅ `npx tsc --noEmit -p tsconfig.json` clean in both `apps/api` and `packages/shared`
- **Lint:** ⚠️ `pnpm lint` does **not** work — there is no ESLint config file in the repo
  (`eslint` exits 2: "couldn't find a configuration file"). Pre-existing. Use `tsc --noEmit`
  + `nest build` as the gates until a config is added.
- **Docker Compose:** ✅ Builds successfully after Dockerfile fix
- **Database:** ✅ PostgreSQL 16. Note: the DB columns are **camelCase** (`"characterId"`,
  `"mapKillCount"`, `"hpCurrent"`), not snake_case — a snake_case `psql` query silently
  fails and is an easy time sink when writing verification queries.
- **Cache:** ✅ Redis 7

### This session's test environment (no Docker available, no sudo)
Docker's daemon was not running, and there was no `redis-server` binary. Both services were
provided locally instead, so the E2E was genuinely end to end:

```bash
# PostgreSQL 16.15 — fresh cluster (no root needed)
/usr/lib/postgresql/16/bin/initdb -D /tmp/kilo/pgdata -U nanommo --auth=trust
/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/kilo/pgdata -o "-p 5432 -k /tmp/kilo" -l /tmp/kilo/pg.log start
psql -h 127.0.0.1 -p 5432 -U nanommo -d postgres -c "create database nanommo;"

# Redis 7.2.5 — built from source into /tmp (no root needed)
curl -sSL -o redis.tar.gz https://download.redis.io/releases/redis-7.2.5.tar.gz
tar xzf redis.tar.gz && cd redis-7.2.5 && make -j"$(nproc)" MALLOC=libc
src/redis-server --port 6379 --daemonize yes --dir /tmp/kilo/redis --logfile /tmp/kilo/redis.log
```

**Backend start (cwd MUST be `apps/api` — `DataService` resolves the data files as
`path.join(process.cwd(), '../../')`, so running from the repo root looks for them in `/`
and every data getter silently returns `null`):**
```bash
cd apps/api
NODE_ENV=development \
DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=nanommo DB_PASSWORD=nanommo_dev_password DB_NAME=nanommo \
REDIS_HOST=127.0.0.1 REDIS_PORT=6379 \
JWT_SECRET=dev_secret \
node dist/apps/api/src/main.js
```

> `NODE_ENV=development` is required for `synchronize: true` in `app.module.ts`, which is
> what creates the new `battle_queue_entries.itemsConsumed` column. On an existing
> `production` database that column will need a real migration, not `synchronize`.

---

## Frontend

**Last Updated:** 2026-09-26  
**Session Focus:** Angular 18+ standalone frontend with auth flow

### ✅ IMPLEMENTED & TESTED

#### 1. Angular App Scaffold (`apps/frontend`)
- Angular 18 standalone components, routing, Tailwind CSS v3, Angular CDK
- pnpm workspace integration (`@nanommo/frontend` + `@nanommo/shared`)
- Environment configuration (`environment.ts` with `apiBaseUrl: http://localhost:3000`)

#### 2. Core HTTP Service with Interceptor (`core/api.service.ts`)
- Base URL from environment (not hardcoded)
- Attaches `accessToken` as `Authorization: Bearer <token>` header on all requests
- Handles 401 responses:
  - Checks `error.error?.code || error.error?.message` for `SESSION_INVALIDATED` or `TOKEN_EXPIRED`
  - Clears tokens and redirects to `/login?reason=session_expired`

#### 3. AuthStore (Signal-based) (`core/auth.store.ts`)
- `accessToken` / `refreshToken` / `userPayload` / `isLoading` / `error` as signals
- `isAuthenticated` computed signal
- Refresh token persisted in `localStorage` (survives reload)
- `bootstrap()` called on app load: restores session by calling `/auth/refresh` with stored refresh token
- `register(username, email, password, cpf)` → calls `POST /auth/register`, stores tokens, sets user payload
- `login(username, password)` → calls `POST /auth/login`, stores tokens, sets user payload
- `logout()` → clears tokens, redirects to `/login`
- `refreshAccessToken()` → calls `POST /auth/refresh` with refresh token

#### 4. Auth Guards (`core/auth.guard.ts`)
- `authGuard`: protects `/play` — redirects to `/login` if not authenticated
- `guestGuard`: protects `/login` and `/register` — redirects to `/play` if already authenticated

#### 5. Register Page (`features/auth/register.component.ts`)
- Fields matching backend `RegisterDto`: `username`, `email`, `password`, `cpf`
- Template-driven form with validation (required, minlength, email format)
- Backend validation errors displayed directly from `error.error?.message`
- On success: stores tokens, redirects to `/play`

#### 6. Login Page (`features/auth/login.component.ts`)
- Fields: `username`, `password` (matching `LoginDto`)
- Template-driven form with validation
- Shows "Sua sessão expirou" message when `?reason=session_expired` query param present
- On success: stores tokens, redirects to `/play`

#### 7. Protected `/play` Page (`features/play/play.component.ts`)
- Guarded by `authGuard`
- Displays "Em manutenção — volte em breve" centered
- Shows logged-in username from JWT payload
- Logout button: clears AuthStore, redirects to `/login` (backend logout endpoint not implemented; local-only cleanup)

#### 8. Routing (`app.routes.ts`)
- `/` → redirects to `/login`
- `/login` (guestGuard) → lazy-loaded LoginComponent
- `/register` (guestGuard) → lazy-loaded RegisterComponent
- `/play` (authGuard) → lazy-loaded PlayComponent
- `**` → redirects to `/login`

### 🧪 TEST RESULTS (Backend API Verified)

| Test Step | Description | Result |
|-----------|-------------|--------|
| 1. Register | `POST /auth/register` with username, email, password, cpf | ✅ Returns tokens, user created in DB |
| 2. Login | `POST /auth/login` with username, password | ✅ Returns tokens, sessionId updated |
| 3. Session Restore | Refresh token in localStorage → `POST /auth/refresh` on app load | ✅ Tokens restored, user authenticated |
| 4. Protected Route Access | Access `/play` with valid token | ✅ Shows "Em manutenção" + username |
| 5. Session Invalidation | Login again → old token gets `SESSION_INVALIDATED` | ✅ Backend returns 401 with message |
| 6. Logout | Click logout button | ✅ Clears localStorage, redirects to `/login` |

**Note:** Full browser-based E2E test (steps 1-5 from requirements) requires manual browser testing since the dev server runs on `localhost:4200` and backend on `localhost:3000`. The API integration has been verified via curl; the Angular components compile and serve without errors.

### ⚠️ KNOWN ISSUES / TODO
- Backend logout endpoint (`POST /auth/logout`) does not exist — frontend `logout()` only clears local state (informing user per requirements)
- CORS `origin: '*'` with `credentials: true` will break in production — must set `CORS_ORIGIN` to frontend URL before deploying
- Email verification and password reset UI not implemented (per scope)
- Tailwind v4 PostCSS plugin issue — using v3 for compatibility with Angular 18
- VERCEL BUILD FIX: `vercel.json` referenced non-existent `scripts/set-env.js` — created the script to generate `environment.prod.ts` at build time from `API_URL` env var; vercel.json now correctly references it
- VERCEL 404 FIX: `outputDirectory` updated from `dist/frontend` to `dist/frontend/browser` — Angular 18's `@angular-devkit/build-angular:application` builder outputs to a `browser/` subdirectory by default; pointing Vercel at the wrong path caused NOT_FOUND on all routes
- VERCEL ROUTING FIX: Added `rewrites` rule to route all SPA routes (`/login`, `/register`, `/play`, etc.) to `/index.html` for Angular client-side routing; without this, Vercel returns 404 for non-root routes
- VERCEL API URL FIX: Added `fileReplacements` to `angular.json` production config to replace `environment.ts` with `environment.prod.ts` during production builds; without this, the build always uses `environment.ts` (which has `apiBaseUrl: 'http://localhost:3000'`) even in production, causing API calls to hit localhost instead of the real backend

### 📁 FILES CREATED/MODIFIED THIS SESSION
- `apps/frontend/` — entire Angular application
  - `package.json` — deps: `@angular/cdk`, `@nanommo/shared`, `tailwindcss@3`
  - `tailwind.config.js`, `postcss.config.js`, `src/styles.css`
  - `src/environments/environment.ts` (dev: `http://localhost:3000`), `environment.prod.ts`
  - `src/app/app.config.ts` — HTTP client + interceptor + animations
  - `src/app/app.routes.ts` — routes with guards
  - `src/app/app.component.ts/html` — minimal router outlet
  - `src/app/core/api.service.ts` — HTTP service + auth interceptor
  - `src/app/core/auth.store.ts` — Signal-based auth state + bootstrap
  - `src/app/core/auth.guard.ts` — authGuard / guestGuard
  - `src/app/features/auth/register.component.ts` — register form
  - `src/app/features/auth/login.component.ts` — login form
  - `src/app/features/play/play.component.ts` — protected page
- `vercel.json` — fixed build command (removed non-existent script reference)