# NanoMMO Backend — Battle Loop Implementation Status

**Last Updated:** 2026-09-28 (Post-Bug Fix Session)  
**Session Focus:** Investigate and document the main battle loop readiness for release

---

## 0. BUG FIXED THIS SESSION

### `mulberry32Seed is not a function` Error

**Symptom:** When clicking a map to enter, backend threw:
```
ERROR [ExceptionsHandler] (0 , shared_1.mulberry32Seed) is not a function
TypeError: (0 , shared_1.mulberry32Seed) is not a function
    at BattleService.queueBattles (/app/apps/api/src/modules/battle/battle.service.js:220:59)
```

**Root Cause:** TypeScript compilation of `packages/shared/dist/battle-engine/prng.js` was missing CommonJS exports for `mulberry32Seed` and `rngForIndex`. The functions were defined but not exported via `exports.funcName = funcName`.

**Fix Applied:**
```bash
cd /home/thiagopereira/Documents/Projetos/nanommo && pnpm build
```

This forced recompilation of the TypeScript files. The compiled `prng.js` now correctly includes:
```javascript
exports.Mulberry32 = Mulberry32;
exports.mulberry32Seed = mulberry32Seed;
exports.rngForIndex = rngForIndex;
```

**Verification:** `grep "exports.mulberry32Seed\|exports.rngForIndex" packages/shared/dist/battle-engine/prng.js` → returns 2 matches ✅

---

## 1. IMPLEMENTED AND TESTED (Main Battle Loop)

All critical components required for the basic loop (map entry → battle → resolve → death/leave) are implemented and have been tested in previous sessions:

| Component | Status | Test Evidence |
|-----------|--------|---|
| **XP curve loading** | ✅ Tested | `xpToNext(1)=17`, values pre-computed and loaded correctly from JSON |
| **Level-up mechanic** | ✅ Tested | L1→L2 transition verified, +5 attribute points awarded, ratio-adjusted HP/SP (no free heal) |
| **Battle queue generation** | ✅ Tested | `queueBattles()` creates 5-deep pre-computed queue via `BattleEngine.simulateBattle()` |
| **Battle resolution** | ✅ Tested | BullMQ delayed job fires at scheduled time, applies XP/gold/drops atomically |
| **Queue recalculation on level-up** | ✅ Tested | Post-level-up, stale queue discarded and rebuilt with new character stats |
| **Character death handling** | ✅ Tested | Death moves character to town, sets HP=1, applies 5% XP loss, discards remaining queued battles |
| **Gambit validation** | ✅ Tested | All 6 §8.4 rules enforced; invalid gambits rejected with 400 before any DB write |
| **Gambit evaluation during battle** | ✅ Tested (prior session) | GambitEvaluator invoked 4x per battle (per gauge fires) during deterministic simulation |
| **Email verification gate** | ✅ Tested | `MapService.enterMap()` blocks unverified users with 400 `EMAIL_NOT_VERIFIED` |
| **Recovery pass on boot** | ✅ Tested | Stale unresolved battles cleaned up on server restart, BullMQ jobs orphaned jobs removed |
| **Idempotent resolution** | ✅ Tested | Concurrent calls to `resolveBattle()` with same battleId: only one succeeds via conditional UPDATE |

**Test command to re-verify the loop:**
```bash
# After pnpm build, start docker-compose and wait for backend boot (~30s)
docker-compose up --build

# In another terminal, run E2E test (requires real Gmail SMTP configured in .env)
cd apps/api && npx ts-node test-s63.js  # Isolated deterministic E2E with kill counter pinning
```

---

## 2. IMPLEMENTED BUT NOT TESTED THIS SESSION

These components are coded and functional but not re-verified in this session's testing scope:

| Component | Implementation | Status |
|-----------|---|---|
| **BattleService.queueBattles()** | Complete at [apps/api/src/modules/battle/battle.service.ts:199-400](apps/api/src/modules/battle/battle.service.ts#L199) | Generates deterministic queue from character state, monster RNG selection, gambit evaluation |
| **BattleService.resolveBattle()** | Complete at [apps/api/src/modules/battle/battle.service.ts:374-600](apps/api/src/modules/battle/battle.service.ts#L374) | Applies battle results: XP/gold/drops, handles level-up and death, invalidates queue if needed |
| **MapService.enterMap()** | Complete at [apps/api/src/modules/map/map.service.ts:54-90](apps/api/src/modules/map/map.service.ts#L54) | Character validation, email gate, map validation, queue initialization |
| **MapService.leaveMap()** | Complete at [apps/api/src/modules/map/map.service.ts:96-107](apps/api/src/modules/map/map.service.ts#L96) | Sets `status=town`, nulls `currentMapId` |
| **Death handling** | Partially at [apps/api/src/modules/battle/battle.service.ts:522-565](apps/api/src/modules/battle/battle.service.ts#L522) via `handleCharacterDeath()` | On death, moves to town, loses 5% XP, cancels queued battles |
| **Potion/food consumption** | Complete at [packages/shared/src/battle-engine/index.ts:593-850](packages/shared/src/battle-engine/index.ts#L593) | Simulated within each battle; stored in `BattleQueueEntry.itemsConsumed`; actually removed from inventory on resolve |
| **Kill counter tracking** | Complete at [apps/api/src/modules/battle/battle.service.ts:595-630](apps/api/src/modules/battle/battle.service.ts#L595) via `incrementKillCounter()` | Tracks map and per-monster kills; used for deterministic monster selection seed |
| **PRNG determinism** | Complete at [packages/shared/src/battle-engine/prng.ts:1-124](packages/shared/src/battle-engine/prng.ts) | Mulberry32 seed-based; used for all randomness (drops, crit, monster selection) |

**Why not re-tested this session:** These are foundational and were all verified in prior sessions. The bug fix (mulberry32 export) only affected compilation, not logic. No code changes were made to battle mechanics.

---

## 3. STILL STUB / TODO (Outside Loop Scope)

These modules are intentionally out-of-scope for the basic "enter map → battle → exit" loop:

| Module | Status | Note |
|--------|--------|------|
| **ChatService** | Stub (8x `throw new Error('Not implemented')`) | Future: server-side message persistence |
| **MailService** | Stub (5x `throw new Error('Not implemented')`) | Separate from `MailerService` (auth emails); future for game notifications |
| **TownService** | Stub (6x `throw new Error('Not implemented')`) | Vendor, warehouse, NPC interactions |
| **MarketService** | Stub (not started) | Buy/sell orders, order matching |
| **WebSocket gateway** | Partial (commented in `app.module.ts`) | Socket.IO infrastructure exists but not integrated with battle events |

**Dead code (not stubs, just unreachable):**
- `MapService.getMapDetails()`, `validateMapAccess()`, `incrementKillCounter()` — all throw "Not implemented" but never called; actual logic in `BattleService.incrementKillCounter()`

---

## 4. BATTLE LOOP COMPONENT MATRIX

Core loop dependencies (all implemented):

```
User Registration
  ↓
Character Auto-Creation
  ↓
Email Verification Gate
  ↓ (must verify)
MAP ENTRY
  ├─ MapService.enterMap()
  │   ├─ Email verification check ✅
  │   ├─ Character on map validation ✅
  │   └─ BattleService.queueBattles(5) ✅
  │
BATTLE QUEUE (5-deep)
  ├─ BattleEngine.simulateBattle() ✅
  │   ├─ GambitEvaluator (4x per gauge fires) ✅
  │   ├─ Item consumption simulation ✅
  │   ├─ Damage/crit/hit rolls (Mulberry32) ✅
  │   └─ Rewards calculation (XP/gold/drops) ✅
  ├─ Stored in BattleQueueEntry ✅
  └─ BullMQ delayed job scheduled ✅
  │
BATTLE RESOLUTION (per BullMQ job fire)
  ├─ BattleService.resolveBattle() ✅
  │   ├─ Atomic battle claim (conditional UPDATE) ✅
  │   ├─ Item removal from inventory ✅
  │   ├─ XP/gold/drops applied ✅
  │   ├─ Level-up detection & stat recalc ✅
  │   ├─ [IF DEATH] handleCharacterDeath() ✅
  │   │   ├─ Move to town ✅
  │   │   ├─ 5% XP loss ✅
  │   │   ├─ Save lastDeathLog ✅
  │   │   └─ Discard remaining queue ✅
  │   ├─ [IF LEVEL-UP] requeueBattlesAfterLevelUp() ✅
  │   │   ├─ Discard stale queue ✅
  │   │   ├─ Cancel BullMQ jobs ✅
  │   │   └─ Rebuild queue with new stats ✅
  │   └─ Return to queueBattles if queue < 5 ✅
  │
MAP EXIT
  └─ MapService.leaveMap() ✅
     └─ status = 'town', currentMapId = null ✅
```

**All ✅ items are implemented and previously tested.**

---

## 5. GAMBIT SYSTEM COMPLIANCE

Per SPEC §8, the gambit system is fully implemented:

| SPEC §8 Requirement | Implementation | Status |
|---|---|---|
| **§8.2 GambitPage schema** | 3 pages per character, up to 20 lines per page, nested conditions + combinator | ✅ `GambitPage` entity + validation |
| **§8.3 HP/SP band detection** | FULL/HIGH/MEDIUM/LOW/CRITICAL bands on current/max percentage | ✅ `GambitEvaluator.isInHpBand()` |
| **§8.4 Validation (6 rules)** | Invalid action.id, bad band, missing params, unknown item/skill, >2 conditions, bad combinator | ✅ `validateGambitLine()` rejects all 6 before persist |
| **§7.3 Evaluation per gauge fire** | Gambit evaluated 4x per simulation (when attack gauge OR cast gauge fills) | ✅ Called in `BattleEngine.simulateBattle()` lines 593, 633, 768, 808 |
| **§7.3 First legal line wins** | Conditions evaluated left-to-right, first matching line executes action | ✅ Early return in `GambitEvaluator.evaluateGambitPage()` |
| **§8.2 Dual param shapes** | Both `{id, band}` (inline) and `{id, params: {band}}` (SPEC style) accepted | ✅ Normalization in `GambitEvaluator.normalizeGambitPage()` |

---

## 6. DETERMINISM & PRNG

Per SPEC §3.1 and §11.2:

| Requirement | Implementation | Verified |
|---|---|---|
| **Same inputs → same outputs (byte-for-byte)** | All randomness via `Mulberry32(seed)`, no `Math.random()` | ✅ |
| **Seed = hash(characterId:mapId:epoch)** | `mulberry32Seed(key: string)` implemented | ✅ |
| **Monster selection = rngForIndex(seed, killIndex)** | `rngForIndex()` implemented, used in `queueBattles()` | ✅ |
| **No Math.random() in battle paths** | `grep -rn "Math.random()" packages/shared/src` → empty | ✅ |
| **Replay support** | Seed stored in `BattleQueueEntry.seedUsed`, log in `.log` jsonb | ✅ |

---

## 7. NEXT STEP (Singular, Specific)

**Run a complete end-to-end battle loop test via real HTTP/Docker to confirm the `mulberry32Seed` fix resolves the map entry error and battles fire correctly.**

### Test Specification:

1. **Setup:** `docker-compose up --build` (waits ~60s for all services online)
2. **Register user** (via curl or browser): `POST http://localhost:3000/auth/register`
3. **Verify email** (via database or email): Set `User.emailVerified = true` in postgres (or parse email if SMTP configured)
4. **Enter map:** `POST http://localhost:3000/maps/map_green_grounds/enter` with JWT token
5. **Check battle queue:** `GET http://localhost:3000/battles/queue` with JWT token
6. **Verify:** Queue has 5 entries, no `mulberry32Seed is not a function` error in backend logs, all battles have valid `sequenceIndex`, `monsterId`, `xpGain`, `drops`
7. **Wait ~30s:** Let first battle resolve via BullMQ job
8. **Verify resolution:** `GET http://localhost:3000/characters` with JWT, confirm `xp` increased, `gold` increased, character still `grinding`
9. **Check logs:** No errors, clean resolution log like `[BattleService] Resolved battle ... xp+=XX gold+=XX`

**Expected output:** ✅ All tests pass, map entry works, queue fires, battle resolves, XP/gold awarded.

**Pass criteria:**
- No `mulberry32Seed is not a function` error
- Queue has exactly 5 entries with deterministic data
- First battle resolves without error
- Character XP/gold updated correctly
- All backend logs clean (no exceptions)

---

## Summary Table

| Aspect | State | Evidence |
|--------|-------|----------|
| **Core loop (enter → battle → exit)** | ✅ Complete | All components implemented + previously tested |
| **Bug fixed (mulberry32)** | ✅ Fixed | `pnpm build` recompiled, exports verified |
| **Ready for testing** | ⚠️ Test needed | E2E test suite on next full run |
| **Blocker issues** | ❌ None | All stubs are non-critical modules (Mail, Market, Chat) |
| **Tech debt** | ⚠️ Minor | Dead code in MapService (3x `throw new Error`), no ESLint config, but doesn't affect runtime |

---

**Ready to proceed with next battle loop test.** Run the test in §7 and report results.
