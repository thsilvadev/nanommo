# NanoMMO - Architecture & Design Decisions

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
Character (level, xp, gold, status, currentMapId)
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
entry = fetch BattleQueueEntry
character = fetch Character

// Apply results
// Auto Feed is evaluated here at authoritative digestion/grind boundaries.
// If the current food expires before the next encounter and an eligible Diet food exists,
// consume it server-side and rebuild the unresolved future queue from the new state.
character.xp += entry.xpGain
character.gold += entry.goldGain
character.inventory += entry.drops

// Check level-up
while character.xp >= character.nextLevelXp:
  character.level += 1
  character.hpCurrent = character.maxHp  // Restore on level-up
  character.xp -= character.nextLevelXp

// Handle death
if entry.outcome == 'loss':
  character.status = 'town'
  character.currentMapId = null
  character.hpCurrent = 1
  character.xp -= character.nextLevelXp * 0.05
  character.lastDeathLog = entry.log
  delete all unresolved BattleQueueEntry rows

// Cleanup
entry.resolved = true
if queue.length < 5:
  queueBattles(character)

// Broadcast authoritative resource state
emit 'battle:resolved' {
  entryId,
  outcome,
  xpGain,
  goldGain,
  drops,
  stateRevision,
  characterAfter,
  inventoryAfter,
}
// After queue advance/rebuild, publish the same Character + Inventory snapshot
// and stateRevision on battle:queueUpdated. The two Redis channels may arrive
// in either order at the browser, so delivery order is never treated as causal.
```

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
- ✅ Redis for presence tracking (O(1) lookups)
- ✅ Redis for job queue (BullMQ)
- ✅ HTTP cache headers on static assets (frontend)

### Lazy Loading
- ✅ Inventory items paginated (50 items visible, more via scroll)
- ✅ Chat messages paginated (latest 50 first)
- ✅ Battle log only fetched on-demand (not in queue list)

### Real-time Efficiency
- ✅ Socket rooms minimize broadcast scope
- ✅ Debounced character updates (batch events)
- ✅ Presence tracking uses Redis sets (not DB)

---

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

**Last Updated:** October 1, 2026
**Architecture Version:** 1.1
**Status:** Active MVP implementation
