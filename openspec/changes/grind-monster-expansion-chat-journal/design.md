# Design

## Context

Canonical world records live in root maps.json and are mirrored in apps/frontend/public/data/maps.json. Species, drops and aggression are in monsters.json and its frontend mirror; item definitions, monster skills and statuses are likewise JSON-driven. Every current monster has an individual sprite on a transparent 167×199 canvas. The shared simulator owns actual battle outcomes, while MapService and the world-activity processing path own pre-combat encounter selection, FLEE, Gathering and committed material grants.

The current map validator requires a non-empty gathering pool on every Grind map, and current pools distribute each gatherable material across many regions. This change deliberately replaces that global distribution with regional exclusivity, so the validator and award path must explicitly support maps that have no gathering pool.

The existing chat drawer is placeholder-only. The /game gateway emits Global/Town events directly, while several ChatService methods are unimplemented. The current SPEC says chat is not persisted and has no history on join; that contract is obsolete for Global chat and must be replaced rather than layered on top. PostgreSQL is authoritative for durable Global history; Redis owns transient Journal history and delivery coordination.

## Goals and non-goals

### Goals

- Add three monsters using the existing server-authoritative combat and catalogue patterns without introducing species-name branches into shared simulation.
- Preserve the explicit 100% probability contract for each affected monster roster, with the new species receiving the exact requested share.
- Make item availability on Gathering regional and data-driven, including safe no-drop collection cycles in maps without an assigned material.
- Make aggression discoverable at a glance without changing the existing sprite canvas, foe panel layout or combat state.
- Deliver one Global player channel and one personal Idle Journal in a persistent, responsive below-map chat panel.
- Keep durable Global message history in PostgreSQL and transient personal history in Redis, with bounded retention and well-separated responsibilities.

### Non-goals

- No character progression, crafting recipes or new gathering-level mechanics.
- No redesign of ordinary hit chance, physical mitigation, attack ordering, monster lane movement or world FLEE formulas.
- No Town, Party, Whisper or other player-chat channels in this change. Future transient channels may use Redis, but they are not exposed as active channels now.
- No persistent Journal table, no guarantee that Journal history survives a Redis data loss/flush, and no local-storage persistence of chat message contents.
- No production DB mutation, migration execution, deployment or alteration of active queued battle snapshots during proposal.

## Decisions

### 1. Canonical monster IDs, sprite and drops

Use stable IDs:
- mon_mutantbee — Mutant Bee, level 5.
- mon_giantmantis — Giant Mantis, level 36.
- mon_flamingtreant — Flaming Treant, level 38.

Each species receives common and rare part records in items.json and the public mirror, with stable IDs and matching drop references:
- Mutant Bee: part_mutantbee_common, **Mutant Bee's Stinger**; part_mutantbee_rare, **Mutant Bee Royal Jelly**.
- Giant Mantis: part_giantmantis_common, **Fun Purple Paint**; part_giantmantis_rare, **Giant Mantis Scythe Blade**.
- Flaming Treant: part_flamingtreant_common, **Forest Ancient's Teardrop**; part_flamingtreant_rare, **Flame-Hollow Heartwood**.

Assign each part a distinct, level-appropriate drop chance and sell/base value using the existing monster-part schema. The common/rare item icons must depict the object named by the item, not generic recolored icons. The Mantis common icon depicts a small purple paint container/splash; the Treant common icon is a luminous teardrop of forest sap; the rare icons depict the named stinger/jelly, scythe blade and charred heartwood. Choose reasonable distinct probabilities and prices; don't change the generic drop resolver.

Every new sprite uses the existing /assets/monsters/<monsterId>.svg URL, 167×199 transparent canvas, centered position and asset-validation convention. Mutant Bee is an ominous/insectoid bee consistent with the current pixel-art sheet style. Giant Mantis follows the supplied leg/antenna/body pose and purple details as closely as possible. Flaming Treant shows a burning tree-like creature, visible tears, and a face/posture that conveys rage and desperation at once.

### 2. Monster stat budgets and behavior

Keep all unspecified stats as explicit catalog values, not runtime level-scaling formulas. Use nearby level-appropriate catalogue entries as the baseline and vary individual stats modestly so the three species do not feel like copies. XP uses the current standard curve and the approved low-level exception rule; no new XP formula is introduced.

- **Mutant Bee:** aggressive, melee basic attack. Add monster skill monster_skill_sting named Sting, costing 30 SP, with a 15-tick cooldown and explicit 2-tick cast. The self-target skill applies the self-status tip_of_pain (display name Tip of Pain); it must not apply any status to the foe at cast time. The status modifies the next basic attack only: its raw physical ATK input is multiplied by 2 before normal hit resolution and physical mitigation, and a successful hit applies Disarm for 10 ticks. Consume the enhancement on the next resolved basic-attack attempt; if that attempt misses, it deals no damage and applies no Disarm. The status is applied to the bee itself, expires/consumes after that one attempt, and must be represented in the normal event/status timeline. Define the effect in skill/status data and a reusable simulator mechanism rather than checking the species name in the attack calculation. The monster's Gambit should prefer Sting while its Tip of Pain self-status is absent and the skill is legal, then basic attack; a status-aware legality gate should prevent repeatedly refreshing the buff before it can attack.
- **Giant Mantis:** non-aggressive, melee basic attack, Evasion exactly 150. It does not initiate combat in Gathering/Traveling under existing non-aggressive encounter rules, but remains fightable in Hunting.
- **Flaming Treant:** aggressive, melee basic attack, explicit fire immunity via catalogue elemental resistance. Define its physical ATK at 1.40× the estimated level-38 baseline, attack frequency at 0.80× baseline, and world Move Speed at 0.80× the level-38 baseline. Convert attack frequency to the engine's integer attack interval with documented rounding so a lower attacks-per-time factor does not accidentally make it faster. Keep the final world moveSpd consistent with moveSpeedBase + level − 1; choose moveSpeedBase to represent the slower final value. Do not add magic damage as a substitute for its strong physical hit.

### 3. Exact map presence

For each affected map, scale only the existing monster shares proportionally into the remaining percentage after the requested new-monster share is reserved. Preserve all unaffected monster entries and require final roster totals to equal 100%.

- Green Grounds 1: Mutant Bee 60%, Field Bat 8%, Thornsprout 32%.
- Green Grounds 4 (former Green Grounds 5): Mutant Bee 35%, Field Bat 13%, Mudcrawler 52%. The current Green Grounds 5 (former Green Grounds 6) retains Mudcrawler 95% / Thornsprout 5%.
- Caetê 0: Giant Mantis 15%, Rootbound Brute 8.5%, Moonleaf Arcanist 55.25%, Kwaiouá Ranger 21.25%.
- Kwaiouá Forest 5: Giant Mantis 50%, Rootbound Brute 22.5%, Venom Viper 17.5%, Mudflat Crocodile 10%.
- Kwaiouá Forest 6: Flaming Treant 30%, Arcane Wisp 22.4%, Kwaiouá Ranger 22.4%, Venom Viper 11.2%, Rootbound Brute 14%.
- Kwaiouá Forest 7: Flaming Treant 35%, Arcane Wisp 22.1%, Kwaiouá Ranger 16.9%, Venom Viper 13%, Rootbound Brute 13%.

Keep the maps.json ownership rule: monsters.json defines species only and each map owns its roster. Update the root and frontend mirrors together. Validate each affected ID exists exactly once, references resolve, rates are non-negative, and weights total 100 within the existing tolerance.

### 4. Regional gathering-material assignment

Use the exact allow-list below. When a map lists multiple materials, these default weights give each specified material a deterministic, documented starting distribution; they do not imply recipes or change gathering duration.

- Green Grounds 0: Wheat 50%, Milk 50%.
- Green Grounds 1: Cabbage 40%, Carrot 40%, Honeycomb 20%.
- Green Grounds 2 (formerly Green Grounds 3): Cabbage 50%, Carrot 50%.
- Green Grounds 3 (formerly Green Grounds 4): Wheat 100%.
- Green Grounds 4 (formerly Green Grounds 5): Sugar 80%, Honeycomb 20%.
- Green Grounds 5 (formerly Green Grounds 6): Sugar 100%.
- Menace Hills 1 and 3: Wild Blueberries 100% on each map.
- Iporá Beach 0 and 1: Cooking Oil 100% on each map.
- Every map whose ID belongs to the Kwaiouá Forest, Forest Ruins or Caetê zones: Herbs 100% on each map.

No other map may include those material IDs in its gathering pool. In particular, Honeycomb is gatherable only on Green Grounds 1 and 4; Meat remains excluded from every gathering pool. Other maps with no allowed material have no gatheringPool. The server still completes and resets the authoritative gathering cycle, but grants no item and emits no gathered-item journal entry when the map has no pool. No fallback item and no Warehouse overflow are allowed. The catalogue validators must test the complete per-item allow-lists and accept absent/empty pools only on maps whose exact allow-list is empty.

### 5. Aggression badge

Create a compact badge asset using the second supplied red-symbol image as its visual source. Render it at the sprite container's upper-right corner, not as part of the sprite canvas, with a small dark translucent backing/edge for contrast. A CSS overlay means the underlying 167×199 artwork is not resized or repositioned. Derive visibility only from the canonical monster's isAggressive field; do not create a second aggression list in the frontend.

The badge's mouse-hover and keyboard-focus tooltip text is exactly: “Aggressive: this monster will try to interrupt your gathering or traveling”. Use the existing accessible tooltip approach and ensure it is not clipped by the foe panel or sprite container.

### 6. Chat module and persistence boundaries

Separate responsibilities:
- **ChatService/facade:** validates authenticated send requests, normalizes input, enforces Global-only player messaging, length/rate guards and delegates to the channel-specific history stores.
- **GlobalChatHistoryService:** persists Global messages and provides chronological history from PostgreSQL. It owns retention cleanup and the transaction/locking needed to keep the newest configured number bounded under concurrent sends.
- **TransientChatHistoryService:** stores non-durable channel history (including a character-scoped Idle Journal) in Redis lists with bounded retention. It does not write those records to PostgreSQL.
- **NanommoGateway/controller adapters:** authenticate/authorize requests, delegate to services, and publish/forward messages; they must not implement database/cache retention themselves.
- **IdleJournalService or equivalent event façade:** formats the six supported event types using committed gameplay results, records them in the character-scoped Redis history and publishes only to that character. Gameplay producers must invoke it after the relevant outcome is committed so retry/reconnect cannot award, steal or announce twice.

Global messages contain a stable message ID, sender character ID when still available, a sender-name snapshot, text and server timestamp. Preserve messages if the character is later deleted by retaining the name snapshot and making the historical character association nullable/SET NULL instead of deleting old chat rows. Store messages as plain text; Angular interpolation must render it as text, not trusted HTML. Enforce one accepted message every five seconds per authenticated account and the 200-character maximum server-side. An invalid channel is rejected; only global is a valid player-send destination.

Set CHAT_HISTORY_RETENTION_LIMIT=20 in .env.example and the local .env when present, parse an absent value as 20, and fail startup configuration validation for a supplied value that is not a positive integer. Apply it to PostgreSQL Global history and bounded Redis transient-channel lists. Use an atomic Redis SET NX EX key with a five-second TTL per authenticated account so the throttle also holds across API instances. Retention is independent of presentation: the frontend combines available Global/Journal events by server timestamp and displays no more than the latest 20 combined rows even if the server setting is larger. It shows five rows at once with scrolling. On load/reconnect, load Global history from the database and the current character's Journal list from Redis, then merge chronologically. Global database history remains available after API/worker restarts; Journal has no PostgreSQL durability guarantee and is available only while its Redis history remains.

Create a forward-only migration and entity/table for Global messages. Global sends must be saved before the durable-history operation reports success and then fanned out to connected instances via Redis pub/sub/Socket.IO; publication failures are logged and must not corrupt retained history. Keep all chat payloads authenticated and character-scoped. Retire the stale drawer, its fake welcome messages, the header toggle and obsolete Town/Party/Whisper channel assumptions; don't add a second floating chat window.

### 7. Idle Journal messages and triggers

Messages are generated server-side from confirmed outcomes, with display strings:
1. “You have gathered {gatherQuantity}x {itemName} in {mapName}”
2. “You passed by a {fledMonsterName} and moved on.”
3. “{aggressiveMonsterName} found you, but you misled it!”
4. “You managed to flee the battle against {aggressiveMonsterName}”
5. “{monsterName} has stolen {stolenQuantity}x {stolenItem} from you! Such a shame...”
6. “You just ate {eatenFood}”

Only emit a gathering line for an actual committed item award; a map with no pool, a failed inventory grant or a skipped cycle produces no false success line. The non-aggressive encounter line is generated when Gathering/Traveling skips a non-aggressive roster candidate without battle. The aggressive pre-combat line is generated only after a successful seeded pre-combat dodge. The battle FLEE line is generated only for a committed successful in-battle escape while Traveling/FLEE is active. The theft line reflects actual inventory loss from the authoritative resolved/checkpoint state, not merely a skill attempt; report each committed stolen stack/quantity. The food line fires only after an actual food consumption commit, including successful automatic feeding and successful manual eating. Never infer events on the frontend from timers, inventory polling or battle log presentation.

The Idle Journal toggle is visible beside/within the chat channel controls, enabled by default, and remembered in browser-local preference storage. Turning it off hides Journal rows from the combined chat view but does not stop server-side Journal collection; turning it back on restores any still-retained rows. Global messages always remain visible. When enabled, Global and Journal items are interleaved by server timestamp. The browser preserves scroll position while a user reads older rows and follows new rows when already at the bottom.

### 8. Grind layout and responsive behavior

Place the chat panel in the Grind center column directly below the map, not as a fixed drawer. Turn that column into a vertical flex layout: the map consumes remaining height and the chat receives a measured fixed/limited height sufficient for five message rows, channel/toggle controls and one input row. Avoid nested scrollbars except the message history. Preserve world-map viewport interactions, overlays, gauge and current-map header. The chat must not overlay the map's pan/touch region.

The one-line input submits on Enter and the Send button uses the same validated send operation. Disable duplicate in-flight sends, clear the input only after acceptance, and show a compact transient send/rate/error state. At narrow widths, keep map then chat in normal flow without horizontal overflow; the fixed five visible rows and inner history scroll remain usable.

## Verification and documentation

Test exact map rosters, complete material allow-lists, root/public catalog parity, item/drop references, icon/sprite dimensions/transparency and aggressive badge selection. Simulator tests cover Tip of Pain self-targeting, SP/cooldown, one-hit consumption, doubled raw physical hit before mitigation, Disarm only on a hit, no accidental re-buff before the next attack and unchanged behavior without the status. Chat tests cover concurrent retention, ordering, reconnect/restart Global history, Redis-only character-scoped Journal, rate/length/channel validation, timestamp interleaving and all six event triggers with no duplicate false announcements. UI checks verify exactly five visible rows, at most 20 displayed items, Enter/send-button parity, journal toggle persistence and responsive below-map layout.

Update the canonical SPEC copies, ARCHITECTURE.md and STATUS.md during apply. Any schema migration must be forward-only and tested in a disposable DB; never run it against the live database during proposal/apply. No deploy.
