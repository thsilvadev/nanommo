### Monster catalogue / map ownership overhaul (2026-10-16)

Maps.json is the canonical source for map topology, map metadata, and weighted monster presence. Monsters.json contains species only; each map roster references monsterId and presenceRate. Town is map_town at (0,0); six grind maps map_lv_1 through map_lv_26 occupy (0,1) through (0,6). Root and frontend public catalogue copies must remain synchronized. Legacy character locations are migrated by character level, while active battle snapshots and historical battle logs are immutable.

The shared attribute key is LUK/luk (not SOR/sor). Data migration preserves character values and renames equipment bonus keys without changing their numeric values. Damage matchups are declarative data; skill elements are explicit. saveButtLuck is an opt-in, non-player-facing skill property that reduces a chance by up to 10 percentage points based on the target total LUK.

# NanoMMO - Architecture & Design Decisions

### Hand Equipment / Mastery application follow-up (2026-10-13)

Hand pairing compatibility comes from each primary equipment catalogue entry's `allowedOffHandTypes`. The approved matrix permits Dagger + Dagger, permits Dagger/Shield/Rune with Sword, Dagger or Rod primaries, and rejects Sword + Sword. The shared validator consumes catalogue metadata rather than maintaining a second weapon-name matrix. Current `skill_trees.json` defines exactly two entries for each of the eight Mastery categories.

`POST /characters/mastery/allocate` validates category/skill identity, available points, node prerequisites, max rank and the persisted rank-total invariant under a row lock. Persistence uses `BattleService.runFutureCombatMutation()`. Learned ranks and definitions are then filtered into the next immutable combat snapshot only when the corresponding category equipment is present. Character DTOs expose William-seeded known item IDs; Gambit controls filter item choices to known IDs and active skill choices to learned active ranks.

The shared simulator now implements the ten active skill effects and six passives with deterministic event/status logs and reuses the existing battle-lane position/distance contract for Blinkstrike, Shield Bash, Fearless Focus, and Violent Shot. Mastery XP thresholds, rank-scaled costs/cooldowns, and level advancement are shared by the simulator snapshot builder and the authoritative BattleService reward transaction. The deterministic pacing harness is an action-count proxy, not live gameplay telemetry. Remaining verification includes transactional retry/idempotence integration, passive unequip/no-action boundary cases, browser-level tooltip/Gambit warnings and handedness mirroring, migration/data preservation against a disposable database, and full API/browser integration. The DEX checkpoint remains unresolved with no special case. No deployment or migration execution was performed.


### Refinement investigation — Mastery, status presentation, and monster resources (2026-10-13)

This is a code-inspection checkpoint for `refining-hand-equipment-mastery-skills`, not an implementation claim.

- Status application events already carry both an `actor`/source and a `target`. The shared engine's `applyStatus(foe, ...)` sends Swordsmanship Bleed to the monster, but both `GrindInfo.eventText()` and `BattleLogsComponent.eventText()` currently derive the displayed affected name from `event.actor` and ignore `event.target`. The periodic `status_damage` event's `actor` is the status source (`status.sourceActor`), so the current format can imply that the character gained/took the status when the monster actually did. Keep combat ownership server-authoritative; fix both formatters around target semantics and add deterministic log assertions.
- Swordsmanship's current `damagePerTick: 5 * swordsmanshipRank` is consistent with the latest approved rank scaling: chance is 1% per rank and each Bleed stack deals 5 × rank pure damage every five ticks. The refinement must source base damage/interval from the skill catalogue, mark Bleed as pure damage bypassing DEF/MDEF, and fix event/UI target ownership; periodic ticks never award Mastery action XP.
- `CharacterSummary.freezeStatus()` reconstructs only Freeze, while the planned STATUS inventory is eight IDs: `freeze`, `bleed`, `slow`, `burn`, `stun`, `disarm`, `war_cry_def` (display label War Cry), and `magic_barrier`. `GrindInfo.monsterStatusEffects()` reads only `header.monsterSnapshot.statusEffects`, so mid-battle applications/stack changes/expiry are invisible in the monster panel. Derive both sides' displayed active statuses from the initial snapshot and ordered events through `elapsedTicks`; do not create new client-side battle rules. The user-provided reference assets exist at `project/status_icons.png`, `project/skill_icons.png`, and `project/skill_tree_example.png`; the status coordinate map is recorded in the canonical SPEC.
- `character-page.component.ts` calls `loadWeaponLevels()` only from `ngOnInit`, and the `battle:resolved` event currently updates only Character/Inventory snapshots in `BattleStore`. Mastery XP/level/available-point fields therefore stay stale while the tab remains mounted. After `battle:resolved`, refresh `GET /characters/weapon-proficiency` (or provide equivalent post-commit authoritative rows); never calculate XP locally.
- Current skill allocation posts one skill point at a time to `POST /characters/mastery/allocate`, which already persists through `BattleService.runFutureCombatMutation()`. New Apply/Reset staging must send the selected category draft atomically and call that same future-combat mutation boundary once per successful Apply. Each category keeps an independent local draft; a staged edit or Reset must not change the server or queue. Apply preserves an active battle and invalidates only eligible future entries through the existing shared boundary. The user confirmed XP, level, available/spent points and learned ranks are independent per category; farming Bow never grants Rod XP/points. Apply and Reset act only on the selected category, while each category retains its own independent pending draft.
- The Mastery screen currently renders rectangular text nodes rather than a connected, icon-only tree. Its right-side category list omits Rune; `WeaponRows` in `character-page.component.ts` is the view's current category source. Current canonical skill catalogue contains 16 player skills (2×8 categories), with passive and active rank-scaling data already present; current monster-only catalogue contains four special skills. User decision: status sprites may be cleanly cropped/background-removed from `project/status_icons.png` when viable, otherwise draw matching SVGs; create original, well-rendered PNG skill icons inspired by `project/skill_icons.png`, with each icon matching the skill effect.
- **Monster mana decision resolved by the user (2026-10-13):** all currently catalogued monsters have 60 max SP, except Venom Viper and Wailing Wraith (80); each regenerates 2 SP per 10 battle ticks. Skill costs are Enraged Strike 30, Regenerate 15, Ice Bolt 10, and Ground Slam 30. Implement current/max SP as actual simulator resources (catalogue-driven), initialize each monster at max SP per encounter, consume cost on skill resolution, and allow Gambit to skip a skill when it is illegal for insufficient SP. Event records must expose monster SP so the frontend bar is an event-timeline projection, not an estimate. Existing runtime is still 0/0 until this proposal is applied.
- **Cooldown and movement timing — final approved contract:** the current implementation's parallel cooldown countdown is wrong for the requested timing. After Ice Bolt resolves at T2, T3 is blocked by `cooldownTicks = 1`; the next cast activates at T4, continues at T5 and resolves at T6, with following resolutions T10, T14, etc. A T4 damage event plus T4 Freeze application is one cast and its proc, not duplicate damage. The initial old/precomputed log may not reflect newly generated entries; queue entries remain immutable. Keep root Wailing Wraith order (`silence → attack` first, Ice Bolt second) and synchronize just that Gambit row/order in the frontend copy. The evaluator's gauge filters and legality checks still decide actual execution.
- **Movement gauge versus movement intent — final approved contract:** the gauge starts at zero at T0 and accumulates effective Move Speed each tick regardless of `movementIntent`. Movement itself requires a legal selected out-of-range action/approach intent; with intent, at most one space is moved per tick when gauge reaches 100, and overflow remains banked. At Move Speed 98 the gauge reaches 98 at T1 and crosses 100 at T2; at >=100 it can move at T1 if a legal approach intent is active. Disarm invalidates the player character's basic Attack line and must not preserve stale approach intent when no legal line requires approaching. Keep the current monster-specific Disarm movement behavior.


### Finalized Mastery reset and cheats (2026-10-13)

The refinement includes a one-time transactional data reset of every existing `weapon_proficiencies` row: preserve character/category identity, Mastery `level` and `xp`, clear `skillRanks`, and set `spentSkillPoints = 0`. This returns all earned category points for redistribution, including points previously spent on Stored Essence; do not migrate its ranks. It is a one-time data operation, not a schema change and never runs on app startup. The targeted development/administrative cheat `POST /reset-skilltree/:characterName` applies the same idempotent reset for an exact, unambiguous character name under row locks, preserving all category XP and levels, logging its result and failing closed if unauthorized or the target is ambiguous/missing.

Light Wisp samples current SP before paying its own cost and before any Arcane Dynamo refund. Ice Bolt cooldown is sequential after resolution: T2 resolves; T3 is blocked; next cast starts T4, progresses T5 and resolves T6; later resolutions are T10, T14, etc. Movement gauge accumulates from T0 on every tick independent of intent, but actual movement remains gated by an active legal approach intent. The root Wailing Wraith Gambit order is canonical: `silence → attack` first and Ice Bolt as the default line; synchronize the frontend copy without overwriting unrelated monster catalogue differences.

## Executive Summary

A browser-based idle MMORPG built with deterministic server-authoritative architecture. All game outcomes are pure functions of character state and a deterministic PRNG seed, enabling seamless idle gameplay with pre-computed battle queues.

## Core Design Principles

### 1. **Server Authority**
- ✅ Server computes all outcomes (battles, XP, loot)
- ✅ Client provides **intents**, not predictions
- ✅ Client animates from server timestamps (`startAt`/`endAt`)
- ❌ Client never simulates game logic

**Benefit:** Prevents exploits, ensures consistency across devices, enables audit trails.

### 2. **Determinism**
- ✅ Same inputs → Same outputs (byte-for-byte)
- ✅ Uses Mulberry32 PRNG (no Math.random())
- ✅ Battle log is reproducible and replayable
- ✅ Supports forensic debugging

**Implementation:** 
```typescript
seed = `${characterId}:${monsterId}:${timestamp}`
rng = new Mulberry32(seed)
outcome = simulateBattle(character, monster, gambit, rng)
// Same seed always produces same outcome
```

### 3. **Seamless Idle**
- ✅ Pre-compute 5 battles ahead in `BattleQueueEntry` rows
- ✅ Client animates for minutes without a request
- ✅ New battles auto-generated when queue drops below 5
- ✅ Handles network interruptions gracefully

**UX Impact:** User can close browser, return in 2 hours, still see 5 queued battles with correct timestamps.

### 4. **Gambit System (FFXII-style)**
- ✅ Declarative automation (not procedural scripting)
- ✅ Server-validated (prevent client-side hacks)
- ✅ Simple & expressive: "IF condition THEN action"
- ✅ Left-to-right evaluation, first legal line wins

**Example:**
```json
{
  "title": "Auto Heal",
  "lines": [
    {
      "conditions": [
        { "id": "self-hp-below", "params": { "percent": 30 } },
        { "id": "has-item", "params": { "itemId": "potion" } }
      ],
      "combinator": "AND",
      "action": { "id": "use-item", "params": { "itemId": "potion" } }
    }
  ]
}
```

---

## Technology Choices

### Backend: NestJS + TypeORM + PostgreSQL

| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Framework** | NestJS 10+ | TypeScript-first, DI, modularity, GraphQL-ready |
| **ORM** | TypeORM 0.3 | Strong TypeScript support, migrations, JSONB columns |
| **Database** | PostgreSQL 16 | ACID, JSONB for complex data, excellent JSON support |
| **Gameplay presence** | MapPresenceService + Redis | Centralized map membership, realtime snapshots, self-healing cache |
| **Online presence** | OnlinePresenceService + Redis | Separate reusable online/heartbeat boundary for future friends lists |
| **Cache/Pub-Sub** | Redis 7 | Presence tracking, job queue backbone |
| **Authentication** | Passport.js + JWT | Industry standard, stateless, CORS-friendly |
| **Validation** | class-validator | Decorators, recursive validation, DTO synergy |
| **Job Queue** | BullMQ | Redis-backed, reliable, great for timed events |

### Frontend: Angular 18+

| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Framework** | Angular 18 | Signals (new), DI, RxJS, mature ecosystem |
| **State** | Signals | React-like reactivity, built-in, no Redux overhead |
| **Styling** | Tailwind CSS | Utility-first, fast prototyping, responsive |
| **Realtime** | Socket.IO | WebSocket abstraction, fallbacks, rooms |
| **UI Kit** | Angular CDK | Drag-drop, tables, overlay primitives |

### Infrastructure

| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Containerization** | Docker | Dev/prod parity, easy deployment |
| **Orchestration** | Docker Compose | Local dev, simple, no Kubernetes overhead |
| **Reverse Proxy** | Caddy | Auto HTTPS, simple config, health checks |
| **Package Manager** | pnpm | Monorepo support, fast, disk efficient |

---

## Data Model & Entity Relationships

### User → Character (1:1)
```
User (username, email, passwordHash)
  ↓
Character (level, xp, gold, status, currentMapId, pendingMapTransition)
  ├→ WeaponProficiency × 7 (one per weapon type)
  ├→ InventoryItem × 50 (inventory) + 10 (warehouse)
  ├→ EquippedItem × 8 (head, body, mainHand, offHand, etc.)
  ├→ GambitPage × 3 (slots 0-2)
  ├→ BattleQueueEntry × N (0-5 unresolved)
  ├→ MapKillCounter × M (one per (character, map) pair)
  ├→ Diet × up to 3 ordered food entries (JSONB on Character)
  └→ MailMessage × N (inbox)
```

### Item → InventoryItem ← Character
- Dual-purpose: Inventory (50 slots) and Warehouse (10 slots)
- Stackable items (max 20) vs. unique equipment (qty=1)
- `instanceData` stores rolled attributes for equipment

### MarketOrder → MarketDeal
- Buy/Sell orders placed by characters
- Orders matched double-auction (buy at resting ask, sell at resting bid)
- Matched orders create `MarketDeal` (history record)
- Matched items delivered via `MailMessage`

### ChatReport → Auto-mute
- Reports stored with reporter/reported user
- Scheduled job: Count distinct reporters per user in 24h
- Auto-mute if ≥ 5 reporters → prevent toxic players

---

## Battle Flow

### 1. **Queue Generation** (When character enters map)
```
for i in range(5):
  monster = selectNextMonster()  // Deterministic via Mulberry32
  battleResult = simulateBattle(character, monster, gambit, seed)
  entry = create BattleQueueEntry {
    startAt: now + (i * avgBattleTime),
    endAt: startAt + battleResult.tickCount * 1000,
    outcome: battleResult.outcome,
    log: battleResult.log,
    xpGain: battleResult.xpGain,
    goldGain: battleResult.goldGain,
  }
  schedule BullMQ job for entry.endAt
```

### 2. **Client Animation**
```
for each entry in battleQueue:
  animationTime = entry.endAt - now
  if animationTime > 0:
    animateBattleBar(animationTime)  // Pure CSS/duration
  else:
    entry is resolved
```

### 3. **Battle Resolution** (When BullMQ job fires)
```
reference = fetch BattleQueueEntry (immutable characterId)
BEGIN PostgreSQL transaction
  character = SELECT Character FOR UPDATE
  entry = SELECT BattleQueueEntry FOR UPDATE
  if entry.resolved:
    COMMIT; return already-resolved (no effects)

  // In this transaction: apply simulated consumptions, XP/HP/SP and level-ups,
  // Diet/Auto Feed, pending equipment changes, drops, kill counter and Town/death
  // routing. Delete future rows here when they are invalidated by those changes.
  // Every participating repository/service receives the same EntityManager.
  entry.resolved = true
COMMIT

// Only after commit: remove BullMQ jobs for deleted/completed rows; synchronize
// Redis map presence if the character left the map; rebuild/top up the queue from
// committed Character + Equipment + Inventory + Diet state; publish socket events.
```

The database transaction is the exactly-once boundary. Do not use BullMQ job state, Redis, or socket delivery as a substitute for transactional idempotency. On rollback, `resolved` remains false and all battle DB effects are undone, so BullMQ retry or boot recovery can safely reapply the whole battle.


### Transactional battle resolution invariant

`BattleService.resolveBattle()` uses one PostgreSQL transaction for the battle's authoritative database effects. Acquire locks in **Character → BattleQueueEntry** order so concurrent jobs for one character serialize. Item consumption, XP/HP/SP, Diet/Auto Feed, equipment substitutions, drops, kill counter and Town/death queue cleanup are persisted together with `BattleQueueEntry.resolved = true`. A thrown error rolls those database writes back; retry/recovery can then safely apply the battle once. BullMQ job cleanup, Redis map-presence synchronization, queue rebuilding and socket publication stay outside the transaction and must not be treated as the idempotency guard for rewards.

### Food expiry and queue projection boundary

`BattleService.queueBattles()` projects `activeFoodBuff` across pre-simulated future entries only to decide whether it can append more encounters. A projected buff cleared because it expires during a future queued battle is not the current persisted Character state and must never itself cause an early Town transition. A battle may start only if food is valid at its actual `startAt`, including the encounter-search delay; if no battle can legally start before a still-future expiry and the queue is empty, schedule a server-side `queue-battles` recheck at that expiry. At the actual boundary, Auto Feed gets its existing authoritative `InventoryService.consumeFood()` opportunity before Town fallback. Never use frontend timers, socket presence or an arbitrary grace period to determine food exhaustion.

### 4. **Gambit Evaluation** (During simulateBattle)
```
for each tick:
  if attacker.attackGauge >= 100:
    gambitLine = evaluate(gambitPage, characterSnapshot, monsterSnapshot)
    if gambitLine:
      action = execute(gambitLine.action)
      apply damage/healing/buff
    attacker.attackGauge = 0

  if defender.attackGauge >= 100:
    // Same as above
```

---

## Diet food stat scaling

Diet mastery is part of the authoritative food-buff calculation. The shared `effectiveFoodStatValue(catalogValue, dietLevel)` helper is the single formula used when food is consumed manually or by Auto Feed, when the deterministic battle engine resolves `use_item`, when battle resolution reconstructs `activeFoodBuff`, and when the frontend renders the Diet tooltip. The engine receives persisted per-food Diet levels in its combat snapshot; item definitions remain raw catalog data so levels are not baked into shared definitions.

### Diet unique-window and streak ownership — `diet-unique-food-streak-rotation` (2026-10-14)

The OpenSpec change `diet-unique-food-streak-rotation` defines `Character.diet` as a three-entry, unique-`itemId` recency window. A repeated food is removed from its old slot and appended at the right without duplication. When the window is full, every successful meal evicts the oldest entry before the selected food is appended. A selected food's next level is computed before eviction so eating the oldest retained food does not erase its own streak. Eviction resets that food's level, but any future `lastDigestUntil` must survive outside the visible window to enforce the digestion lockout. The API now uses a shared deterministic normalizer/transition helper for manual consumption, Auto Feed eligibility and battle-resolution food reconciliation; queue snapshots consume the normalized `dietLevels` projection. A one-time migration repairs legacy duplicate JSON without touching inventory. NPC-granted food, if introduced as a separate gameplay path, must call the same `consumeFood` transition rather than write Diet state independently.


## Authoritative Resource Synchronization

Character HP/SP and Inventory quantities have two distinct frontend concerns:

- **Authoritative state:** `CharacterStore` and `InventoryStore` hold the latest persisted server state. Battle resolution publishes a complete Character + Inventory snapshot with the Character `stateVersion` as the monotonic revision.
- **Active-battle presentation:** while an encounter is actually ACTIVE, `CharacterSummary` may derive a temporary display value from the queued battle's immutable log events and its `startAt`/`endAt` timestamps. This is animation/presentation only; it never mutates either store or the server. As soon as the battle is no longer ACTIVE, the display falls back to the authoritative store state.

### Causal ordering

The HTTP and realtime paths are intentionally guarded independently:

1. `CharacterStore` and `InventoryStore` retain a request sequence and a realtime generation. An HTTP response that belongs to an obsolete request or was in flight when a newer realtime snapshot was accepted is discarded.
2. Both stores retain the latest accepted `stateVersion` and ignore realtime snapshots with an equal or older revision.
3. `GET /inventory` returns `{ items, stateVersion }`, so InventoryStore can compare an HTTP snapshot against the same Character revision used by battle realtime updates.
4. After battle resolution, **both** `battle:resolved` and the immediately following `battle:queueUpdated` carry the same authoritative Character + Inventory snapshot and revision. They use independent Redis pub/sub channels, so the duplicate snapshot is deliberate: Socket/Redis delivery order is not treated as a causal guarantee.

### Important boundary

`battle:queueUpdated` emitted during normal queue generation (for example on map entry) may contain only the queue. The authoritative snapshot fields are attached specifically to the post-resolution queue update. This keeps the queue contract backward-compatible for other producers while closing the resolution → encounter-search race.

---

## Security Considerations

### Authentication
- ✅ JWT tokens (Access token: 15 minutes, Refresh token: 7 days)
- ✅ Password hashed with argon2 (argon2id, memory=19456, timeCost=2, parallelism=1)
- ✅ CPF hashed with HMAC-SHA256 (never stored raw)
- ✅ Single session enforcement (User.activeSessionId + sessionId claim in JWT)
- ✅ CORS restricted to known origins

### Authorization
- ✅ Players can only access their own character
- ✅ All server logic validates ownership
- ✅ No client-side role/permission checks

### Input Validation
- ✅ DTOs validated with class-validator decorators
- ✅ Combat formulas use validated snapshots
- ✅ Gambit lines validated server-side (reject invalid references)
- ✅ Item stacking/equipment slots validated before persistence

### Rate Limiting
- ⚠️ TODO: Implement rate limiting middleware
  - Chat: 1 message/sec per user
  - API: 100 requests/min per user
  - Market orders: 5 orders/min per user

### Exploits Prevented
- ❌ Offline XP farming (battles pre-computed server-side)
- ❌ Infinite gold exploit (currency capped at 1 trillion)
- ❌ Market price manipulation (order matching is deterministic)
- ❌ Duplicate item creation (inventory operations atomic)

---

## Performance Optimizations

### Database
- ✅ Indexed fields: `characterId`, `userId`, `status`, `currentMapId`, `mapId`
- ✅ JSONB columns for battle logs (queryable)
- ✅ Denormalized kill counters (fast lookup)
- ✅ Connection pooling (TypeORM default)

### Caching
- ✅ DataService loads JSON files once at startup (immutable)
- ✅ Redis for gameplay map-presence runtime cache (timestamped HASH per map)
- ✅ Redis pub/sub for cross-process realtime event fanout
- ✅ Redis for job queue (BullMQ)
- ✅ HTTP cache headers on static assets (frontend)

### Lazy Loading
- ✅ Inventory items paginated (50 items visible, more via scroll)
- ✅ Chat messages paginated (latest 50 first)
- ✅ Battle log only fetched on-demand (not in queue list)

### Real-time Efficiency
- ✅ Socket rooms minimize broadcast scope
- ✅ Map population is pushed as absolute snapshots only when membership/count changes
- ✅ PostgreSQL remains authoritative; Redis map presence is a self-healing runtime cache
- ✅ Online/socket presence is isolated from gameplay map presence
- ✅ Reconciliation repairs missed map-presence writes without turning the battle loop into a presence mechanism

---

## Map Presence, Online Presence & Future Movement

### Ownership

Map presence is a gameplay-state concern, not a Socket.IO connection concern.

The authoritative question is:

`currentMapId is set && pendingMapTransition is null` for generic map presence; `status='grinding' && currentMapId = target && pendingMapTransition is null` for encounter search

`MapPresenceService` owns this predicate, Redis map membership, absolute population publication, stale-member pruning and periodic reconciliation.

`OnlinePresenceService` owns online/socket state and is the reusable home for the future heartbeat that will support friend/online-player lists. It does not decide whether a character is on a gameplay map.

### Realtime flow

```
Authoritative Character transition
          |
          v
MapPresenceService.syncCharacter(characterId, previousMapId)
          |
          +--> Redis map hash updated
          |
          +--> population changed?
                   |
                  yes
                   |
                   v
            Redis pub/sub
           gateway:map:presence
                   |
                   v
            NanommoGateway
           Socket.IO map room
                   |
                   v
             map:presence
        { mapId, playersOnMap }
                   |
                   v
                Frontend
              replace count
```

The frontend never applies `+1/-1` deltas. It replaces its displayed count with the absolute snapshot. A later snapshot naturally corrects any missed/interleaved update.

### Canonical Town identity

Town has exactly one physical identity in the runtime: `map_town`. That same value is the Character location, canonical map-catalog entry, single Board Town node, map-presence identity, Socket.IO room suffix, Town NPC location boundary, and destination of Town-return transitions. `status = town` is an activity/state value only; it is never an alternative physical-location model. The Board must render the dedicated Town node once and must exclude `isTown` entries from the generic grind-map loop.

### Central transition boundary

Any future movement implementation should follow this sequence:

1. Capture the previous `currentMapId`.
2. Apply and persist the authoritative new Character map state.
3. Call `MapPresenceService.syncCharacter(characterId, previousMapId)`.

The same boundary already covers map entry, map-to-map movement, Town routing, death and food exhaustion. A deferred Town request uses the generic `pendingMapTransition` state: presence is removed immediately while `currentMapId` remains the battle map, then the transition finalizes to `map_town` after the active battle resolves.

Battle start/end is not a map-presence event. The character is still on the same map unless authoritative gameplay state says otherwise.

### Redis role

Redis is deliberately a cache/runtime layer here:

- PostgreSQL answers who should count.
- Redis makes the per-map membership and publication path fast and ephemeral.
- Timestamps allow stale members to be removed.
- A 10-second reconciliation pass repairs missed writes or process interruptions.

A Redis failure must never be interpreted as a gameplay state transition. The next reconciliation and explicit state transition restore the cache.

### Future heartbeat boundary

The future heartbeat should call `OnlinePresenceService.touch()` to keep online state fresh. It must not add/remove map membership and must not be used to infer gameplay movement.

---

## Future-combat mutation boundary

`BattleService` owns the authoritative invalidation/rebuild boundary for any successful mutation that changes a future battle simulation. `CharacterService.spendAttributePoints()` and `GambitService` active-page edits/activation call this boundary rather than deleting `BattleQueueEntry` rows or BullMQ jobs themselves.

The boundary checks the persisted unresolved queue for the authoritative active-battle window `startAt <= now < endAt`. It never rejects these combat-state mutations merely because a battle is active. During an active battle, the mutation is persisted, the active BattleQueueEntry and its BullMQ job are preserved, and only stale future entries after the active battle are discarded; the replacement future chain is intentionally deferred until that battle resolves. When no battle is active, stale unresolved entries and their jobs are discarded and `queueBattles()` rebuilds the canonical five-entry chain from the new Character + Equipment + Inventory + active Gambit state. Town and pending-transition states never fabricate a grind queue.

Inactive Gambit edits do not cross this boundary, and activating the already-active page is a no-op. The current in-progress battle is never edited or re-simulated; only future unresolved snapshots are invalidated.

The CharacterModule/BattleModule dependency is intentionally circular and uses `forwardRef`. Because BattleModule also imports InventoryModule and EquipmentModule, and both of those modules import CharacterModule (EquipmentModule also imports InventoryModule), those cycle-closing module references must also use `forwardRef` on both sides where applicable. Keep this module graph explicit when adding future cross-module dependencies; `BattleService` remains the sole owner of queue reconstruction and BullMQ cleanup.

## Testing Strategy

### Unit Tests
- Battle formulas (damage, crit, hit chance)
- PRNG determinism
- XP curves
- Stat calculations

### Integration Tests
- Character creation → Initial inventory
- Equip item → Stat recalculation
- Gambit save/validate
- Battle queue generation
- Market order matching

### E2E Tests
- Full game loop (login → map → battles → level-up)
- Death and respawn
- Market transactions
- Chat and reporting

### Load Testing
- 1000 concurrent users
- Battle queue generation (5 pre-sim per user)
- Market order throughput
- Chat broadcast latency

---

## Deployment Strategy

### Development
- Docker Compose (all services local)
- Hot reload (NestJS dev server)
- Mock data via JSON files
- Database auto-sync

### Staging
- Docker images built
- PostgreSQL (production config)
- Redis persistence (RDB)
- SSL via Caddy

### Production
- Kubernetes or Docker Swarm
- Managed PostgreSQL (RDS, Cloud SQL)
- Redis cluster (Sentinel)
- CDN for static assets
- CloudFlare for DDoS protection
- Scheduled backups (daily)

---

## Known Limitations & Future Improvements

### Current
- ✅ Single-server deployment (no horizontal scaling)
- ✅ No guilds/parties yet
- ✅ No PvP combat
- ✅ No daily quests/events
- ✅ Portuguese UI only (English scaffold ready)

### Planned
- Horizontal scaling with Redis pub/sub
- Guild system with guild wars
- Future PvE/PvP party battles up to 5 vs 5; the current simulator remains one character versus one monster, and group/target/area rules require separate approved OpenSpec changes
- PvP arena battles
- Daily dungeons with unique loot
- Multi-language support
- Mobile app (React Native)
- Analytics dashboard (Grafana)

---

## Documentation Links

- [SPEC.md](./SPEC.md) - Full game design specification
- [README.md](./README.md) - Setup and development guide
- [NEXT_STEPS.md](./NEXT_STEPS.md) - Implementation roadmap

---

**Last Updated:** October 8, 2026
**Architecture Version:** 1.2
**Status:** Active MVP implementation


## Frontend UI implementation lessons — 2026-10-05

The Grind scaling/layout pass established durable frontend rules for future Character/Gambits/Mastery UI work.

### Application-level scaling, not browser zoom

The intended enlarged readability level is part of the application CSS. Do not use browser zoom or transform scaling to imitate a larger UI. Those approaches complicate responsive layout, fixed-position overlays and hit testing. Prefer scoped CSS tokens/explicit font sizes and grid/flex dimensions.

### Fixed shell baseline

The desktop play shell treats the outer left/center/right zones as a geometry invariant: their bottom edges align at one viewport-derived baseline. Content-heavy inner panels may manage their own overflow, but they must not change the outer panel height. Character, Gambits and Mastery should consume this invariant rather than inventing content-driven heights.

### Reuse item UI

Inventory, equipment and vendor stock use the same item presentation and centralized CatalogService.itemTooltipLines() content path. Future item-bearing surfaces, including the Character Inventory, should reuse that path rather than implement separate tooltip/content logic.

### Tooltip safety boundary

The current tooltip implementation uses pointer events and a document-level floating clone positioned relative to the curluk/viewport. A previous MutationObserver-per-tooltip implementation caused severe Firefox CPU/UI freezes and had to be removed. Do not reintroduce MutationObserver-driven tooltip positioning or container-local tooltip elements that can be clipped by overflow.

### Desktop/mobile isolation

Desktop readability/layout rules must be scoped to the intended desktop breakpoint. Mobile has its own deliberate composition and must not be treated as a scaled-down desktop screenshot.

### Dense row integrity

When increasing typography in dense editors such as Gambits, layout constraints must preserve semantic groups on one line. Do not solve wrapping by shrinking the requested font size or hiding overflow. Reserve width for labels and parameters with grid/flex constraints and keep repeated rows structurally consistent.

### Verification discipline

Builds and git diff --check prove syntax/build integrity, not visual correctness. When browser smoke is unavailable, record that explicitly instead of claiming visual verification. UI changes that touch Inventory/equipment should also exercise drag/drop, tooltips and equipment edge cases where practical.

## Battle distance and movement ownership

The shared `BattleEngine` owns battle-local lane positions, empty-space distance, combat-style initialization, range checks, movement intent/gauge, Slow status timing and deterministic movement events. It remains pure and consumes immutable character/monster/Gambit/catalog snapshots; API queue generation freezes the character's entry combat style and uses the same simulator for every precomputed queue entry. Position state is not persisted as map location and the frontend does not simulate or visualize the lane in this change.

Each duel has eight positions (0–7). Melee-vs-melee begins at 3/4; any RANGED participant means 0/7. Actions evaluate at the start-of-tick positions, then movement resolves in a deterministic post-action phase. The movement gauge is independent of attack/cast gauges, starts at zero at T0, and gains effective Move Speed on every tick even when approach intent does not exist. It is a banked charge meter rather than a move command: actual movement requires a legal selected out-of-range action, consumes 100 per completed step, moves at most one space per tick, and retains overflow while idle. The server's immutable log records initial position/style/speed and completed movement (space count, from/to positions and direction), but emits no `range_blocked` event. Both Grind and Battle Logs derive the displayed arrow from the position delta: increasing position is `-->`, decreasing position is `<--`; they do not assume a fixed direction based on whether the actor is the character or target. This remains correct if they pass each other and swap sides.

Monster catalog metadata is explicit and mirrored in the frontend public catalog: `combatStyle`, `basicAttackDamageType`, `basicAttackRange`, and level-1 `moveSpeedBase`. Character base Move Speed is `50 + level` and is displayed in the Character page's derived Stats panel. Monster Evasion is tuned down 10% from its previously calibrated values. The approved basic-attack hit chance is `clamp(100 + Precision - Evasion, 5, 95)`. The canonical `status_effects.json` owns status duration, stackability/cap, Move Speed penalties and Attack Speed penalties; its frontend mirror is loaded by CatalogService, and the API passes the same definitions into BattleEngine. Slow is non-stackable and refreshes its -50 Move Speed duration for 20 ticks. Ice Bolt's skill definition contains only `applyStatus: "freeze"` and `statusChance: 0.25` for status application; Freeze's five-tick duration, -25 Move Speed per stack, -25 Attack Speed per stack, and three-stack cap live in the status catalog. Attack Speed penalties subtract fixed rating points and affect basic Attack gauge refill only: effective rating 0 means 10 ticks, while 800 means 1 tick; skill/cast timing remains DEX-based. Wailing Wraith's Ice Bolt is a 2-tick, 10-SP, 1 tick-cooldown ranged magic action at `maxRange: 7` inclusive of the target position; the monster mana resource uses max SP 80 and regenerates 2 SP per 10 ticks. Tick 0 is the initial instant, so the initial Ice Bolt resolves at T2. The approved cooldown contract then blocks T3; the next cast starts at T4, continues at T5 and resolves at T6, and subsequent resolved casts occur at T10, T14, etc. Cooldown does not run down concurrently with the next cast. The first tick is not incorrectly counted as a full elapsed second. Stack expiration is explicit: `status_stack_lessened` records remaining stacks and `status_ended` records the final stack or a non-stackable status expiry. The live Grind feed and Battle History format the same immutable `use_skill.damage` value. Wraith's basic attack remains melee and only its legal Ice Bolt keeps it stationary; if Silenced, its Gambit fallback can approach and use the basic attack. The Character summary and Grind monster STATUS area are specified to show the complete real-time status icon set with stack/duration tooltips sourced from the status catalog; implementation of the full set is pending `refining-hand-equipment-mastery-skills`. This change does not implement lane UI, multi-target AoE, groups, PvP, cross-lane movement or executable 5x5 combat. The future design may represent up to five independent eight-space lanes.


## Inventory layout mutations and drag/drop stability — 2026-10-13

Inventory ordering is a persisted part of `InventoryItem.slotIndex`, not a local-only visual reorder. The shared Angular `InventoryGrid` is used by both Grind and the Character tab, so controls and drop behavior belong there rather than in route-specific copies.

The authenticated inventory API owns two layout mutations: moving a row to a target slot and lukting a complete inventory row-ID order. A move to an occupied slot swaps the two rows. A move to an empty slot leaves the source slot empty. Sorting validates that the request contains each current inventory row exactly once, then compacts occupied slots from index 0 without merging or splitting stacks. Both operations lock the Character before locking inventory rows and save the Character to advance its `stateVersion`; the client applies the returned Inventory + Character snapshot through its revision-aware stores. This prevents an older in-flight GET/realtime snapshot from casually replacing a newer accepted layout.

The database constraint `UNIQUE(characterId, location, slotIndex)` means row swaps and compaction must not assign a destination before freeing/staging the conflicting index. Use a temporary index outside the user-facing range, then persist final indexes in a second step inside the same transaction. Do not leave temporary indexes committed.

Angular CDK's drag placeholder is not the slot geometry. Inventory and vendor cells retain fixed dimensions from their slot wrappers; their source placeholders are hidden so the item's 72px preview cannot stretch grid tracks. The vendor drop-list uses a dashed CSS `outline` to signal a valid selling target; an outline (not border/padding) preserves its box geometry. The per-slot target highlight is likewise visual-only. Do not reintroduce DOM mutation observers for hover tracking; use the existing pointer/drag lifecycle and safe hit-testing.


### CDK custom placeholders and tooltip lifecycle — 2026-10-13

A template fragment named `cdkDragPreview` or `cdkDragPlaceholder` is not sufficient by itself in a standalone Angular component. The matching CDK directives must be included in that component's `imports`. If omitted, the browser can fall back to CDK's default clone, whose intrinsic dimensions can create oversized grid tracks when it is moved into a connected drop list. InventoryGrid must import both preview and placeholder directives; the vendor component already does. Keep the custom inventory/vendor placeholders hidden, while the fixed slot wrapper remains the grid geometry anchor.

Tooltip overlays are cloned into `document.body`, so pointer leave alone is not a reliable cleanup boundary during a captured drag. Every draggable surface publishes the same `nm:drag-start` / `nm:drag-end` document lifecycle. `TooltipPositionDirective` hides the floating clone and stops its content timer at drag start, refuses to show or reposition while suspended, and only re-enables hover on drag end. Do not make the tooltip follow the drag preview or add MutationObservers; hover should show it again only on a subsequent pointer-enter.

## Hand equipment and Mastery ownership

The item catalogue owns hand slot and two-handed classification. Main/off-hand identity remains semantic across handedness presentation. Secondary weapon ATK is weighted at 50%; all other secondary item properties are applied at full value. Mastery action rewards use equipment and successful actions copied into the immutable battle snapshot and are committed transactionally by `BattleService.resolveBattle`; duplicate resolver delivery is guarded by the existing locked resolved marker. Configured default reward values live in API environment configuration, never in the shared simulator.

Equipment and skill changes that affect future combat must cross `BattleService.runFutureCombatMutation()`. While a battle is active, its persisted queue entry, BullMQ job, and precomputed snapshot remain unchanged; stale later entries are invalidated and the next canonical queue is built after the active battle resolves. The battle engine remains the owner of the eight-position lane, range, and movement contract used by positional skills. Current combat is one character versus one monster. Future PvE/PvP up to five versus five remains roadmap work requiring a separate group-combat design; no group targeting or AoE behavior is implied here.

## Mastery allocation and reset boundary — 2026-10-13

Mastery UI rank clicks are local drafts. Apply submits absolute target ranks for one category to `POST /characters/mastery/apply`; the API validates the complete category allocation and persists it under a proficiency-row lock inside `BattleService.runFutureCombatMutation()`. Reset only discards the selected category's client draft. The active battle queue entry/job remain immutable under the shared future-combat mutation boundary.

Migration `1796000000000-ResetExistingMasterySkillRanks` performs the one-time global allocation reset by clearing `skillRanks` and `spentSkillPoints` while preserving proficiency rows, category XP, and levels. `POST /reset-skilltree/:characterName` is a JWT-protected development/admin cheat that resets one exact character's category allocations transactionally. In production it requires `req.user.role === 'admin'`; confirm that the authentication strategy actually includes the role claim before granting access.

Monster SP is simulator state initialized from `monsters.json`, not a UI estimate. Current defaults are 60 max SP and 2 SP per ten ticks, with Venom Viper and Wailing Wraith at 80 max SP. Monster skill costs come from the canonical `skill_trees.json` definitions and are paid only when a legal skill executes. Character and monster resource snapshots are emitted together in `spRemaining` events. Cooldown lockout is sequential: it blocks the configured number of ticks after resolution and does not overlap the next cast.

Implementation status is partial: the two panels currently use separate status projections rather than one shared reducer; status stack-duration/early-removal edge cases still need tests; per-skill illustrated SVGs are now mapped and copied by the frontend build; the originally requested high-quality PNG variants and visual/browser review remain outstanding; richer rank-aware tooltips/tree polish and reset/monster-SP integration tests remain outstanding. No deploy or migration execution is part of this coding session.

## Food mutation and immediate approach timing — 2026-10-14

Manual inventory consumption is a future-combat mutation. The Inventory controller routes `POST /inventory/use` through `BattleService.runFutureCombatMutation()` rather than directly mutating inventory/diet while leaving stale BattleQueueEntry simulations unresolved. The shared boundary preserves the active entry/job if a battle is actually running; otherwise it invalidates stale unresolved entries and lets the canonical queue be generated from persisted Diet state on the next eligible map entry. Never rewrite an active battle's immutable food snapshot.

The shared simulator's per-boundary regeneration is base Character HP/SP regen plus all food buffs still active at that tick. Each food retains its own expiry; for Cheese and three-star Bread, expected regen is +23 HP / +8 SP until Cheese expires, then +15 HP / +7 SP. UI log events are distinct HP and MP/SP events and their formatters must show resource and amount, preventing a same-tick HP+MP pair from looking like duplicated HP regen.

Approach intent is a movement decision, not an action resolution. The engine refreshes it every tick by inspecting currently legal attack/cast target actions; it starts approach without waiting for those action gauges to fire, still retains movement gauge/cooldown/range rules, and clears intent if no legal target action needs approach. Mastery and Character status icons reuse `TooltipPositionDirective`; tooltip triggers include hover and keyboard focus. Production asset copy includes `assets/ui/skill-icons` and `assets/ui/status`. The 2026-10-14 change passed local builds/focused tests but was not deployed or browser-visually verified.


## Live status presentation and SP event copy — 2026-10-14

The Grind panel owns live presentation for in-progress combat events. Monster `sp_regen` is displayed as `{monsterName} regenerates {amount} SP.` in that live feed only; the Battle History formatter remains unchanged. Monster icons are derived from the immutable initial snapshot plus `target: 'monster'` timeline events evaluated against the display clock. Keep `item-tooltip` off the icon wrapper because the global CSS hides that class's element; tooltip content belongs in a child node. For Character status tooltips, only the `.status-effect-icon` anchor should own `TooltipPositionDirective`; excluding nested `.status-tooltip` nodes from the directive selector avoids duplicate handlers fighting over the same floating overlay. The UI remains a read-only projection of battle log/timestamps, not a second combat state authority.


## Status-event ownership, no-expiry effects and tooltip ownership — 2026-10-14

When a monster skill applies a status to the player, immutable log data uses `actor: 'monster'`, `target: 'character'`. Presentation must not confuse the source with the status owner. Status effects with no `expiresAtTick` and no positive `durationTicks` are untimed effects; the live timeline must keep them active until explicit removal or battle end, rather than deriving a fake expiry at the application tick. This applies to Bleed (`statusDurationTicks: 0`).

Character and Grind status tooltip markup must omit `.item-tooltip`, because that global class is forcibly hidden. Both `.status-effect-icon` and `.status-icon` use `TooltipPositionDirective` to clone their child `.status-tooltip` into the document overlay; do not attach the same directive to the nested tooltip content. This produces one lifecycle owner, keeps placement viewport-aware, and avoids clipping and competing hide/show handlers.


## Stable status-icon DOM identity and tooltip lifecycle — 2026-10-14

Both live status projections are reevaluated on a 250 ms display-clock signal and return fresh objects. The Character STATUS `*ngFor` and Grind monster STATUS `*ngFor` therefore require ID-based `trackBy` functions. This preserves each icon element and its `TooltipPositionDirective` listeners across clock refreshes, so an active hover does not lose its overlay when Angular updates stack/duration text. Without `trackBy`, the old wrapper's destruction removes its overlay and the replacement wrapper under the pointer may not receive another pointer-enter. Keep one directive owner on each icon wrapper, keep the nested `.status-tooltip` as non-visible content, and use the existing document-level viewport-aware overlay; do not restore panel-local hover display or a MutationObserver.


## Heavy Swing / Disarm / action-gauge precedence — 2026-10-14

Brutality contributes only `strPerRank: 6`; it must not be a combat-status proc. Heavy Swing owns Disarm: its physical formula is `ATK × 1.1 + 20 × masteryRank`, and its catalog effect declares guaranteed `disarm` with duration ticks `[3, 6, 9, 12, 15]`. The engine's active-skill resolution path reads `applyStatus`, chance and rank duration from the skill definition and applies the canonical status through `applyStatus()`; it must not hardcode Heavy Swing separately or add a second status source.

Attack and Cast gauges are separate clocks, but they may not resolve a basic Attack and a selected ready in-range active skill on the same tick. Evaluate the legal Cast-gauge Gambit choice against the current combat snapshot before processing the character's Attack gauge. If a selected `use_skill` is ready and in range, suppress the Attack-gauge fire and reset its accumulated progress. Out of range, this priority does not prevent movement/approach; the existing legal target-action and lane-range code continues to move the character toward the skill's required range. Once skill execution sets its ordinary cast/cooldown lock, basic Attack refills normally and may resolve only on a later tick. Preserve deterministic seeded action ordering and do not introduce client-side combat logic.


## Storage and drop-capacity correction handoff — 2026-10-16

The canonical map catalogue now includes explicit npcIds; Town NPC discovery must be scoped to the character's canonical Town-type map and must require status === "town" with no pending map transition. Storage is a distinct storage capability, not a Vendor. Warehouse transfers must lock Character first and then the source/destination rows, moving complete stacks only; a merge is allowed only if the complete stack fits. Inventory grants never silently redirect to Warehouse. Battle drop capacity is preflighted per drop inside the payout transaction; a non-fitting drop is logged and skipped, while unrelated payout effects continue.

The core implementation and offline validations are complete. The horizontal map board and level-15+ HP reduction are implemented in canonical data and mirrors. Storage uses row-ID whole-stack transfers; the shared status projector is used by both Character Summary and Grind; Mastery Level 7 starts at 20,000 cumulative XP; forward-only Town-reset/Mastery migrations exist; and queue/presence maintenance is serialized behind a fail-closed shared gate. Live PostgreSQL/Redis/Bull integration and authenticated battle visual verification remain pending because the configured database hostname could not be resolved from this workstation. Never run migrations or baseline their history without an explicit live schema audit and all API/Bull consumers stopped.

### Vendor sell quantity ownership
The Inventory drag payload identifies the selected row and quantity. The Vendor sell modal uses that selected stack quantity as its upper bound, additionally capped by the current owned total to avoid stale UI values. The All button remains a generic selection of the active modal maximum; it must not compute aggregate item quantity itself.


## Storage, status projection, Mastery thresholds and global Town reset (2026-10-16)

- `maps.json` owns map topology, horizontal board coordinates and each map's `npcIds`. `npc_catalog.json` owns the one canonical Storage definition. Frontend mirrors must match canonical JSON. Town Storage endpoints share a guard that requires the character's current map to resolve to `type: town`, `status: town`, and no pending map transition.
- `InventoryService.transferInventoryRow()` is the shared row-ID-based transaction for Inventory↔Warehouse transfers. It locks Character first, revalidates the source row/location, locks destination rows, validates slot and stacking rules, then commits either a whole-stack merge or move into a free slot. Generic grants cannot overflow to Warehouse. Battle drop capacity is preflighted in Inventory and non-fitting drops are logged/discarded without aborting the remaining payout.
- `projectStatusTimeline()` in shared battle-engine code is the one read-only status projection used by Character Summary and Grind monster STATUS. It replays immutable snapshot/events for a specific target and display tick; frontend components only format the projected state. Status-expiry events identify the removed stack where available.
- `MASTERY_LEVEL_XP_THRESHOLDS` in shared code is canonical. `weapon_xp_curve.json` is not authoritative. `1799100000000-ReconcileMasteryLevelsForCumulativeXp` is forward-only and changes only stored levels. `1799000000000-ResetAllCharactersToCurrentTown` is also forward-only; it preserves one already-started unresolved battle per character, deletes stale unresolved projections, and requests Town after the preserved battle.
- Queue maintenance now uses `BattleQueueGateService`: a Redis lease serializes startup repair, the shared gate closes across replicas, Bull is globally paused and active jobs are drained before repair; DB rows/jobs are reconciled, MapPresence is rebuilt from authoritative Character state, missing resolver jobs are repaired, and only valid Grind characters are topped up. Any pending/missing migration baseline or reconciliation error leaves the gate closed and the queue paused. `reconcile:battle-queue` runs in a context without Bull processors and intentionally leaves the gate closed/queue paused; normal API startup opens/resumes only after it revalidates.
- Migration commands are explicit. `db:migration:show` performs a read-only audit rather than TypeORM `showMigrations()`, which may create the tracking table. `db:migrate` requires explicit stopped-consumer confirmation and refuses to replay the full history when the tracking table is absent/empty. For an already-existing schema, `db:migration:baseline` is a separate, high-risk operator-only action: it records only a manually audited chronological prefix through the named legacy migration (never the new Town/Mastery migrations), and mutates only migration-history metadata.
- Required operations when a live database is reachable: stop all API/Bull consumers → read-only migration-history audit → manually audit or establish the legacy migration baseline → guarded migrations → run stopped-consumer queue/presence reconciliation → start normal API/worker services. The current workstation could not resolve hostname `db` (`EAI_AGAIN`), so the actual database history is unknown and no migration/baseline/deploy was run.


## Migration history audit and guarded baseline (2026-10-16)

- `apps/api/src/database/data-source.ts` is the missing TypeORM CLI DataSource; it loads the root `.env` and has both synchronization and auto-migration disabled. Do not use TypeORM's CLI `migration:show` because its implementation may create the tracking table when missing; use `pnpm --filter @nanommo/api db:migration:show`, which reports history using read-only queries.
- Guarded `db:migrate` refuses if migrations are pending and the history is missing/empty, because replaying every historical migration against a schema that was previously synchronized/manually altered could corrupt state. To recover a proven legacy schema, manually audit the schema/data, stop all API/Bull consumers, then use `BATTLE_QUEUE_MAINTENANCE_ONLY=true CONFIRM_QUEUE_CONSUMERS_STOPPED=1 CONFIRM_LIVE_SCHEMA_AUDITED=1 MIGRATION_BASELINE_THROUGH='<exact verified legacy migration name>' pnpm --filter @nanommo/api db:migration:baseline`. This writes only TypeORM migration-history rows for the chronological legacy prefix, ending no later than the existing catalog migration; it never baselines the newly added `179900...` or `179910...` migration. Do not guess this boundary.
- After a safe known baseline, run `BATTLE_QUEUE_MAINTENANCE_ONLY=true CONFIRM_QUEUE_CONSUMERS_STOPPED=1 pnpm --filter @nanommo/api db:migrate`, then `BATTLE_QUEUE_MAINTENANCE_ONLY=true CONFIRM_QUEUE_CONSUMERS_STOPPED=1 pnpm --filter @nanommo/api reconcile:battle-queue`. The maintenance app does not register Bull consumers and leaves the queue paused/gate closed; normal API startup performs the final fresh reconciliation and is the only path that opens/resumes processing.
- The workstation's read-only migration audit failed before connection because hostname `db` did not resolve. No database writes/migrations or deploy were performed. Actual DB/Bull integration must be completed from the configured Docker/network context after schema history is audited.
