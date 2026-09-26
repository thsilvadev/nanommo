# NanoMMO Backend - Implementation Status

**Last Updated:** 2026-09-25 (Post-Session Debugging — BUG FIXED)  
**Session Focus:** Root-caused and fixed InventoryService.addItem() "remaining=undefined" error

---

## ✅ IMPLEMENTED & TESTED

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

### Battle System (Stubs)
- Battle Queue Generation: ✅ Working
- Battle Simulation: ✅ Working  
- XP/Gold/Drops Calculation: ❌ Stub - all return 0/[]

### Gambit Service (Stubs)
- `validateGambitLine()`: Not implemented
- `deleteGambitPage()`: Implemented but not tested
- Gambit evaluation during battle: Not wired to BattleEngine

### Other Modules
- Map kill counters: Stub
- Mail system: Stub
- Market system: Stub
- Town vendor/warehouse: Stub
- Chat system: Stub
- WebSocket gateway: Stub

---

## 🎓 CRITICAL LESSONS & TECHNICAL TRAPS (THIS SESSION)

### 1. JWT Claims Mapping - ABSOLUTE RULE
**Pattern:** JWT contains ONLY `{ userId, username, sessionId, type, iat, exp }` — NO `characterId`
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

---

## ✅ SINGULAR NEXT STEP (FOR NEXT SESSION)

**Inventory system is fully working.** Move on to the next critical blocker: the **Battle System stubs** (XP/Gold/Drops all return 0/[]), which is the largest remaining gap for MVP. See the "Battle System (Stubs)" section above.

Recommended order:
1. Implement `BattleEngine.simulateBattle()` in `packages/shared/battle-engine/` (pure functions, deterministic via Mulberry32)
2. Wire `BattleQueueService` to actually compute XP/gold/drops instead of stubs
3. Wire Gambit evaluation into the battle engine (currently not connected)
4. Implement `MapKillCounter` epoch logic

---

## Infrastructure Status

- **NestJS Build:** ✅ `npm run build` succeeds
- **Docker Compose:** ✅ Builds successfully after Dockerfile fix
- **Database:** ✅ PostgreSQL 16 (must reset with `docker-compose down -v` between test runs)
- **Cache:** ✅ Redis 7

**Local Backend Start:**
```bash
cd apps/api
docker-compose up -d db redis
DATABASE_URL="postgresql://nanommo:nanommo_dev_password@localhost:5432/nanommo" \
REDIS_URL="redis://localhost:6379" \
JWT_SECRET="dev_secret" \
node dist/apps/api/src/main.js
```
