# Proposal — Quest Standardization

## Why

NanoMMO currently stores dialogue graphs inside NPC records under a `quest` capability. Father Marcelus uses this for a non-persistent conversation, while Cecilia's dialogue contains a hard-coded item exchange and accessory grant. This couples NPC dialogue to one-off quest-like behavior and cannot represent shared, persistent objective progress, quest-specific Gathering/drop rewards, or deadlines.

Quests must become independent data-driven game objects. NPCs remain the actors with whom players interact; a quest may be offered by one NPC and turned in to another, and one NPC may offer many quests with different eligibility requirements.

## What Changes

- Add a canonical `quests.json` catalogue and boot validation, synchronized to frontend public data when needed.
- Define quest eligibility, giver/turn-in NPCs, single-button offer/action dialogue, objectives, optional deadlines/repeatability, and editable rewards in quest data.
- Persist accepted quest instances and objective progress per character; enforce a configurable active-quest limit from environment variable `QUEST_ACTIVE_LIMIT` (default 5).
- Support kill-monster, quest-specific NPC action/talk, delivery of ordinary items, quest-only physical items, and quest item bonuses from Gathering and monster drops.
- Quest Gathering bonuses are additional independent chance rolls; normal Gathering output remains unchanged. Each configured Gathering quest objective must specify a quest-only `containerItem`, whose stack quantity represents successful quest yields.
- Quest-only physical items are inventory items but cannot be sold to vendors, listed or bought on the Market, attached to Mail, transferred to Warehouse, or traded. Enforce restrictions in backend services, not only the UI.
- Quest-reward equipment instances are marked with per-instance quest provenance and cannot be listed on the Market. Existing Worn Lucky Ring (`equip_accessory_sor_t1`) instances remain tradable; the item is removed from all normal equipment-drop pools so future copies are obtainable only through quest rewards.
- Show active quests prominently and completed quest names with their giver NPC in a new Quests tab on the existing Character page. Do not display abandoned or expired quests in that panel.
- Show quest-specific actions in the existing Town NPC dialogue panel. Each dialogue step has exactly one advance/action button; accepting the quest occurs only when the final decisive button is selected.
- Migrate Cecilia's item exchange into a non-repeatable quest. Preserve Father Marcelus's current dialogue behavior, but model his conversation as dialogue rather than as a quest capability.
- Keep quest completion atomic, server-authoritative, and retry-safe. A failed turn-in must not consume required items or partially grant rewards.

## Capabilities

### New Capabilities
- `quest-system`: catalogue, eligibility, acceptance, objective progress, expiry, turn-in, rewards, quest item rules, and the Character Quests panel.

### Modified Capabilities
- `npc-framework`: NPC dialogue and service capabilities remain distinct from quest definitions; NPCs may expose quests associated with their NPC ID without becoming quests themselves.
- `player-market`: reject Market listings based on quest-reward instance provenance; do not block legacy/non-quest Worn Lucky Ring instances by item ID.
- `mailbox`: reject quest-only physical items as attachments.

## Non-Goals

- No general-purpose scripting language or branching dialogue choices. Quest dialogue is a data-driven sequence with one button per step.
- No NPC interactions on Grind maps in this release; quests reference Town NPCs only.
- No unrelated changes to normal drops or Gathering outputs beyond configured independent quest bonus rolls and removing `equip_accessory_sor_t1` from the normal equipment-drop pool.
- No migration execution, live database mutation, or production deployment during implementation.

## Decisions Incorporated

- Objectives can progress concurrently; quest chains use completed-quest prerequisites.
- Quest definitions can configure repeatability and prerequisites. Players may abandon active quests; the abandoned record is not shown in the Character panel, quest-only items for it are removed, and reacceptance follows explicit quest policy.
- Deadlines begin at acceptance and use wall-clock time including offline time.
- Rewards support gold, Character XP, items, and profession XP, with a data contract extensible for future reward types.
- Delivery is all-or-nothing. If the reward cannot fit in Inventory, turn-in fails and no requirement is consumed.
- Character Quests UI emphasizes active quests; completed entries show only quest name and giver NPC. Abandoned/expired entries are not shown.
- Quest-reward equipment carries per-instance provenance so it cannot be sold on the Market. Existing Worn Lucky Ring instances remain tradeable; its normal equipment-drop pool is removed so new copies come only from the Cecilia quest (no migration/backfill is planned, and a future wipe will clear legacy state).
