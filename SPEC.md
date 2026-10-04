# NanoMMO — Full Technical & Design Specification

> Single source of truth for building NanoMMO, a browser idle MMORPG, in an AI-assisted IDE.
> This document is intentionally exhaustive. Build it phase by phase (see §16 "Build Plan / AI Prompts"),
> not all at once. Every formula, schema and rule below is a decision already made — do not re-derive
> them, implement them as written. Where a value is explicitly marked `TUNABLE`, it is expected to be
> adjusted after playtesting without changing the surrounding system.

## Table of Contents

1. Product Overview & Pillars
2. Tech Stack & Monorepo Layout
3. Core Design Principles (determinism, server authority, seemless idle)
4. Data Model (TypeORM entities)
5. Attributes, Stats & Formulas
6. Progression: Character XP & Weapon Proficiency
7. Battle Engine (tick simulation, action gauge, prediction queue)
8. Gambit System
9. Weapons & Skill Trees
10. Items, Equipment & Inventory
11. Maps, Encounter Queues & Drops
12. Town: Vendor NPC, Warehouse, Chat
13. Market Trade
14. Mail System
15. Accounts, Auth & Security
16. WebSocket Protocol (event catalog)
17. Frontend Spec (routes, components, state, UX)
18. Infra, Docker, Redis, Caddy, CI/CD
19. Testing Strategy
20. Build Plan — Ordered AI Prompts
21. Appendix — JSON Data Files Reference

---

## 1. Product Overview & Pillars

NanoMMO is a **browser-based idle MMORPG**. There is no manual combat input. The player:

1. Creates an account and a single character.
2. Distributes attribute points and equips gear.
3. Configures a **Gambit page** (FFXII-style automated behavior script).
4. Selects a map to grind on. The character fights monsters automatically, one at a time,
   deterministically, for as long as it can sustain itself (potions/food) or until the player intervenes.
5. Returns to town to trade, manage inventory, chat, and use the Market.

**Pillars:**
- **Determinism.** Every battle outcome is a pure function of `(characterState, monsterState, seed)`. No live RNG during battle resolution — everything is computed once, up front.
- **Server-authoritative, client-light.** The client never computes outcomes; it only animates timers derived from server-provided timestamps.
- **Minimal network chatter.** The server pre-computes and pushes a short queue of upcoming battle results so the client can run "seemlessly" for minutes without a single extra request (see §7.4).
- **True idle.** Progress continues while the browser is closed, as long as the character stays on a map (town = paused when offline). No punishing offline penalties beyond running out of consumables.
- **Meaningful automation depth without code.** The Gambit system is the player's entire skill expression. It must be deep (up to 2 chained conditions, 20 lines, 3 pages) but never require the player to write logic — only compose from curated lists.

---

## 2. Tech Stack & Monorepo Layout

- **Backend:** NestJS (Node 20+, TypeScript strict), TypeORM, PostgreSQL 16, Redis 7 (BullMQ for scheduled jobs + pub/sub for cross-instance socket fanout), Socket.IO Gateway, class-validator/class-transformer for DTOs, Argon2id for password hashing.
- **Frontend:** Angular 18+ (standalone components, Signals for local/reactive state, RxJS for streams/socket events), Tailwind CSS + Angular CDK (drag-drop, overlay), i18n via `@angular/localize` (pt-BR default + en scaffold).
- **Realtime:** Socket.IO (namespaced: `/game`), authenticated via JWT passed in the `auth` handshake payload.
- **Infra:** Docker Compose (services: `db` [postgres], `redis`, `backend`, `caddy`), Caddy as reverse proxy + automatic HTTPS. Frontend deployed separately on Vercel (not part of docker-compose).
- **CI/CD:** GitHub Actions — build/test on PR, SSH deploy to a private VPS on push to `main` (mirrors the provided `deploy-backend.yml` pattern).

### 2.1 Monorepo layout

```
nanommo/
├── apps/
│   ├── api/                     # NestJS backend
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   ├── account/
│   │   │   │   ├── character/
│   │   │   │   ├── battle/      # battle engine (pure functions, framework-agnostic core)
│   │   │   │   ├── gambit/
│   │   │   │   ├── inventory/
│   │   │   │   ├── equipment/
│   │   │   │   ├── map/
│   │   │   │   ├── town/        # vendor, warehouse
│   │   │   │   ├── chat/
│   │   │   │   ├── market/
│   │   │   │   ├── mail/
│   │   │   │   └── gateway/     # Socket.IO gateway, thin — delegates to modules
│   │   │   ├── data/            # static JSON: monsters.json, items.json, npc_vendor.json,
│   │   │   │                    # gambit_catalog.json, skill_trees.json, char_xp_curve.json,
│   │   │   │                    # weapon_xp_curve.json — loaded & schema-validated at boot
│   │   │   ├── migrations/
│   │   │   └── main.ts
│   │   └── test/
│   └── web/                     # Angular frontend
│       └── src/app/
│           ├── core/            # auth guard, http interceptor, socket service
│           ├── state/           # signal-based stores (character, inventory, battle, chat, market)
│           ├── features/
│           │   ├── auth/
│           │   ├── character-sheet/
│           │   ├── gambit-editor/
│           │   ├── grind/       # map view + battle bar
│           │   ├── town/
│           │   ├── market/
│           │   ├── mail/
│           │   └── chat/
│           └── shared/          # UI kit, pipes, i18n
├── packages/
│   └── shared/                  # @nanommo/shared — published to nothing, just tsconfig path-mapped
│       ├── src/
│       │   ├── dto/             # request/response DTOs used by both apps
│       │   ├── enums/           # Attribute, DamageType, Slot, GambitConditionId, etc.
│       │   ├── types/           # BattleResult, GambitLine, ItemDefinition, MonsterDefinition...
│       │   └── battle-engine/   # the deterministic battle simulator — pure TS, zero deps,
│       │                        # imported by apps/api AND (optionally) apps/web for prediction/preview
├── docker-compose.yml
├── docker-compose.prod.yml
├── .github/workflows/
│   └── deploy-backend.yml
└── package.json                 # pnpm workspaces
```

**Why `battle-engine` lives in `packages/shared`:** it must be 100% pure (no DB, no Nest DI, no I/O) so it is trivially unit-testable with snapshot tests and so the frontend *could* run the exact same code for a local dry-run preview in the gambit editor in a future iteration, without duplicating logic. The backend module `battle/` is a thin wrapper that feeds this pure engine real character/monster data and persists results.

---

## 3. Core Design Principles (read this before implementing anything)

### 3.1 Determinism

A battle is a pure function:

```
simulateBattle(characterSnapshot, monsterDefinition, gambitPage, seed) -> BattleResult
```

Given the same four inputs, it **always** produces the same `BattleResult`, byte for byte. This is what
makes prediction (§7.4), crash recovery (§7.5), and snapshot testing (§19) possible. The only source of
randomness in the entire battle system is a seeded PRNG (`mulberry32`, see §11.2) — `Math.random()` must
never be called anywhere inside `packages/shared/battle-engine`.

### 3.2 Server authority

The client never decides an outcome. It:
- Sends **intents** (equip item, activate gambit page, select map, eat food) via REST or socket events.
- Receives **facts** (battle results, resolved timestamps, inventory diffs) and renders them.
- Animates progress bars from `startAt`/`endAt` timestamps it was given — it does not simulate anything itself for MVP (the shared battle-engine package exists for future client-side preview, not required at launch).

### 3.3 Seemless idle via the Battle Queue

See §7.4 for full detail. In short: the server keeps a rolling queue of the **next 5 battles**
already fully simulated and stored, so the client can animate for minutes without a round-trip, and the
server only needs to "resolve" (apply effects) one battle at a time via a scheduled job.

### 3.4 What "recalculation" means

The battle queue is invalidated and rebuilt from scratch whenever, and only whenever:
- The player changes their **active gambit page** (or edits the currently active one) — only allowed while not mid-battle (see §8.5).
- The player changes **equipment**.
- The player consumes a **food** item manually from the inventory UI (as opposed to via gambit) or otherwise changes buffs outside of the auto-battle loop.
- The player switches **map**.
- The player **levels up** mid-queue in a way that changes stats (handled automatically by the resolver, not player-triggered, but still forces a requeue — see §7.6).

Anything else (a battle resolving normally, a potion being consumed by the gambit as predicted) does **not** trigger recalculation — it was already accounted for in the original simulation.

After a successful HTTP equipment or consumable mutation, the frontend MUST apply the authoritative Character/Inventory/Equipment state returned by that mutation immediately. Attributes and Stats MUST NOT wait for a follow-up Character poll to reflect the new state. The client never recomputes gameplay formulas; it only presents the authoritative response.

---

## 4. Data Model (TypeORM entities)

Below is the authoritative schema. Field names are the actual TypeORM property names to use. `jsonb` columns are Postgres JSONB. All IDs are UUID v4 unless noted. Implement as TypeORM entity classes with decorators; this section defines contract, not literal decorator syntax.

### 4.1 `User`
| field | type | notes |
|---|---|---|
| id | uuid, PK | |
| username | varchar(16), unique, **case-sensitive** | also the character name (1 char/account) |
| email | varchar, unique | |
| passwordHash | varchar | argon2id |
| cpfHash | varchar(64), unique | `HMAC-SHA256(cpf, PEPPER)`, hex. Raw CPF is **never stored**. |
| emailVerified | boolean, default false | |
| emailVerificationToken | varchar, nullable | |
| passwordResetToken | varchar, nullable | |
| passwordResetExpiresAt | timestamptz, nullable | |
| activeSessionId | varchar, nullable | single active session enforcement, see §15.5 |
| isMuted | boolean, default false | |
| muteExpiresAt | timestamptz, nullable | |
| createdAt / updatedAt | timestamptz | |

### 4.2 `Character`
| field | type | notes |
|---|---|---|
| id | uuid, PK | |
| userId | uuid, FK → User, unique | 1:1 |
| name | varchar(16) | denormalized copy of `User.username` |
| level | int, default 1 | 1–99 |
| xp | bigint, default 0 | current XP toward next level |
| unspentAttributePoints | int, default 0 | |
| str / agi / dex / vit / int / sor | int, default 5 each | base 5 |
| gold | bigint (numeric(15,0)), default 0 | cap 1,000,000,000,000 |
| hpCurrent | int | persisted so grind can resume mid-HP |
| spCurrent | int | |
| currentMapId | varchar, nullable | null = in town |
| status | enum('town','grinding','dead_pending_return') | |
| activeGambitPageId | uuid, FK → GambitPage, nullable | |
| lastDeathLog | jsonb, nullable | see §7.7, overwritten each death |
| activeFoodBuff | jsonb, nullable | `{ itemId, hpRegenPerTenTicks, spRegenPerTenTicks, expiresAt }` |
| activeTempBuffs | jsonb, default [] | array of `{ source, stat, mult|flat, expiresAt|expiresAtTick }` from skills like Bloodlust |
| statusEffects | jsonb, default [] | array of `{ type, appliedAtTick, expiresAtTick, sourceSkillId }` |
| lastSeenAt | timestamptz | for online/offline + presence |
| regenAnchorAt | timestamptz, nullable | stable origin for the character's continuous 10-tick regeneration timeline |
| createdAt / updatedAt | timestamptz | |

Character creation bootstrap (one time only): equip `equip_sword_t1` and seed the starter pack with 50 `pot_hp_small` and 5 `food_bread`. A character with no active food buff is **Hungry** and cannot enter or continue grind until food is consumed. New characters start with current HP/SP equal to their authoritative maximums.

### 4.3 `WeaponProficiency`
| field | type | notes |
|---|---|---|
| id | uuid, PK | |
| characterId | uuid, FK | |
| weaponType | enum(sword, greatsword, dagger, bow, staff, wand, shield) | |
| level | int, default 1 | 1–50 |
| xp | bigint, default 0 | |

Unique index on `(characterId, weaponType)`. One row per weapon type is created lazily on first equip (or all 7 seeded at character creation — recommended, simpler).

### 4.4 `InventoryItem` (also reused, with a `location` discriminator, for Warehouse)
| field | type | notes |
|---|---|---|
| id | uuid, PK | |
| characterId | uuid, FK | |
| location | enum('inventory','warehouse') | inventory = 50 slots, warehouse = 10 slots |
| slotIndex | int | position, enforced unique per `(characterId, location, slotIndex)` |
| itemId | varchar | references static `items.json` id |
| quantity | int, default 1 | stackables up to 50; equipment always 1 |
| instanceData | jsonb, nullable | for equipment: `{ rolledAttribute, rolledValue }` (see §10.3). Null for stackables. |

### 4.5 `EquippedItem`
| field | type | notes |
|---|---|---|
| id | uuid, PK | |
| characterId | uuid, FK, unique with `slot` | |
| slot | enum(head, body, mainHand, offHand, shoes, cape, accessoryLeft, accessoryRight) | |
| itemId | varchar | |
| instanceData | jsonb, nullable | `{ rolledAttribute, rolledValue }` or elemental immunity for shoes (static, no roll) |

Catalog equipment with `slot: accessory` is compatible with either persisted `accessoryLeft` or `accessoryRight`; the persisted EquippedItem always stores the explicit left/right slot.

### 4.6 `GambitPage`
| field | type | notes |
|---|---|---|
| id | uuid, PK | |
| characterId | uuid, FK | |
| slotIndex | int(0-2) | exactly 3 rows per character, seeded empty at creation |
| title | varchar(30), nullable | |
| lines | jsonb | array (max 20) of `GambitLine`, see §8.2 for exact shape |

### 4.7 `BattleQueueEntry`
| field | type | notes |
|---|---|---|
| id | uuid, PK | |
| characterId | uuid, FK | |
| sequenceIndex | int | 0..4, position within the rolling 5-deep queue |
| mapId | varchar | |
| monsterId | varchar | |
| startAt | timestamptz | |
| endAt | timestamptz | |
| outcome | enum('win','loss') | |
| log | jsonb | full deterministic tick log, see §7.7 |
| xpGain | bigint | |
| goldGain | int | |
| drops | jsonb | array of `{ itemId, quantity }` resolved at simulation time |
| hpAfter / spAfter | int | character HP/SP at the end of this battle, carried into the next |
| resolved | boolean, default false | flips true once the resolver job has applied its effects |
| seedUsed | varchar | the exact PRNG seed string used, for debugging/replay |

Indexed on `(characterId, sequenceIndex)`. Only unresolved future entries live here. On resolve the row is **marked resolved, not deleted**: the row stays as the audit trail of what was fought, and "unresolved entries" means `resolved = false` (the field above) — every read path filters on it, including `GET /battles/queue` and the §7.5 recovery pass. The only rows ever **deleted** are the ones that never happened: the rest of the chain after a death (§7.6) and the chain invalidated by a level-up (§6.3/§3.4). The last-death log is copied into `Character.lastDeathLog` separately, so nothing is lost by keeping resolved rows.

### 4.8 `MapKillCounter`
| field | type | notes |
|---|---|---|
| id | uuid, PK | |
| characterId | uuid, FK | |
| mapId | varchar | |
| epoch | int, default 0 | increments every 10,000 kills on this map, see §11.2 |
| mapKillCount | int, default 0 | resets to 0 when epoch increments |
| perMonsterKillCount | jsonb, default {} | `{ [monsterId]: number }`, also resets per epoch |

Unique on `(characterId, mapId)`.

### 4.9 `MarketOrder`
| field | type | notes |
|---|---|---|
| id | uuid, PK | |
| characterId | uuid, FK | owner |
| type | enum('sell','buy') | |
| itemId | varchar | |
| itemInstanceData | jsonb, nullable | present for a **sell** order of a unique equipment piece; **buy orders never carry this** (see §13.4) |
| quantity | int | equipment orders always quantity = 1 |
| pricePerUnit | int | gold, before the 5% buyer fee |
| escrowedItemQuantity | int, nullable | for sell orders, mirrors `quantity` while in escrow |
| escrowedGold | bigint, nullable | for buy orders: `quantity * pricePerUnit * 1.05`, refundable |
| status | enum('active','fulfilled','cancelled','expired') | |
| createdAt | timestamptz | |
| expiresAt | timestamptz | `createdAt + 7 days` |

### 4.10 `MarketDeal` (history, last 15 shown per player per §47)
| field | type | notes |
|---|---|---|
| id | uuid, PK | |
| buyerCharacterId | uuid, FK | |
| sellerCharacterId | uuid, FK | |
| itemId | varchar | |
| itemInstanceData | jsonb, nullable | |
| quantity | int | |
| pricePerUnit | int | |
| feeCollected | bigint | 5% of `quantity*pricePerUnit`, paid by buyer |
| dealAt | timestamptz | |

### 4.11 `MailMessage`
| field | type | notes |
|---|---|---|
| id | uuid, PK | |
| recipientCharacterId | uuid, FK | |
| itemId | varchar, nullable | null for pure-gold mails (not used in MVP, but future-proof) |
| itemInstanceData | jsonb, nullable | |
| quantity | int, nullable | |
| subject | varchar | e.g. "Market sale delivery", "Order cancelled" |
| createdAt | timestamptz | |
| expiresAt | timestamptz | `createdAt + 30 days` |
| collected | boolean, default false | |

### 4.12 `ChatMessage` (not persisted long-term — see §12.3 — but modeled for the report pipeline)
Chat is fire-and-forget over the socket, **not stored in Postgres** (no history on join, per spec §41). Only `ChatReport` rows are persisted.

### 4.13 `ChatReport`
| field | type | notes |
|---|---|---|
| id | uuid, PK | |
| reporterUserId | uuid, FK | |
| reportedUserId | uuid, FK | |
| messageSnapshot | varchar(200) | the reported text, for moderation review |
| createdAt | timestamptz | |

A simple threshold job (e.g., 5 distinct reporters within 24h) auto-applies `User.isMuted = true` + `muteExpiresAt` (`TUNABLE`, default 24h global mute). Document this as a scheduled/triggered check in `chat` module; manual admin override is out of scope for MVP (no admin panel).

---

## 5. Attributes, Stats & Formulas

No classes. Every level-up grants **5 unspent attribute points** (`TUNABLE`), freely assignable to any of the 6 attributes. Base value at character creation is **5 in each attribute**.

These formulas were designed after the shape of Ragnarok Online (soft-cap DEF formula, ASPD-as-diminishing-returns), Priston Wars (elemental % resistance instead of flat magic defense), and MU Online (simple additive ATK from a primary stat + gear). They are original values tuned for this game, not copied numbers.

### 5.1 Attribute → Stat mapping

| Attribute | Feeds |
|---|---|
| STR (Força) | Physical ATK |
| AGI (Agilidade) | Attack Speed (ticks to fill the **basic Attack** action gauge), Evasion |
| DEX (Destreza) | Accuracy, Cast Speed (ticks to fill the **Skill** action gauge) |
| VIT (Vitalidade) | Max HP, HP regen |
| INT (Inteligência) | Max SP, SP regen, Magic ATK |
| SOR (Sorte) | Crit Chance |

### 5.2 Derived stat formulas

The six attributes are always present at character creation with value 5. Each point contributes to one or more derived stats through the following NanoMMO formulas. The design is inspired by Ragnarok Online relationships, but the numeric values are original to NanoMMO.

attack = floor(STR * 2) + weaponAttack
magicAttack = floor(INT * 2) + weaponMagicAttack
defense = equipmentDefense
maxHp = 50 + floor(VIT * 18) + equipmentMaxHp
maxSp = 20 + floor(INT * 8) + equipmentMaxSp
attackSpeed = 100 + floor(AGI * 2)
castSpeed = 100 + floor(DEX * 2)
evasion = floor(AGI * 1.5)
accuracy = 50 + floor(DEX * 2)
hpRegenPerTenTicks = 1 + floor(VIT / 2)
spRegenPerTenTicks = 1 + floor(INT / 2)
critChance% = floor(SOR * 0.3 * 10) / 10

Attack Speed and Cast Speed are displayed as ratings where higher is faster. The battle engine converts them into the existing weapon/skill gauge thresholds. Regeneration is recovered once every 10 ticks because one tick is one second.

At level 1 with all six attributes at 5 and the starter sword's +8 ATK:

ATK 18 | MATK 10 | DEF 0 | Max HP 140 | Max SP 60
Attack Speed 110 | Cast Speed 110
Evasion 7 | Accuracy 60
HP Regen 3 / 10 ticks | SP Regen 3 / 10 ticks
Critical 2.5%

Equipment stat bonuses are added to the corresponding attributes before these formulas. Flat equipment Max HP/Max SP and weapon ATK are added directly.

**Physical damage mitigation (soft cap, avoids DEF ever reaching 100% reduction):**
```
finalPhysicalDamage = rawDamage * (1 - def / (def + 300))
```
At `def=300` this is 50% mitigation; it asymptotically approaches but never reaches 100%. This mirrors Ragnarok Online's well-tested soft-DEF curve and prevents "unkillable tank" edge cases while still making DEF gear feel meaningful at every tier.

**Magic damage mitigation (flat %, per spec §11 of the confirmed answers — MDEF is a percentage from gear only):**
```
finalMagicDamage = rawDamage * (1 - mdefPercent/100)
```
`mdefPercent = 100` means true magic immunity. This is intentionally simpler/harsher than physical mitigation (no soft cap) because MDEF gear is rarer by design (see §10 equipment catalog — only "Arcane" variant armor pieces roll it).

**Hit / evasion resolution:**
```
hitChance% = clamp(75 + (accuracy - evasion) * 0.5, 5, 95)
```
Rolled once per action at resolution time using the seeded PRNG (§11.2) — deterministic given the seed, not "live" randomness.

**Critical hits:**
```
isCrit = roll() < critChance%
damage = isCrit ? damage * critMultiplier : damage
```

### 5.3 Weapon type combat identity

| Weapon | Slot(s) | Damage type | Base Attack gauge (ticks) | Notes |
|---|---|---|---|---|
| Sword | mainHand (1H) | melee | 6 | balanced; pairs with Shield or a second Sword/Dagger |
| Greatsword | mainHand+offHand (2H) | melee | 10 | heaviest hit, slowest |
| Dagger | mainHand (1H) | melee | 4 | fastest melee; pairs with Shield, Sword, or a second Dagger |
| Bow | mainHand+offHand (2H) | ranged physical | 7 | |
| Staff | mainHand+offHand (2H) | ranged magic | 9 | highest MATK scaling |
| Wand | mainHand+offHand (2H) | ranged magic + healing | 7 | only weapon with heal skills |
| Shield | offHand only | — (utility) | n/a (no basic attack) | pairs with Sword or Dagger only |

Valid main/off-hand combinations: `Sword+Shield`, `Sword+Sword`, `Sword+Dagger`, `Dagger+Shield`, `Dagger+Dagger`, or any of `Greatsword`/`Bow`/`Staff`/`Wand` alone (occupies both hand slots, `offHand` slot is locked/hidden in UI while equipped). Server validates this combination on every equip request — reject with a clear error code if illegal.

The **basic Attack** gambit action always uses the mainHand weapon's damage type and base gauge tick value, modified by AGI (see §7.2). **Skills** always use the **DEX-based cast gauge** regardless of weapon (see §7.2), and are only usable while their required `weaponType` is equipped in mainHand (or offHand for Shield skills).

---

## 6. Progression: Character XP & Weapon Proficiency

### 6.1 Design intent

Reaching character level 60 should take roughly **1 month of continuous idle grinding** (excluding time spent in town), and the **single step from level 59 to 60 alone** should account for roughly **half of that month** — i.e. the curve is dominated by its own tail, early levels fly by, the last stretch dominates. Beyond level 60 (cap 99), growth becomes deliberately near-impossible, framing 99 as an aspirational horizon rather than a realistic target. Weapon proficiency (separate resource, cap 50) should feel fast at first (level 10 in about a day) and become a true long-term commitment (level 50 in about a year).

Both curves below were derived, not guessed: a small simulation (`packages/shared` should ship the generator script as `scripts/generate-xp-curves.ts` for future rebalancing) assumed **~20 effective idle-hours/day**, an **average battle length of 15s**, and an average XP-per-kill of `18 * monsterLevel^1.15` (this constant also drives `xpReward` in `monsters.json` — the two are the same formula, keep them in sync). Solving for these targets yields a clean **geometric doubling curve** up to level 60, then a steeper geometric tail to 99.

### 6.2 Character XP formula

```
xpToNextLevel(L) =
  if L <= 60:  round(C1 * 2^(L-1))
  if L  > 60:  round(xpToNextLevel(60) * 1.35^(L-60))

C1 = 2.4433638740432053e-10   // derived constant, TUNABLE only via full curve regeneration
```

Do not hand-edit individual level values — if rebalancing is needed, adjust `C1` and/or the two exponents (`2.0` early ratio, `1.35` late ratio) and regenerate the full table. The current Grind reward resolver additionally applies a **0.25 global XP pacing multiplier** to monster payouts; the canonical monster `xpReward` values remain the curve source data. The complete precomputed table (all 98 rows: `level, xpToNext, cumulativeXp, estHoursAtThisLevel, estDaysAtThisLevel`) ships as `char_xp_curve.json` (§21) — **load this at boot and use it directly**; do not recompute the formula at runtime, just index into the table by level for O(1) lookups.

Sanity checkpoints from the generated table (assumptions above): level 60 reached at ~600 idle-hours (~30 days); level 59→60 alone takes ~294 idle-hours (~14.7 days, essentially half the total climb to 60); level 90 is ~205 years; level 99 is deliberately beyond any realistic playtime. This matches the intent: fast early game, brutal late game, 99 as a horizon.

### 6.3 Level-up effects
- `unspentAttributePoints += 5`
- `maxHp`/`maxSp` recompute immediately (derived, not stored deltas)
- `hpCurrent`/`spCurrent` are **not** auto-topped — a level-up mid-grind keeps current HP/SP ratio-adjusted: `hpCurrent = round(hpCurrent * newMaxHp/oldMaxHp)` (prevents a level-up from either healing for free or leaving HP nonsensically low relative to the new max).
- Triggers a **battle queue recalculation** (§3.4) since stats changed.

The ratio is taken between two `maxHp`/`maxSp` values, so **both ends must be derived from the same state the battles were simulated against** — the character's attributes *including* equipment `statBonus` (§5.2), with the character's real `def`/`mdefPercent`/weapon ATK as the third argument of `calculateDerivedStats`. Deriving the ratio from bare attributes instead scales an equipped character by the wrong factor (a level-1 character in tier-1 armour, VIT 5 → 26, would be scaled by 176/158 = 1.114 instead of 428/410 = 1.044, and the result would then be clamped against the wrong maximum). Implemented in `battle.service.ts:453-484`; verified by the equipped-character level-up scenario in `apps/api/test-phase3-levelup.js`.

A single XP resolution SHALL consume every XP threshold crossed by the awarded XP, allowing multiple level gains when enough XP is awarded. Each crossed threshold is consumed in order and excess XP remains stored toward the next level. The reduced Grind XP rate is the pacing control. This is enforced server-side in the authoritative resolver.

### 6.4 XP loss on death

On loss, before returning to town: `xp = max(0, xp - floor(xpToNextLevel(currentLevel) * 0.05))` — i.e. **5% of the XP required for the current level** is lost, truncated to a whole number of XP and never dropping XP below 0.

Two things this deliberately does *not* do, both settled as of 2026-09-28 (previously listed as divergence #1 in `design.md`; the code was kept and this section was brought in line with it):

- **No `cumulativeXp` floor.** An earlier draft of this section clamped at `cumulativeXp[currentLevel-1]`. That clamp is undefined under the toward-next-level model §4.2 actually uses: `characters.xp` holds XP *toward the next level*, not a cumulative total, so there is no "previous level's threshold" to clamp at. The clamp at **0** is what actually prevents a de-level — a character who would lose more XP than they hold keeps their level and lands on exactly 0, never below.
- **No rounding up.** `floor`, not `round`: at level 10 that is 1 XP where `round` would give 2.

Implemented as written in `battle.service.ts:545-546`; verified by `apps/api/test-phase3-death.js` (level 10 → `floor(30 × 0.05) = 1`; level 20 seeded at 1 XP with `floor(73 × 0.05) = 3` → clamped to 0, level unchanged at 20).


### 6.5 Weapon proficiency XP formula

```
weaponXpToNextLevel(L) = round(5886.4477522292345 * 1.1508260363470009^(L-1))   // L = 1..50
```

Also ships precomputed as `weapon_xp_curve.json` (§21) — load and index, do not recompute at runtime. Derived assuming ~600 weapon actions/hour (~1 action every 6s blended across weapon speeds) and 10 XP per action performed with that weapon (basic Attack **and** Skill actions both grant weapon XP; using a Skill does not grant less). Sanity checkpoints: level 10 at ~1 idle-day, level 50 at ~1 idle-year, smooth exponential in between.

**Important:** switching equipped weapon type does not lose progress — each `WeaponProficiency` row is permanent and independent. A character can raise all 7 weapon types over time, but only the currently-equipped weapon's skills are usable at any moment (§9).

---

## 7. Battle Engine

Lives in `packages/shared/src/battle-engine/`. Pure functions only — no DB, no Date.now() (all "time" is tick-indexed integers; wall-clock timestamps are attached by the caller in `apps/api` after simulation).

### 7.1 The tick

**1 tick = 1 second of in-game time.** A battle is simulated as a loop over integer ticks starting at 0, until one side's HP reaches 0. The number of ticks the loop takes **is** the battle's duration; the frontend displays a progress bar computed purely from `startAt`/`endAt` timestamps (`endAt = startAt + ticksElapsed * 1000ms`), so it never needs to know about ticks itself.

### 7.2 Action gauges

Each combatant (character and monster) has **two independent gauges**: `attackGauge` (fills toward the weapon's base Attack) and `castGauge` (fills toward Skill use). Both fill by `+1` per tick. When a gauge reaches its combatant's current threshold, that gauge "fires": the combatant evaluates its gambit **for that action type** and either performs the matching action or resets the gauge anyway (a wasted tick if nothing legal is available — see §7.3).

```
attackGaugeThreshold = weaponBaseAttackTicks - floor(AGI * 0.04)   // min 2
castGaugeThreshold   = 8 - floor(DEX * 0.05)                        // min 3, base 8 ticks TUNABLE
```

Monsters use their own fixed `atkSpeedTicks` from `monsters.json` as their `attackGaugeThreshold`, and a flat `castGaugeThreshold = 6` for their (rare) skill use.

When a gauge fires, the corresponding action is **not instant** — it has its own `baseCastTicks` (how long the swing/spell takes to land, defined per skill in `skill_trees.json`; the basic Attack action's `baseCastTicks` is always `2`, `TUNABLE`) during which the gauge is locked at zero and refilling again only starts once the action resolves. This is the "cast time" — see §29 of the design conversation: attack/cast speed is "how many ticks until the gauge fires", and the action's own duration is separately how long it takes to actually land once triggered.

Every action, without exception, also has a **cooldown** in ticks after it resolves (`cooldownTicks` for skills; consumable items use `cooldownInSeconds` from `items.json`, converted at runtime to 1-second ticks). The basic Attack's cooldown is `0` beyond its gauge refill. Consumable cooldowns are item-defined; do not hardcode a universal potion cooldown. Outside battle, manual consumable use has no cooldown. During battle, the item's configured cooldown applies.

### 7.3 Gambit evaluation per tick

On every tick where a combatant's `attackGauge` or `castGauge` fires:
1. Walk the active gambit page's lines top to bottom, filtered to only lines whose action type matches the gauge that fired (an Attack-gauge fire can only trigger `attack`; a Cast-gauge fire can trigger `use_skill`, `use_item`, `defend`, or `wait`).
2. For each line, evaluate its condition(s) (1 or 2, combined with AND/OR per §8).
3. If the condition is true, check whether the **action is currently legal**: skill unlocked for the equipped weapon AND off cooldown AND enough SP; item present in inventory (`quantity > 0`) AND its cooldown category is free; etc.
4. First line that is both **condition-true** and **legal** executes and ends evaluation for that gauge-fire. A line that is condition-true but illegal is skipped entirely (does not block evaluation, per the confirmed rule) — the next line is checked as if the illegal one didn't exist.
5. If no line qualifies, the combatant does nothing this gauge-fire (gauge still resets and starts refilling toward the next fire).

Monsters follow the exact same engine using their own (much shorter, max 2-line) `gambit` array from `monsters.json`.

### 7.4 The Battle Queue — seemless idle

To satisfy "minimum requests, seemless experience" (confirmed design), the server never simulates one battle at a time reactively. Instead:

1. When a character enters a map (or the queue empties), the backend simulates **the next 5 battles in one shot**, chained: battle 2 starts from battle 1's `hpAfter`/`spAfter`/statuses/cooldown states, and so on. Each is written as a `BattleQueueEntry` with real wall-clock `startAt`/`endAt`. Every encounter also has an authoritative search gap before `startAt`: 2 seconds + 0.1 seconds per other character grinding on the same map.
2. The full queue (5 entries, or fewer if a death cuts the chain short — see below) is sent to the client in one payload. The client renders the current battle's bar from `startAt`/`endAt` and has enough data to *know* what's coming next without asking.
3. A **BullMQ delayed job** is scheduled for each entry's `endAt`. When it fires, the backend "resolves" that entry: applies `xpGain`, `goldGain`, inventory drops, HP/SP, death log if applicable, checks level-up, and publishes an authoritative `battle:resolved` snapshot containing the completed Character + Inventory state and its `stateRevision`. After the queue is advanced/rebuilt, the subsequent `battle:queueUpdated` also carries that same snapshot and revision so Redis channel ordering cannot expose a stale search-state snapshot. The resolved entry is then **marked `resolved = true` and kept** (§4.7 — it is the audit trail, and it disappears from every live read path the moment `resolved` flips), and if remaining queue depth `< 5` and the character is still alive and still on the map, **one new battle is appended** to bring it back to 5.
4. **If a battle in the pre-simulated chain ends in the character's death**, everything simulated *after* that point in the chain is simply never generated (the chain naturally stops there) — on resolve, the character is routed to town per §7.6, and no new battles are queued until the player returns to a map.

This means, under ideal "automaticozão" conditions (good gambit, enough potions/food), the client can go minutes without a single request, and the server does a small burst of CPU work only every ~5 battles instead of on every single kill. Auto Feed is evaluated at authoritative digestion/grind boundaries: when the active food would expire before the next encounter can safely begin, the server consumes an eligible Diet food before allowing Hungry to terminate the grind; the future queue is then rebuilt from the new Character + Inventory state.

### 7.5 Crash / restart recovery

`BattleQueueEntry` rows are the source of truth, not the BullMQ job state. On backend boot, for every character with unresolved `BattleQueueEntry` rows whose `endAt < now()`, resolve them **synchronously in order** (oldest first) exactly as the scheduled job would have — applying effects, deaths, drops, and level-ups — before accepting new socket connections for that character. Then re-derive the live queue depth and top it back up to 5 if the character is still alive and still on a map. This guarantees zero data loss and zero "free time" exploits from server downtime.

### 7.6 Death handling

On the `BattleQueueEntry` whose `outcome = 'loss'`:
- `Character.status = 'town'`, `Character.currentMapId = null`
- `Character.hpCurrent = 1` (never 0, avoids edge cases elsewhere — `TUNABLE`, could be `round(maxHp*0.01)`)
- XP loss per §6.4 applied
- `Character.lastDeathLog` is **overwritten** with this battle's full log (§7.7) — only the single most recent death is ever kept, per spec
- Any remaining not-yet-resolved queue entries after this one are deleted (they were never valid — they assumed the character survived)
- Leaving the map — by death or by walking back to Town — rolls that map's `MapKillCounter` `epoch` forward and resets `mapKillCount`/`perMonsterKillCount` (§11.2), so every re-entry draws a **fresh** encounter sequence instead of replaying the run that just ended. A loss never advances `mapKillCount`, so without this a character that keeps dying on the same map would be handed the same stream from the same index — the killer included — on every single re-entry.
- Frontend is notified via `characterDied` socket event so it can route the player to the Town view and surface the "last death" button/modal

### 7.7 Battle log format

Stored in `BattleQueueEntry.log` (and copied verbatim into `Character.lastDeathLog` on a loss). Shape:

```jsonc
{
  "header": {
    "mapId": "map_menace",
    "monsterId": "mon_venomviper",
    "seedUsed": "a1b2c3...",
    "characterSnapshot": { "level": 12, "hp": 940, "sp": 210, "atk": 88, "def": 40, /* ...full computed stats at battle start */ },
    "monsterSnapshot": { "hp": 860, "atk": 95, /* ... */ }
  },
  "events": [
    { "tick": 0, "actor": "character", "action": "attack", "target": "monster", "damage": 62, "damageType": "melee", "crit": false, "hpRemaining": { "character": 940, "monster": 798 } },
    { "tick": 4, "actor": "monster", "action": "use_skill", "skillId": "monster_skill_self_heal", "target": "monster", "healAmount": 215, "hpRemaining": { "character": 940, "monster": 1013 } },
    { "tick": 6, "actor": "character", "action": "use_item", "itemId": "pot_hp_medium", "target": "character", "healAmount": 180, "hpRemaining": { "character": 1120, "monster": 1013 } }
  ],
  "outcome": "loss",
  "durationTicks": 47
}
```

The frontend's "last death" modal renders: how the battle started (map, monster, starting stats), a scrollable event feed (damage sources highlighted), and the final blow.

### 7.8 Balance note: under-leveling on purpose

Because the XP curve (§6) is intentionally punishing, a well-built gambit should let a character farm monsters **1–2 levels above the map's "comfortable" band** for faster XP/hour, at higher risk. Concretely: a level-3 character with a solid gambit (potion-on-low-HP, food-on-hungry, correct weapon matchup per §11.3 favored archetype) should be able to sustainably farm level 5–6 monsters in Green Grounds. This is achieved naturally by the formulas above (soft-cap physical mitigation means a slight level disadvantage isn't a hard wall) and should be validated in balance testing (§19.3) — if a level-3 character with the example gambit page (`gambit_catalog.json → exampleGambitPage`) reliably loses to a level-6 Dire Wolf Alpha, DEF/HP constants need adjustment, not the design intent.

---

## 8. Gambit System

Modeled directly on Final Fantasy XII's Gambit system, adapted for a single controlled character (no party). Full curated condition/action catalog ships as `gambit_catalog.json` (§21) — **the server is the only source of truth for what conditions/actions exist**; the frontend renders whatever that file contains, it does not hardcode the list.

### 8.1 Structure

- Each character has exactly **3 `GambitPage` rows**, seeded at character creation.
- Exactly **one page is active** at a time (`Character.activeGambitPageId`); the first page is active by default.
- The starter page contains the confirmed default behavior: `self_hp_below_percent` at `< 30%` → use `pot_hp_small`, followed by `always` → attack nearest foe.
- Each page has an optional `title` (≤30 chars) and up to **20 lines**.
- Switching the active page is only allowed while the character is not in the middle of a battle. Reject while an unresolved `BattleQueueEntry` is currently in flight; allow the change between battles and rebuild the future queue.

### 8.2 Gambit line shape (stored in `GambitPage.lines`)

```ts
type GambitLine = {
  priority: number;                 // 1-20, execution order
  conditions: GambitCondition[];    // length 1 or 2
  combinator: 'AND' | 'OR' | null;  // null if only 1 condition
  action: GambitAction;
}
type GambitCondition = { id: string; params?: Record<string, string|number> } // id from gambit_catalog.json "conditions"
type GambitAction    = { id: string; params?: Record<string, string|number> } // id from gambit_catalog.json "actions"
```

### 8.3 Conditions & actions catalog (summary — full list with params in `gambit_catalog.json`)

**Conditions** (full catalog is authoritative): `always`, `self_hp_below_percent`, `self_sp_below_percent`, `self_hp_band`, `self_sp_band`, `foe_hp_band`, `self_has_status`, `self_missing_status`, `foe_has_status`, `foe_element_is`, `skill_ready`, `item_in_stock`, and other entries present in `gambit_catalog.json`.

Percentage conditions expose their threshold through `params` (for example `self_hp_below_percent` with `params.value = 30`). HP/SP bands remain available for coarse thresholds: `FULL (100%)`, `HIGH (70-99%)`, `MEDIUM (30-69%)`, `LOW (10-29%)`, `CRITICAL (1-9%)`.

**Actions:** `attack` (basic attack with equipped weapon), `use_skill` (references a `skillId` — see §9), `use_item` (references an `itemId`), `defend` (reduces next incoming hit by a flat %, `TUNABLE` 30%), `wait` (explicit no-op, useful as a page's last fallback line instead of leaving a gap).

Gambit actions are target-aware: the action's catalog params define the valid target selector where applicable (`self`, `foe`, or another legal target). The frontend must expose those params rather than hiding them, and the engine must execute the selected target deterministically. Things like "ticks elapsed", "cooldown ready", "mana sufficient", "potions in stock" are not player-facing conditions — they are legality checks the engine performs automatically.

### 8.4 Validation (server-side, mandatory — client is not trusted)

On every `GambitPage` write:
- `lines.length <= 20`
- each line's `conditions.length` is 1 or 2; `combinator` is `null` iff length is 1
- every `condition.id` and `action.id` exist in `gambit_catalog.json`
- every `condition.params`/`action.params` match the expected shape/enum from the catalog entry (e.g. `band` must be one of the 5 valid values)
- `use_skill` actions reference a real `skillId` from `skill_trees.json` (existence only — legality re: weapon-equipped is a runtime concern, not a save-time rejection, since the player might configure a page for a weapon they plan to equip later)
- `use_item` actions reference a real `itemId` from `items.json`

Reject the whole write with a 400 + field-level errors if any line fails validation — never silently drop invalid lines.

### 8.5 Frontend requirements (greying out)

Any gambit line whose action currently cannot fire (skill not unlocked at current weapon proficiency level, skill's weapon not equipped, referenced item has 0 quantity in inventory) renders visually greyed out in the editor, with a hover tooltip explaining precisely why (e.g. *"Requires Bow equipped"*, *"Requires Bow proficiency level 20 (currently 14)"*, *"0x Small HP Potion in inventory"*). This is purely a UI affordance — the line is still saved and will simply be skipped by the engine at runtime per §7.3 until the condition changes, exactly as it would in live play. See §17.5 for the editor's full UX spec.

---

## 9. Weapons & Skill Trees

Full data in `skill_trees.json` (§21) — 7 weapon types × 7 skills each (unlocked at weapon proficiency levels **1, 5, 10, 20, 30, 40, 50**), plus 3 monster-only skills.

### 9.1 Rules

- A skill is **usable** only if: (a) its `weaponType` is currently equipped in the relevant slot (mainHand for all types except Shield, which checks offHand), **and** (b) `WeaponProficiency.level >= skill.unlockWeaponLevel` for that weapon type on this character.
- Skills are **never** purchased, dropped, or learned individually — unlocking is 100% automatic and tied to proficiency level. This keeps the system simple and removes an entire economy surface (no "skill book" items needed).
- Each weapon type's tree is thematically consistent (see `skill_trees.json` for exact effects): Sword and Greatsword are pure melee DPS with an execute/AoE progression; Dagger favors speed/multi-hit/bleed-poison; Bow favors precision/defense-pierce/marking; Staff is heavy elemental burst magic; **Wand is the only tree with heal/cure skills** (this is where the "Priest" archetype comes from — a character built INT/DEX wielding a Wand); Shield is a pure utility/mitigation tree usable alongside Sword or Dagger.
- `spCost` and `cooldownTicks` scale up with `unlockWeaponLevel` (see formulas in the generation script referenced by the JSON) — higher-tier skills hit harder but are used more sparingly.

### 9.2 Archetype ⇄ build mapping (for player-facing UI copy only — mechanically there are no classes)

| Informal archetype | Typical attributes | Typical weapon(s) |
|---|---|---|
| Warrior | STR, VIT | Sword/Shield, Greatsword, Dagger/Dagger |
| Archer | DEX, AGI | Bow |
| Mage | INT, DEX | Staff |
| Priest | INT, VIT | Wand |

These labels appear in monster `favoredAgainstArchetypeLabel` fields (§11.3) purely as flavor/guidance text — the engine only ever reads `damageTakenMultiplier.{melee,ranged,magic}` and the monster's `sustainPressure` flag, never a hardcoded "archetype" enum on the character.

---

## 10. Items, Equipment & Inventory

Full catalog in `items.json` (§21): 30 monster parts, 15 consumables, 51 equipment pieces.

### 10.1 Inventory & Warehouse

- Inventory: **50 slots**. Stackable items (consumables, monster parts) stack to **20 per slot**; equipment never stacks (1 per slot).
- Warehouse (town only): **10 slots**, same stacking rules. Moving an item between inventory ⇄ warehouse is instant and free, blocked only if the destination has no room (no partial-stack splitting required for MVP — moving a full stack moves the whole stack; if the target stack has room, merge instead of consuming a new slot).
- Gold cap: **1,000,000,000,000** (`numeric(15,0)` column, application-level clamp).

### 10.2 Equipment slots

`head, body, mainHand, offHand, shoes, cape, accessoryLeft, accessoryRight`. Weapon/offHand legality is enforced per §5.3.

### 10.3 Equipment stat rolls

Every equipment item **template** in `items.json` defines:
- `fixedStats` — permanent, identical on every drop of that template (e.g. all "Reinforced Chestplate" always give `def: 18, statBonus: {VIT: 2, STR: 1}`). This is what makes a template a Tank piece vs. a Mage piece.
- `randomRollOnDrop` — for all slots **except shoes**: at the moment of drop, roll **one** random attribute from `[STR, AGI, DEX, VIT, INT, SOR]` and a random integer **1–6** bonus to it. This roll is generated once, server-side, using the deterministic per-character PRNG stream (§11.2, same mechanism as monster/drop selection — not a separate `Math.random()`), and stored permanently in `InventoryItem.instanceData` / `EquippedItem.instanceData` as `{ rolledAttribute, rolledValue }`. It never changes again — "eternal" as specified.
- Shoes (`equip_shoes_*`) never roll — their single fixed effect is `elementalImmunity: <element>` (full immunity to that element's status/bonus-damage interactions, per confirmed design; no move-speed effect in MVP).

Equipment tooltips show the actual stats granted by the item instance (fixed stats plus its rolled Attribute, when present). Roll-generation metadata, vendor/economic fields and stack metadata are not presented as granted stats.

### 10.4 Item categories

- **Monster parts** (30): 2 per monster (`common`, `rare`). Sellable to the vendor (never usable as a potion), reserved for future crafting/quest hooks (fields present in schema, unused by any system in MVP — do not build crafting/quests, just don't break the schema by omitting the fields).
- **Consumables** (15): HP potions (S/M/L), SP potions (S/M/L), Antidote, Greater Elixir (rare drop, heals both pools), and 7 **foods**. All consumables share `sellPriceToVendor: 7` gold as specified. Only the 6 basic potions + Antidote are sold by the town vendor (§12.1); Elixir and all foods are drop/market only.
- **Equipment** (51): 21 weapons (7 types × 3 tiers), 24 armor (head/body/cape × physical-or-magic variant × 3 tiers), 6 accessories (2 variants × 3 tiers), 6 shoes (2 elements × 3 tiers, chosen to match each map's monster elements — see §11).

### 10.5 Foods (buffs) — detail

Foods are 60-minute (`durationSeconds: 3600`) buffs granting passive HP/SP regen per 10 ticks on top of the normal regeneration formula, with varying HP:SP ratios. Only one food buff is active at a time (`Character.activeFoodBuff`). The Diet system additionally persists three ordered food entries, permanent per-food Diet levels from 0 to 3, and digestion boundaries. A food cannot be consumed again while its previous digestion is active; after it finishes, the next successful repeat increases that food's Diet level up to 3. **Each Diet level adds a flat +1 to every regeneration statistic the food grants**: level 0 uses catalog values, level 1 uses catalog+1, level 2 uses catalog+2, and level 3 uses catalog+3 independently for HP and SP regeneration. Auto Feed is the official automatic food mechanism and consumes only food identified by the character's Diet state and present in Inventory; it is evaluated server-side at authoritative digestion/grind boundaries.

---

## 11. Maps, Encounter Queues & Drops

### 11.1 The three maps

| Map | Unlock level | Monster levels | Theme |
|---|---|---|---|
| Green Grounds | 1 | 1, 2, 3, 4, 6 | Grassy plains, first steps |
| Menace | 8 | 7, 9, 10, 12, 13 | Arid desert, raiders & sand beasts |
| Ruins | 15 | 14, 16, 17, 19, 20 | Abandoned ancient city |

Each map is **one single global room** (confirmed design — no instancing, no multiple parallel rooms per map). All players grinding the same map share the same "how many players are here" pressure on encounter search time (§11.4).

Town sits at the center; the four cardinal exits (**North/South/East/West**) lead to the three maps (one exit currently unused/reserved for future expansion — wire it in the UI as a disabled/"coming soon" direction rather than omitting it, since the world is designed to grow outward from town). A living character's regeneration timeline is continuous and authoritative: HP/SP regeneration is evaluated every 10 ticks across battle, encounter search, and non-battle Grind time, and Battle start/end never resets the interval. Town also applies the same derived regeneration rates while the character is alive, capped at max HP/SP. A Hungry character (no active food buff) cannot enter or continue grind.

### 11.2 Deterministic monster & drop selection (no giant arrays)

Rejecting the original "pre-generate an explicit array of 10,000" idea in favor of an **equivalent, storage-free** approach (confirmed as the preferred direction):

- Each `(characterId, mapId)` pair has a `MapKillCounter` row (§4.8) with an `epoch` and running kill counts.
- The "next monster to encounter" and "what it drops" are both derived **on demand**, in O(1), via a seeded PRNG function seeded by `hash(characterId + mapId + epoch)`, advanced deterministically by an index derived from the running kill count:

```
seed = mulberry32Seed(`${characterId}:${mapId}:${epoch}`)
rngForIndex(index) = mulberry32(seed, index)   // pure function: same (seed, index) always -> same stream

nextMonsterId(mapId, mapKillCount) =
  weightedPick(mapMonsterList, rngForIndex(mapKillCount))   // uniform pick across the map's 5 monsters, TUNABLE weights (default: equal weight)

nextDrops(monsterId, perMonsterKillCount[monsterId]) =
  for each drop entry in monster.drops (independent rolls, a kill CAN yield multiple items):
    if rngForIndex(`${monsterId}:${perMonsterKillCount[monsterId]}`) < drop.chance: award it
```

This is **mathematically identical** in outcome and reproducibility to a pre-generated 10,000-length array (same determinism, same "pre-calculated luck" feel, fully replayable for debugging), but costs two integers per `(character, map)` row in Postgres instead of megabytes of JSON per character. `mulberry32` (or `xoshiro128**`) must be implemented once in `packages/shared/battle-engine/prng.ts` and used **everywhere** randomness is needed in this game (drops, monster selection, hit/crit rolls, equipment attribute rolls) — never `Math.random()` anywhere in deterministic code paths.

- **Epoch rollover:** when `mapKillCount` (or a given monster's `perMonsterKillCount`) reaches **10,000**, increment `epoch` and reset the relevant counter(s) to 0. Because the seed incorporates `epoch`, this "feels" like a fresh 10,000-length sequence without ever materializing one, and — as originally intended — it happens for free, with zero precomputation lag, since nothing was ever stored to begin with. Leaving the map is the second trigger — a death and a plain walk back to Town both roll `epoch` forward and reset both counters (§7.6) — so re-entering a map never replays the encounter stream that just ended.

### 11.3 Monster archetype matchups

Each monster in `monsters.json` carries a `damageTakenMultiplier: { melee, ranged, magic }` object. A value `> 1.0` means that damage type is **effective** (easier fight for that build); `< 1.0` means **resisted** (harder). Within each map, the 5 monsters are deliberately spread across: one favors melee (Warrior), one favors ranged physical (Archer), one favors magic (Mage), one is a `sustainPressure` fight that punishes low-healing builds regardless of damage type (favors Priest/Wand builds via its self-heal or poison pressure), and one is `balanced` (no clear weakness — the odd one out, and where two of the game's three "monster with an active ability" fights live: enrage/massive-damage, self-heal, and stun, one per map, never more than one ability-monster per map).

### 11.4 Encounter search time

Every real monster encounter has a server-authoritative search phase before the battle begins:

```
searchTimeSeconds = 2 + (otherPlayersGrindingOnMap * 0.1)
```

The character being queued is excluded from `otherPlayersGrindingOnMap`. The same delay is applied before the first encounter and between every subsequent queued encounter. It is not a separate `BattleQueueEntry`; it is represented by the gap between the previous `endAt` and the next battle's `startAt`. Existing 1-second battle ticks and battle duration formulas are unchanged.

The authoritative grinder count for encounter timing is based on Character rows with `status = grinding` and the same `currentMapId`. Realtime UI presence is additionally tracked in Redis and broadcast through the `/game` Socket.IO gateway whenever map membership changes.

### 11.5 Drop rates (confirmed, apply per kill — multiple can trigger)

| Drop category | Chance per kill |
|---|---|
| Monster part (common) | 10% |
| Consumable (tier-appropriate) | 2% |
| Equipment (tier-appropriate, from that map's pool) | 0.2% |
| Monster part (rare) | 0.02% |

Consumable/equipment drops are resolved to a **specific item id** at roll time by picking uniformly (same seeded PRNG) from the appropriate pool: for consumables, any of the 15 (foods included — yes, foods can drop, not just be bought); for equipment, `items.equipment` entries whose `dropPool` includes the current `mapId`. The reviewed Grind configuration doubles the four canonical rates above while preserving their relative rarity; the resolver performs exactly one deterministic roll per drop entry. Monsters provide **no gold reward** directly.

---

## 12. Town: Vendor NPC, Warehouse, Chat

### 12.1 Vendor NPC

Full data in `npc_vendor.json` (§21). One vendor, infinite fixed stock, sells: 3 HP potions, 3 SP potions, Antidote (fixed prices in the JSON). **Buys any item** at a flat **40%** of that item's `marketBasePrice`/`sellPriceToVendor` field (already precomputed per item in `items.json`). Selling to the vendor **destroys the item immediately** — the vendor's own sell stock is completely independent and infinite; nothing a player sells is ever resold (confirmed).

### 12.1.1 NPC framework

Town NPCs are data-driven actors composed from reusable capabilities. The shared NPC contract uses `id`, `name`, `location` and one or more capability types. The supported MVP capabilities are `vendor` and `quest`; capabilities are composable on the same NPC.

A `vendor` capability owns the existing vendor inventory and BUY/SELL behavior. A `quest` capability owns a server-authoritative dialogue graph with NPC text, player choices, conditions and effects. Quest NPCs do not have an NPC inventory unless they also expose `vendor`.

Quest dialogue choices are client intents only. The backend re-evaluates character/inventory conditions and applies inventory/character effects atomically in Town. Effects may add/remove inventory items or apply a transient consumable effect immediately without persisting a temporary item.

The Town right Info Panel uses one generic NPC selector. Capability renderers are stacked in deterministic order: vendor/inventory first, quest/dialogue below it. This allows a future NPC to expose multiple capabilities without creating another UI or service architecture.

### 12.1.2 Father Marcelus

`father_marcelus` is a quest NPC. Opening dialogue: "May the light be with us, friend. How are you, fellow adventurer?" Speaking to Marcelus in Town always restores the character to the authoritative maximum HP and SP before the dialogue is returned.

Hungry branch: "I'm hungry..." → "Eat and rest, for the love of god is forever, but you are not." The second choice consumes food immediately. If the character is hungry and has no food item in inventory, the server grants Bread only transiently and consumes it in the same transaction, so Bread never remains in inventory.

Not-hungry branch: "I'm fine, prayer. Came to get blessed for battle." → "The Lord doesn't want blood to be spilled. But I pray you'll return in peace 🙏." This branch has no character or inventory mutation.

### 12.1.3 Blacksmith Loren

`blacksmith_loren` is a vendor NPC with ten visual slots. Its infinite stock contains the nine canonical T1 equipment pieces: sword, greatsword, dagger, bow, staff, wand, shield, physical body armor and magic body armor. Its greeting is data-driven from `npc_catalog.json`; vendor BUY/SELL remains authoritative and uses the existing item pricing fields for Loren's stock.

### 12.1.4 Cecilia

`cecilia` is a quest NPC. Her server-authoritative exchange requires 3 `part_slime_common`, 1 `part_cindergolem_common` and 1 `part_venomviper_common`, and rewards exactly 1 canonical `equip_accessory_sor_t1` (Worn Lucky Ring). The inventory condition is evaluated when the offer node is returned, so the hand-over choice is available immediately on the first conversation when all materials are already owned. The exchange locks/revalidates Town status and inventory and removes/adds all items atomically.

### 12.2 Warehouse

10-slot personal storage, town-only, instant/free transfers, same stacking rules as inventory (§10.1). Simple REST endpoints (`moveToWarehouse`, `moveToInventory`) — no socket events needed, it's not time-sensitive.

### 12.3 Chat

- Two channels: **Global** and **Town**. Both are **always available regardless of the character's location** (grinding or in town) — confirmed design, this differs from the original brief's "chat only appears in town". Implement as two Socket.IO rooms (`chat:global`, `chat:town`) the client subscribes to on connect.
- **No history on join** — chat is ephemeral, nothing is persisted beyond a `ChatReport` snapshot (§4.13).
- Rate limit: **1 message/second per user** (server-enforced, reject with a transient error, do not queue).
- Message length: **200 characters max**, server-trimmed/rejected if longer.
- Optional profanity filter (`TUNABLE` — ship a basic pt-BR/en wordlist filter behind a config flag, default on).
- **Mute:** any user can `report` a message (stores a `ChatReport`); a scheduled check (every few minutes, or triggered on each new report) auto-applies a **global mute** to a user once they've accumulated reports from **5 distinct reporters within 24h** (`TUNABLE`). A muted user's socket messages are rejected server-side with a clear "you are muted until X" error; no admin UI needed for MVP.
- **Presence counters:** show "N players online" (global) and "N players on this map" per map, sourced from the same Redis presence tracking used for encounter search time (§11.4).

---

## 13. Market Trade

An order-book style, auto-matching market, town-only UI.

### 13.1 Order types

- **Sell order:** player picks an item (and, for stackables, a quantity; equipment is always quantity 1), a price **per unit**, lists it. The item(s) leave the inventory immediately and sit in **escrow** on the `MarketOrder` row (`escrowedItemQuantity`).
- **Buy order:** player picks an item **by name/template only** — for equipment, they cannot pick or filter by the random-rolled bonus attribute (confirmed: buy orders are template-level, never instance-level), a quantity (equipment always 1), and a price per unit. `escrowedGold = quantity * pricePerUnit * 1.05` (the 5% fee, always buyer-side, is escrowed up front) is deducted from the character's gold immediately and held on the order.

### 13.2 Matching

Fully automatic, continuous double-auction style: whenever a new order is placed, the server looks for existing **opposite-side** orders on the same `itemId` (ignoring `itemInstanceData` for matching — a buy order matches *any* sell order of that template, first-come-first-served among sellers) where `sellOrder.pricePerUnit <= buyOrder.pricePerUnit`. Match at **the resting order's price** (i.e., whichever order was already sitting in the book — first-come-first-served on price, per confirmed design), for `min(remaining sell qty, remaining buy qty)` units, repeating until one side is exhausted or no more matches exist. This can partially fill an order (some quantity trades, the remainder stays active) — support partial fills for stackable-item orders; equipment orders are always all-or-nothing since quantity is always 1.

On a match:
- Seller receives `quantity * pricePerUnit` gold directly to `Character.gold` (confirmed: instant, not via mail).
- Buyer receives the item via **Mail** (§14) — not directly to inventory (confirmed).
- The `5%` fee (already escrowed from the buyer at order-placement time) is captured as platform revenue (a `MarketDeal.feeCollected` row — no actual "sink" account needed, just don't credit it to the seller; it simply leaves the economy, which is intentional as a gold sink alongside the flat order fee below).
- A `MarketDeal` row is created for **both** parties' history (§13.5).

### 13.3 Fees (confirmed)

- **5% fee, always charged to the buyer,** baked into `escrowedGold` on buy orders, and shown transparently: when browsing sell orders, the buyer-facing price already includes the +5% ("you pay: X"); when placing a buy order, the seller-facing view of that resting order shows the amount they'll actually receive (the buyer's stake minus 5%).
- **Flat 100 gold listing fee**, charged immediately on placing **any** order (sell or buy), non-refundable even if the order is later cancelled (only the escrowed item/gold is returned on cancel, not this fee).

### 13.4 Equipment orders — units and instances

Because equipment is never stackable and buy orders never target a specific instance, an equipment **buy** order is inherently a "give me any copy of Reinforced Chestplate (Magic), I don't care about its rolled bonus stat" order — it will match the **first (oldest)** eligible sell order at or under the buyer's price. Equipment **sell** orders always carry the real `itemInstanceData` (the actual rolled attribute/value) so the buyer can inspect exactly what they're receiving once it lands in their mail.

### 13.5 Order lifecycle

- `expiresAt = createdAt + 7 days`. A scheduled job sweeps expired orders: **the escrowed item or gold is refunded via Mail**, not instantly (confirmed) — consistent with how all "the market gives you something" flows work.
- Cancelling an active order early also refunds the escrow via Mail (same handling as expiry, for consistency — implement as one shared `releaseOrderEscrow(order, reason)` function).
- Limit: **10 active sell orders + 10 active buy orders per character** (accepted suggestion).
- **History:** the market UI's "My Deals" tab shows the **last 15** `MarketDeal` rows involving the character (as buyer or seller), newest first — simple `ORDER BY dealAt DESC LIMIT 15`.

---

## 14. Mail System

- Every mail is tied to `recipientCharacterId`, carries **at most one item stack** (or is a pure-text system notice with no item — supported by the schema for future use, not required at launch), and expires **30 days** after creation.
- A numeric badge on the Mail icon shows the count of **uncollected** mail.
- **Collecting** an item from mail requires available inventory space (a free slot, or room on an existing stack) — if there's no room, the collect action fails client-side with a clear "inventory full" message and the mail stays pending.
- Expired, uncollected mail: **the item is simply deleted** (confirmed — no refund-of-refund chains). A scheduled job sweeps `expiresAt < now() AND collected = false` rows.
- Sources of mail in MVP: Market sales delivered to the buyer (§13.2), Market order cancellations/expirations (§13.5). No other systems generate mail yet, but the schema is generic enough for future quest rewards etc.

---

## 15. Accounts, Auth & Security

### 15.1 Registration

Fields: `username` (3–16 chars, alphanumeric, **case-sensitive**, unique — also becomes the character name, confirmed), `email` (unique, verified via emailed token before the account can grind — email confirmation is required in MVP), `password`, `cpf`.

**CPF handling (LGPD-conscious, confirmed):**
1. Validate the CPF's check digits server-side (standard modulo-11 algorithm) — reject invalid CPFs outright before hashing.
2. Compute `cpfHash = HMAC-SHA256(cpf, PEPPER)` where `PEPPER` is a server-only secret from `.env` — **the raw CPF is never persisted anywhere**, not in logs, not in the DB.
3. Reject registration if `cpfHash` already exists (this is the actual anti-multi-account mechanism).

### 15.2 Password & sessions

- Passwords hashed with **argon2id** (via `argon2` npm package, sane defaults: memory 19MB+, iterations 2+, parallelism 1 — use library defaults unless load-tested otherwise).
- JWT access token (short-lived, ~15 min) + refresh token (longer-lived, ~7 days), both delivered as regular JSON in the auth response body (no httpOnly-cookie complexity needed since the whole stack sits behind Caddy's automatic HTTPS anyway — **confirmed**: Caddy terminates TLS as a reverse proxy in front of the backend). The Angular app stores tokens in memory + a refresh-on-load flow using the refresh token kept in `localStorage` (acceptable given this is a game, not a banking app — document this as a deliberate simplicity trade-off, not an oversight).
- WebSocket handshake authenticates with the same access token passed in `socket.handshake.auth.token`; the gateway verifies it before allowing the connection to join any room.
- **Single active session per account (confirmed):** on successful login, generate a new `activeSessionId` (random UUID), store it on `User`, and embed it as a claim in the issued JWT. Every authenticated request (REST and socket) checks the JWT's `sessionId` claim against `User.activeSessionId` — mismatch means "you were logged in elsewhere", reject with 401 and a specific error code the frontend uses to show *"Your account was logged in from another device"* rather than a generic auth error.

### 15.3 Email verification & password reset

Both required in MVP (confirmed). Standard token-in-email-link flow: generate a random token, store it with an expiry (verification: 24h, reset: 1h), email a link via SMTP (credentials from `.env`, see §18.3), the linked page (frontend route) calls a backend endpoint that validates and consumes the token.

### 15.4 Rate limiting & lockout

- `@nestjs/throttler` on `POST /auth/login` and `POST /auth/register`: e.g. 5 attempts / 60s per IP (`TUNABLE`).
- Account lockout: after **5 consecutive failed logins**, lock the account for **15 minutes** (`TUNABLE`) — track via a `failedLoginCount`/`lockedUntil` pair on `User` (add these two columns to §4.1, omitted above for brevity, include them in the actual migration).

### 15.5 Anti item-duplication

Every operation that moves gold or items between two owners (market match, mail collect, vendor buy/sell, inventory↔warehouse transfer) **must** run inside a single Postgres transaction with explicit row-level locking (`SELECT ... FOR UPDATE`) on every row being mutated, in a **consistent lock order** (e.g. always lock the lower-UUID row first) to avoid deadlocks. Never trust client-sent quantities/prices without re-validating server-side inside that same transaction. This is a hard requirement, not a nice-to-have — write integration tests specifically trying to double-spend/double-collect (§19.4).

---

## 16. WebSocket Protocol (event catalog)

Namespace: `/game`. Auth via handshake (§15.2). Suggested rooms: `char:<characterId>` (private, joined on connect), `map:<mapId>` (joined on entering a map, for presence), `chat:global`, `chat:town`.

### 16.1 Client → Server events

| Event | Payload | Notes |
|---|---|---|
| `map:enter` | `{ mapId }` | validates level requirement, builds fresh battle queue |
| `map:leave` | `{}` | returns to town, stops the grind loop (queue entries beyond the current one are cancelled) |
| `gambit:setActivePage` | `{ pageId }` | rejected if mid-battle, see §8.1 |
| `chat:send` | `{ channel: 'global'|'town', message }` | rate-limited, muted users rejected |
| `chat:report` | `{ targetUserId, messageSnapshot }` | |

### 16.2 Server → Client events

| Event | Payload | Notes |
|---|---|---|
| `battle:queueUpdated` | `{ entries: BattleQueueEntry[], stateRevision?, characterAfter?, inventoryAfter? }` | sent on map:enter and whenever the queue is topped up; after battle resolution, carries the same authoritative Character + Inventory snapshot as `battle:resolved` |
| `battle:resolved` | `{ entryId, outcome, xpGain, goldGain, drops, stateRevision, characterAfter: CharacterDto, inventoryAfter: InventoryItem[] }` | authoritative Character + Inventory snapshot after each battle resolves server-side; `stateRevision` is the Character VersionColumn value |
| `character:died` | `{ deathLog }` | triggers town routing + "last death" affordance client-side |
| `character:leveledUp` | `{ newLevel, unspentAttributePoints }` | |
| `chat:message` | `{ channel, username, message, sentAt }` | fanned out to the relevant room |
| `map:presence` | `{ mapId, playersOnMap }` | realtime on map enter/leave/disconnect |
| `mail:newItem` | `{ unreadCount }` | badge update |
| `market:orderFilled` | `{ orderId }` | so the Market UI can refresh without polling |

Equipment changes, food consumption, attribute point allocation, inventory/warehouse moves, and market/mail actions are plain **REST** endpoints (they are not latency-sensitive and benefit from standard HTTP semantics — status codes, idempotency, easier testing) — only genuinely realtime, push-driven data goes over the socket. Document each REST endpoint with a standard NestJS Swagger decorator; a full OpenAPI listing is intentionally not enumerated line-by-line in this document — the controllers should be organized 1:1 with the modules in §2.1, using conventional REST verbs/paths (`POST /character/attributes/allocate`, `PATCH /equipment/:slot`, `POST /inventory/move`, `POST /market/orders`, `DELETE /market/orders/:id`, `POST /mail/:id/collect`, etc).

---

## 17. Frontend Spec (Angular + RxJS + Signals)

### 17.1 Stack decisions

- **Angular 18+**, standalone components throughout, no NgModules.
- **State:** Signals for local/component state; small injectable Signal-based stores in
  `core/state/` (`CharacterStore`, `InventoryStore`, `BattleStore`, `ChatStore`,
  `MarketStore`). RxJS is reserved for Socket.IO event streams and genuinely stream-like
  sources. No NgRx.
- **Styling:** Tailwind CSS + Angular CDK (`DragDropModule` for drag/drop,
  `OverlayModule` for tooltips/modals).
- **i18n:** `@angular/localize`, pt-BR default + en scaffolded.
- **Responsive:** every view works at >=360px. `/play` and Character/Gambit screens get
  the highest responsive attention.
- **Icons/assets:** dependency-free SVG assets and/or a small local `IconComponent`.
  Angular Material is not required solely for icons.

### 17.2 Visual direction

NanoMMO is a **fantasy MMORPG game client**, not a SaaS dashboard.

Visual language:
- dark brown/black panel surfaces;
- bronze/gold frames and highlights;
- cream text;
- red HP and blue SP;
- compact numeric/data typography;
- dense but readable hierarchy;
- large framed game navigation tabs;
- map-first visual center;
- subtle inner highlights/noise and restrained shadows.

Avoid white cards, glassmorphism, giant rounded SaaS cards, screenshot-as-background
implementations, and unnecessary animation.

The implementation-level visual contract is `PLAY_WINDOW_SPEC.md`.
Concept references:
- `assets/concepts/play-window-concept.png`
- `assets/concepts/character-window-concept.png`

### 17.3 Routes

```text
/login, /register, /verify-email, /reset-password
/play                          -> shell; redirects to town or grind by Character.status
/play/town                     -> vendor, warehouse, market, mail
/play/grind                    -> map selection + battle bar + inventory + event feed
/play/character                -> Character / Gambits / Mastery internal tabs
/play/gambits                  -> deep-link to /play/character with Gambits selected
/play/character?tab=mastery     -> weapon mastery/workbench view
```

There is one Gambit editor implementation. `/play/gambits` is a route-level entry point,
not a second editor.

### 17.4 Global layout

At desktop widths, the shell uses:
- persistent top bar with the `assets/lords.png` logo instead of the `NANOMMO online` wordmark;
- left character summary;
- center context;
- right single Info Panel;
- collapsible chat drawer.

The compact XP bar in the top bar shows the active Gambit page title immediately above it.

The `/play/grind` center is:
- `Currently in: {mapName}`;
- one illustrated fantasy map with the selectable grind tiles;
- battle progress/status;
- the 50-slot inventory directly below the map.

There is **no duplicate map selector/list below the map**. Map tiles are represented only in the central map; removing the redundant lower map strip is intentional.

The 50 inventory cells must fit without vertical scrolling at the intended desktop layout. Use compact square slots sized only slightly larger than the item icon (roughly half the previous slot footprint, subject to responsive constraints), while preserving readable stack counts and hover/focus states.

The left panel answers who the character is, what is equipped, HP/SP, active statuses,
and derived combat stats.

The right panel is a single large **Info Panel**. In Town it shows information about the currently selected object/item/map/character context. During Grind it shows the current grind state, monster information, consumable availability, XP progress and battle timing. Weapon proficiency is not a separate panel.

Exact component composition, dimensions, responsive behavior, visual tokens and states
are defined in `PLAY_WINDOW_SPEC.md`.

### 17.5 Character screen

`/play/character` is the extended character-management screen.

Internal tabs:
1. **Character** — only `Attributes` and `Stats`. Do not render Paper Doll, Build Summary, Equipment, or Inventory in this tab.

The Character tab's six Attributes show the base value plus any authoritative non-base contribution in green `(+N)`. Hovering an Attribute explains which Stats it feeds. The authoritative Character DTO exposes `attributeBonuses` and all Stats, including Magic ATK.

The Stats section includes HP, SP, Attack, Magic ATK, Defense, Attack Speed, Cast Speed, Evasion, Accuracy, HP Regen, SP Regen and Critical.
2. **Gambits** — the full three-page Gambit editor.
3. **Mastery** — weapon mastery workspace. The left side shows the selected weapon type and its mastery tree; the right side shows the weapon list/levels. The skill-tree container is intentionally present even before skills are implemented.

On the Mastery tab, **Weapons** is the right-side list of weapon types (Sword, Greatsword, Dagger, Bow, Staff, Wand, Shield) with each type's level. The selected weapon type is highlighted and its Mastery is shown on the left. Do not show the old Equipment or Inventory panels on this tab.

Attribute allocation:
- shows all six attributes;
- shows unspent points;
- +/- controls;
- pending preview;
- Reset Allocation;
- Apply Changes;
- remains visible but disabled at 0 points;
- server rejection restores authoritative state and shows a specific error.

Equipment remains visible and interactive in the persistent left Character panel of the main play shell; it is not duplicated into the Character sub-tab.

Equipment item icons in Character UI must render white/light rather than black, preserving their silhouette against the dark fantasy panels.

### 17.6 Gambit editor UX

- Reorderable list using Angular CDK `cdkDropList`/`cdkDrag`, up to 20 rows per page.
- Each row is a compact two-level composition: **conditions on top, action below**, matching the visual structure in `project/image.png`. Condition labels/controls align consistently with one another; action controls align on the same grid below.
- Each node exposes its catalog-defined params inline, so a line reads visually like `[Self HP is...] [< 30%] [Use item...] [Small Potion]` rather than hiding params in a secondary editor.
- Numeric/value controls use the same compact input styling as the other Gambit controls; no raw browser-default number-input appearance.
- The enabled control is a minimal switch/toggle, not a full text button.
- Condition/action params remain editable without expanding a secondary panel.
- Condition/action selects come from `gambit_catalog.json`.
- Unavailable actions remain visible but greyed out with an explanatory tooltip.
- Disabled-by-player and unavailable-by-state are visually distinct.
- Three pages, one active page, optional title.
- Switching active page is blocked while a battle is in flight.
- Server field-level validation highlights the exact failing control.
- No dry-run/simulation UI in MVP.

### 17.7 Feedback & feel

- Toasts for drops and level-ups.
- Live event feed during grind.
- Short, muteable SFX for hit, crit, level-up and death.
- Last Death modal renders `Character.lastDeathLog`.
- Battle progress is calculated only from server `startAt`/`endAt` timestamps.
- Reduced-motion mode disables nonessential movement/scroll animations.

### 17.8 Asset and Angular implementation policy

- Navbar branding uses `assets/lords.png` in place of the old `NANOMMO online` text.
- Equipment icons in Character panels use the existing item/equipment icon assets with a white/light presentation.

Use semantic DOM and CSS grid/flex. Do not recreate the reference screenshot through
absolute pixel positioning.

Preferred icons:
- SVG assets in `assets/ui/`;
- local `IconComponent` for dynamic state/color;
- CSS/Tailwind for panel surfaces, borders, bars and state styling.

Use Angular CDK for drag/drop and overlay behavior. Do not add another UI framework merely
to obtain icons.

### 17.9 Detailed screen specification

See `FRONTEND_SPEC.md` and `PLAY_WINDOW_SPEC.md` for the route-by-route implementation
contract, states, component boundaries and responsive behavior.

---

## 18. Infra, Docker, Redis, Caddy, CI/CD

### 18.1 `docker-compose.yml` (base) + `docker-compose.prod.yml` (overrides)

Services: `db` (Postgres 16), `redis` (Redis 7), `backend` (the NestJS app, builds from `apps/api`), `caddy` (reverse proxy + automatic HTTPS via a `Caddyfile`). The frontend is **not** in Docker — it's deployed on Vercel (confirmed) and simply points its API base URL at the backend's public domain.

```yaml
# docker-compose.yml
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: ${DB_NAME}
    volumes:
      - db_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER}"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redis_data:/data

  backend:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    restart: unless-stopped
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
    expose:
      - "3000"

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - backend

volumes:
  db_data:
  redis_data:
  caddy_data:
  caddy_config:
```

```yaml
# docker-compose.prod.yml (overrides — e.g. no exposed db/redis ports to the host, build args, etc.)
services:
  backend:
    build:
      args:
        NODE_ENV: production
```

```
# Caddyfile
api.yourdomain.com {
  reverse_proxy backend:3000
}
```

### 18.2 `.env` (backend) — required keys

```
DB_USER=
DB_PASSWORD=
DB_NAME=
DATABASE_URL=postgres://${DB_USER}:${DB_PASSWORD}@db:5432/${DB_NAME}
REDIS_URL=redis://redis:6379
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
CPF_HASH_PEPPER=
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
FRONTEND_URL=            # used to build email verification/reset links
PORT=3000
```

Loaded in Nest via `@nestjs/config` (`ConfigModule.forRoot({ isGlobal: true })`) at boot; validate required keys with a Joi/zod schema on startup and **fail fast** (crash immediately with a clear message) if any are missing, rather than limping along with `undefined` secrets.

### 18.3 CI/CD

Two workflows:
- `ci.yml` (on every PR / push to any branch): install deps (pnpm), lint, run unit + e2e tests for `apps/api` and unit tests for `apps/web`, build both apps — fail the workflow on any failure.
- `deploy-backend.yml` (on push to `main` only): mirrors the pattern already in use — SSH into the private VPS via `appleboy/ssh-action`, `git fetch && git reset --hard origin/main && git clean -fd`, then `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build db backend caddy redis`. Adapt exactly as follows for this repo:

```yaml
name: Deploy Backend

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to production server via SSH
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.SSH_HOST }}
          username: ${{ secrets.SSH_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            set -e
            cd ~/nanommo
            git fetch origin main
            git reset --hard origin/main
            git clean -fd
            docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build db redis backend caddy
```

The frontend has **no deploy workflow** in this repo — Vercel's own GitHub integration handles it automatically on push (confirmed), just make sure `apps/web` is set as Vercel's project root with the correct build command (`ng build`) and output directory.

---

## 19. Testing Strategy

### 19.1 Battle engine — snapshot tests (highest priority, given determinism is the core promise)

For a fixed matrix of `(characterSnapshot, monsterId, seed)` inputs covering: each of the 15 monsters, at least 2 representative gambit pages (the catalog's `exampleGambitPage` and a minimal "just attack" page), and a few character stat presets per archetype (§9.2) — run `simulateBattle(...)` and snapshot the full `BattleResult` (Jest `toMatchSnapshot()`). Any unintentional formula change will fail these loudly; intentional balance changes require reviewing and committing new snapshots, which is the point.

### 19.2 Unit tests

- Stat formulas (§5.2): pure input→output tests for `maxHp`, `atk`, `def` mitigation curve at several DEF values (verify the 50%-at-300 soft-cap claim), hit chance clamping at its 5%/95% bounds.
- PRNG (§11.2): same `(seed, index)` always yields the same value; distribution sanity check (chi-square-ish spot check, not required to be rigorous) over a large sample.
- Gambit evaluation (§7.3/§8): a line that's condition-true-but-illegal is correctly skipped in favor of the next; AND/OR combinators evaluate correctly; disabled lines are skipped.
- XP curve tables (§6): loaded table values match the documented formula for a sample of levels (guards against the JSON and the formula silently drifting apart after a manual edit).

### 19.3 Balance/simulation tests

A standalone script (not part of CI, run manually during tuning) that runs thousands of simulated battles for each monster against each of the 4 archetype presets (§9.2) at several character levels, reporting win rate and average battle duration. Use this to validate the §7.8 claim (a level-3 character with a good gambit should be able to farm level 5–6 monsters) and to catch any monster that's either trivial or unwinnable at its map's intended level band.

### 19.4 Integration / e2e tests (backend)

- Auth flow: register → verify email → login → single-session enforcement (second login invalidates the first token).
- Full grind loop: enter map → queue of 5 battles created → simulate time passing (mock the scheduler or fast-forward a test clock) → battles resolve → XP/gold/drops applied → death routes to town + death log recorded.
- Market: place sell order → place matching buy order → both `MarketDeal` rows created → seller gold credited instantly → buyer receives item via mail → **concurrency test**: two buy orders racing for the same single sell order must never both succeed (this is the anti-duplication guarantee from §15.5 — write this test specifically, firing near-simultaneous requests and asserting exactly one wins and the other's gold is never spent).
- Mail: expiry sweep deletes uncollected items past 30 days; collect fails cleanly when inventory is full.
- Crash recovery (§7.5): manually insert `BattleQueueEntry` rows with `endAt` in the past, restart the resolving service (or call its boot-time recovery function directly in the test), assert they resolve synchronously and in order before new connections are served.

### 19.5 Frontend tests

Component tests for the gambit editor (line add/remove/reorder, greyed-out rendering logic given mock catalog + mock character state) and the battle bar (renders correct progress purely from injected `startAt`/`endAt` + a mocked clock, including the "resume correctly after simulated page reload" case).

---

## 20. Build Plan — Ordered AI Prompts

Use these as literal, sequential prompts to your IDE's AI assistant, one at a time, each in its own session/context with this full `SPEC.md` available. Do not skip ahead — each phase assumes the previous one's code exists and compiles.

1. **Scaffold the monorepo.** Create the pnpm workspace layout from §2.1 (empty NestJS app in `apps/api`, empty Angular app in `apps/web`, empty `packages/shared` with a `tsconfig` path alias `@nanommo/shared`). Wire up root scripts (`dev`, `build`, `test`) that run both apps. Add the `docker-compose.yml`, `.env.example`, and `Caddyfile` from §18.
2. **`packages/shared`: enums, DTOs, types.** Implement every enum/type mentioned across §4–§11 (Attribute, Slot, WeaponType, DamageType, GambitConditionId/ActionId, BattleResult, GambitLine, etc.) as plain TypeScript, zero runtime deps.
3. **`packages/shared/battle-engine`.** Implement `mulberry32` PRNG (§11.2), the stat formulas (§5.2), and `simulateBattle()` (§7.1–§7.3) as pure functions. Write the §19.1 snapshot tests alongside — this package should be fully correct and tested **before** touching NestJS.
4. **Backend: data loading.** Copy the 7 JSON files (§21) into `apps/api/src/data/`, write a boot-time loader that schema-validates them (zod) and exposes them via an injectable `GameDataService`. Also port the two curve-generator scripts (xp_curve.py / weapon_xp_curve.py logic, §6) into TypeScript as `scripts/generate-xp-curves.ts` for future rebalancing, but ship the already-generated JSON tables as the runtime source of truth.
5. **Backend: entities & migrations.** Implement every entity from §4 with TypeORM decorators, generate the initial migration, verify it runs cleanly against the dockerized Postgres.
6. **Backend: auth module.** Registration (incl. CPF validation/hashing), email verification, login (incl. single-session + lockout), refresh, password reset — per §15.
7. **Backend: character module.** Character creation on first login, attribute allocation endpoint, equipment endpoints (with slot-combination validation from §5.3), weapon proficiency tracking.
8. **Backend: gambit module.** CRUD for the 3 pages, full server-side validation (§8.4), active-page switching with the mid-battle guard (§8.1).
9. **Backend: battle module + gateway.** Wire the shared battle engine into the real flow: map:enter → build 5-deep queue → BullMQ scheduled resolution → crash recovery on boot (§7.4–§7.6). This is the most complex phase — budget real time for it, and lean on the §19.1 snapshot tests plus the new §19.4 integration tests to verify correctness.
10. **Backend: inventory, equipment drops, market, mail, warehouse, vendor.** §10, §12–§14. Pay special attention to the transactional locking rules in §15.5.
11. **Backend: chat + presence.** Redis-backed rooms, rate limiting, mute/report flow (§12.3).
12. **Frontend: shell + auth.** Routes, game-client visual shell, login/register/verify/reset screens, socket connection service, and shared SVG icon/panel primitives.
13. **Frontend: character sheet + equipment paper-doll + Gambit sub-tab/editor.** Implement `/play/character` with Character/Gambits/Equipment tabs and `/play/gambits` as a deep-link to the same Gambit implementation.
14. **Frontend: grind view + battle bar + 50-slot inventory + map tile selection + event feed + town hub + chat drawer.** Follow `FRONTEND_SPEC.md` and `PLAY_WINDOW_SPEC.md` without changing backend contracts.
15. **Polish pass.** Sound effects, toasts, i18n extraction (pt-BR/en), reduced-motion, accessibility, responsive pass, and visual consistency against the concept references.
16. **Balance pass.** Run the §19.3 simulation script, adjust `TUNABLE` constants as needed, regenerate the two XP curve JSONs if `C1`/exponents change.

---

## 21. Appendix — JSON Data Files Reference

These 7 files are the complete static game data and ship in `apps/api/src/data/`. Each is provided as a separate deliverable alongside this document:

| File | Contents |
|---|---|
| `monsters.json` | 3 maps' metadata + all 15 monster definitions (stats, archetype matchups, drops, gambits) |
| `items.json` | 30 monster parts, 15 consumables, 51 equipment pieces |
| `npc_vendor.json` | The town vendor's fixed sell stock + buy-rate config |
| `gambit_catalog.json` | The full curated condition/action catalog, page/line limits, HP/SP band thresholds, an example page |
| `skill_trees.json` | All 49 weapon skills (7 types × 7 tiers) + 3 monster-only skills + base attack-gauge ticks per weapon |
| `char_xp_curve.json` | Precomputed character level 1–98 XP table (§6.2) |
| `weapon_xp_curve.json` | Precomputed weapon proficiency level 1–50 XP table (§6.5) |

Load all seven at boot, validate their shape, and fail fast on mismatch (§18.2 philosophy applies here too — a malformed data file should crash the boot, not silently degrade).

### Grind synchronization follow-up
- A Town request made during an active battle is deferred server-side through Character.returnToTownAfterBattle; future queued battles are cancelled, the active battle resolves normally, then the character transitions to Town before any replacement battle is queued.
- Frontend Character, Inventory, and Battle state loads must not allow an older HTTP response to overwrite newer authoritative state received through the realtime game channel.
- Persisted Character HP/SP and Inventory quantities remain authoritative outside an active battle. During an ACTIVE battle, the Character Summary may use a read-only display projection from the immutable queued battle log plus `startAt`/`endAt`; this projection never writes to CharacterStore, InventoryStore, or the server and is abandoned immediately when the battle is no longer ACTIVE.
- `battle:resolved` and the immediately following post-resolution `battle:queueUpdated` carry Character and complete Inventory from the same server state revision. This closes ordering races between their independent Redis pub/sub channels. Realtime snapshots with an older or equal revision are ignored, and HTTP responses that were in flight across a newer realtime update are discarded.
- `GET /inventory` returns `{ items, stateVersion }`, allowing the frontend InventoryStore to reject an older HTTP snapshot relative to the accepted realtime Character revision.
