# Quebradeira + Item-Obtained Toast Implementation Plan

> **Name (user, 2026-11-24):** the event is **Quebra-Quebra** in pt-BR and **Smashing Spree** in en-US. Code identifiers use `smashingSpree` / `smashing-spree`; "Quebradeira" below is the old working name.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A server-run town event ("Quebradeira") four times a day, where 200 vases per town break on one hit for prizes, plus a single-line "item obtained" toast for every real inventory gain.

**Architecture:** A per-minute Bull repeatable job in `America/Sao_Paulo` derives the current phase (announce / start / end) from `town_events.json`. Event state lives only in Redis: the public vase layout, server-only prizes, and an atomic `HSETNX` "first hit wins" claim. Town broadcasts reuse the existing `kind:'town'` presence channel. Prizes go to the bag, fall back to idempotent system mail, and fall back again to a Redis pending list. Each allowed inventory-gain path publishes `inventory:obtained` after commit. The client shows only `items[0]` in one replace-in-place box.

**Tech Stack:** NestJS 10, Bull 4 (`@nestjs/bull`), ioredis, TypeORM/Postgres, Angular 18 signals, three.js (town runtime), `@nanommo/shared`.

**Spec:** `docs/superpowers/specs/2026-11-24-quebradeira-design.md`

## Global Constraints

- Schedule: starts at **03:30, 09:30, 15:30, 21:30**, timezone **America/Sao_Paulo**. Announcements at **30, 15, 5, 1** minutes before. The "started" announcement goes out at start.
- Towns: every map with a town scene (`DataService.getTownScene(mapId)` non-null). Today these are `map_town`, `map_outpost`, `map_kwaioua_taba`, `map_aramaia_city` and `map_emperial_capital_caelum`.
- **200 vases per town** for **120 s**. One hit breaks a vase, and the first accepted hit wins it. There is **no per-character prize cap**.
- Early end per town when all **20** prize vases are broken.
- Town attack rule: **≤ 1 attack per 1000 ms** per character, enforced server-side. Vases are the only valid target, and only while the event is active.
- Range: character within **1.0 world unit** of the vase centre. Click-to-approach stops **0.6** short of the centre (the user said: no need to touch, just almost there).
- Prize table (per town): 10× `mega_elixir`×20; 1× `tonic_fontoura`×10; 1× `tonic_kombucha`×10; 1× `tonic_haste_shot`×10; 1× `tonic_capo`×10; 1× (`fairy_in_a_bottle` | `super_tonic_sapupema_tea`, 50/50 per town per event)×1; 4× `mat_bliss_stone`×1; 1× `mat_divine_shard`×1.
- Prize data never leaves the server before its vase breaks. `town_events.json` is **not** mirrored to the frontend.
- No `Math.random()` in game logic: use `Mulberry32` / `mulberry32Seed` from `@nanommo/shared`.
- No migrations. Job handlers must be idempotent.
- Sound: `project/sons/new_packs/7/potShatter.wav` → `apps/frontend/public/assets/sounds/pot_shatter.wav`. Its license is unknown, so list it in `UNLICENSED_ASSETS_README.txt`.
- Toast: **one box**, **4 s**, replaced in place with **no transition**. Shows only **the first item** of a multi-item gain. Position ≈ 14vh from the top, above the existing notification band (27vh). Text: pt `"{name} – {n} obtido(s)."`, en `"{name} – {n} obtained."`.
- Toast sources: solo battle drops, party battle drops, gathering, crafting/cooking output, vendor purchase, mail attachment collect, quest rewards, vase prize. **Not** storage withdraw and **not** unequip.
- `server_announce` is **yellow** both in the chat System channel and on screen. The on-screen notice ignores the chat System filter.
- Git: work on branch `feat/quebradeira`. The user has unrelated uncommitted edits in the tree, so **never `git commit -a` / `git add .`**; stage only the files listed in the task. Never push.
- Tests: API tests are direct-execution Node scripts (`node apps/api/test/<name>.test.js`) and run against built `dist`. Rebuild before each run: `pnpm --filter @nanommo/shared build && pnpm --filter @nanommo/api build`. Frontend specs use Karma: `cd apps/frontend && npx ng test --watch=false --include='<glob>'` (needs `CHROME_BIN`). If Chrome is unavailable, type-check with `npx tsc -p tsconfig.spec.json --noEmit` and say so.

## Review Focus

1. **Two players hit the same vase in the same instant.** Exactly one gets `success`; the other gets `ALREADY_BROKEN`; one prize is granted. Pinned in Task 3.
2. **A hit lands after `endsAt`, or after the early end, or the end tick runs late.** It is rejected with `NO_EVENT`, even if the Redis keys still exist. Pinned in Task 3.
3. **The bag is full or the DB write throws during a prize grant.** The prize goes by mail with `sourceKey`. If mail also throws, the prize is pushed to `qb:pendingGrants`, and the vase still counts as broken. Pinned in Task 4.
4. **The scheduler tick fires twice in the same minute** (Bull redelivery, two API instances). The phase runs once (no double spawn, no double announcement). Pinned in Task 5.
5. **A player joins the town or reconnects mid-event.** The roster sync returns the live, unbroken vase set with `endsAt`, and broken vases never reappear. Pinned in Task 6.

---

## Part 1 — Quebradeira

### Task 1: Catalogue, config loader, OpenSpec change

**Files:**
- Create: `town_events.json` (repo root)
- Modify: `apps/api/src/modules/data/data.service.ts`: load and validate it next to `town_scenes.json` (~line 62); add the getter.
- Create: `apps/api/src/modules/town-event/quebradeira.types.ts`
- Create: `openspec/changes/add-quebradeira-town-event/{proposal.md,tasks.md,specs/quebradeira/spec.md}`
- Test: `apps/api/test/town-events-catalog.test.js`

**Interfaces:**
- Produces:
  ```ts
  // quebradeira.types.ts
  export interface QuebradeiraPrizeRule { count: number; quantity: number; itemId?: string; oneOf?: string[] }
  export interface QuebradeiraConfig {
    timezone: string; startTimes: string[]; announceMinutesBefore: number[];
    durationSeconds: number; vasesPerTown: number; minVaseSpacing: number;
    hitRange: number; approachDistance: number; attackCooldownMs: number;
    prizes: QuebradeiraPrizeRule[]; announceFindItemIds: string[];
  }
  export interface TownEventVase { id: string; x: number; z: number; rot: number; variant: number }
  export interface TownEventPrize { itemId: string; quantity: number }
  export function validateQuebradeiraConfig(raw: unknown, itemIds: Set<string>): string[]  // error list
  ```
  `DataService.getQuebradeiraConfig(): QuebradeiraConfig`. Boot throws `Invalid town_events.json: …` on errors, like town scenes do.

- [ ] **Step 1: Create the branch.** `git switch -c feat/quebradeira`.
- [ ] **Step 2: Write `town_events.json`.**
  ```json
  { "quebradeira": {
    "timezone": "America/Sao_Paulo",
    "startTimes": ["03:30", "09:30", "15:30", "21:30"],
    "announceMinutesBefore": [30, 15, 5, 1],
    "durationSeconds": 120, "vasesPerTown": 200, "minVaseSpacing": 1.2,
    "hitRange": 1.0, "approachDistance": 0.6, "attackCooldownMs": 1000,
    "prizes": [
      { "count": 10, "itemId": "mega_elixir", "quantity": 20 },
      { "count": 1, "itemId": "tonic_fontoura", "quantity": 10 },
      { "count": 1, "itemId": "tonic_kombucha", "quantity": 10 },
      { "count": 1, "itemId": "tonic_haste_shot", "quantity": 10 },
      { "count": 1, "itemId": "tonic_capo", "quantity": 10 },
      { "count": 1, "oneOf": ["fairy_in_a_bottle", "super_tonic_sapupema_tea"], "quantity": 1 },
      { "count": 4, "itemId": "mat_bliss_stone", "quantity": 1 },
      { "count": 1, "itemId": "mat_divine_shard", "quantity": 1 }
    ],
    "announceFindItemIds": ["mat_bliss_stone", "mat_divine_shard"]
  } }
  ```
- [ ] **Step 3: Write the failing test** `town-events-catalog.test.js`:
  - root file prize counts sum to 20;
  - every `itemId`/`oneOf` exists in `items.json`;
  - `validateQuebradeiraConfig` returns `[]` for the root file;
  - it returns a non-empty list for: an unknown item id; `count` sum > `vasesPerTown`; a rule with both `itemId` and `oneOf`; `startTimes` entry `"9:30"` (must be `HH:MM`); `announceMinutesBefore` containing `0`;
  - `apps/frontend/public/data/town_events.json` does **not** exist.
- [ ] **Step 4: Run it and see it fail** (module missing). Run: `pnpm --filter @nanommo/shared build && pnpm --filter @nanommo/api build && node apps/api/test/town-events-catalog.test.js`.
- [ ] **Step 5: Implement** the types, the validator, and the `DataService` load and getter.
- [ ] **Step 6: Run it and see it pass.** Expected: `town-events-catalog passed`.
- [ ] **Step 7: Write the OpenSpec change** `add-quebradeira-town-event`. Base proposal, tasks and spec deltas on the spec doc, covering both parts. Requirements use SHALL with scenarios for: schedule, first-hit-wins, range/cooldown, early end, prize fallback, toast sources, single-box rule. Run `pnpm exec openspec validate add-quebradeira-town-event --strict` and expect it to be valid.
- [ ] **Step 8: Commit.** `git add town_events.json apps/api/src/modules/data/data.service.ts apps/api/src/modules/town-event/quebradeira.types.ts apps/api/test/town-events-catalog.test.js openspec/changes/add-quebradeira-town-event && git commit -m "feat(town-event): Quebradeira catalogue and OpenSpec change"`

### Task 2: Pure logic: schedule phases, vase placement, prize assignment

**Files:**
- Create: `apps/api/src/modules/town-event/quebradeira.logic.ts`
- Test: `apps/api/test/quebradeira-logic.test.js`

**Interfaces:**
- Consumes: `QuebradeiraConfig`, `TownEventVase`, `TownEventPrize` (Task 1); `TownNav`, `TownSceneDef`, `Mulberry32`, `mulberry32Seed` from `@nanommo/shared`.
- Produces:
  ```ts
  export type QuebradeiraPhase =
    | { kind: 'announce'; eventKey: string; startMs: number; minutes: number }
    | { kind: 'start'; eventKey: string; startMs: number; endsAt: number }
    | { kind: 'end'; eventKey: string; startMs: number };
  /** Phase for the wall-clock minute containing nowMs (local time in cfg.timezone), or null. */
  export function phaseAt(nowMs: number, cfg: QuebradeiraConfig): QuebradeiraPhase | null
  /** eventKey = `qb-${startMs}` (startMs = epoch ms of the local HH:MM:00 start). */
  export function placeVases(def: TownSceneDef, nav: TownNav, seed: number, cfg: QuebradeiraConfig): TownEventVase[]
  /** vaseId -> prize; exactly sum(count) entries; oneOf resolved by the same rng. */
  export function assignPrizes(vases: TownEventVase[], seed: number, cfg: QuebradeiraConfig): Map<string, TownEventPrize>
  export function eventSeed(eventKey: string, mapId: string): number  // mulberry32Seed(`${eventKey}:${mapId}`)
  ```
  The `'end'` phase fires in the minute that contains `startMs + durationSeconds*1000`.

- [ ] **Step 1: Write the failing test** `quebradeira-logic.test.js` (use the root `town_scenes.json` defs and `new TownNav(def)`):
  - `phaseAt(Date.parse('2026-11-24T09:00:10-03:00'))` → `{kind:'announce', minutes:30, startMs: Date.parse('2026-11-24T09:30:00-03:00')}`.
  - 09:15, 09:25 and 09:29 give minutes 15, 5 and 1. `03:29:59-03:00` gives minutes 1 for the 03:30 start.
  - `09:30:05-03:00` gives `start` with `endsAt = startMs + 120000`. `09:32:00-03:00` gives `end`.
  - `09:31:00-03:00` and `12:00-03:00` give `null`. `15:30-03:00` and `21:30-03:00` give `start`.
  - `eventKey` is the same for the announce and start phases of one event.
  - For each of the 5 towns, `placeVases`:
    - returns 200 vases with unique ids `v000`…`v199`;
    - every vase is on a cell where `!nav.blocked(floor(x), floor(z))` and that is reachable from the spawn;
    - pairwise distance ≥ `minVaseSpacing`;
    - no vase within 2.0 of any `npcSpots` entry or of `spawn`;
    - the same seed gives deep-equal output, and a different seed gives a different layout.
  - `assignPrizes`:
    - 20 entries, with the counts per item matching the table;
    - exactly one of `fairy_in_a_bottle` / `super_tonic_sapupema_tea`;
    - deterministic per seed;
    - over seeds 1..200 both oneOf options occur.
- [ ] **Step 2: Run it and see it fail.** `node apps/api/test/quebradeira-logic.test.js` should fail on the missing module.
- [ ] **Step 3: Implement.**
  - **Timezone:** get local `HH:MM` and date parts with `Intl.DateTimeFormat('en-CA', { timeZone, hourCycle:'h23', … })`. Build `startMs` by taking local midnight + HH:MM and correcting with the zone's offset at that instant (an `Intl` formatted offset). Do not use a hard-coded `-03:00`.
  - **Placement:** rejection sampling with `Mulberry32(seed)` over `def.size`, with a capped number of draws (e.g. 200×50). Throw if fewer than `vasesPerTown` are placed, so a town that cannot fit them fails loudly in tests.
  - **`rot`** ∈ [0, 2π); **`variant`** ∈ {0,1,2}.
- [ ] **Step 4: Run it and see it pass.** Expected: `quebradeira-logic passed`.
- [ ] **Step 5: Commit** the two files.

### Task 3: `TownEventService`: lifecycle and hit handling (Redis)

**Files:**
- Create: `apps/api/src/modules/town-event/town-event.service.ts`, `town-event.module.ts`
- Modify: `apps/api/src/modules/presence/town-roster.service.ts`: add the public `poseOf` (below).
- Test: `apps/api/test/town-event-service.test.js`

**Interfaces:**
- Consumes: Task 1 and Task 2 exports; `TownRosterService`, `ChatService`, `DataService`, `REDIS_CLIENT`; `TOWN_EVENTS_CHANNEL`.
- Produces:
  ```ts
  // TownRosterService (new, public)
  poseOf(characterId: string): Promise<{ mapId: string; x: number; z: number } | null>  // positionAt(def, nav, state, Date.now()); null when not town-present

  // TownEventService
  runPhase(phase: QuebradeiraPhase): Promise<void>               // idempotent per (eventKey, phase kind[, minutes])
  activeEvent(mapId: string): Promise<TownEventSnapshot | null>  // { eventKey, mapId, endsAt, vases: TownEventVase[] } (unbroken only)
  vasePosition(mapId: string, vaseId: string): Promise<{ x: number; z: number } | null>
  hitVase(characterId: string, vaseId: string): Promise<HitVaseResult>
  type HitVaseResult =
    | { success: true; vaseId: string; prize: (TownEventPrize & { via: 'bag' | 'mail' | 'pending' }) | null }
    | { success: false; error: 'NOT_IN_TOWN' | 'NO_EVENT' | 'COOLDOWN' | 'OUT_OF_RANGE' | 'UNKNOWN_VASE' | 'ALREADY_BROKEN' };
  ```
  Redis keys (TTL 3600 s on all per-event keys):
  - `qb:active` hash: mapId → JSON `{eventKey, endsAt}`.
  - `qb:{ek}:{mapId}:vases`: JSON string of the public layout.
  - `qb:{ek}:{mapId}:prizes` hash: vaseId → JSON prize.
  - `qb:{ek}:{mapId}:broken` hash: vaseId → characterId.
  - `qb:{ek}:{mapId}:prizesLeft`: integer.
  - `qb:phase:{ek}:{kind}[:{minutes}]`: `SET NX` guard.
  - `town:attackCd:{characterId}`: `SET PX 1000 NX`.

  Town broadcasts are published on `TOWN_EVENTS_CHANNEL` as `{kind:'town', event, mapId, ...}` with event:
  - `'town:event:vases'` `{eventKey, endsAt, vases}`
  - `'town:event:vaseBroken'` `{eventKey, vaseId, byCharacterId, at, prize: boolean}`
  - `'town:event:ended'` `{eventKey, reason: 'timeout' | 'all-prizes-found'}`

  Announcements: `ChatService.announceServerMessage(message, id, key?, params?)`. Add the two optional args, and put `key`/`params` on the row.
  - Keys: `event.quebradeira.soon` `{minutes}`, `event.quebradeira.started`.
  - English `message` fallbacks: `"The Smashing Spree starts in N minute(s)! Head to any town."` / `"The Smashing Spree has begun! Break the vases in town!"`.

  Find line: `ChatService.announceEventFind(characterName, itemId, mapId, id)` publishes on `gateway:chat:global` a row `{channel:'journal', type:'event_find', key:'event.quebradeira.found', params:{name,itemId,mapId}, message}`. The row is not `server_announce`, so it causes no screen popup.

- [ ] **Step 1: Write the failing test** `town-event-service.test.js` with an in-memory fake redis (`set` with NX/PX/EX, `hset`/`hsetnx`/`hget`/`hgetall`/`hdel`, `incrby`/`decr`, `get`, `expire`, `publish`, `lpush`) and fake roster/chat/data. Assert:
  - `runPhase(start)` twice → one `town:event:vases` publish per town (5 total); each payload has 200 vases and **no** `prize`/`itemId` fields anywhere (`JSON.stringify` must not contain `itemId`).
  - `runPhase(announce minutes 5)` twice → `announceServerMessage` called once, with key `event.quebradeira.soon` and `{minutes:5}`.
  - `hitVase` returns these errors:
    - not town-present → `NOT_IN_TOWN`;
    - no active event → `NO_EVENT`;
    - pose 1.01 from the vase → `OUT_OF_RANGE`, and the cooldown is still consumed (a second hit 10 ms later → `COOLDOWN`);
    - pose 0.6 away → success;
    - an immediate second hit by the same character on another in-range vase → `COOLDOWN`, and after advancing the fake clock 1000 ms it succeeds;
    - unknown id → `UNKNOWN_VASE`.
  - Race: `Promise.all` of two characters hitting the same vase gives exactly one success and one `ALREADY_BROKEN`, and the grant is called once.
  - Expiry: with `Date.now` stubbed to `endsAt + 1` and keys still present → `NO_EVENT`.
  - Early end: breaking all 20 prize vases publishes `town:event:ended` `{reason:'all-prizes-found'}` once and removes the map from `qb:active`. The next hit → `NO_EVENT`.
  - `runPhase(end)` publishes `ended` `{reason:'timeout'}` only for towns still active.
  - `activeEvent(mapId)` excludes broken vases.
  - A prize vase whose item is in `announceFindItemIds` triggers `announceEventFind` once. A Mega Elixir does not.
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement.**
  - Hit order, exactly: presence → active and `Date.now() < endsAt` → cooldown `SET NX PX` → vase exists → range (`hypot ≤ hitRange`) → `HSETNX broken`.
  - On a claim, look up the prize. If there is one: `DECR prizesLeft`, then call `grantPrize` (Task 4; in this task inject it as a constructor dependency `TownEventGrantService` with `grant(characterId, eventKey, mapId, vaseId, prize): Promise<'bag' | 'mail' | 'pending'>`; tests fake it).
  - Publish `vaseBroken`.
  - When `prizesLeft` reaches 0: `HDEL qb:active mapId` and publish `ended`.
  - Seed: `eventSeed(eventKey, mapId)`.
- [ ] **Step 4: Run it and see it pass.**
- [ ] **Step 5: Commit** the service, module, roster change, chat change and test.

### Task 4: Prize grant with fallbacks

**Files:**
- Create: `apps/api/src/modules/town-event/town-event-grant.service.ts`
- Test: `apps/api/test/town-event-grant.test.js`

**Interfaces:**
- Consumes: `InventoryService.addItem(characterId, itemId, qty, 'inventory', undefined, manager)`; `MailService.sendSystemMail(characterId, subject, body, gold, attachments, manager?, sourceKey)` (check the exact attachment parameter shape against Market's buyer-item mail in `market.service.ts` ~line 195); `DataSource`.
- Produces: `TownEventGrantService.grant(characterId, eventKey, mapId, vaseId, prize): Promise<'bag' | 'mail' | 'pending'>`.
  - `sourceKey = quebradeira:${eventKey}:${mapId}:${vaseId}`.
  - Mail subject `"Smashing Spree prize"`, body `"Your bag was full, so your Smashing Spree prize is waiting here."`.
  - Pending: `LPUSH qb:pendingGrants JSON{characterId, eventKey, mapId, vaseId, prize, at}` plus `logger.error`.
  - On `'bag'`: push the inventory snapshot the same way other town actions do, and (once Part 2 lands) emit `inventory:obtained` source `'event'`. Leave a `// Task 11` marker only if Part 2 is not done yet.
  - On `'mail'`: `GatewayService.publishMailNewItem`.
  - Prize grants do not alter future combat, so there is no `runFutureCombatMutation`.

- [ ] **Step 1: Write the failing test** with fakes:
  - `addItem` resolves → `'bag'`, and mail is not called;
  - `addItem` throws `BadRequestException('No available slots')` → `'mail'` with the exact sourceKey;
  - `addItem` throws a generic `Error` → `'mail'`;
  - `addItem` and mail both throw → `'pending'`, and the list holds one row with the prize;
  - calling `grant` twice with mail fallback passes the same sourceKey both times.
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement**, then wire it into `TownEventModule` (imports `InventoryModule`, `MailModule`, `GatewayModule`).
- [ ] **Step 4: Run it and see it pass.** Re-run `town-event-service.test.js` as well.
- [ ] **Step 5: Commit.**

### Task 5: Scheduler (Bull repeatable tick)

**Files:**
- Create: `apps/api/src/modules/town-event/town-event.processor.ts`
- Modify: `town-event.module.ts` (`BullModule.registerQueue({ name: 'town-event' })`), `apps/api/src/app.module.ts` (import `TownEventModule`)
- Test: `apps/api/test/town-event-scheduler.test.js`

**Interfaces:**
- Consumes: `phaseAt`, `TownEventService.runPhase`.
- Produces:
  - Queue `town-event`, job name `quebradeira-tick`, repeat `{ cron: '* * * * *', tz: cfg.timezone }`, `jobId: 'quebradeira-tick'`.
  - It is registered in `onModuleInit`; first remove stale repeatables with the same name whose cron/tz differ.
  - `TownEventProcessor.handleTick(job)` → `phaseAt(Date.now(), cfg)` → `runPhase` when non-null. Errors are logged and rethrown, so Bull retries; retries are safe because `runPhase` is idempotent.

- [ ] **Step 1: Write the failing test.**
  - Source contract: the module registers queue `town-event`; the processor uses `@Processor('town-event')` and `@Process('quebradeira-tick')`; `onModuleInit` calls `add('quebradeira-tick', …, { repeat: { cron: '* * * * *', tz: 'America/Sao_Paulo' }, … })`, taking tz from the config.
  - Behaviour: with a fake service and `Date.now` stubbed to 09:25:03-03:00, `handleTick` calls `runPhase` once with announce minutes 5.
  - At 09:26 it does not call it.
  - Two `handleTick`s at 09:30:01 → `runPhase` is called twice, and the idempotency itself is covered in Task 3.
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it and see it pass.** Also start the API locally (`cd apps/api && pnpm dev`, with Redis/DB up) and confirm in the log that the repeatable job is registered and no boot error appears. Do not wait for a real event.
- [ ] **Step 5: Commit.**

### Task 6: Gateway wiring: hit, approach move, broadcasts, roster sync

**Files:**
- Modify: `apps/api/src/modules/gateway/nanommo.gateway.ts`:
  - the `kind:'town'` whitelist (~line 127) adds the three `town:event:*` events;
  - new `@SubscribeMessage('town:hitVase')`;
  - `town:move` accepts `{ vaseId }`;
  - `town:syncRoster` and the join-time `town:roster` emit (~line 214) include `event: await townEvent.activeEvent(mapId)`.
- Modify: `apps/api/src/modules/presence/town-roster.service.ts`: `TownMoveTarget` gains `{ approach: { x: number; z: number; distance: number } }`.
- Modify: `packages/shared/src/town/town-scene.types.ts`: add `TownEventVase`, `TownEventSnapshot` (move them from the api types file and re-export there), and `event?: TownEventSnapshot | null` on the roster snapshot type.
- Test: `apps/api/test/town-event-gateway.test.js`

**Interfaces:**
- Consumes: `TownEventService.hitVase`, `vasePosition`, `activeEvent`; `TownRosterService.move`.
- Produces:
  - Socket `town:hitVase {vaseId}` → `HitVaseResult`.
  - Socket `town:move {vaseId}` → `{success, entry}`. Server side: resolve the vase position in the caller's town, then call `move(id, {approach:{x, z, distance: cfg.approachDistance}})`.
  - The approach move walks to the point `distance` short of (x, z) on the line from the current pose (if already closer, it stays put), with `lookAt = [x, z]`, snapped by `nearestReachable`.
  - Unknown/broken vase → `{success:false, error:'UNKNOWN_VASE'}`.

- [ ] **Step 1: Write the failing test.**
  - Source contract: the whitelist contains `'town:event:vases'`, `'town:event:vaseBroken'` and `'town:event:ended'`; `town:hitVase` is a handler.
  - Behaviour, with a `TownRosterService` built via `Object.create` plus a fake redis and data:
    - an `approach` move from (10,10) toward a vase at (14,10) with distance 0.6 → stored `move.toX ≈ 13.4`, `lookAt [14,10]`;
    - from (14.3,10) it stays at the current pose.
  - Roster sync: a fake `activeEvent` returning 3 vases → the snapshot carries `event.vases.length === 3`.
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it and see it pass.** Also re-run `node apps/api/test/town-*.test.js` for every existing town test file and expect no regressions.
- [ ] **Step 5: Commit.**

### Task 7: Client store: event state and hit flow

**Files:**
- Modify: `apps/frontend/src/app/core/town.store.ts`
- Test: `apps/frontend/src/app/core/town.store.spec.ts` (extend)

**Interfaces:**
- Consumes: the socket events from Task 6; `townMoveArrival(nav, move)` from `@nanommo/shared`.
- Produces (TownStore):
  ```ts
  readonly vaseEvent: Signal<{ eventKey: string; endsAt: number; vases: TownEventVase[] } | null>
  readonly vaseBreaks: Observable<{ vaseId: string; byCharacterId: string; at: number; prize: boolean }>
  breakVase(vaseId: string): Promise<void>
  ```
  `breakVase`:
  - if the local character's current pose is within `hitRange` (constant `VASE_HIT_RANGE = 1.0` in the store; the server is the authority) → emit `town:hitVase` now;
  - otherwise `moveTo({vaseId})`, then schedule one `town:hitVase` at the arrival time (`townMoveArrival` on the returned entry's move, converted with the server-clock offset) + 50 ms;
  - a new `breakVase`/`moveTo` cancels a pending scheduled hit;
  - ignore calls within 1000 ms of the last hit sent.
  - Error `ALREADY_BROKEN`/`NO_EVENT` → silent. `OUT_OF_RANGE` → one retry after re-approaching. `COOLDOWN` → retry once at +1000 ms.
  - On a `vaseBroken` delta, remove the vase from `vaseEvent`. On `ended` or when `endsAt` passes → `null`. A roster snapshot with `event` replaces the state.

- [ ] **Step 1: Write failing specs.**
  - A snapshot with `event` sets `vaseEvent`.
  - `town:event:vaseBroken` removes that vase id and emits on `vaseBreaks`.
  - `town:event:ended` clears it.
  - In range: `breakVase` emits `town:hitVase` immediately and never `town:move`.
  - Out of range: it emits `town:move {vaseId}`, then (fake clock to arrival) `town:hitVase` once.
  - A second `breakVase` within 1000 ms sends nothing.
- [ ] **Step 2: Run** `npx ng test --watch=false --include='**/town.store.spec.ts'` **and see it fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it and see it pass.**
- [ ] **Step 5: Commit.**

### Task 8: Vase rendering, pick, break effect, sound, attack clip

**Files:**
- Create: `apps/frontend/src/app/features/play/town-scene/town-vases.ts` (three.js; lazy, imported only by `town-runtime.ts`)
- Modify: `town-runtime.ts` (owns a `TownVases`; `pick` returns kind `'vase'`; break effects use the existing `effects` list), `town-scene.types.ts` (`TownPick.kind` adds `'vase'`; handle gains `setVases(vases: TownEventVase[] | null)`, `breakVase(vaseId: string, byCharacterId: string, prize: boolean)`), `town-scene.component.ts` (feeds `vaseEvent`/`vaseBreaks` into the runtime; a click on `'vase'` → `town.breakVase(id)`; pointer cursor on vase hover), `town-character.ts` (load the rig's `Attack` clip; `playOnce('Attack', faceTowards: [x, z])` returns to the pose clip when done, regardless of weapon), `apps/frontend/src/app/shared/game-audio.service.ts` (sound `'pot_shatter'` → `pot_shatter.wav`; add `playAt(name, { volume, rate })`, which multiplies into the effects volume and sets `playbackRate`).
- Create: `apps/frontend/public/assets/sounds/pot_shatter.wav` (copied from `project/sons/new_packs/7/potShatter.wav`)
- Modify: `UNLICENSED_ASSETS_README.txt` (entry: file, origin "user-supplied pack new_packs/7", license unknown)
- Test: `town-scene/town-vases.spec.ts`, `town-runtime.spec.ts` (extend)

**Interfaces:**
- Consumes: Task 7's store API; `TownEventVase`.
- Produces: `class TownVases { constructor(scene: THREE.Scene); set(vases: TownEventVase[] | null): void; pickTargets(): THREE.Object3D[]; positionOf(id: string): [number, number] | null; hide(id: string): void; fadeOutAll(ms: number): void; dispose(): void }`.

- [ ] **Step 1: Write failing specs.**
  - `TownVases.set` with 200 vases builds ≤ 3 `InstancedMesh` (one per variant) whose total `count` is 200.
  - `hide(id)` removes it from picking, and `positionOf` returns null afterwards.
  - `set(null)` disposes geometries.
  - Runtime: `breakVase` adds 1 effect (`effectCount()` increases), and the effect finishes within 1200 ms of ticks.
  - `pick` over a vase returns `{kind:'vase', id}`.
  - Audio: `playAt('pot_shatter', {volume:0.5, rate:1.1})` creates an `Audio` with `playbackRate 1.1` and the volume scaled.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
  - **Vase:** `LatheGeometry` terracotta profile, 3 variants (tall amphora, round jar, short pot), height ≈ 0.55–0.75. `MeshStandardMaterial` terracotta with a darker painted band (vertex colours) and a slight rim highlight. It casts no shadow. Hover outline/emissive bump.
  - **Break:**
    - 12–16 shard meshes (small curved quads from the lathe material) with velocity outwards + up, gravity, spin, one floor bounce, and fade by 900 ms;
    - a dust puff (a few billboard sprites expanding/fading over 500 ms);
    - when `prize`, a short golden sparkle burst;
    - the hitter's `TownCharacter.playOnce('Attack', vasePos)` starts at the break.
  - **Sound:** `playAt('pot_shatter', { volume: clamp(1 - dist/20, 0.15, 1), rate: 0.92 + seeded jitter ∈ [0, 0.16] })`. Distance is from the local character. Use `mulberry32Seed(vaseId)` for jitter (no `Math.random`, even client-side, so every client hears the same).
  - On `ended`: `fadeOutAll(400)`.
- [ ] **Step 4: Run them and see them pass.** Then run the app (`pnpm --filter @nanommo/frontend start` and the API). To force an event locally, temporarily call `TownEventService.runPhase({kind:'start', …})` from a dev-only script under `apps/api/src/maintenance/` (`quebradeira-start-now.ts`, guarded by `NODE_ENV !== 'production'`; this is kept as a dev tool).
  - Check by eye: the vases render, a click walks up and attacks, the break looks and sounds right, a second browser sees the same break, and fps holds.
  - Take screenshots for the user.
- [ ] **Step 5: Commit**, including the wav, the README entry and the dev script.

### Task 9: Yellow localized server announcements

**Files:**
- Create: `apps/frontend/src/app/core/server-announce-text.ts`
- Modify: `apps/frontend/src/app/features/play/notification-messages.component.ts` (announce notices use class `announce-message`: yellow `#ffe14d` text, border `#c9a227`; use the formatter), `idle-chat.component.{ts,html,css}` (`ChatRow` gains `type?`, `key?`, `params?`; a `server_announce` row gets class `announce-row` with yellow text; an `event_find` row gets the same yellow; text via the formatter)
- Test: `server-announce-text.spec.ts`, `notification-messages` spec (create `notification-messages.component.spec.ts`)

**Interfaces:**
- Produces: `formatServerAnnounce(row: { key?: string; params?: Record<string, unknown>; message: string }, locale: GameLocale, itemName: (id: string) => string, mapName: (id: string) => string): string`.
  - `event.quebradeira.soon`:
    - en `"The Smashing Spree starts in {n} minute(s)! Head to any town."` → n=1: `"…in 1 minute!…"`, else `"…in N minutes!…"`;
    - pt `"O Quebra-Quebra começa em 1 minuto! Vá para qualquer cidade."` / `"…em N minutos!…"`.
  - `event.quebradeira.started`: en `"The Smashing Spree has begun! Break the vases in town!"`; pt `"O Quebra-Quebra começou! Quebre os vasos na cidade!"`.
  - `event.quebradeira.found`: en `"{name} found {item} in {town}!"`; pt `"{name} encontrou {item} em {town}!"`.
  - An unknown key → `row.message`.

- [ ] **Step 1: Write failing specs.**
  - The formatter covers each key × locale and n=1 vs n=5.
  - Notification component: a `chat:message` with `type:'server_announce'` renders with class `announce-message` and the pt text when the locale is pt-BR. It also shows while `localStorage['nanommo.chat.journal.enabled']==='false'`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Update docs and commit.**
  - `STATUS.md` gets a dated entry: what changed and which tests ran; "no migrations; nothing deployed".
  - `ARCHITECTURE.md` gets a decision entry: Redis-only town event state; per-minute tick.
  - `ENGINEERING_NOTES.md`: the town-event phase guard keys must stay unique per `eventKey`.

---

## Part 2 — Item-obtained toast

### Task 10: `inventory:obtained` channel + battle, party and gathering emitters

**Files:**
- Modify: `apps/api/src/modules/gateway/gateway.service.ts` (new method), `nanommo.gateway.ts` (add `gateway:inventory:obtained:${characterId}` to `setupRedisSubscribers`), `battle/battle.service.ts` (~1800, emit after the resolution commits, next to `publishBattleResolved`), `party/shared-battle.service.ts` (~120), `map/map.service.ts` (~872, gathering; emit after commit)
- Test: `apps/api/test/inventory-obtained-emitters.test.js`

**Interfaces:**
- Produces:
  ```ts
  type ObtainedSource = 'battle' | 'party_battle' | 'gather' | 'craft' | 'vendor' | 'mail' | 'quest' | 'event';
  GatewayService.publishItemsObtained(characterId: string, items: { itemId: string; quantity: number }[], source: ObtainedSource): Promise<void>
  // no-op when items is empty; filters quantity <= 0; channel `gateway:inventory:obtained:${characterId}`; socket event `inventory:obtained` { items, source }
  ```
  Only items actually inserted into the bag are listed (exclude drops dropped or diverted by capacity rules). Emit only on the first successful resolution: battle resolution is idempotent, so emit inside the branch that ran the claim, after commit.

- [ ] **Step 1: Write the failing test.**
  - Unit: `publishItemsObtained` publishes the exact channel and payload, and the empty list publishes nothing.
  - Source contract: `setupRedisSubscribers` lists the channel; each of `battle.service.ts`, `shared-battle.service.ts` and `map.service.ts` contains `publishItemsObtained(` with the source `'battle'`, `'party_battle'` and `'gather'` respectively; `town.service.ts`'s storage-withdraw method and the equipment unequip path do **not** call it.
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it and see it pass.** Also re-run `node apps/api/test/battle-drop-capacity-isolation.test.js` and `battle-queue-recovery-lifecycle.test.js` and expect no regressions.
- [ ] **Step 5: Commit.**

### Task 11: Craft, vendor, mail, quest and vase emitters

**Files:**
- Modify: `town/town.service.ts` (~560 and ~754 craft/cooking output → `'craft'`; `buyFromVendor` ~204 → `'vendor'`), `mail/mail.service.ts` (`collectAttachments` ~176 → `'mail'`, items only, no gold), `quests/quest.service.ts` (reward grant → `'quest'`, after commit, only on the completing call), `town-event/town-event-grant.service.ts` (on `'bag'` → `'event'`; remove the Task 4 marker)
- Test: extend `apps/api/test/inventory-obtained-emitters.test.js`

- [ ] **Step 1: Extend the test.**
  - Source contract for each path and source string.
  - Behaviour: the grant service with fakes calls `publishItemsObtained(char, [{itemId:'mat_divine_shard', quantity:1}], 'event')` on `'bag'` and does not call it on `'mail'`.
  - The `collectAttachments` fake with 2 item attachments + gold → one call with 2 items.
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement.** Emit after the transaction resolves (outside the `transaction(...)` callback), never inside it.
- [ ] **Step 4: Run it and see it pass.** Re-run `craft-announcements.test.js` and any existing `mail-*` and `quest-*` tests in `apps/api/test`.
- [ ] **Step 5: Commit.**

### Task 12: `ItemObtainedToastComponent`

**Files:**
- Create: `apps/frontend/src/app/features/play/item-obtained-toast.component.ts` (standalone, inline template/styles, mounted next to `<app-notification-messages>` in `play.component.html`)
- Modify: `play.component.html`, `play.component.ts` (imports)
- Test: `item-obtained-toast.component.spec.ts`

**Interfaces:**
- Consumes: socket `inventory:obtained {items, source}`; `CatalogService.item(id)`, `CatalogService.itemIcon(id)`; `LocaleService`.
- Produces: the UI only.
  - `:host{position:fixed;inset:0;pointer-events:none;z-index:2500}`.
  - Box at `top:14vh`, centred, `max-width:min(560px, calc(100vw - 28px))`.
  - Light translucent background `rgba(255,255,255,.88)`, `1px solid #9aa3b5`, radius 3px, dark text `#1b1b1b`, 13px.
  - 18px icon at left.
  - Item name coloured by rarity: common `#1b1b1b`, uncommon `#2f7d32`, rare `#1f5fbf`, epic `#7b2fbf`, legendary `#c46a00`.
  - **No animation or transition properties.**

- [ ] **Step 1: Write failing specs** (fake socket, `jasmine.clock()`):
  - An event with `[A×3, B×1]` shows only A, as `"A – 3 obtido(s)."` in pt-BR or `"A – 3 obtained."` in en-US.
  - After 4000 ms it is gone.
  - A second event at t=2000 replaces the text in the same element, which is not re-created: assert the same `HTMLElement` reference. It stays until t=6000.
  - Computed style has `transition-duration` `0s` and `animation-name` `none`.
  - An empty `items` shows nothing.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.** Then, in the running app:
  - check by eye the grind drops, a vendor buy, mail collect, a craft and a vase prize;
  - check that a storage withdraw and an unequip show nothing;
  - check that it sits above an on-screen announcement without overlap, at 1280px and at 375px width.
- [ ] **Step 5: Docs and commit.** `STATUS.md` entry; mark the OpenSpec tasks done; `pnpm exec openspec validate add-quebradeira-town-event --strict`.

### Final verification (after Task 12)

- [ ] `pnpm --filter @nanommo/shared build && pnpm --filter @nanommo/api build && for f in apps/api/test/{town-events-catalog,quebradeira-logic,town-event-service,town-event-grant,town-event-scheduler,town-event-gateway,inventory-obtained-emitters,craft-announcements}.test.js; do node "$f" || echo "FAIL $f"; done` → no `FAIL`.
- [ ] `pnpm --filter @nanommo/frontend build --configuration production` → succeeds (known CSS-budget/CommonJS warnings only).
- [ ] `cd apps/frontend && npx ng test --watch=false --include='**/{town.store,town-vases,town-runtime,server-announce-text,notification-messages.component,item-obtained-toast.component}.spec.ts'` → all green.
- [ ] `git status`: the user's pre-existing unrelated edits are still uncommitted and untouched.
