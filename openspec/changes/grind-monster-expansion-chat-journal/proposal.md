# Proposal

## Why

The current Grind screen has no compact aggression cue on monster sprites, the world roster is missing three requested species, and gathering materials are currently randomized across many maps rather than controlled by regional availability. The existing floating Chat drawer is a stale placeholder; the current chat channel and no-history contract no longer match the requested in-game Global chat and personal Idle Journal.

This change brings these related Grind-facing additions into one coherent contract while keeping authoritative encounters, item awards, chat persistence and UI presentation in their correct layers.

## What Changes

- Add **Mutant Bee** (Lv. 5, aggressive melee), **Giant Mantis** (Lv. 36, non-aggressive melee, 150 Evasion) and **Flaming Treant** (Lv. 38, aggressive melee and fire-immune). Add stable catalogue IDs, level-appropriate but deliberately varied stats, XP, unique common/rare monster parts, drops, icons and transparent 167×199 sprites.
- Add Mutant Bee's **Sting** skill and **Tip of Pain** self-buff: Sting costs 30 SP, has a 15-second cooldown and applies Tip of Pain to the Bee itself; the next basic attack deals 2× ATK and applies Disarm for 10 seconds to the foe if it hits.
- Add the new monsters to their approved map rosters and normalize each affected roster to 100%: Mutant Bee 60% in Green Grounds 1 and 35% in current Green Grounds 4 (the former GG5); Giant Mantis 15% in Caetê 0 and 50% in Kwaiouá Forest 5; Flaming Treant 30% in Kwaiouá Forest 6 and 35% in Kwaiouá Forest 7. Scale each existing roster proportionally into its remaining share.
- Retune Flaming Treant around the level-38 baseline: 40% stronger physical ATK, 20% lower attack rate and 20% lower world Move Speed than the level-38 baseline. Keep its fire immunity explicit in catalogue data.
- Constrain map gathering availability by material and region: Wheat in Green Grounds 0/3; Sugar in Green Grounds 4/5; Cabbage and Carrot in Green Grounds 1/2; Milk in Green Grounds 0; Honeycomb only in Green Grounds 1/4; Wild Blueberries in Menace Hills 1/3; Cooking Oil in Iporá Beach 0/1; Herbs in all Kwaiouá Forest, Forest Ruins and Caetê maps. Grind maps with no assigned material have no gathering pool and can finish a collection cycle without granting an item. Meat remains drop-only.
- Add an aggression badge from the provided red symbol reference to the upper-right of every aggressive monster sprite, with the tooltip: “Aggressive: this monster will try to interrupt your gathering or traveling”.
- Replace the deprecated floating drawer and Global/Town/Party/Whisper assumptions with a chat panel directly below the Grind map. It shows five lines at once, scrolls through retained messages, includes a single-line input and Send button, and submits on Enter. Remove the old header CHAT toggle and stale drawer/mockup.
- Implement Global player chat with cross-instance WebSocket delivery and PostgreSQL history retention controlled by CHAT_HISTORY_RETENTION_LIMIT (default 20) and limited to one accepted message every five seconds per account. Load retained Global messages after page entry/reconnect/API restart. The frontend displays at most the latest 20 messages regardless of the configured server retention.
- Add a personal **Idle Journal** whose messages interleave chronologically with Global chat when enabled. The Journal is enabled by default and the toggle preference is remembered locally. Journal and future transient channels use bounded Redis history, not PostgreSQL; they are scoped so one character cannot see another character's private journal.
- Emit the six approved Journal events from authoritative committed outcomes: gathering awards, passing a non-aggressive encounter during Gathering/Traveling, successful pre-combat dodge of an aggressive monster, successful in-battle FLEE, committed item theft, and food consumption.
- Separate chat responsibilities into validated Global-message handling, PostgreSQL Global history, Redis-only transient history/Journal handling, and thin socket/API adapters. Add a forward-only migration for the Global message table, root/frontend catalogue parity and focused regression tests.

## Capabilities

### New Capabilities

- monster-roster-aggression-presentation: New monster data, their combat behavior, weighted map presence, sprites and aggression badge.
- regional-gathering-materials: Exact regional availability and handling of maps without gathering drops.
- global-chat-idle-journal: Persistent Global history, Redis-only personal Journal/ transient channels, event integration and the below-map UI.

### Modified Capabilities

None. The repository has no registered capability specs under openspec/specs/<capability>/spec.md; this change introduces focused OpenSpec capability deltas rather than claiming an existing registered capability is being modified.

## Impact

Canonical and mirrored monsters.json, maps.json, items.json, skill_trees.json and status_effects.json; monster/item/skill/status icon and sprite assets; the shared battle simulator's next-basic-attack enhancement; gathering award validation; API chat services/controllers and authenticated /game gateway; a PostgreSQL migration/entity for retained Global messages; environment configuration; Grind/map layout and focused catalogue, service, simulator and UI tests.

Implementation must update root SPEC.md, openspec/specs/SPEC.md, ARCHITECTURE.md and STATUS.md when applying the change, without overwriting unrelated existing documentation differences. This proposal session itself does not implement gameplay/UI code, edit canonical docs, execute a migration, mutate the database or deploy.
