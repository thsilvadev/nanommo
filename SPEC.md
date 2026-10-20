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
6. Progression: Character XP & Mastery
7. Battle Engine (tick simulation, action gauge, prediction queue)
8. Gambit System
9. Mastery Skill Trees
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
│   │   │   │   ├── presence/    # gameplay map presence + reusable online presence
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
- The player changes their **active gambit page** (or edits the currently active one); during an active battle the change is persisted for future battles while the active battle snapshot remains unchanged (see §8.5).
- The player spends **attribute points** that change combat statistics; during an active battle the spend is accepted but only affects battles after the active snapshot resolves.
- The player changes **equipment**.
- The player consumes a **food** item manually from the inventory UI (as opposed to via gambit) or otherwise changes buffs outside of the auto-battle loop.
- The player switches **map**.
- The player **levels up** mid-queue in a way that changes stats (handled automatically by the resolver, not player-triggered, but still forces a requeue — see §7.6).

All future-combat mutations use one BattleService-owned boundary. If an unresolved queue entry satisfies `startAt <= now < endAt`, the mutation is still accepted after validation: persist the new Character/Gambit state, preserve the active BattleQueueEntry and its BullMQ job unchanged, and invalidate only stale future entries after that active battle. Do not schedule a replacement chain while the battle is active; rebuild the canonical queue to depth 5 after it resolves, using the new state. When no battle is active, invalidate stale unresolved entries and rebuild immediately if the character remains eligible to grind. Failed validation happens before queue invalidation. Editing an inactive Gambit page and re-activating the page that is already active are no-ops for queue invalidation.

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
| dominantHand | varchar(5), default right | right/left; presentation only, never changes semantic hand API slots |
| knownItemIds | jsonb, default [] | item IDs the character has seen/acquired; separate from inventory quantity |
| level | int, default 1 | 1–99 |
| xp | bigint, default 0 | current XP toward next level |
| unspentAttributePoints | int, default 0 | |
| str / agi / dex / vit / int / luk | int, default 5 each | base 5 |
| gold | bigint (numeric(15,0)), default 0 | cap 1,000,000,000,000 |
| hpCurrent | int | persisted so grind can resume mid-HP |
| spCurrent | int | |
| currentMapId | varchar, NOT NULL | canonical physical location; `map_town` = Town |
| status | enum('town','grinding','dead_pending_return') | |
| activeGambitPageId | uuid, FK → GambitPage, nullable | |
| lastDeathLog | jsonb, nullable | see §7.7, overwritten each death |
| activeFoodBuff | jsonb, nullable | `{ itemId, hpRegenPerTenTicks, spRegenPerTenTicks, expiresAt }` legacy fallback for food-buff state |
| diet | jsonb, default [] | ordered array of up to three unique food entries `{ itemId, consumedAt, digestUntil, dietLevel }`, oldest first and newest last; expired entries remain until shifted out |
| dietLevels | jsonb, default {} | `{ [itemId]: { level: 0..3, lastDigestUntil } }`; retained items own a streak level, evicted items have level 0 but may retain a future digestion boundary |
| autoFeed | boolean, default false | authoritative server-side food automation toggle |
| activeTempBuffs | jsonb, default [] | array of `{ source, stat, mult|flat, expiresAt|expiresAtTick }` from skills like Bloodlust |
| statusEffects | jsonb, default [] | array of `{ type, appliedAtTick, expiresAtTick, sourceSkillId }` |
| lastSeenAt | timestamptz | online/offline metadata; future heartbeat owns online freshness, not gameplay map membership |
| regenAnchorAt | timestamptz, nullable | stable origin for the character's continuous 10-tick regeneration timeline |
| createdAt / updatedAt | timestamptz | |

Character creation bootstrap (one time only): seed the starter pack with 50 `pot_hp_small` and 5 `food_bread`. Characters start with a `Knife` (`equip_knife`, dagger, +8 ATK) equipped in `mainHand`; it is a dedicated starter item and is not added to inventory. A character with no active food buff is **Hungry** and cannot enter or continue grind until food is consumed. New characters start with current HP/SP equal to their authoritative maximums.

### 4.3 Mastery category progress (`weapon_proficiencies` legacy table)
| field | type | notes |
|---|---|---|
| id | uuid, PK | |
| characterId | uuid, FK | |
| weaponType | varchar(16) | one of `sword`, `greatsword`, `dagger`, `bow`, `staff`, `rod`, `shield`, `rune` |
| level | int, default 0 | 0–10; derived from cumulative Mastery XP by the shared threshold table (§6.5) |
| xp | bigint, default 0 | cumulative Mastery XP for this category |
| spentSkillPoints | int, default 0 | ranks purchased in this category; must not exceed Mastery level |
| skillRanks | jsonb, default `{}` | map from skill ID to allocated rank; ranks survive death |

Unique index on `(characterId, weaponType)`. Character creation and the migration seed exactly one row for each of the eight categories at level 0, 0 XP, 0 spent points, and no learned ranks. The SQL table name remains `weapon_proficiencies` for compatibility; its legacy level-1-to-50 meaning is retired.

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
| slot | enum(head, body, mainHand, offHand, shoes, cape, acceslukyLeft, acceslukyRight) | |
| itemId | varchar | |
| instanceData | jsonb, nullable | `{ rolledAttribute, rolledValue }` or elemental immunity for shoes (static, no roll) |

Catalog equipment with `slot: accesluky` is compatible with either persisted `acceslukyLeft` or `acceslukyRight`; the persisted EquippedItem always stores the explicit left/right slot.

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
| DEX (Destreza) | Accuracy, Cast Time Reduction (CTR) |
| VIT (Vitalidade) | Max HP, HP regen |
| INT (Inteligência) | Max SP, SP regen, Magic ATK |
| LUK (Sorte) | Crit Chance |

### 5.2 Derived stat formulas

The six attributes are always present at character creation with value 5. Each point contributes to one or more derived stats through the following NanoMMO formulas. The design is inspired by Ragnarok Online relationships, but the numeric values are original to NanoMMO.

attack = floor(STR * 2) + weaponAttack
magicAttack = floor(INT * 2) + weaponMagicAttack
defense = equipmentDefense
maxHp = 50 + floor(VIT * 18) + equipmentMaxHp
maxSp = 20 + floor(INT * 8) + equipmentMaxSp
attackSpeed = 100 + floor(AGI * 2)
castTimeReduction = floor(DEX * 2)
evasion = 99 + floor(AGI / 3)
accuracy = 79 + floor(DEX / 3) + equipmentAccuracyModifier + passiveAccuracyModifier
hpRegenPerTenTicks = 1 + floor(VIT / 2)
spRegenPerTenTicks = 1 + floor(INT / 2)
critChance% = floor(LUK * 0.3 * 10) / 10

Attack Speed is displayed as a rating where higher is faster. Attack Speed affects only the character's basic Attack gauge: active status penalties are subtracted from the rating, then the effective value is clamped to 0–800 and converted to a 10-to-1-tick refill interval in §7.2. Cast Time Reduction is derived as floor(DEX × 2), with no +100 baseline; 100 CTR removes one tick from a character skill's base cast duration. Regeneration is recovered once every 10 ticks because one tick is one second.

At level 1 with all six attributes at 5 and the starter Knife's +8 ATK:

ATK 18 | MATK 10 | DEF 0 | Max HP 140 | Max SP 60
Attack Speed 110 | Cast Time Reduction 10
Evasion 100 | Precision 80
HP Regen 3 / 10 ticks | SP Regen 3 / 10 ticks
Critical 2.5%

Equipment stat bonuses are added to the corresponding attributes before these formulas. Flat equipment Max HP/Max SP and weapon ATK are added directly.

**Physical damage mitigation (hybrid flat + relative DEF):**
```
raw = max(0, rawDamage)
armor = max(0, DEF)
flatReduction = armor * 0.225
relativeReduction = raw * armor / (armor + 250)
finalPhysicalDamage = max(raw * 0.01, raw - flatReduction - relativeReduction)
```

DEF combines a flat reduction (0.35 damage per DEF) with a relative reduction (`DEF / (DEF + 100)`) so it remains useful against both small early-game hits and large later-game hits. Physical damage cannot be reduced below 10% of its raw pre-mitigation value. These values are NanoMMO balance parameters, not a copied Dota formula; validate against representative equipment tiers and monster attacks before further tuning. Critical-hit scaling, monster damage-type multipliers, and direct-damage variance are applied in their existing order around physical mitigation.
The combined flat and relative terms have diminishing returns, while the 1% floor ensures that even very high DEF cannot fully negate physical hits. Unlike a purely percentage-based armor curve, the flat term also creates visible value at low DEF values; unlike pure flat reduction, relative mitigation scales against large late-game hits.

**Magic damage mitigation (flat %, per spec §11 of the confirmed answers — MDEF is a percentage from gear only):**
```
finalMagicDamage = rawDamage * (1 - mdefPercent/100)
```
`mdefPercent = 100` means true magic immunity. This is intentionally simpler/harsher than physical mitigation (no soft cap) because MDEF gear is rarer by design (see §10 equipment catalog — only "Arcane" variant armor pieces roll it).

**Hit / evasion resolution:**
```
hitChance% = clamp(100 + accuracy - evasion, 5, 95)
```
Rolled once per basic attack at resolution time using the seeded PRNG (§11.2) — deterministic given the seed, not "live" randomness. Under this formula, Precision 80 versus Evasion 100 gives 80% hit / 20% miss. Monster Accuracy/Evasion values must be calibrated onto this same scale before these player baselines are active; do not reuse the current low monster Evasion values unchanged. Active abilities do not roll Accuracy/Evasion or critical hits unless an explicitly specified future exception says otherwise.

**Critical hits:**
```
isCrit = roll() < critChance%
damage = isCrit ? damage * critMultiplier : damage
```

### 5.3 Hand equipment and weapon identity

The eight canonical Mastery categories are Sword, Greatsword, Dagger, Bow, Staff, Rod, Shield, and Rune. Sword, Dagger, and Rod are one-handed primary weapons. Greatsword, Bow, and Staff occupy both hands. Dagger is the only weapon that may occupy either semantic hand; Shield and Rune are off-hand equipment. A secondary item requires a compatible one-handed primary. Dagger + Dagger and Sword/Rod + Dagger are legal; Sword + Sword is forbidden. Shield and Rune may pair with any one-handed primary. The item catalogue's slot, twoHanded, and allowedOffHandTypes metadata is the authoritative compatibility contract; do not maintain a second hard-coded weapon-name matrix.

The semantic slots remain mainHand (primary) and offHand (secondary), independent of a character's saved dominantHand (right or left). Dominant hand mirrors only the UI presentation; API names and combat semantics never change. A two-handed equip returns a conflicting secondary item to inventory. The server validates final hand combinations for every equip mutation.

Main-hand weapon ATK contributes at 100%; secondary-hand weapon ATK contributes at 50%. Only the secondary weapon's ATK is reduced: attributes, defensive properties, and other bonuses/effects remain at full value. The equipped secondary weapon tooltip displays its original ATK struck through and the effective 50% contribution beside it, using the shared CatalogService tooltip path.

Basic Attack's damage type comes from the main-hand item and timing uses the universal Attack Speed formula (§7.2), not legacy weapon timing metadata. Active skills require the relevant mastery rank, required equipment, sufficient SP, and a ready cooldown; active abilities do not roll Accuracy/Evasion or critical hits. Positional abilities consume the battle-distance-movement contract at the end of this document.

---

## 6. Progression: Character XP & Mastery

### 6.1 Design intent

Reaching character level 60 should take roughly **1 month of continuous idle grinding** (excluding time spent in town), and the **single step from level 59 to 60 alone** should account for roughly **half of that month** — i.e. the curve is dominated by its own tail, early levels fly by, the last stretch dominates. Beyond level 60 (cap 99), growth becomes deliberately near-impossible, framing 99 as an aspirational horizon rather than a realistic target. Mastery is separate per category, starts at level 0, and is capped at level 10; skill points are earned by Mastery levels and spent on ranks.

Both curves below were derived, not guessed: a small simulation (`packages/shared` should ship the generator script as `scripts/generate-xp-curves.ts` for future rebalancing) assumed **~20 effective idle-hours/day**, an **average battle length of 15s**, and an average XP-per-kill of `18 * monsterLevel^1.15` (this constant also drives `xpReward` in `monsters.json` — the two are the same formula, keep them in sync). Solving for these targets yields a clean **geometric doubling curve** up to level 60, then a steeper geometric tail to 99.

### 6.2 Character XP formula

```
xpToNextLevel(L) =
  if L <= 60:  round(C1 * 2^(L-1))
  if L  > 60:  round(xpToNextLevel(60) * 1.35^(L-60))

C1 = 2.4433638740432053e-10   // derived constant, TUNABLE only via full curve regeneration
```

Do not hand-edit individual level values — if rebalancing is needed, adjust `C1` and/or the two exponents (`2.0` early ratio, `1.35` late ratio) and regenerate the full table. The current Grind reward resolver applies a **0.25 global XP pacing multiplier** and a level-gap multiplier: 100% when the character is at most 3 levels above the monster, 70% at +4, 50% at +5, 30% at +6, and 5% at +7 or more. The character level is taken from the immutable battle snapshot; canonical monster `xpReward` values remain the base source data. The complete precomputed table (all 98 rows: `level, xpToNext, cumulativeXp, estHoursAtThisLevel, estDaysAtThisLevel`) ships as `char_xp_curve.json` (§21) — **load this at boot and use it directly**; do not recompute the formula at runtime, just index into the table by level for O(1) lookups.

Sanity checkpoints from the generated table (assumptions above): level 60 reached at ~600 idle-hours (~30 days); level 59→60 alone takes ~294 idle-hours (~14.7 days, essentially half the total climb to 60); level 90 is ~205 years; level 99 is deliberately beyond any realistic playtime. This matches the intent: fast early game, brutal late game, 99 as a horizon.

### 6.3 Level-up effects
- `unspentAttributePoints += 5`
- `maxHp`/`maxSp` recompute immediately (derived, not stored deltas)
- `hpCurrent`/`spCurrent` are **not** auto-topped — a level-up mid-grind keeps current HP/SP ratio-adjusted: `hpCurrent = round(hpCurrent * newMaxHp/oldMaxHp)` (prevents a level-up from either healing for free or leaving HP nonsensically low relative to the new max).
- Triggers a **battle queue recalculation** (§3.4) since stats changed.

The ratio is taken between two `maxHp`/`maxSp` values, so **both ends must be derived from the same state the battles were simulated against** — the character's attributes *including* equipment `statBonus` (§5.2), with the character's real `def`/`mdefPercent`/weapon ATK as the third argument of `calculateDerivedStats`. Deriving the ratio from bare attributes instead scales an equipped character by the wrong factor (a level-1 character in tier-1 armour, VIT 5 → 26, would be scaled by 176/158 = 1.114 instead of 428/410 = 1.044, and the result would then be clamped against the wrong maximum). Implemented in `battle.service.ts:453-484`; verified by the equipped-character level-up scenario in `apps/api/test-phase3-levelup.js`.

A single XP resolution SHALL consume every XP threshold crossed by the awarded XP, allowing multiple level gains when enough XP is awarded. Each crossed threshold is consumed in order and excess XP remains stored toward the next level. The reduced Grind XP rate is the pacing control. This is enforced server-side in the authoritative resolver.

### 6.3.1 Attribute allocation and future-battle safety

Spending unspent STR/AGI/DEX/VIT/INT/LUK points is a combat-state mutation because those attributes feed derived combat statistics. The server validates the complete spend before persisting it. If an unresolved `BattleQueueEntry` is currently in flight (`startAt <= now < endAt`), the request is still accepted: the Character attributes are updated, the active battle entry/job remain unchanged, and only stale future entries after that active battle are invalidated. The future chain is rebuilt from the persisted post-spend Character state after the active battle resolves. When no battle is in flight, the successful spend immediately invalidates the unresolved future chain through the same BattleService-owned discard/cancel/rebuild boundary used by level-up, equipment and food mutations.

### 6.4 XP loss on death

On loss, before returning to town: `xp = max(0, xp - floor(xpToNextLevel(currentLevel) * 0.05))` — i.e. **5% of the XP required for the current level** is lost, truncated to a whole number of XP and never dropping XP below 0.

Two things this deliberately does *not* do, both settled as of 2026-09-28 (previously listed as divergence #1 in `design.md`; the code was kept and this section was brought in line with it):

- **No `cumulativeXp` floor.** An earlier draft of this section clamped at `cumulativeXp[currentLevel-1]`. That clamp is undefined under the toward-next-level model §4.2 actually uses: `characters.xp` holds XP *toward the next level*, not a cumulative total, so there is no "previous level's threshold" to clamp at. The clamp at **0** is what actually prevents a de-level — a character who would lose more XP than they hold keeps their level and lands on exactly 0, never below.
- **No rounding up.** `floor`, not `round`: at level 10 that is 1 XP where `round` would give 2.

Implemented as written in `battle.service.ts:545-546`; verified by `apps/api/test-phase3-death.js` (level 10 → `floor(30 × 0.05) = 1`; level 20 seeded at 1 XP with `floor(73 × 0.05) = 3` → clamped to 0, level unchanged at 20).


### 6.5 Mastery XP and levels

Mastery XP is awarded transactionally when the authoritative BattleService resolves a battle, using only the immutable equipment snapshot and actions recorded by that battle. Defaults are 2 XP for a successful offensive action with a two-handed weapon; 1 XP for each occupied one-handed weapon hand per successful offensive action; and 1 defensive XP for each equipped Shield or Rune when an incoming enemy attack/ability is confirmed as landed. Two Daggers therefore credit 2 XP to Dagger per eligible offensive action. Basic-attack misses award no offensive XP. An action skipped because it is unlearned, unequipped, on cooldown, or lacks SP awards no XP. An incoming miss awards no defensive XP. A battle retry or duplicate delivery MUST NOT award the same Mastery XP twice.

All eight categories (sword, greatsword, dagger, bow, staff, rod, shield, rune) begin at level 0, 0 XP, and no learned ranks. Mastery level is capped at 10 and earned XP/levels/ranks survive death. The canonical shared data source must define the threshold table; frontend/backend must not independently derive it. Mastery thresholds are shared and continuous; validate their pacing against the active character XP curve and level-gap-adjusted rewards rather than treating older action-count checkpoints as current guarantees. The DEX/Bow milestone discrepancy described near the end of this document remains unresolved; do not add a special-case discontinuity without a design decision.

The shared cumulative thresholds for Mastery levels 1–10 are 5, 15, 40, 100, 300, 600, 1,800, 4,500, 10,000, and 20,000 XP (level 0 starts at 0 XP). The increase from levels 3→4 and 4→5 is intentional; the 5→6 gap is 300 XP, followed by a continuous increase rather than a sudden jump to 20,000 XP. The deterministic calibration harness is an action-count proxy: it reads cumulative character XP, cycles eligible monsters, applies the 0.25 global rate per kill and estimates actions as `ceil(monster HP / (5 × character level))`. It does not model the full level-gap penalty or real battle timing, so its Mastery level outputs are regression indicators only, not approved pacing targets. The threshold table removes the former 500→20,000 XP cliff and keeps increasing requirements gradual. Validate final pacing against actual combat stats and measured kill cadence. The DEX/Bow milestone remains open. Threshold changes belong only in the shared Mastery progression function/table.

Four API environment settings control reward amounts and must be validated as non-negative integers at boot: MASTERY_XP_TWO_HANDED_ACTION=2, MASTERY_XP_ONE_HANDED_ACTION=1, MASTERY_XP_SHIELD_ON_HIT=1, and MASTERY_XP_RUNE_ON_HIT=1. Environment parsing belongs to the API, never the shared simulator.

---

## 7. Battle Engine

Lives in `packages/shared/src/battle-engine/`. Pure functions only — no DB, no Date.now() (all "time" is tick-indexed integers; wall-clock timestamps are attached by the caller in `apps/api` after simulation).

### 7.1 The tick

**1 tick = 1 second of in-game time.** A battle is simulated as a loop over integer ticks starting at 0, until one combatant's HP reaches 0. There is **no maximum tick count, timeout, or duration-based defeat**; a battle cannot be declared a loss merely because it lasted a long time. `FLEE` may become a future explicit termination condition when implemented, but is not currently available. The number of ticks the loop takes **is** the battle's duration; the frontend displays a progress bar computed purely from `startAt`/`endAt` timestamps (`endAt = startAt + ticksElapsed * 1000ms`), so it never needs to know about ticks itself.

### 7.2 Action gauges

Each combatant (character and monster) has an independent `attackGauge` for basic Attacks. The character's Attack gauge adds `1 / effectiveAttackDurationTicks` per eligible tick and fires at `gauge >= 1`; it preserves partial gauge progress when a status changes the refill rate. Character skills use immediate Cast Gambit intent and a pending cast timer, not the character Cast gauge. The character Cast gauge remains for `use_item`, `defend`, and `wait`; monsters retain their existing Attack/Cast gauges. Gauge fires evaluate the Gambit for only that action type, then reset even if no matching action is legal (a wasted fire; see §7.3). Attack Speed affects only the basic Attack gauge.

```
effectiveAttackSpeed = clamp(attackSpeed - activeAttackSpeedPenalty, 0, 800)
effectiveAttackDurationTicks = clamp(10 - effectiveAttackSpeed * 9 / 800, 1, 10)
attackGauge += 1 / effectiveAttackDurationTicks
The character Cast gauge threshold applies only to non-skill Cast actions and remains `8 - floor(DEX * 0.05)` (minimum 3 ticks, TUNABLE). Character skills do not wait for this gauge.
```

The catalog contract is typed by `StatusEffectDefinition` in `packages/shared/src/types/index.ts`; supported status fields are `id`, `name`, `stackable`, `statusDurationTicks`, `maxStacks`, `moveSpeedPenalty`, `moveSpeedPenaltyPerStack`, `attackSpeedPenalty`, `attackSpeedPenaltyPerStack`, and `reapplication: "refresh"`. The active Attack Speed penalty is the sum of `attackSpeedPenaltyPerStack` for each active stackable-status stack (up to its catalogued `maxStacks`) and `attackSpeedPenalty` for each active non-stackable status. These are fixed rating-point subtractions, not percentages. The speed-to-duration scale is universal: effective Attack Speed 0 means a 10-tick gauge refill; effective Attack Speed 800 means a 1-tick refill. `weaponBaseAttackTicks` values remain catalogued but do not override this rating-based character interval. The basic Attack's separate 2-tick resolving lock remains independent of gauge refill. Applying, stacking, or expiring a status recalculates the next gauge increment and preserves progress already accumulated.

Status application contract: supported monster skills and character Mastery actions/passive procs can apply statuses to either combatant. IDs are resolved through canonical `status_effects.json`; duration, stackability, stack cap, reapplication policy and catalogue-defined penalties belong in the catalogue rather than being duplicated on the skill. Character passive effects such as Swordsmanship Bleed and Shield Bash additionally consume their skill-catalogue proc chance and payload. Passive procs are status/effect events, never new Gambit actions or gauge consumers; Shield Bash's stun event carries `sourceSkillId: "shield_bash"` and `passiveProc: true`. Format it as `<target> is stunned by Shield Bash.` without treating it as a character action. An absent status ID applies no status. `effect.statusChance` is optional (default 1) and clamped to 0–1; application is considered only after the action lands. The simulator does not consume a seeded RNG roll when application is impossible because a stack cap is reached or a non-stackable instance is active without a refresh policy; guaranteed chance 1 also does not advance the RNG stream. A stackable status is one runtime entry per active stack, each with its own `appliedAtTick`, `expiresAtTick`, optional `sourceSkillId`, source actor and resolved per-instance penalties. New stacks are ignored at `maxStacks` without refreshing existing stacks. A non-stackable status is ignored while active unless `reapplication: "refresh"`, which replaces the existing instance and starts a fresh duration. Duration is `max(1, floor(statusDurationTicks))`. Expiration is checked before actions each tick (`expiresAtTick <= tick`); losing a stack while others remain emits `status_stack_lessened`, while the final stack or a non-stackable expiry emits `status_ended`. Current catalogue modifiers wired into combat are Move Speed and Attack Speed penalties, plus effect-specific mechanics for Bleed, Burn, Stun, Disarm, War Cry and Magic Barrier; any additional status mechanic needs explicit field semantics and engine behavior, not just a new JSON row.

Monsters retain their catalogued `atkSpeedTicks` baseline from `monsters.json`; an active Attack Speed penalty adds `penalty * 9 / 800` ticks to that basic-attack interval without applying the character's 10-tick cap. Monster Cast actions are evaluated deterministically each tick. When the first legal Cast-Gambit `use_skill` is selected and in range, the monster starts a pending cast immediately; its duration is `max(0, floor(baseCastTicks))`, defaulting to the legacy six ticks when the catalogue omits the field. Tick 0 is the initial instant, so a four-tick skill selected at T0 resolves at T4. While casting, the monster's basic-Attack gauge is held/reset and no second action resolves. SP is paid and cooldown begins when the skill resolves. Once a zero-cooldown skill resolves, the next legal cast may begin at that resolution boundary, without a second effect resolving on the same tick; this preserves Wailing Wraith Ice Bolt's T2/T4/T6 timing. Monster skills remain catalog-driven and do not use character CTR, equipment or mastery ranks.

Monster mana is a real battle resource. Every monster begins a battle at its catalogue `maxSp`; all current monsters use 60 max SP except `mon_venomviper` and `mon_wraith`, which use 80. Every monster regenerates 2 SP per 10 battle ticks, capped at max SP. Monster-skill costs are declared by `skill_trees.json`: `monster_skill_massive_damage` (Enraged Strike) costs 30 SP, `monster_skill_self_heal` (Regenerate) costs 15 SP, `monster_skill_ice_bolt` (Ice Bolt) costs 10 SP, and `monster_skill_stun` (Ground Slam) costs 30 SP. Costs are paid when the skill resolves; a skill without sufficient SP is illegal, so the monster Gambit evaluator may select its next legal line rather than spending mana it does not have. Battle event resource snapshots include both `spRemaining.character` and `spRemaining.monster`; monster `sp`/`maxSp` and their event values drive the realtime blue mana bar. Mana and skill costs must remain deterministic and snapshot-contained.

A legal character `use_skill` Cast Gambit is evaluated at T0 and every tick. Once a selected skill is legal and in range, effective cast duration is `max(0, ceil(baseCastTicks - CTR / 100))`, defaulting base duration to 2 and allowing zero. A positive-duration cast resolves at `startTick + effectiveCastTicks`; a zero-duration cast resolves in the intention tick. SP is paid and cooldown starts at resolution. During casting, no other character skill, non-skill Cast action, or basic Attack resolves; the Attack gauge is held at zero through the resolution tick and resumes next tick. An out-of-range targeted skill sets movement intent only (no pending cast, SP cost, or cooldown); range is checked again at the next action phase after movement commits. Self/no-target skills skip range checks. The basic Attack action retains its existing two-tick resolution behavior. Monsters keep their existing cast gauge and `baseCastTicks` path unchanged.

Every action, without exception, also has a **cooldown** in ticks after it resolves (`cooldownTicks` for skills; consumable items use `cooldownInSeconds` from `items.json`, converted at runtime to 1-second ticks). A cooldown of N blocks activation for the following N ticks after the action resolves; a new cast cannot start or advance while the action is on cooldown. Cooldown does not run concurrently with a new cast's cast time. The basic Attack's cooldown is `0` beyond its gauge refill. Consumable cooldowns are item-defined; do not hardcode a universal potion cooldown. Outside battle, manual consumable use has no cooldown. During battle, the item's configured cooldown applies. For the specified Wailing Wraith Ice Bolt (`baseCastTicks = 2`, `cooldownTicks = 1`), the initial cast resolves at T2, T3 is blocked, the next cast begins at T4, continues at T5 and resolves at T6; T7 is blocked, the next cast begins at T8 and resolves T10. Resolved Ice Bolt events therefore occur at T2/T6/T10/... rather than every two ticks.

### 7.3 Gambit evaluation per tick

On every tick where a combatant's `attackGauge` or `castGauge` fires:
1. Walk the active gambit page's lines top to bottom, filtered to only lines whose action type matches the gauge that fired (an Attack-gauge fire can only trigger `attack`; a Cast-gauge fire can trigger `use_skill`, `use_item`, `defend`, or `wait`).
2. For each line, evaluate its condition(s) (1 or 2, combined with AND/OR per §8).
3. If the condition is true, check whether the **action is currently legal**: skill unlocked for the equipped weapon AND off cooldown AND enough SP; item present in inventory (`quantity > 0`) AND its cooldown category is free; etc.
4. First line that is both **condition-true** and **legal** executes and ends evaluation for that gauge-fire. A line that is condition-true but illegal is skipped entirely (does not block evaluation, per the confirmed rule) — the next line is checked as if the illegal one didn't exist.
5. If no line qualifies, the combatant does nothing this gauge-fire (gauge still resets and starts refilling toward the next fire). No implicit attack, auto-approach or fallback is added outside the configured legal lines. Movement intent is created only by a legal selected out-of-range action. The separate movement gauge starts at 0 at battle start/T0 and accumulates effective Move Speed on every tick whether or not intent exists. This gauge is only a charging meter: movement requires an active legal out-of-range approach intent. With intent and gauge >= 100, move at most one space that tick, subtract 100 and retain overflow. Without a legal intent, no movement occurs but accrued gauge remains banked; lack of intent must not stop accumulation or erase progress.

A disarmed player character cannot execute its basic `attack` Gambit action. If that is the only otherwise-applicable line, it is illegal and does not create or continue movement intent merely to reach melee range; with no other legal line, the character remains stationary. Active skill/item lines still follow their own normal legality rules. This rule changes player-controlled character behavior only; retain the current monster-specific Disarm movement behavior.

Monsters follow the exact same engine using their own (much shorter, max 2-line) `gambit` array from `monsters.json`.

### 7.4 The Battle Queue — seemless idle

To satisfy "minimum requests, seemless experience" (confirmed design), the server never simulates one battle at a time reactively. Instead:

1. When a character enters a map (or the queue empties), the backend simulates **the next 5 battles in one shot**, chained: battle 2 starts from battle 1's `hpAfter`/`spAfter`/statuses/cooldown states, and so on. Each is written as a `BattleQueueEntry` with real wall-clock `startAt`/`endAt`. Every encounter also has an authoritative search gap before `startAt`: 2 seconds + 0.1 seconds per other character grinding on the same map.
2. The full queue (5 entries, or fewer if a death cuts the chain short — see below) is sent to the client in one payload. The client renders the current battle's bar from `startAt`/`endAt` and has enough data to *know* what's coming next without asking.
3. A **BullMQ delayed job** is scheduled for each entry's `endAt`. When it fires, resolution SHALL lock the Character row and then the BattleQueueEntry row, and apply all authoritative PostgreSQL effects in one transaction: simulated item consumption, XP/HP/SP and level-ups, Diet/Auto Feed, pending equipment substitutions, drops, kill-counter changes, death/Town routing, and any invalidated future rows. The transaction SHALL commit `resolved = true` together with those effects; a failed transaction rolls all of them back, leaving the battle eligible for a safe retry. Concurrent/duplicate jobs serialize on the Character lock; after the first commit, later callers see the retained audit row as resolved and do not apply effects again. BullMQ cleanup, map-presence synchronization, queue generation and Socket.IO publication happen after the database commit and are not used as the payout idempotency primitive. The backend publishes an authoritative `battle:resolved` snapshot containing the completed Character + Inventory state and its `stateRevision`; after queue maintenance, `battle:queueUpdated` carries that same final snapshot and revision so Redis channel ordering cannot expose stale state. The resolved row remains as the §4.7 audit trail and disappears from every live read path when committed as resolved; if remaining queue depth `< 5` and the character is still eligible to grind, the queue is topped back up to 5.
4. **If a battle in the pre-simulated chain ends in the character's death**, everything simulated *after* that point in the chain is simply never generated (the chain naturally stops there) — on resolve, the character is routed to town per §7.6, and no new battles are queued until the player returns to a map.

This means, under ideal "automaticozão" conditions (good gambit, enough potions/food), the client can go minutes without a single request, and the server does a small burst of CPU work only every ~5 battles instead of on every single kill. Auto Feed is evaluated at every authoritative battle-resolution boundary while Grind continues: the server walks the current Diet and consumes every configured food whose digestion has reached 0 and which is available in Inventory, regardless of whether another food buff is still active; the future queue is then rebuilt from the new Character + Inventory state when any food was consumed. When the same `itemId` occurs in multiple retained Diet slots, only its newest retained occurrence determines digestion eligibility. An older expired duplicate SHALL NOT make that food eligible while the newest occurrence is still digesting; Auto Feed skips that candidate and continues checking other foods without treating the normal eligibility conflict as a battle error.

Food expiry projection across unresolved future queue entries is only used to decide whether another future encounter can be appended. A projected buff becoming null because it expires during a future queued battle SHALL NOT move the real Character to Town while the persisted `activeFoodBuff.expiresAt` is still in the future. A battle whose `startAt` is before food expiry may resolve normally even if the food expires during that battle; no subsequent battle may start at or after expiry without an authoritative replacement food. Do not use a fixed expiry grace period, and include the map's encounter-search delay when deciding whether the next battle can start before expiry.

### 7.5 Crash / restart recovery

`BattleQueueEntry` rows are the source of truth, not the BullMQ job state. On backend boot, for every character with unresolved `BattleQueueEntry` rows whose `endAt < now()`, resolve them **synchronously in order** (oldest first) exactly as the scheduled job would have — applying effects, deaths, drops, and level-ups — before accepting new socket connections for that character. Then re-derive the live queue depth and top it back up to 5 if the character is still alive and still on a map. This guarantees zero data loss and zero "free time" exploits from server downtime.

### 7.6 Death handling

A battle outcome is never decided by elapsed time or tick count. `outcome = 'loss'` is valid only when the character's HP reaches 0 (including a simultaneous mutual knockout); reaching any elapsed-time threshold must never cause defeat.

On the `BattleQueueEntry` whose `outcome = 'loss'`:
- `Character.status = 'town'`, `Character.currentMapId = 'map_town'`
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

Battle-log event ownership is explicit: `actor`/`sourceActor` identify who caused an action or status, while `target` identifies the combatant whose state changed. Presentation must name the target for status application, stack changes, expiration, and damage-over-time; it must not use the source actor as the affected unit. For example, Swordsmanship Bleed procced by the character applies to the monster and should read as the monster gaining Bleed; each DoT entry must name the monster as the damage recipient and state the actual damage amount and status. The live Grind feed and Battle History use the same semantics. Do not change the actual target to compensate for a presentation bug.

Bleed contract: Swordsmanship has a 1% proc chance per learned rank, applies at most five independent stacks to the foe, and each stack deals `damagePerStack × Swordsmanship rank` every five ticks (base catalogued damagePerStack = 5, so rank 5 deals 25 pure damage per stack per tick). Bleed damage type is `pure`: it bypasses physical DEF and MDEF and is not run through physical/magic mitigation. Status damage targets the unit losing HP, while actor/sourceActor identify the status source. A successful action can award Mastery XP once regardless of the number of damage components/status procs it generates; DoT ticks never award Mastery action XP.

### Status-effect icon projection and target-aware presentation

The left Character summary's STATUS row and the Grind panel's monster STATUS area display one icon per currently active status from the canonical set: `freeze`, `bleed`, `slow`, `burn`, `stun`, `disarm`, `war_cry_def`, and `magic_barrier`. Status icons are derived from the battle's initial combatant snapshot plus status events through the currently elapsed tick; a status appears, stacks/refreshes, and disappears as its recorded application/expiry is crossed in real time. The monster panel must not render only the initial snapshot's status list. Show stack counts for stackable statuses and expose a status tooltip with its name, current count, remaining duration and relevant catalogued effects. The existing `/assets/ui/freeze.svg` asset and badge frame are retained, but its “Fre” lettering is replaced by a centered snowflake; preserve its blue palette, size, position, and real-time behavior. New effect icons use the provided `project/status_icons.png` references: Burn [4,1], Freeze [4,2], Bleed [9,1], Stun [9,4], Magic Barrier [11,7], War Cry [11,9], Disarm [12,9], Slow [13,9] (row/column, 1-based).

A status icon is a presentation of the authoritative battle log, not a client-side status simulation. Event reducers must honor `target` for which combatant owns a status and `sourceActor`/`actor` for who applied it. Damage-over-time logs must state the target, status name, and actual damage; a character-caused status on a monster must never be shown as a status on the character. The current canonical Bleed definition is 5 × Swordsmanship rank pure damage per stack every five ticks, max five stacks, with a 1%-per-rank application chance. New status icon references map 1-based atlas coordinates in `project/status_icons.png`: Burn [4,1], Freeze [4,2] (reuse `/assets/ui/freeze.svg` with its existing frame/blue palette/footprint, but replace “Fre” with a centered snowflake), Bleed [9,1], Stun [9,4], Magic Barrier [11,7], War Cry [11,9], Disarm [12,9], and Slow [13,9]. The Freeze badge keeps its present size, position and realtime behavior, replacing only “Fre” with a snowflake. For the other status icons, crop the referenced sprite with background removal when it remains clean at UI size; otherwise draw an original matching SVG. Both Character STATUS and the monster STATUS area show the active timeline state (initial snapshot plus events through the current battle tick), including stack count and tooltip; they must not depend only on the opening snapshot.

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
- Switching the active page is allowed during an active battle. Persist the new active page immediately, preserve the immutable active battle and its BullMQ job, invalidate only stale future entries, and rebuild the future queue after the active battle resolves. When no battle is active, rebuild immediately through the BattleService-owned mutation boundary.

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

### 8.5 Frontend availability

Gambit item choices show only item IDs known to the character; item quantity remains an independent execution-time check. A character's known-item list is seeded from William's canonical vendor stock and updated idempotently on authoritative acquisition. The active-skill picker shows learned active skills only; passive skills are never Gambit actions. A saved skill line can be temporarily unavailable when the required weapon is not equipped; the editor shows a warning icon and the agreed tooltip, and the runtime skips that action without rewarding Mastery XP. Grind's active Gambit title shows a warning only when the active page contains a skill line disabled by missing equipment, and clicking it opens that Gambit page.

---

## 9. Mastery Skill Trees

skill_trees.json is the canonical definition source for eight Mastery categories with exactly two current skills each (16 player skills total), plus the existing monster-only skills. Skill progression is purchased with Mastery points; the retired automatic unlock schedule at proficiency levels 1/5/10/20/30/40/50 does not apply.

Each category has node 1 and node 2. Node 1 accepts ranks 1–5. Node 2 is unavailable until node 1 is rank 5, then accepts ranks 1–5. Each category grants one point per Mastery level gained, for a maximum of ten points at Mastery 10. The data/validation contract must support per-skill maxRank from 1 through 10 even though current nodes use five ranks. A passive only operates while the source equipment is present in the immutable battle snapshot. An active skill is usable only when it is learned at rank 1 or greater, its required equipment is present, enough SP is available, and its cooldown is ready. Its Gambit line remains saveable but is unavailable when a requirement is not met. The one-time rollout reset clears every existing row's allocated skill ranks and spent-skill-point count while preserving each category's XP and level; every point earned at the preserved level becomes available again. The cheat endpoint `POST /reset-skilltree/:characterName` performs this same reset transactionally for one exact, unambiguous character name and is development/administrative-only.

The exact current effects, costs, cooldowns, status behavior, and position interactions for Swordsmanship/Power Strike, Brutality/Heavy Swing, Double Strike/Blinkstrike, Shield Bash/War Cry, Fire Ball/Fire Blast, Light Wisp/Light of Heaven, Fearless Focus/Violent Shot, and Arcane Dynamo/Magic Barrier are governed by the hand-equipment-mastery-skills OpenSpec change and the skill catalogue. Current combat remains one character versus one monster; do not implement party support, multi-target AoE, PvP, or 5v5 combat as part of this contract. Positional skills must reuse the shared battle-distance-movement API.

Rank-scaled ability contracts: War Cry grants `10 × War Cry rank` DEF for 15 ticks/seconds. Light Wisp (display name renamed from Wisp Flow; stable skill ID remains `wisp_flow`) uses base raw damage `MATK + 25 × Light Wisp rank + floor(current SP before paying Light Wisp's own SP cost / 5)`; sample SP before charging Light Wisp and before any Arcane Dynamo refund from the same action. It must not estimate target-specific final damage in its tooltip.

Arcane Dynamo replaces Stored Essence as Rune node 1; Magic Barrier requires Arcane Dynamo rank 5. Arcane Dynamo is a passive active only while Rune equipment is present in the immutable snapshot. After each successful basic attack or resolved active skill it refunds `2 × Arcane Dynamo rank` SP (ranks 1–5: 2/4/6/8/10), capped by current SP and max SP. Misses, illegal/out-of-range actions that do not resolve, rejected SP/cooldown actions and periodic status ticks do not trigger a refund. Apply one refund per successful action, never per damage component. Retain Stored Essence as deprecated/hidden source/catalog data, not a learnable tree entry. The one-time reset of all existing Mastery allocations clears every category's persisted ranks, including Stored Essence, instead of migrating them; XP and Mastery levels remain unchanged and all earned points become available for redistribution.

Each category's pending Mastery rank draft is local and independent. Switching categories preserves each draft. Apply and Reset operate only on the currently selected category; Reset discards that category's pending additions only, never committed ranks. Apply submits the selected category's draft as one validated/idempotent transaction under `BattleService.runFutureCombatMutation()`; the active battle remains unchanged and only eligible future queue entries are invalidated/rebuilt. Pending `N/max` ranks and next-rank numeric increments are green; after commit they are shown in the normal color. The skill icon itself has no text/card and no tooltip controls. Tooltips show deterministic skill formulas/current rank values and bold every number, but never predict final damage after target DEF/MDEF and random variance.

The category Mastery tree renders each skill as a 64×64 icon only, with node 1 above node 2 and visible connector lines. The visuals must remain extensible to later branches/nodes. Create 16 custom, high-quality PNG skill icons inspired by `project/skill_icons.png` (do not merely reuse unrelated sheet sprites), with the visual subject matching each skill's effect. On `/play/grind`, monsters expose icons for the monster skill IDs referenced by their own Gambit, using the same icon/tooltip pattern. Tooltips open on hover/focus, never contain controls, and show all applicable mechanics; numeric values are bold. When ranks are staged but not applied, rank-aware preview values show the next/current pending values with each increment rendered green, for example `64 (+15)`. After Apply commits those ranks, the ordinary value is shown in the normal color.

Mastery rank allocation is staged, not saved per icon click. Clicking a skill icon stages one rank if the selected category has points and the rank/prerequisites permit it. The visible `N/5` rank increases in green while pending. Apply submits and atomically commits the staged plan; after success the rank is shown in its normal color and tooltips reflect the committed definition. UI Reset discards pending allocations in the selected category only and can never refund an already committed rank. As a one-time data reset during rollout, all existing characters' ranks across all categories are cleared: preserve each proficiency row's character/category identity, `level` and `xp`, set `skillRanks = {}` and `spentSkillPoints = 0`, and do not rerun the reset on application startup. This restores every point earned at the preserved level for redistribution without erasing progress. The development/administrative cheat `POST /reset-skilltree/:characterName` applies the same reset to one exact, unambiguous character name; it is transactional, idempotent, guarded against unauthorized/production access, preserves all category XP and levels, and rejects missing/ambiguous targets without mutation. Mastery XP, levels and available points are per category and never transfer between weapon categories. Successful Apply must use the existing `BattleService.runFutureCombatMutation()` boundary so current battle snapshots/jobs remain untouched and only future queue entries are invalidated/rebuilt.

---


### 9.1 Mastery tree interaction and live progress

The Mastery workspace shows one selected category at a time, with its skill tree on the left and all eight Mastery categories on the right. Each skill node is a 64×64 icon only (no label text inside a rectangular card). The current tree renders node 1 above node 2, connected vertically; node 2 stays below its prerequisite. The layout must accommodate future branching and additional nodes without changing the two-node layout contract. Locked, available-to-learn, learned, and max-rank states must be distinguishable without making the node into a text card.

Hover/focus on a skill icon opens a readable tooltip with the skill name, kind, rank/cap, prerequisite/unlock requirement, description and authoritative mechanical details: SP cost, cast time, cooldown, damage/healing/defense/stat changes, proc chance, stack count/duration, range/position effects, as applicable. Show rank-aware values from the canonical skill definition/resolver rather than duplicating balance numbers in Angular. Every numerical value in skill tooltips is bold. Tooltips must remain keyboard-focusable and avoid clipping beyond the viewport.

Rank changes are staged in the UI. Before Apply, allocation is only a pending frontend plan and has no server/gameplay effects. Reset discards pending changes only; it never refunds ranks/points already persisted by a previous Apply. Apply submits the entire pending plan for server-side validation and atomic persistence, including point totals, category bounds, rank caps, and prerequisites. A valid Apply enters the existing `BattleService.runFutureCombatMutation()` boundary once: saved character/Mastery state changes immediately, the active battle's immutable snapshot/job is preserved, and only stale future battles are invalidated/rebuilt according to that boundary. The exact batch scope (selected category or staged allocations across categories) is resolved in the `refining-hand-equipment-mastery-skills` proposal before implementation.

After every authoritative `battle:resolved` event, the visible Mastery UI reloads the authoritative rows for all categories and updates XP, level, XP-to-next-level, available points, and ranks. The UI never estimates Mastery XP or rank promotion on the client. Reopening the Mastery tab also refreshes from the API.
## 10. Items, Equipment & Inventory

Full catalog in `items.json` (§21): 30 monster parts, 15 consumables, 51 equipment pieces.

### 10.1 Inventory & Warehouse

- Inventory: **50 slots**. Stackable items (consumables, monster parts) stack to **20 per slot**; equipment never stacks (1 per slot). Inventory quantity/count/removal APIs are scoped strictly to `location = inventory` and aggregate all inventory stacks for an item; warehouse stock is never available to combat, Auto Feed, manual use, selling, or other inventory-only operations.
- Warehouse (town only): **10 slots**, same stacking rules. Moving an item between inventory ⇄ warehouse is instant and free, blocked only if the destination has no room (no partial-stack splitting required for MVP — moving a full stack moves the whole stack; if the target stack has room, merge instead of consuming a new slot).
- Gold cap: **1,000,000,000,000** (`numeric(15,0)` column, application-level clamp).

#### Inventory layout, lukting and drag/drop

The same InventoryGrid component is used on /play/grind and /play/character?tab=character; the two screens must share these rules and must not implement separate inventory behavior.

- The Inventory title row uses space-between alignment and contains a Sort control.
- Sort orders catalog item types alphabetically, then each type's items by catalog display name using Brazilian Portuguese, case-insensitive and numeric-aware comparison. itemId and inventory-row ID break ties deterministically. The server persists the resulting row order in slotIndex, assigns occupied items consecutively from slot 0, and leaves all remaining cells empty; it does not merge or split item stacks.
- Dragging an inventory item over another inventory cell highlights only the cell under the pointer. A drop onto an occupied cell swaps the two rows' slotIndex values; a drop onto an empty cell moves the dragged row there and leaves its original cell empty. Dropping outside a valid destination does not change inventory order.
- Inventory slot wrappers define the fixed grid geometry. A CDK drag placeholder must not contribute intrinsic width/height to grid tracks. Dragging over the vendor must not resize the vendor drop-list or move its stock slots.
- The `InventoryGrid` standalone component must import `CdkDragPreview` and `CdkDragPlaceholder`; merely writing their template elements without importing those directives leaves the CDK defaults active. Drag-start/end events hide and suspend all floating item tooltips; the tooltip cannot reopen until a subsequent pointer-enter after the drag ends.
- When an NPC with the vendor capability is selected, dragging any inventory item over the vendor drop-list highlights the whole drop-list with a dashed outline. The highlight is visual only and must not alter layout. Dropping an inventory item still opens the existing quantity/confirmation modal; the sale happens only after confirmation.
- Inventory moves and lukts are authoritative server mutations. The UI applies the returned complete Inventory and Character revision; a layout change must not mutate or rebuild the active battle snapshot or alter item quantity/equipment behavior.


### 10.2 Equipment slots

`head, body, mainHand, offHand, shoes, cape, acceslukyLeft, acceslukyRight`. Weapon/offHand legality is enforced per §5.3.

### 10.3 Equipment stat rolls

Every equipment item **template** in `items.json` defines:
- `fixedStats` — permanent, identical on every drop of that template (e.g. all "Reinforced Chestplate" always give `def: 18, statBonus: {VIT: 2, STR: 1}`). This is what makes a template a Tank piece vs. a Mage piece.
- `randomRollOnDrop` — for all slots **except shoes**: at the moment of drop, roll **one** random attribute from `[STR, AGI, DEX, VIT, INT, LUK]` and a random integer **1–6** bonus to it. This roll is generated once, server-side, using the deterministic per-character PRNG stream (§11.2, same mechanism as monster/drop selection — not a separate `Math.random()`), and stored permanently in `InventoryItem.instanceData` / `EquippedItem.instanceData` as `{ rolledAttribute, rolledValue }`. It never changes again — "eternal" as specified.
- Shoes (`equip_shoes_*`) never roll — their single fixed effect is `elementalImmunity: <element>` (full immunity to that element's status/bonus-damage interactions, per confirmed design; no move-speed effect in MVP).

Equipment tooltips show the actual stats granted by the item instance (fixed stats plus its rolled Attribute, when present). Roll-generation metadata, vendor/economic fields and stack metadata are not presented as granted stats.

### 10.4 Item categories

- **Monster parts** (30): 2 per monster (`common`, `rare`). Sellable to the vendor (never usable as a potion), reserved for future crafting/quest hooks (fields present in schema, unused by any system in MVP — do not build crafting/quests, just don't break the schema by omitting the fields).
- **Consumables** (8): HP potions (S/M/L), SP potions (S/M/L), Antidote, and Greater Elixir (rare drop, heals both pools). All consumables share `sellPriceToVendor: 7` gold as specified. Only the 6 basic potions + Antidote are sold by the town vendor (§12.1); Elixir is drop/market only.
- **Foods** (7): food items whose `effect.type` is `food_buff`. Foods are stackable inventory items and are consumed manually outside battle or automatically by Auto Feed; they are not consumables and cannot be used by Gambits.
- **Equipment**: the static catalogue is authoritative for the complete set of weapon, armor, accesluky, shoe, and Rune templates. The former fixed equipment count predates the Rod/Rune changes and must not be used as a schema constraint.

### 10.5 Foods (buffs) — detail

Foods are 60-minute (`durationSeconds: 3600`) buffs granting passive HP/SP regen per 10 ticks on top of the normal regeneration formula, with varying HP:SP ratios. Every food item has `type: food` and `effect.type: food_buff`. Only one food buff is active at a time in the legacy `Character.activeFoodBuff` fallback, while the Diet's food entries and simulator snapshots determine which food regen bonuses remain active.

The Diet is an ordered window of up to three **unique** food item IDs, oldest on the left and most recently consumed on the right. A food ID must never occupy two Diet slots. Digestion expiry alone does not remove an entry; expired food remains visible until a later successful food consumption changes the window. If fewer than three foods are retained, a new food fills the next slot. Re-consuming a food already retained removes its previous occurrence and moves it to the rightmost slot while preserving the relative order of other retained foods.

When the Diet already has three entries, every successful food consumption advances the window by evicting the oldest/leftmost entry, removing any retained occurrence of the selected food, and appending the selected food at the right. Compute the selected food's next level before eviction: if it was retained at the start, increment its level by one capped at 3; if it was absent, start at level 0. Each retained Diet level adds a flat +1 to every regeneration statistic the food grants: level 0 uses catalog values, levels 1/2/3 use catalog+1/+2/+3 independently for HP and SP regeneration. A food's stars are a streak, not permanent per-food mastery: when it is evicted, its level resets; if later reintroduced after digestion has finished, it starts at level 0. If a retained food is consumed again at ★★★, it remains at ★★★.

Digestion lockout is independent of Diet retention. A food cannot be consumed before its latest `lastDigestUntil` has elapsed, even if its Diet slot was evicted. `dietLevels` therefore records both the level for retained foods and the latest digestion boundary; for an item absent from Diet, its level is 0 and only a still-future digestion boundary may be retained. Legacy Diet JSON containing duplicate food IDs must be normalized to one entry per item without consuming Inventory or losing the highest observed retained star level; newest occurrence determines recency, and a safe latest digestion boundary prevents premature reuse.

Food has exactly two gameplay consumption paths: manual use outside battle and Auto Feed at authoritative Grind progression boundaries; NPC-granted food and simulated food events must follow the same transition contract. Auto Feed normally runs during battle resolution and is also checked by the server-side expiry re-evaluation when no queued battle can legally start before food expires. Food is never a Gambit `use_item` action. Auto Feed consumes only eligible food present in Inventory and is evaluated server-side before Hungry/Town fallback. Inventory lookups used for eligibility must filter `location = inventory` and sum all matching inventory stacks; a food that exists only in Warehouse is unavailable. If inventory/digestion changes between eligibility check and consumption, an `Insufficient item quantity` or `Food is still digesting` conflict is a normal skipped candidate and must not roll back battle resolution. For combat snapshots, `hpRegenPerTenTicks` and `spRegenPerTenTicks` contain only the character's derived base regeneration; active food bonuses stay separate in `foodBuffHpRegenPerTenTicks` and `foodBuffSpRegenPerTenTicks`. BattleEngine adds each food bonus to the base rate once while that food remains active and stops adding it after expiry. Do not fold food values into the base regen fields, because the simulator independently applies the food-buff fields.

---

## 11. Maps, Encounter Queues & Drops

### 11.1 Canonical maps and map board

The canonical map catalog contains one Town entry, `id = map_town`, `type = town`, `isTown = true`. Town is a real gameplay location and participates in map presence, but it is not a grind map and never belongs in encounter pools or grind-entry requests. The current map board contains Town followed by six grind maps: `map_lv_1`, `map_lv_6`, `map_lv_11`, `map_lv_16`, `map_lv_21`, and `map_lv_26`. Coordinates are Town=(0,0), then grind maps at x=1..6/y=0. Every tile has a fixed equal width and height and remains square; the board is one horizontal row and may scroll horizontally on narrow viewports.

Each map is one global room (no instancing). All players grinding the same map share the map-population pressure on encounter search time (§11.4). Town also applies the same derived regeneration rates while the character is alive, capped at max HP/SP. A character may enter Grind without a weapon; the only character-state gate is that the character must not be Hungry (in addition to normal email-verification and map-level requirements).

The canonical map record owns its weighted monster roster and may declare `npcIds`. Every map with `type: "town"` references the same canonical Storage NPC ID; it must not duplicate the NPC definition. Map and NPC IDs are validated at boot or by the repository catalogue validator.


### Definitive world map and exploration (2026-10-18)

The canonical `maps.json` catalogue now defines the first 41-location world: Sierra-Village (`map_town`), four additional Town destinations and 36 grind maps. Root `maps.json` is authoritative and `apps/frontend/public/data/maps.json` is its mirror. Every location has `unlockLevel: 0`; `recommendedLevel` is advisory only. Grid coordinates map to zero-based world cells as `column = x + 7`, `row = 6 - y` (equivalently one-based column `x + 8`, row `7 - y`). The world is 15×13 cells, each 153px, at native 2295×1989 artwork size inside a fixed 761×660 viewport. Cells have no gaps, and revealed clickable locations use a transparent overlay with an inset 1px near-white border.

Each Character stores `discoveredMapIds`; new characters start with Sierra-Village discovered. A discovered map reveals itself and the four cardinal neighbor cells. The fog cells and map tiles use the same zero-based coordinate conversion (`column = x + 7`, `row = 6 - y`); fog-cell coordinates must not use a different vertical origin. Arrival persists the destination ID; the reveal set is derived from canonical coordinates and never stores a per-cell bitmap. The pinpoint follows authoritative `currentMapId`. Town destinations are peaceful and use Town-type checks for access; grind entry keeps email verification and the existing hungry/food gate but has no level gate. Requests during a live battle preserve its snapshot/job and commit the requested destination only after resolution. While a Town request is pending, retain the existing Grind status/panel and show the waiting message; only the resolver's committed destination/status change may switch the panel to Town. Plain Return to Town still targets Sierra-Village.

Migration `1799200000000-DefinitiveWorldMapViewport` adds discovery and remaps legacy `map_lv_*` locations by character level. It is forward-only and must follow the existing stopped-consumer/read-only migration-history audit and queue/presence reconciliation procedure. No migration, live database mutation or deployment was performed in the implementation session. `node scripts/validate-world-map.js` validates the 41 map records, map mirror, grid bounds, zero level gates, Town Storage, roster weights/species references and asset byte integrity. Browser verification and migration integration against an audited database remain rollout checks.

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

- **Epoch rollover:** when `mapKillCount` (or a given monster's `perMonsterKillCount`) reaches **10,000**, increment `epoch` and reset the relevant counter(s) to 0. Because the seed incorporates `epoch`, this "feels" like a fresh 10,000-length sequence without ever materializing one, and — as originally intended — it happens for free, with zero precomputation lag, since nothing was ever stored to begin with. Leaving a Grind map is the second trigger — death and every confirmed departure to Town or another map roll `epoch` forward and reset both counters (§7.6) — so re-entering a map never replays the encounter stream that just ended.

### 11.3 Monster archetype matchups

Each monster in `monsters.json` carries a `damageTakenMultiplier: { melee, ranged, magic }` object. A value `> 1.0` means that damage type is **effective** (easier fight for that build); `< 1.0` means **resisted** (harder). Within each map, the 5 monsters are deliberately spread across: one favors melee (Warrior), one favors ranged physical (Archer), one favors magic (Mage), one is a `sustainPressure` fight that punishes low-healing builds regardless of damage type (favors Priest/Rod builds via its self-heal or poison pressure), and one is `balanced` (no clear weakness — the odd one out, and where two of the game's three "monster with an active ability" fights live: enrage/massive-damage, self-heal, and stun, one per map, never more than one ability-monster per map).

### 11.4 Encounter search time

Every real monster encounter has a server-authoritative search phase before the battle begins:

```
searchTimeSeconds = 2 + (otherPlayersGrindingOnMap * 0.1)
```

The character being queued is excluded from `otherPlayersGrindingOnMap`. The same delay is applied before the first encounter and between every subsequent queued encounter. It is not a separate `BattleQueueEntry`; it is represented by the gap between the previous `endAt` and the next battle's `startAt`. Existing 1-second battle ticks and battle duration formulas are unchanged.

The authoritative encounter-search count is grinder-specific: `status = grinding`, the same `currentMapId`, and `pendingMapTransition IS NULL`. Generic gameplay map presence is location-based: `currentMapId IS SET AND pendingMapTransition IS NULL`, independent of status. Realtime UI presence is a separate Redis-backed runtime cache broadcast through the `/game` Socket.IO gateway whenever map membership changes.

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

Quest dialogue choices are client intents only. The backend re-evaluates character/inventory conditions and applies inventory/character effects atomically in Town. Effects may add/remove inventory items or apply a transient consumable effect immediately without persisting a temporary item. Town-only NPC endpoints and interactions require the canonical physical location boundary `currentMapId = map_town` with `pendingMapTransition = null`; stale `status = town` alone is insufficient. If a Town return is still pending, NPC access remains rejected until Town is finalized.

The Town right Info Panel uses one generic NPC selector. Capability renderers are stacked in deterministic order: vendor/inventory first, quest/dialogue below it. This allows a future NPC to expose multiple capabilities without creating another UI or service architecture.

### 12.1.2 Father Marcelus

`father_marcelus` is a quest NPC. Opening dialogue: "May the light be with us, friend. How are you, fellow adventurer?" Speaking to Marcelus in Town always restores the character to the authoritative maximum HP and SP before the dialogue is returned.

Hungry branch: "I'm hungry..." → "Eat and rest, for the love of god is forever, but you are not." The second choice consumes food immediately. If the character is hungry and has no food item in inventory, the server grants Bread only transiently and consumes it in the same transaction, so Bread never remains in inventory.

Not-hungry branch: "I'm fine, prayer. Came to get blessed for battle." → "The Lord doesn't want blood to be spilled. But I pray you'll return in peace 🙏." This branch has no character or inventory mutation.

### 12.1.3 Blacksmith Loren

`blacksmith_loren` is a vendor NPC with ten visual slots. Its infinite stock contains the nine canonical T1 equipment pieces: sword, greatsword, dagger, bow, staff, rod, shield, physical body armor and magic body armor. Every T1 weapon in Loren's stock costs exactly 2,000 gold; body armor prices remain data-driven. Its greeting is data-driven from `npc_catalog.json`; vendor BUY/SELL remains authoritative.

### 12.1.4 Cecilia

`cecilia` is a quest NPC. Her server-authoritative exchange requires 3 `part_slime_common`, 1 `part_cindergolem_common` and 1 `part_venomviper_common`, and rewards exactly 1 canonical `equip_accesluky_luk_t1` (Worn Lucky Ring). The inventory condition is evaluated when the offer node is returned, so the hand-over choice is available immediately on the first conversation when all materials are already owned. The exchange locks/revalidates Town status and inventory and removes/adds all items atomically.

### 12.2 Warehouse

10-slot personal storage, available only while the character is settled in a canonical `type: town` map with `status = town` and `pendingMapTransition = null`. The canonical Storage NPC monologue is exactly: “You know I have a name, right? But you'll keep calling me Storage anyway.” Transfers are explicit, transactional, row-ID-based whole-stack operations. A stack merges only if its complete quantity and instanceData-compatible state fit one destination stack; otherwise it needs a free slot. On failure the source and destination remain unchanged. Drag/drop and double-click deposit/withdraw stacks; outside Storage selection, Inventory double-click retains its consumable/equipment behavior. Warehouse rows are never a generic overflow destination.

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
| `map:presence` | `{ mapId, playersOnMap }` | absolute realtime population snapshot; emitted when gameplay map membership/count changes; Socket.IO disconnect does not remove a grinding character from gameplay presence |
| `mail:newItem` | `{ unreadCount }` | badge update |
| `market:orderFilled` | `{ orderId }` | so the Market UI can refresh without polling |

### Map population authority

`playersOnMap` is gameplay map presence, not online/socket presence. A character counts while its authoritative Character state has a `currentMapId` and `pendingMapTransition = null`; settled Town residents therefore count on `map_town`, while encounter-search population remains restricted to characters actually grinding on a grindable map. This remains true after Socket.IO disconnect because gameplay map membership is authoritative in persisted Character state.

Map membership changes are the normal realtime trigger: after an authoritative map-state transition is persisted, the shared MapPresenceService synchronizes the previous/new map and emits the absolute `map:presence` snapshot for each affected map. This applies to map entry, future map-to-map movement, Town return, death, food-exhaustion routing, and the deferred Town request that makes the character temporarily ineligible for map presence. Battle start/end alone is not a map-presence trigger.

Redis `map:players:{mapId}` is a timestamped self-healing runtime cache, not gameplay authority. Periodic reconciliation repairs missed writes, process restarts and disconnected grinders; it is a safety net rather than the normal realtime mechanism. The online/socket presence used by a future heartbeat/friends list is intentionally separate from gameplay map presence.

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

The right panel is a single large **Info Panel**. In Town it shows information about the currently selected object/item/map/character context. During Grind it shows the current grind state, monster information, consumable availability, XP progress and battle timing. Mastery is not a separate Town panel.

Exact component composition, dimensions, responsive behavior, visual tokens and states
are defined in `PLAY_WINDOW_SPEC.md`.

### 17.5 Character screen

`/play/character` is the extended character-management screen.

Internal tabs:
1. **Character** — only `Attributes` and `Stats`. Do not render Paper Doll, Build Summary, Equipment, or Inventory in this tab.

The Character tab's six Attributes show the base value plus any authoritative non-base contribution in green `(+N)`. Hovering an Attribute explains which Stats it feeds. The authoritative Character DTO exposes `attributeBonuses` and all Stats, including Magic ATK.

The Stats section includes HP, SP, Attack, Magic ATK, Defense, Attack Speed, Cast Time Reduction, Evasion, Accuracy, HP Regen, SP Regen and Critical.
2. **Gambits** — the full three-page Gambit editor.
3. **Mastery** — the left side shows the selected category's icon-only skill tree (64×64 skill icons, prerequisite connector lines, hover/focus detail tooltips, staged allocation, Apply and Reset); the right side lists all eight categories (Sword, Greatsword, Dagger, Bow, Staff, Rod, Shield, Rune), each with its level and selection state. The selected category's XP, level, XP-to-next-level and available points update after each authoritative battle resolution. Do not show the old Equipment or Inventory panels on this tab.

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

### 17.10 Grind monster artwork

The active Grind panel centers the foe name/level, current battle/tick line, and one transparent creature sprite vertically in that order. Each catalogue monster has its own image under apps/frontend/assets/monsters/<monsterId>.svg, keyed by the stable monster ID rather than its display name; artwork is interpreted from the monster name and designNote. Standard sprite canvas is 167×199 px with a transparent background, rendered below the small battle line instead of the generic target icon. This is presentation only and must not alter battle state, sizing of the HP/SP bars, or encounter selection.

### 17.11 Town NPC portraits and selection reset

In the Town context of the Grind Info panel, each selected NPC has a dedicated transparent pixel-art portrait under `apps/frontend/assets/npcs/<npcId>.png`, on a 167×199 px canvas. Portraits appear centered above the NPC name/capability header and only while that NPC is selected. The NPC selector's initial option is `Choose NPC to interact`; an empty selection is valid and must not be replaced automatically by William or the first entry. Whenever the physical Town map changes (including Town→Town transitions), reset selected NPC ID, dialogue, Vendor stock, Warehouse view, modal, and error state to the default and reload that Town’s NPC catalogue. Responses from requests started on a previous Town must not overwrite the destination Town’s NPC list. Returning from Grind also starts with the default selection. Async stock/dialogue/warehouse responses must be ignored if they belong to an NPC that is no longer selected.

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

- Stat formulas (§5.2): pure input→output tests for `maxHp`, `atk`, the hybrid `def` mitigation curve (flat plus relative components and the 1% floor), and hit chance clamping at its 5%/95% bounds.
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
7. **Backend: character module.** Character creation on first login, attribute allocation endpoint, equipment endpoints (with slot-combination validation from §5.3), eight-category Mastery tracking and skill-point allocation.
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
| `skill_trees.json` | 16 current player Mastery skills (8 categories × 2 nodes) + monster-only skills and legacy attack timing metadata |
| `char_xp_curve.json` | Precomputed character level 1–98 XP table (§6.2) |
| `weapon_xp_curve.json` | Legacy proficiency table retained for migration/reference only; not the Mastery threshold source |

Load all seven at boot, validate their shape, and fail fast on mismatch (§18.2 philosophy applies here too — a malformed data file should crash the boot, not silently degrade).

### Grind synchronization follow-up
- Any request to move to a different map while a started battle remains unresolved is deferred in `Character.pendingMapTransition = { destinationMapId, reason, requestedAt }`; `reason` is `town_request` for Town and `map_request` for Grind. `currentMapId` and Grind status stay at the origin until that battle's authoritative resolution transaction commits. Detection uses unresolved rows with `startAt <= now`, even when `endAt` has passed but the resolver has not committed. Clicking another map replaces the pending destination; an older delayed request may not overwrite a newer `requestedAt`. All future precomputed encounters for the origin are deleted in the same database transaction as the pending intent. The resolver commits the latest destination before building any replacement queue; food exhaustion/death retain their existing Town fallback. Map presence is removed from the origin when the request is accepted and resynchronized at commit.
- Every departure from a Grind map, whether immediate or deferred and whether to Town or another Grind map, increments that origin map's kill-counter `epoch` and resets its map/per-monster counts in the authoritative transaction. Returning later therefore starts a fresh encounter sequence. `map_kill_counters(characterId, mapId)` creation is idempotent under concurrent access (`INSERT ... ON CONFLICT DO NOTHING` followed by re-read). Queue generation, battle resolution's authoritative transaction and map-transition intent use a shared Redis per-character encounter-chain lock, so concurrent writers cannot precompute/commit overlapping encounter sequences.
- The frontend displays `waiting for battle to end to move...` while the server-confirmed transition is pending. After a successful map request it overlays `/project/destination_pinpoint.png` on the selected destination and renders an animated dashed shortest route across cardinally adjacent canonical map nodes from the current location to that destination. The destination pin and route are cleared as soon as the authoritative Character state shows `currentMapId` equals the requested destination, regardless of ongoing combat or stale pending-transition metadata; a fallback to Town also clears the preview. A later Character snapshot must not recreate that cleared preview from the same stale `pendingMapTransition`: reconcile `currentMapId` against both the locally requested destination and the server-pending destination, and suppress the settled stale intent by destination plus request timestamp until a newer successful map intent is accepted. When a map-intent HTTP response arrives after a newer realtime location/pending intent, it must not patch the Character back to the old origin; reconcile against the freshest known Character state before applying any response patch. Arrival is always determined by `currentMapId`, not `status` or map `type`, and this preview contract applies to every supported map type. This is a visual preview only; server map transition behavior remains immediate when no started unresolved battle exists.
- Each Character may persist one explicitly saved Town waypoint in nullable `savedTownMapId`. The `Save here` action is available only while settled in a canonical Town (`status = town`, Town map type, no pending transition); it stores the current Town. The UI then shows non-clickable `Saved ✔` and the saved Town tile displays `/project/T_waypoint.png`, centered within the tile. Every character defaults to Sierra Village (`map_town`) as the saved Town, including existing characters backfilled by migration and newly created characters. The current map click behavior remains unchanged for now; the marker prepares the future saved-Town-only teleport contract.
- Frontend Character, Inventory, and Battle state loads must not allow an older HTTP response to overwrite newer authoritative state received through the realtime game channel.
- Persisted Character HP/SP and Inventory quantities remain authoritative outside an active battle. During an ACTIVE battle, the Character Summary may use a read-only display projection from the immutable queued battle log plus `startAt`/`endAt`; this projection never writes to CharacterStore, InventoryStore, or the server and is abandoned immediately when the battle is no longer ACTIVE.
- `battle:resolved` and the immediately following post-resolution `battle:queueUpdated` carry Character and complete Inventory from the same server state revision. This closes ordering races between their independent Redis pub/sub channels. Realtime snapshots with an older or equal revision are ignored, and HTTP responses that were in flight across a newer realtime update are discarded.
- `GET /inventory` returns `{ items, stateVersion }`, allowing the frontend InventoryStore to reject an older HTTP snapshot relative to the accepted realtime Character revision.


## Future combat roadmap: PvE/PvP up to 5v5

The current MVP battle simulator remains one character versus one monster. Party formation, allied targeting, target switching, group PvP, multi-target AoE and lane-to-lane movement are not implemented by the current duel contract. Future PvE and PvP modes are planned to support up to five combatants versus five combatants. Position, movement, target-selection and multi-target rules must be specified in their own approved OpenSpec changes before implementation; this roadmap does not silently extend current one-on-one semantics.


## Battle distance and movement — implementation contract

The current simulator remains one character versus one monster, but each battle uses an eight-space lane indexed 0–7. Distance is the number of empty spaces between units: `max(0, abs(positionA - positionB) - 1)`, so adjacent means distance 0 and the endpoints mean distance 6. Melee-vs-melee starts at positions 3/4; if either unit is RANGED, they start at 0/7. Positions are local to the immutable precomputed battle and do not represent map movement or frontend-authoritative state.

A character's entry style is frozen from valid enabled Foe Gambit actions: Bow basic Attack or an available ranged skill/item makes it RANGED; Ally/self support does not. Monsters explicitly declare `combatStyle`, `basicAttackDamageType`, `basicAttackRange`, and level-1 `moveSpeedBase` in both monster catalog copies. Character base Move Speed is 50 + level and is shown in the Character page's derived Stats panel; monster effective speed is catalog base + monster level - 1. Monster Evasion has been reduced by 10% from the previously calibrated values, rounded to the nearest integer. The movement gauge starts at 0 at T0 and accrues effective Move Speed every tick regardless of approach intent. It is not itself a movement command: each 100 banked points enables at most one space per tick only while a legal selected out-of-range action requires approach, with overflow retained even when there is no intent. With Move Speed 98, the gauge is 98 at T1 and crosses 100 at T2; with >=100 Move Speed and valid approach intent, movement can occur at T1. Movement resolves after actions, so current-tick range checks use positions from tick start. An out-of-range action sets movement intent but does not emit a `range_blocked` log event and does not spend SP/items or start cooldowns; it also blocks lower-priority fallback on that gauge fire.

Slow remains a reusable canonical status effect: -50 Move Speed for 20 seconds; reapplication refreshes that one status. Ice Bolt is distinct: Wailing Wraith has a melee basic attack usable only at distance 0, but stays stationary while its ranged magical Ice Bolt is legal. Ice Bolt costs 10 SP, has `baseCastTicks: 2`, `cooldownTicks: 1`, and `maxRange: 7` in `skill_trees.json`; that range includes the target's occupied position, so it reaches six empty spaces between positions 0 and 7. The canonical Wraith Gambit preserves `silence → attack` as the conditional first line and Ice Bolt as the otherwise/default monster Cast action. The engine filters each gauge's eligible action type and still validates condition, cooldown, SP and range; do not force Ice Bolt to be the first array entry. The frontend monster catalogue mirrors this Wraith Gambit order without overwriting unrelated catalogue differences. The Wraith cannot make basic attacks while Ice Bolt is legal; if silenced, the fallback approaches only while the player is not adjacent.

Each successful Ice Bolt cast has a seeded 25% chance to apply the `freeze` status to the character (never to Wailing Wraith). Ice Bolt contains `applyStatus: "freeze"` and `statusChance: 0.25`; duration, stackability, maximum stacks, Move Speed penalty, and Attack Speed penalty are defined by canonical root `status_effects.json` and mirrored at `apps/frontend/public/data/status_effects.json`. Freeze currently has five-second per-stack duration, -25 Move Speed and -25 Attack Speed per stack, and a maximum of three active stacks (-75 Move Speed / -75 Attack Speed total). Attack Speed penalties are fixed rating-point subtractions that affect only basic Attack gauge refill, with the effective rating clamped to 0–800 and weapon interval clamped to 1–10 ticks; skill/action cast timing remains unchanged. Slow is a separate non-stackable, 20-second -50 Move Speed status whose reapplication refreshes its duration. Player-facing Battle History and live Grind feeds omit internal `action_suppressed` events and `range_blocked` lines, and show completed movement with the actor's name and an arrow derived from the lane-position delta (`-->` when `toPosition > fromPosition`; `<--` when `toPosition < fromPosition`), so the direction stays correct even if the character and target swap sides. Freeze application is logged as `CharacterName is freezing (N)`. When a stackable status loses a stack but remains active, the log reports `CharacterName's freeze lessens (N)` with the new count; when any status reaches zero stacks or a non-stackable status expires, it reports `CharacterName's freeze ended` (using the actual status ID). Skill log entries in both the live Grind feed and Battle History include their resolved damage. The character summary and Grind monster STATUS area show real-time icons for Freeze, Bleed, Slow, Burn, Stun, Disarm, War Cry and Magic Barrier, with stack counts and catalog-sourced hover/focus details. Freeze keeps its existing asset and frame, but replaces the “Fre” text with a centered snowflake without changing badge size, placement or live behavior. The lane has no UI visualization; group combat, multi-target AoE, cross-lane movement and PvP/5x5 execution remain future work.

## Hand equipment, Mastery, and learned skills

The semantic equipment slots are `mainHand` (primary) and `offHand` (secondary), regardless of the character's persisted `dominantHand` (`right` or `left`). The client mirrors the visual slots for left-handed characters; combat and API slot names do not change. Primary one-handed weapons are Sword, Dagger, and Rod. Greatsword, Bow, and Staff occupy both hands. Dagger is the only secondary weapon; Shield and Rune are secondary equipment. Any secondary item requires a valid one-handed primary. Sword + Sword is forbidden; two Daggers are allowed. Catalogue slot and `twoHanded` metadata are authoritative. A two-handed equip returns a conflicting off-hand item to inventory. Secondary weapon ATK contributes at half value; its other attributes and effects remain full strength.

Mastery has eight fully independent categories: Sword, Greatsword, Dagger, Bow, Staff, Rod, Shield, and Rune. Each category separately owns its Mastery XP, derived level, available skill points, spent points, and learned ranks. XP/actions earned with Bow do not increase Rod Mastery; only eligible actions/defensive rewards for the corresponding equipped category increase that category. New and migrated categories begin at level 0 and 0 XP with no allocated skill ranks. Each category caps at level 10 and earned progression survives death. The canonical cumulative XP thresholds for levels 1–10 are `[5, 10, 25, 50, 100, 500, 20000, 35000, 45000, 60000]`; Level 7 starts at 20,000 cumulative XP. `weapon_xp_curve.json` is legacy/reference data, not the Mastery threshold source. The Character UI shows level-relative progress (`total XP - current level threshold` over the next threshold gap), cumulative XP in accessible detail, and available points as `max(0, level - spentSkillPoints)`. At 1,920 Greatsword XP the display is Level 7, 120 / 2,700 XP, and one point if six are spent. Each level gained in that category grants one skill point for that category only. Each category has two skill nodes: node one accepts five ranks, then node two opens for up to five ranks. The system supports per-skill maximum ranks from one through ten. Mastery rewards are calculated from executed actions and landed defensive actions recorded in the immutable battle snapshot, then applied once in the BattleService battle-resolution transaction. Defaults are 2 XP per two-handed offensive action, 1 XP per occupied one-handed hand per offensive action, and 1 XP for an equipped Shield or Rune per landed incoming action. A basic-attack miss earns no offensive XP.

Current combat remains a single character versus one monster. Positional Mastery abilities use the shared eight-position battle lane and its canonical distance and movement APIs. The battle engine must not introduce a second range or movement model. Current single-target effects remain single-target; party support, AoE, and executable group combat require a separate approved change. Future PvE and PvP may support up to five combatants versus five combatants, with lane, targeting, movement, and area rules specified separately.

The reserved future City respec price ladder is 100k, 200k, 300k, 400k, 500k, 1kk, 2kk, 3kk, 4kk, 5kk, 10kk, 20kk, 30kk, 40kk, and 50kk; later respecs remain capped at 50kk. No Town respec interface is part of this contract.

Precision and Evasion use `79 + floor(total DEX / 3) + modifiers` and `99 + floor(total AGI / 3) + modifiers`. Equipping any Bow multiplies the resulting Precision by 0.5 (rounded down); this is not a tier-specific flat subtraction. Fearless Focus no longer increases damage: a learned rank grants `5 × rank` Precision plus `5 × empty-space distance` at the start of each basic attack. Hit chance is `clamp(100 + Precision - Evasion, 5, 95)`. The Bow penalty applies to derived Precision after attribute/equipment contributions, before Fearless Focus's per-attack bonus.

## Refining hand equipment and Mastery skills — 2026-10-13

This section records the current implementation state of `refining-hand-equipment-mastery-skills`; it does not imply the whole OpenSpec change is complete.

- The Character Mastery UI now stages category-specific target ranks locally, has Reset/Apply controls, hides deprecated skills, and submits one absolute-target-rank request to `POST /characters/mastery/apply`. The API validates the full requested rank map under a locked proficiency row and commits it through `BattleService.runFutureCombatMutation()` once. A failed request leaves the draft available for correction. Visual tree nodes are icon-first with rank/prerequisite labels, but bespoke per-skill PNG art, complete detailed rank-aware tooltips, status lifecycle UI, and realtime mastery refresh after every `battle:resolved` remain incomplete.
- Added migration `1796000000000-ResetExistingMasterySkillRanks`: it clears `skillRanks` and `spentSkillPoints` for existing proficiency rows while preserving each row's identity, `level`, and `xp`. The migration is one-time through TypeORM migration tracking and intentionally irreversible. The targeted cheat is available at `POST /reset-skilltree/:characterName`; it requires JWT authentication, is blocked in production unless the JWT user carries `role=admin`, resets all category allocations transactionally, and preserves XP/levels. Verify deployment auth claims before relying on production admin access.
- Canonical and frontend skill-tree JSON now rename the displayed `wisp_flow` skill to Light Wisp while preserving its stable ID, set War Cry to +10 DEF per rank for 15 ticks, hide/deprecate Stored Essence, introduce Arcane Dynamo as Rune node 1, and add the approved monster skill costs. The shared engine samples SP before Light Wisp's cost for its rank-scaled raw damage formula, records pure Bleed DoT, applies the player-only Disarm attack legality rule, banks movement gauge independently of movement intent, and records both combatants' SP. Monster snapshots now initialize from catalogued max SP (60 baseline; 80 for Venom Viper/Wailing Wraith) and 2 SP/10 ticks regeneration; resolved monster skills pay catalogued costs. Sequential cooldown is implemented by extending the stored lockout one bookkeeping tick so the cooldown tick itself is blocked.
- Verification so far: `pnpm --filter @nanommo/shared build` passed; `pnpm --filter @nanommo/api build` passed; `pnpm --filter @nanommo/frontend build --configuration production` passed after moving new Mastery styling into component-scoped inline styles. Angular still emits existing CSS-budget and CommonJS warnings. `git diff --check` must be rerun after final edits. No database migration was executed, no browser-level desktop/mobile review was performed, and no deployment was performed.
- Remaining OpenSpec work includes unifying the two status timeline projections into one shared reducer, testing status stack durations/early removal and reset/monster-SP integration, exporting high-quality PNG variants from the now-mapped illustrated SVG skill assets, completing rank-aware tooltip/tree polish, and browser-level verification. The target-aware log formatters, battle-resolution Mastery refresh, monster SP HUD and monster skill row are implemented. Do not mark the change complete until the remaining work is tested.

## Follow-up — food snapshots, approach timing and tooltip behavior (2026-10-14)

The simulator's HP/SP regeneration contract remains: add base Character regeneration plus the sum of every food whose own Diet digestion window is still active at that tick. For the catalogued Cheese + three-star Bread case this is +23 HP and +8 SP per ten-tick boundary (8+8+7 HP; 3+1+4 SP), falling to +15 HP/+7 SP after Cheese expires. A battle already precomputed before a manual food consumption is immutable and must not be patched in place. `POST /inventory/use` now crosses `BattleService.runFutureCombatMutation()` so that, with no active battle, stale future entries are invalidated before a fresh queue can be built from the new food state; the active battle/job is preserved if one is actually in progress.

The live Grind and Battle History feeds show resource-specific regeneration amounts. Separate `regen` events for HP and MP/SP at the same tick are not duplicate HP regeneration. Movement intent is recalculated every tick independently from action-gauge fires; it only moves when a legal out-of-range target action requires approach and movement gauge reaches 100, and intent is cleared when no legal target action remains. Mastery and Character status tooltips use the shared floating tooltip directive; it supports pointer hover and keyboard focus and displays Mastery prerequisites by skill name. Illustrated per-skill SVG files are included in Angular's production build output. These corrections were built and locally tested on 2026-10-14, but not deployed or visually checked in a real browser; the deployed production bundle is unchanged until published.


## Live combat log and status-tooltip regressions — 2026-10-14

The live Grind battle feed renders a monster `sp_regen` event as `{monsterName} regenerates {amount} SP.`. This live-feed copy change does not alter the Battle History formatter. Monster status icons remain visible independently of tooltip markup: never put the global `item-tooltip` hiding class on the icon wrapper itself. The icon timeline is derived from the initial monster snapshot plus battle log events targeting `monster`, and icons must appear/stack/refresh/disappear as the current elapsed tick crosses application and expiration events. Character status icons use one shared floating-tooltip owner per icon; the nested `.status-tooltip` markup must not also instantiate `TooltipPositionDirective`, because competing host/child handlers can hide one another's overlay. Tooltips are available on hover and keyboard focus; no client-side status simulation is introduced.


## Status-event ownership and indefinite-effect timeline — 2026-10-14

For any status applied by a monster skill to the character, the event must record `actor: "monster"` and `target: "character"`; the target owns the status while actor/source identifies who applied it. The Grind monster-status timeline starts from the monster snapshot and applies only events targeting `monster`. An event with neither `expiresAtTick` nor positive `durationTicks` represents an effect with no timed expiry, not an effect expiring on its application tick. Such a status remains visible (with its stack count and an “until removed” tooltip) until an explicit end/stack-removal event or battle end. The Character and Grind status UI must not invent an expiry for a status catalogued with `statusDurationTicks: 0`.

Character and Grind status tooltips must not carry the global `.item-tooltip` class, because that class is hidden with `display:none!important`. Both STATUS rows use the floating overlay, owned only by the icon wrapper and never by nested `.status-tooltip` content. This keeps the tooltip viewport-aware and out of scroll-container clipping while avoiding competing show/hide handlers.


## Stable identity for live status tooltips — 2026-10-14

The Character summary and Grind monster-status lists are recomputed from a display clock every 250 ms, producing fresh result objects. Both `*ngFor` loops must use `trackBy` keyed by the stable canonical status ID (`status.id` for Character, `effect.id` for monster statuses). Without this, Angular destroys and recreates each icon wrapper on every clock update; that tears down `TooltipPositionDirective`, removes its floating overlay, and may leave the pointer hovering over a replacement node that never receives a new `pointerenter`. Keep the wrapper stable while allowing stack counts and tooltip content to refresh. Each icon wrapper remains the sole tooltip lifecycle owner; the nested `.status-tooltip` is content only, and the viewport-aware shared overlay remains the only visible tooltip.


## Heavy Swing, Disarm, and cast-action priority — 2026-10-14

- **Brutality** is a passive that grants only +6 STR per learned rank. It has no Disarm chance or other status proc.
- **Heavy Swing** deals physical raw damage `(ATK × 1.1) + (20 × rank)`; the normal physical defense, archetype modifier, and direct-damage variance still apply. It applies the canonical `disarm` status with 100% chance when the target survives the hit. Duration is rank 1–5: 3, 6, 9, 12, and 15 battle ticks (one tick is one second). Status ownership, refresh behavior, and expiration logging remain governed by `status_effects.json` and the shared `applyStatus` path.
- The independent Attack and Cast gauges must not let a selected, ready, in-range active skill resolve alongside a basic Attack on the same tick. When a legal character `use_skill` is selected and in range, its immediate intent takes action priority; the basic Attack gauge is held/reset during casting and through resolution. Once the skill resolves, basic Attack gauge progress resumes on the following tick. The same legal-action and lane-distance rules still drive approach movement: a melee skill establishes approach while out of range, but upon arrival the selected skill resolves first, without a same-tick basic Attack.
- Canonical `skill_trees.json` and `apps/frontend/public/data/skill_trees.json` must agree on these definitions. Heavy Swing's pre-existing local balance settings are preserved: SP cost by rank is 30/35/40/45/50 and cooldown is 25 ticks.


## Monster and map catalogue ownership (2026-10-16)

`maps.json` is the canonical source of map topology and encounter presence. It contains Town at coordinates (0,0) and six grind maps named only `lv. 1`, `lv. 6`, `lv. 11`, `lv. 16`, `lv. 21`, and `lv. 26`, at (1,0) through (6,0). Each map declares `coordinates`, `isClickable`, `type`, `is_town_border`, `description`, `monsters_quantity`, and `monsters`, where each roster entry references a monster ID and its percentage presence rate. `monsters.json` defines species only and SHALL NOT own a map reference. Every monster of level 1–30 belongs to exactly one of the six non-overlapping level bands; monsters above level 30 remain unassigned for future maps.

Standard monster `xpReward` is `round(round(18 * level^1.15) * 0.75)`; Thornsprout is the exception at `round(round(18 * 5^1.15) * 0.30)`. Current balance override: all monster HP values are halved (rounded to the nearest integer, minimum 1), and monsters of levels 1–6 receive +30% `xpReward` (rounded to the nearest integer). This does not change the character XP curve or global `GRIND_XP_RATE`. The shared attribute is LUK/luk. Element and weapon-category damage-taken multipliers, special skill chance properties, and monster materials are catalogue data; the server validates map rosters and weights at boot.


## Storage, map board, drop-capacity and high-level monster HP corrections — 2026-10-16

- Canonical maps use a single horizontal row: map_town=(0,0), then map_lv_1, map_lv_6, map_lv_11, map_lv_16, map_lv_21, map_lv_26 at x=1..6/y=0. Tile boxes are fixed squares and may overflow horizontally on narrow viewports.
- Map records may declare npcIds; every type: "town" map must reference the canonical storage NPC. Storage monologue is exactly: "You know I have a name, right? But you'll keep calling me Storage anyway." Storage is not a vendor capability. Town access requires a canonical Town-type map, character status town, and no pending map transition.
- Warehouse transfers must be explicit, transactional, whole-stack operations. A stack may merge only when the entire source quantity fits; otherwise a free destination slot is required. Failure preserves the source. Generic item grants must never silently overflow to Warehouse. A battle drop is granted only if its entire quantity fits Inventory; otherwise that drop is discarded/logged and other rewards and battle resolution continue.
- For newly generated encounters, every monster with level >=15 uses hp = max(1, round(baselineHp * 0.60)); all other monster fields and all monsters below level 15 remain unchanged. Existing simulated queue snapshots and resolved history remain immutable.
- This is the approved implementation contract. Core implementation, offline contract tests, catalog validation and the map-layout browser smoke are complete. Actual PostgreSQL/Redis/Bull integration and authenticated live-battle status-icon visual verification remain environment-dependent; see STATUS.md and openspec/changes/storage-map-and-combat-progression-corrections/tasks.md.

### Vendor selling is scoped to the dragged stack
When a player drags an Inventory stack onto a Vendor, the sell modal maximum and All button are limited to that selected stack quantity, capped by the current owned total. Identical items in other Inventory stacks are not aggregated for the modal maximum. Example: four stacks of 20 potions; drag one stack and choose All => quantity 20. Buying behavior is unchanged.


## Shared status timeline projection — 2026-10-16

Character Summary and Grind monster STATUS must use the same pure `projectStatusTimeline` reducer over the immutable battle opening snapshot and persisted status events. Projection replays eligible events in their stored array order, filters by `target`, applies at the event tick, and hides an effect when `expiresAtTick <= displayTick`. It supports explicit end/expiry, refresh, untimed effects, stack count changes, and independent stack expiry; newer expiry events identify the removed stack by its expiry/application ticks. UI projection never mutates battle logs or runs combat rules. Unknown status IDs remain displayable without catalogue coupling; their icon path is still subject to the asset validator.

## Mastery level reconciliation and Town reset migrations — 2026-10-16

`1799000000000-ResetAllCharactersToCurrentTown` is a forward-only migration and must run with API/queue consumers stopped. It sets all characters to `map_town` / `town`, increments `stateVersion` when authoritative location/transition state changes, deletes unresolved future projections, and preserves the earliest unresolved entry that has already started/due, with a pending Town transition so it resolves before final settlement. Resolved battle history is never changed. `1799100000000-ReconcileMasteryLevelsForCumulativeXp` updates only the stored Mastery level derived from cumulative XP and the canonical thresholds; XP, row IDs, skill ranks, spent points, and Character state are preserved. Neither migration has a safe gameplay rollback. Queue job removal, authoritative MapPresence/Redis rebuilding, a stopped-consumer maintenance entry point and a fail-closed startup gate are implemented and covered by deterministic tests. The migration must only be run after a live schema/migration-history audit and with all API/Bull consumers stopped; the live database could not be reached in this workstation session.

UI asset paths are catalogue-derived: item IDs require both `/assets/ui/items/svg/<folder>/<id>.svg` and `/assets/ui/items/svg-noframe/<folder>/<id>.svg`; player/monster skills require `/assets/ui/skill-icons/<id>.svg`; statuses require `/assets/ui/status/<id>.svg`. Run `pnpm --filter @nanommo/frontend validate:ui-assets` and `node scripts/validate-storage-map-catalog.js` to validate current catalogues and mirrors.


## Guarded migration history and queue maintenance — 2026-10-16

Normal API startup SHALL NOT auto-run TypeORM migrations or schema synchronization. The canonical DataSource uses `migrationsRun: false` and `synchronize: false`. Before a worker can process jobs, startup acquires a distributed Redis maintenance lease, closes the shared queue gate, globally pauses Bull and drains active jobs, then inspects migration history through read-only catalog/SELECT queries. Do not call TypeORM `DataSource.showMigrations()` for this preflight; TypeORM may create the migration-history table when missing. Startup fails closed while migration history is missing/empty with pending migrations or while any incremental migration remains pending. It only opens the Redis gate and resumes Bull after queue/job and MapPresence reconciliation completes.

`pnpm --filter @nanommo/api db:migration:show` is a read-only audit; it reports whether the TypeORM migration table exists, the recorded rows and the pending class names without creating the table. A pre-existing schema with empty migration history SHALL NOT trigger blind replay of every historical migration. After manually comparing the live schema and data to migration effects, an operator may use the guarded `db:migration:baseline` command to record a chronological prefix ending at the exact last legacy migration whose effects were independently verified. This explicit tool only writes migration-history metadata, requires all API/Bull consumers stopped plus `CONFIRM_LIVE_SCHEMA_AUDITED=1`, and refuses to baseline the new Town-reset or Mastery-reconciliation migrations. Do not guess the boundary.

Only after the baseline is known safe may an operator run `BATTLE_QUEUE_MAINTENANCE_ONLY=true CONFIRM_QUEUE_CONSUMERS_STOPPED=1 pnpm --filter @nanommo/api db:migrate`. Then run `BATTLE_QUEUE_MAINTENANCE_ONLY=true CONFIRM_QUEUE_CONSUMERS_STOPPED=1 pnpm --filter @nanommo/api reconcile:battle-queue` while all consumer processes remain stopped. That context registers no Bull processors, reconciles DB rows, delayed jobs, stale battles and Redis presence, and intentionally leaves Bull paused with the gate closed. Restart the normal API/worker service last; regular startup repeats preflight/reconciliation and only then opens the gate/resumes Bull. If the database cannot be reached or migration baseline is unknown, stop; do not migrate, baseline, start workers or deploy by guessing.

## Verification boundary — 2026-10-16

Offline validation includes shared/API builds, production frontend build, focused inventory/Storage/drop/queue/presence/status/Mastery/migration contract tests, ChromeHeadless component tests, catalogue validators, strict OpenSpec validation and a Playwright Chromium map-layout test at desktop/mobile widths. The configured database hostname `db` failed DNS resolution from the workstation before a DB connection (`EAI_AGAIN`); no live database schema/data or migration table was changed. PostgreSQL/Redis/Bull end-to-end recovery and a full authenticated status-icon battle visual smoke remain unverified until a host/container with those services is reachable. No database migration or deploy was performed.

### World map interaction refinements (2026-10-19)

Map tiles must preserve native click targeting while the viewport supports drag panning. A drag suppresses the synthetic click, and a click dispatches the selected map ID through the viewport's delegated handler. Mouse-wheel zoom is only handled while the pointer is over the viewport, is anchored to the cursor, and ranges from 100% down to 50%; panning and centering use world-space camera coordinates at the current zoom. The current map header is a transparent overlay inside the viewport; the viewport remains fixed-height and any remaining panel space below it stays reserved/empty. Map tooltips are immediate, use the shared dark/bronze visual language, render outside clipping ancestors, and show the natural-language map name prominently with Recommended level as a subtitle. Map catalogue display names use normal words/spaces rather than internal underscores/hyphens.


## World travel, Gathering, aggression and FLEE — 2026-10-20

This section is the current contract for the `world-travel-gathering-flee` change and supersedes earlier roadmap/catalog notes that FLEE is disabled or that map changes commit instantly. The canonical `maps.json` remains the source of map topology, coordinates and rosters; `apps/frontend/public/data/maps.json` is its mirror. All five Town records have `mapLength: 0`; all 36 current grind records have `mapLength: 25`. Each current monster explicitly declares `isAggressive` and fixed world `moveSpd`; only Slime, Thornsprout, Saltfang Crab and Moonleaf Arcanist are initially non-aggressive. The existing `moveSpeedBase` and monster-level scaling remain exclusively the combat-lane movement contract.

A click to another location creates a persisted server-authoritative route using cardinal BFS over canonical clickable nodes. Neighbor tie-breaking is by map ID so the route preview and backend can produce the same shortest path. `currentMapId`, discovery and location pin remain at the current node until a segment commits; every committed intermediate node is persisted/discovered and presence is reconciled after the database commit. A change of destination keeps the current segment's normalized progress only when its next map ID is unchanged. Clicking the current node cancels the route without undoing any committed arrival. A cardinal Town↔Grind edge is instantaneous in either direction; other edges are timed, with a timed segment length floor of 25 even when a source Town has length zero.

World Move Speed is distinct from eight-space battle-lane movement. Its base is `50 + character level`, then generic equipment/buff flat and multiplicative modifiers and applicable status penalties are applied; effective speed clamps to 0–250. For `mapLength = 25`, constant speed 51 takes 30 seconds, 100 takes 20 seconds, and 250 takes 5 seconds. Interpolate linearly over 51–100 and 100–250; below 51 use `30 × 51 / speed`; timed travel has a five-second minimum and duration scales by `mapLength / 25`. Zero effective speed pauses travel. Progress is persisted as a normalized segment gauge; client clocks are display-only. The `travelIntent` identifies the route or saved-Town teleport and makes Traveling a derived, non-clickable activity, while `lastGrindStance` retains the last selectable Hunting/Gathering stance. An intermediate Town is still in transit: Town NPC and Warehouse operations remain blocked until the route has settled in its final destination.

Clicking the saved Town is an instant teleport intent. When idle, the server commits it immediately; during battle, it activates Traveling and requests parallel FLEE. Normal death respawns at a valid saved Town, falling back to `map_town`; plain Return to Town and food-exhaustion fallback still target `map_town`. Death/teleport clear active travel and Gathering state. These rules do not mutate an already committed map arrival or the immutable combat-lane snapshot.

Every monster-search interval is a seeded inclusive `randInt(2, 6) + playersOnMap` seconds. Population comes from persisted gameplay map presence and includes the current character and disconnected residents; it is not an online socket count. There is no “Searching for monster…” progress indicator. Hunting engages every selected monster. Gathering and Traveling skip non-aggressive monsters without an additional pause; an aggressive encounter receives a pre-combat FLEE roll using the same speed/LUK curve as in-battle escape. A failed pre-combat roll starts a normal battle; during Traveling it is the first failed escape attempt and the next attempt is due ten seconds later.

FLEE is a parallel roll, not a Gambit action, cast or action-gauge consumer; ordinary combat actions retain their normal deterministic schedule. With `r = clamp(characterMoveSpd / max(monsterMoveSpd, 1) - 1, -0.5, 0.5)`, speed chance is `1 + (r + 0.5) × 98` percent. LUK contributes 10% of weighted influence toward `clamp(50 + 2 × (total LUK - 5), 1, 99)`, tapered by `4 × t × (1 - t)` where `t = (speedChance - 1) / 98`; LUK influence is exactly zero at the 1% and 99% speed endpoints. FLEE uses a separate deterministic stream keyed by battle ID and attempt index, so a failed escape cannot advance combat RNG. Destination changes do not reset the ten-second retry deadline; selecting Hunting/Gathering cancels future retries but never rewrites an active battle.

New queued battles store their immutable starting combatant and Inventory snapshot plus the original Gambit/seed, enabling deterministic simulation to a chosen full tick. Successful FLEE is serialized through the same per-character queue lock and Character→BattleQueueEntry lock ordering as normal resolution. If the character remains alive after that tick's ordinary combat effects, the transaction applies only the partial Character/Inventory/food/digestion/status checkpoint, marks the entry resolved with cancellation reason/time, and discards obsolete future queue rows. It does not alter the original battle log, outcome or snapshot and awards no XP, Mastery XP, gold, drops, kill count or death payout. A lethal character tick or an already-ended battle wins instead. Cancelled entries are retained for audit but excluded from active queues, normal win/loss history and reward projections. A legacy active entry without a starting Inventory snapshot fails closed and continues normal combat rather than guessing an unsafe partial state.

While stationary on a grind map, Gathering accrues during both Hunting and Gathering. Its base duration is `max(30, 12 × mapLength + 30 × (playersOnMap - 1) - (gatheringLevel - 1))` seconds, plus one seeded inclusive 0–5 second variance fixed for that cycle. Gathering Level starts at 1; level progression, crafting and recipes are out of scope. Travel and active battle intervals pause the Gathering gauge. Completion makes a deterministic weighted selection from the map's optional 100%-total `gatheringPool`, then grants through normal Inventory capacity checks; a full Inventory discards the collection and restarts the cycle, never redirecting it to Warehouse. Twelve grind maps have initial pools. The `food_blueberry` ID/effect is preserved as Blueberry Jelly, `food_honey` as Honey; Wild Blueberries is a distinct material. Wheat, Cooking Oil, Milk, Sugar, Carrot, Cabbage, Herbs, Honeycomb and Meat are data-only material types. Meat has independent 20% drop entries only on Dire Wolf and Needleback Stalker and never appears in a gathering pool.

Implementation/rollout boundary: this contract does not authorize running migrations, mutating a live database or deploying from a coding session. The forward-only migration is `1799600000000-WorldTravelGatheringFlee`; use the established stopped-consumer, read-only migration-history audit and queue/presence reconciliation procedure before rollout. Browser-level visual testing, live PostgreSQL/Redis/Bull concurrency, migration integration and exhaustive chronological offline catch-up remain rollout/verification requirements; do not infer them from a successful local build.


## World travel, Gathering and parallel FLEE — 2026-10-20

`maps.json` remains the canonical 41-location topology and the frontend copy is a mirror. Every grind map has `mapLength: 25`; every Town has `mapLength: 0`. The map validator requires the value and rejects Town gathering pools. World travel uses stable-ID cardinal BFS over clickable nodes and is independent from combat-lane movement. A Town↔cardinally-adjacent grind edge commits instantly in either direction; other edges use the persisted segment gauge. For length 25, world Move Speed 51/100/250 yields 30/20/5 seconds; the approved piecewise curve applies below/within/above those calibration points, a five-second timed minimum, a zero-speed pause and linear map-length scaling. Segment progress is accrued at the previously stored rate; a speed update changes future fill, and delayed jobs carry the historical segment-completion timestamp forward so offline travel does not lose time at each leg. Speed-affecting updates routed through `BattleService.runFutureCombatMutation()` first rebase progress under the old rate and temporarily pause the route, then install the new rate after the mutation commits.

`Character.lastGrindStance` stores Hunting or Gathering. Traveling is derived from `travelIntent`, never overwrites the saved stance, and Town arrival hides stationary selection without clearing it. The PostgreSQL intent owns destination, route IDs, segment index/progress, accrual time, generation/schedule version, encounter identity and FLEE retry state. Only a segment commit changes `currentMapId`, discovery and MapPresence. Saved-Town click is the sole waypoint teleport; a live battle pauses travel and requests parallel FLEE. Death respawns at a valid saved Town or `map_town`; ordinary Return to Town and food-exhaustion fallbacks remain `map_town`.

The monster catalogue has explicit species-level `moveSpd` and `isAggressive`. World `moveSpd` is not level-scaled and does not replace `moveSpeedBase` for lane combat. Only Slime, Thornsprout, Saltfang Crab and Moonleaf Arcanist start non-aggressive. Deterministic encounter intervals are `randIntInclusive(2, 6) + playersInMap` seconds, with the current character and disconnected persisted residents included. Hunting engages all monsters; Gathering/Traveling skip non-aggressive monsters and make a seeded speed/LUK pre-combat roll against aggressive ones. FLEE is not a Gambit/action: its relative-speed chance is calibrated to 1%/50%/99%, LUK contributes a tapered 10% influence, and each attempt uses an independent stream keyed by battle ID and attempt index. A successful roll replays the immutable battle to the requested tick, applies only that complete resource/inventory/Diet/status checkpoint, marks the row cancelled for audit, and suppresses XP, Mastery XP, drops, gold, kill counts and death payout.

Gathering runs while stationary on grind maps under both stances and pauses for combat or Traveling. Duration is `max(30, 12 × mapLength + 30 × (playersOnMap − 1) − (gatheringLevel − 1))` plus one seeded 0–5 second cycle variance; Gathering Level starts at 1 and does not progress in this change. Twelve grind maps own weighted material pools totaling 100%; inventory capacity failures discard the selected grant and restart the cycle without Warehouse overflow. `items.json.materials` owns the ten cooking/material IDs; Blueberry Jelly and Honey preserve the existing food IDs/effects, and Meat drops independently at 20% only from Dire Wolf and Needleback Stalker. No crafting/recipe execution is added.

Migration `1799600000000-WorldTravelGatheringFlee` is forward-only. Its migration-history audit and PostgreSQL/Redis/Bull integration must follow the guarded stopped-consumer procedure in §18/ARCHITECTURE. Do not run it, write a migration baseline or deploy as part of local coding.
