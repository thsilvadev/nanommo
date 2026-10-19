# Design

## Context

The Mastery interface exists but is a placeholder. WeaponProficiency currently initializes seven categories at level 1 and the legacy skill tree automatically unlocks abilities through weapon levels up to 50. Equipment legality is partly item metadata and partly duplicated hard-coded lists; the catalogue and EquipmentService disagree about Wand's hand usage. The deterministic shared battle engine is single-character versus one monster and has no positional or multi-target model.

See proposal.md for motivation and scope. The companion battle-distance-movement change now defines positions, ranges, movement, Slow and the logs. This change must be applied after that change and must consume its shared position/distance contract.

## Goals / Non-Goals

**Goals**
- One data-driven, server-authoritative contract for item hand usage, ATK contributions, Mastery and skill eligibility.
- Keep combat deterministic and replayable, awarding XP exactly once at the authoritative battle resolution boundary.
- Allow successful future-combat mutations during an active battle without mutating that battle.
- Keep the UI consistent with the existing dark-fantasy shell, item tooltip path and mobile/desktop separation.

**Non-Goals**
- Implement distance/movement in this change.
- Implement party/ally targeting, multi-enemy AoE, PvP, or PvE/PvP 5v5 combat now.
- Add a functional City/respec screen before Cities exist.
- Change character XP, Diet/Auto Feed, hunger/grind eligibility, or unrelated equipment slots.
- Deploy to production.

## Decisions

### 1. Canonical hand and equipment metadata

Use the item catalogue as the sole source of slot and handedness metadata; remove duplicated weapon-name lists. Keep the semantic API/database slot names mainHand (primary) and offHand (secondary). A character's dominantHand changes only the visual presentation and drag/drop highlights.

Primary one-handed weapons: Sword, Dagger and Rod. Primary two-handed weapons: Greatsword, Bow and Staff. Dagger, Shield and Rune can occupy the secondary hand; Shield and Rune are off-hand equipment, not weapons. A secondary item requires an already equipped one-handed primary. Dagger can be in either hand and two Daggers are legal; Sword + Dagger and Rod + Dagger are legal; Sword + Sword is forbidden. Shield or Rune can pair with any one-handed primary. Two-handed items occupy both hands.

When a user begins the first hand drag, highlight the primary slot; once a valid one-handed primary is equipped, permit/highlight the secondary slot for the next compatible drag. Server validation remains authoritative. A 2H equip removes and returns a conflicting off-hand item; an off-hand request must not leave a shield/rune equipped by itself or silently persist an invalid intermediate loadout. Preserve existing staged equipment behavior during Grind, including atomic application at the established boundary.

### 2. Secondary ATK and tooltip

Main-hand weapon ATK contributes 100%; secondary-hand weapon ATK contributes 50%. Only the secondary weapon's ATK is reduced. Its other stats, attributes, and effects stay at 100%. Store the true item ATK in the catalogue and calculate an effective contribution from slot context. The equipped off-hand weapon tooltip shows original ATK struck through and effective ATK, for example ~~120~~ 60 ATK. Use CatalogService.itemTooltipLines() as the single tooltip content path; do not add a separate tooltip implementation.

Double Strike computes its physical base once as attribute-derived ATK without hand-weapon ATK + primary weapon current ATK + secondary weapon current ATK (the secondary current ATK is already half). It doubles that total only when the passive triggers. Do not use a derived ATK value that already includes hand weapon ATK and then add the weapons again. Emit one same-tick damage event with two logged components and a total; it is one action for XP and scheduling.

### 3. Character handedness

Persist dominantHand as right/left. Creation requires an explicit choice and may default the control to right, but must save the selected value. Existing characters migrate to right. The primary hand semantic slot remains mainHand in both cases; a left-handed character's visual primary slot appears on the left and the secondary slot on the right, with slot labels and drop highlights mirrored. Do not swap identifiers in server combat math.

### 4. Mastery and XP event ownership

Replace legacy WeaponProficiency rows/semantics with eight categories: sword, greatsword, dagger, bow, staff, rod, shield and rune. Every category begins at level 0 and 0 XP. Mastery caps at level 10 for this release; points/XP are not lost on death.

For each successfully executed basic attack or active skill action, award configured XP to the categories of equipped hand items that participate in the loadout:
- a two-handed weapon earns 2 XP for that category;
- each occupied one-handed hand earns 1 XP for its own category;
- two Daggers award 1 XP for each hand, so the Dagger category receives 2 XP total;
- a miss awards no offensive-action XP;
- an action skipped because a Gambit skill is not learned/equipped, cooldown is active, or SP is insufficient awards no offensive XP;
- an active ability uses no Accuracy/Evasion and cannot miss under the current rules, so an accepted ability action can earn its action XP even if mitigation/immunity reduces its damage to zero;
- a passive trigger is not a second action and grants no extra action XP.

An equipped Shield or Rune additionally receives 1 defensive XP when an incoming enemy attack/ability is confirmed as landed, including zero damage or magic immunity. A physical miss grants no defensive XP. Apply this only once per incoming action, not per damage component or secondary effect.

Supply defaults through validated API environment configuration:
- MASTERY_XP_TWO_HANDED_ACTION=2
- MASTERY_XP_ONE_HANDED_ACTION=1
- MASTERY_XP_SHIELD_ON_HIT=1
- MASTERY_XP_RUNE_ON_HIT=1

No service may read environment variables from the shared battle engine. Parse them in the API and pass the validated numeric policy into authoritative combat/reward code.

Award Mastery exactly once inside the existing transactional BattleService.resolveBattle flow, after determining which immutable equipment snapshot and logged actions actually resolved. Retried/duplicate resolution must not duplicate Mastery XP. Award based on the recorded battle snapshot, never on the player's current equipment at resolution time.

### 5. Curve and skill points

Mastery starts level 0. The single shared data source supplies each category's level thresholds; the frontend and backend must not independently calculate them. Add a reproducible pace test using current character progression and the canonical effective idle-play assumption to tune thresholds against these checkpoints:
- one two-handed Mastery reaches level 5 around character level 23;
- two one-handed Masteries each reach level 5 around character level 28;
- around character level 50, the reference build reaches level 10 in one category or level 7 in each of two categories.

Each Mastery level gained from 1 through 10 grants one skill point for that category. The first skill begins unavailable at Mastery 0. At Mastery 1, node 1 becomes allocatable; its first point makes that skill active/learned. Node 1 receives up to 5 points. Node 2 is locked until node 1 reaches 5; point 6 can then activate node 2 at rank 1, and points 7–10 raise node 2 to rank 5. Current skills use rank 1–5, but the schema and validation must support per-skill max ranks from 1 to 10 for future content.

The future respec price ladder, reserved for Cities, is 100k, 200k, 300k, 400k, 500k, 1kk, 2kk, 3kk, 4kk, 5kk, 10kk, 20kk, 30kk, 40kk, and 50kk; every later respec remains capped at 50kk. No respec endpoint/UI is introduced in Town.

### 6. Shared ability contract

All active abilities use SP (mana). Active abilities do not use Accuracy/Evasion and do not crit. Immunity/resistance exceptions are future hooks. The current engine has one enemy and no allies; self-target effects work on the character, while enemy effects target the current monster. Ally-target behavior is reserved for party support. Use current combat timing units/clock consistently and keep all effects deterministic in simulation and logs.

- Sword — Swordsmanship (passive): each successful basic attack has chance 1% × rank to add one Bleed stack, maximum 5. Each stack deals 5 × rank damage every 5 seconds until battle end or a future cleanse. No proc on a miss.
- Sword — Power Strike (active): 30 SP, raw physical damage = character physical ATK + 50 × rank, cooldown 10 seconds.
- Greatsword — Brutality (passive): while Greatsword is equipped, +6 × rank STR. Each successful damage event the character causes independently has a 1% chance to disarm the current enemy for 5 seconds; disarm prevents basic attacks. An area of targets is blocked on the distance/movement prerequisite.
- Greatsword — Heavy Swing (active): SP cost by rank 10/15/20/25/30, cooldown 15 seconds, raw physical damage = character physical ATK × rank against the selected target. The nearby-target/AoE portion is blocked on the distance/movement prerequisite; do not emulate extra targets now.
- Dagger — Double Strike (passive): each equipped Dagger adds 5% × rank chance to produce one additional basic-attack component, capped at one additional component total. On trigger, total raw base is (attribute-derived ATK + primary current ATK + secondary current ATK) × 2. Both components occur in the same tick and are reported as one damage event/log message with component sum, not two actions. A single Dagger only adds its own chance; two Daggers double that chance.
- Dagger — Blinkstrike (active): guaranteed hit, raw physical damage = character physical ATK, no extra SP cost, cooldown by rank 100/85/70/55/40 ticks. Blinkstrike does not crit. It can be selected at any distance; on resolution it moves the character to the space directly in front of the target, unless already there, and applies the hit in the same action. It has no separate movement action or SP cost. Use the companion battle-distance-movement position API.
- Shield — Shield Bash (passive): when a landed incoming enemy basic attack occurs at distance 0 (adjacent, directly in front), chance 2% × rank to stun that enemy for 5 seconds. Use the shared battle-distance-movement position API.
- Shield — War Cry (active): 50 SP, cooldown 30 seconds, +20 DEF for 10 seconds. Party aggro behavior is future scope.
- Staff — Fire Ball (active): costs 10 × rank SP; raw magic damage = character MATK + 30 × rank; base cast 3 seconds; cooldown 1 second; 5% chance to apply Burn for 25 seconds. Burn does current character MATK every 5 seconds, does not stack, and reapplication refreshes the expiry.
- Staff — Fire Blast (active): costs 100 × rank SP; raw magic damage = character MATK + 50 × rank; base cast 6 seconds; cooldown 15 seconds; 50% chance to apply the same Burn. Multiple-target explosion is blocked on the distance/movement prerequisite.
- Rod — Wisp Flow (active): costs 5 × rank SP; raw magic damage = character MATK + remaining SP after paying this skill cost; base cast 2 seconds; cooldown 1 second.
- Rod — Light of Heaven (active): costs 20 × rank SP; heals 50 × rank + floor(target max HP × floor(MATK / 20) / 100); base cast 5 seconds; cooldown by rank 9/8/7/6/5 seconds. In current solo combat, target self.
- Bow — Fearless Focus (passive): basic attacks gain `5 × rank` Precision plus `5 × empty-space distance` Precision using the authoritative distance at attack start. It does not modify damage.
- Bow — Violent Shot (active): SP cost by rank 20/40/60/80/100; raw physical damage = 50 × rank; cooldown 15 seconds; pushes the target away to a distance of six empty spaces (the lane maximum). If already at distance six or blocked by the lane edge, it does not move further.
- Rune — Stored Essence (passive): final SP cost = `max(1, floor(base SP cost × (1 - 0.05 × rank)))`.
- Rune — Magic Barrier (active): costs 50 × rank SP; self barrier absorbs 100 × rank magic damage for 300 seconds; cooldown 30 seconds. Allied-target support is future scope.

Staff and Rod intentionally have two active skills each and no invented passive. Shield and Rune are Mastery/equipment categories, not weapon types.

### 7. Accuracy, Evasion and bows

Set derived Precision to `79 + floor(total DEX / 3) + equipmentAccuracyModifier + passiveAccuracyModifier` and derived Evasion to `99 + floor(total AGI / 3) + equipmentEvasionModifier`; with initial DEX/AGI 5 this gives Precision 80 and Evasion 100 before weapons. Equipping a Bow halves resulting Precision (round down), independent of tier; remove the old absolute tier-specific modifiers. Fearless Focus adds `5 × rank + 5 × empty-space distance` Precision to each basic attack and gives no damage bonus. Use the approved hit formula `hitChance% = clamp(100 + Precision - Evasion, 5, 95)`. Monster Accuracy/Evasion remain on the same scale and require representative hit-rate regression tests.

DEX checkpoint: the chosen total-stat formula is one Precision per three total DEX points, normalized by the baseline constant 79 so initial DEX 5 yields Precision 80. Under that exact formula, total DEX 225 yields Precision 154 before a T1 Bow and Precision 79 after its -75 modifier; total DEX 228 is the first threshold that returns the character to Precision 80 with that Bow. Fearless Focus adds `5 × rank + 5 × empty-space distance` Precision at the moment a basic attack resolves; it no longer affects damage. Equipped Bows halve the derived Precision (round down) rather than applying the old tier-specific flat penalties. Active skills do not use Accuracy/Evasion and do not crit. Fearless Focus reads the authoritative distance from the companion battle-distance-movement snapshot.

### 8. Gambit availability and warning state

Store known item IDs separately from inventory quantities. Seed each character's known-item set with the canonical items sold by William. A first authoritative acquisition of an additional item marks it known, idempotently; use one shared knowledge hook for vendor purchases, drops, quests, gifts and other grant paths. Gambit choices show known items only, even when quantity is currently zero; execution separately checks quantity. Do not show unknown catalogue items in the item action picker.

The skill action picker returns only learned active skills. Passive skills never become Gambit actions. A line referencing a learned active skill remains saved if its required weapon is currently unequipped, but is marked unavailable and skipped at runtime. Show ⚠️ on that line with tooltip: “Este gambit não será executado porque a arma necessária não está equipada.” In Grind, show a ⚠️ in the active Gambit title only if its active page has one or more such impossible lines; its generic tooltip says “Há gambits impossibilitados!” and clicking it opens/selects the Gambit page requiring attention. Preserve the existing centralized floating-tooltip path and avoid MutationObserver.

Reset every character's legacy Gambit line customizations. Preserve the three page records, set page one active, clear all old action/condition references, then restore the canonical starter preset on page one: `self_hp_below_percent` `< 30%` → `pot_hp_small`, followed by `always` → `attack`. `pot_hp_small` is sold by William, so it belongs to the known-item default set. The other two pages start empty.

### 9. Migration, Rod rename and Rune catalogue

Migration must atomically rename all stored Wand item/category/skill identifiers to corresponding Rod IDs where such identifiers exist, without duplicate/vanished inventory, mail, market or equipment entries. Search all persisted item/skill references, including pending equipment, market orders/deals, messages and JSON-backed state. Preserve character, account, attributes, currency, inventory quantities, current equipment, map, Diet, quests and other unrelated state. Existing characters default to right-handed.

Three provisional Rune item entries now exist in both the authoritative root items.json and frontend public/data/items.json, with runtime icon paths in both framed/unframed equipment icon folders: equip_rune_t1 (DEF 2, MDEF 10%), equip_rune_t2 (DEF 5, MDEF 20%), and equip_rune_t3 (DEF 10, MDEF 35%). Values are intentionally easy to rebalance by editing the JSON. They are off-hand catalogue data only; equip validation, Rune Mastery, Stored Essence and Magic Barrier still require this change to be implemented. Reset legacy proficiency rows to the eight new Mastery categories at level 0 / 0 XP and zero allocated skill ranks; no old level or Gambit line may grant a free new skill. Keep the new known-item seeding idempotent and do not invent a usable respec/city system.

### 10. Distance/movement integration and release compatibility

The companion battle-distance-movement change defines the canonical eight-space lane, empty-space distance, combat-style classification, separate movement gauge, range-blocked action behavior, Slow and movement logs. This change must be implemented after that prerequisite and must call its shared position/distance contract for Blinkstrike, Shield Bash, Fearless Focus and Violent Shot; do not duplicate movement logic inside the Mastery system.

Do not implement multi-target attacks by duplicating single-target hits; do not add 5v5 combat or ally targeting here. Heavy Swing and Fire Blast stay single-target until a separate group-combat change defines target sets. Keep the future PvE/PvP up-to-5v5 roadmap in SPEC.md and ARCHITECTURE.md.

## Risks / Trade-offs

- [Mastery rewards are duplicated on retry] → Award inside the same transaction/idempotency boundary as BattleQueueEntry resolution and test duplicate delivery.
- [A catalogue item is assigned to the wrong hand] → Drive all validation from one item metadata contract and test all combinations, including staged Grind updates.
- [Wand/Rod migration misses references] → Enumerate every persisted reference and verify row/item counts before and after.
- [The XP curve reaches milestones too early/late] → Keep one versioned threshold table and a deterministic pacing harness instead of separate frontend/API formulas.
- [Positional abilities duplicate movement rules] → Require battle-distance-movement first and route all range/position checks through its shared contract.
- [The tooltip warning is clipped or freezes Firefox] → Reuse CatalogService item-tooltip logic and the viewport-safe shared floating tooltip; no MutationObserver.

## Migration Plan

1. Back up/review existing item and skill identifiers and record counts.
2. Add dominant-hand and known-item persistence; backfill existing characters to right and seed William's canonical stock.
3. Rename Rod IDs and migrate all dependent references; fail loudly if unknown legacy IDs remain.
4. Replace proficiency rows/semantics and reset old ranks/XP; clear legacy Gambit lines, set page one active, restore the canonical William-potion-then-attack starter preset, and leave other pages empty.
5. Deploy only after the distance/movement prerequisite has been agreed, specified and implemented, and after tests prove the in-progress battle snapshot remains immutable.
6. If migration fails, roll back transactionally where possible; never attempt to “repair” by creating duplicate items. Preserve the backup and expose row-count reconciliation in the migration test.

## Open Questions

- Confirm the recommended hit formula (clamp(100 + accuracy - evasion, 5, 95)) before implementation. It matches the 80 vs 100 = 20% miss example, but monster Accuracy/Evasion values must be calibrated to the same scale; retaining the existing 1–16 monster Evasion values would make Bow penalties too weak against most current monsters.
- The DEX math above corrects the arithmetic checkpoint: 225 invested DEX, for 230 total including the initial 5, is needed to gain 75 Precision. If total DEX must be 225 instead, attribute scaling must change from +1 Precision per 3 invested DEX.
