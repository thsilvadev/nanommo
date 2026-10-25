# Quest System

## ADDED Requirements

### Requirement: Quests are independent from NPC definitions
A quest SHALL have a stable quest ID and canonical definition independent from NPC records. An NPC MAY offer multiple quests; each quest SHALL independently identify giver and turn-in NPC. NPC dialogue/service capabilities SHALL NOT serve as persistent quest identity or progress storage.

#### Scenario: One NPC offers multiple quests
- **WHEN** the catalogue contains multiple quests for the same NPC with different eligibility rules
- **THEN** the server exposes each currently available quest independently and preserves its own lifecycle/progress

#### Scenario: Different giver and turn-in
- **WHEN** a quest identifies different giver and turn-in Town NPCs
- **THEN** acceptance is available from the giver and completion is available only from the configured turn-in NPC

### Requirement: Quest data is centralized and validated
The canonical `quests.json` SHALL define editable requirements, dialogue steps, objectives, deadlines, repeatability policy and rewards. Boot validation SHALL reject duplicate IDs, invalid NPC/map/monster/item/prerequisite references, invalid probabilities/quantities and unsupported reward definitions.

#### Scenario: Invalid catalogue reference
- **WHEN** a quest references a missing catalogue entry or malformed rule
- **THEN** API catalogue validation fails clearly rather than silently granting invalid content

### Requirement: Active quest limit is configurable
The service SHALL enforce `QUEST_ACTIVE_LIMIT` from the environment, defaulting to 5 when absent. The configured value SHALL be a positive integer and SHALL count active accepted quests, not completed entries.

#### Scenario: Active limit reached
- **WHEN** accepting a quest would exceed the configured active quest limit
- **THEN** acceptance is rejected without creating an active quest instance

### Requirement: Quest offer dialogue has one button per step
Available quests SHALL appear as additional actions in the selected NPC's existing Town interaction panel. Each offer-dialogue step SHALL display NPC text and exactly one advance button. Only pressing the decisive final button SHALL accept the quest and persist its active instance. Merely opening the dialogue SHALL NOT accept it.

#### Scenario: Final acceptance step
- **WHEN** a player follows the single-button dialogue to its decisive final step and presses its button
- **THEN** the server rechecks eligibility and active limit, then creates the quest instance exactly once

### Requirement: Quest state is persisted and server-authoritative
Acceptance, progress, expiry, abandonment, completion and rewards SHALL be checked by the server. Client-supplied progress/reward values SHALL never be authoritative. Repeated/concurrent acceptance or turn-in requests SHALL NOT duplicate quest instances or rewards.

#### Scenario: Level unlock
- **WHEN** a character reaches a quest's configured minimum level and satisfies prerequisites
- **THEN** the quest becomes available from its giver NPC without code changes

#### Scenario: Expired quest
- **WHEN** authoritative time has passed the persisted expiry time
- **THEN** no later progress or reward is granted and the quest's owned quest-only items are removed

### Requirement: Timed quest deadlines include offline time
A configured positive time limit SHALL begin when acceptance is committed. The server SHALL persist the expiry timestamp and count wall-clock time while the character is offline. Client countdowns SHALL be presentation-only.

#### Scenario: Offline expiration
- **WHEN** the character returns after the quest deadline
- **THEN** the quest is expired and cannot be turned in

### Requirement: Objectives support multiple gameplay events
A quest MAY define concurrent objectives for successful monster kills, explicit quest-specific NPC actions, delivery of ordinary items, and quest-only item acquisition. Kill objectives SHALL count only successful victories after acceptance; optional map restrictions SHALL be enforced.

#### Scenario: Kill without quest drop
- **WHEN** a character successfully defeats the required monster but the independent quest-item roll fails
- **THEN** kill progress advances and the item objective advances only if its item is actually granted

#### Scenario: NPC action objective
- **WHEN** an active quest requires a talk/action objective and the player selects the target Town NPC and presses that quest-specific button
- **THEN** the server validates the active quest/objective and advances it once; no dialogue answer puzzle is required

### Requirement: Quest Gathering rewards are additional chance rolls
A Gathering objective SHALL define its eligible map(s), chance percentage, target quantity, and a valid quest-only `containerItem`. Its chance roll SHALL be independent of ordinary Gathering output.

#### Scenario: Successful quest Gathering roll
- **WHEN** an eligible Gathering cycle succeeds its quest chance roll
- **THEN** the server grants/increments the configured `containerItem` stack while still awarding the normal Gathering result

#### Scenario: Failed quest Gathering roll
- **WHEN** an eligible Gathering cycle fails the quest chance roll
- **THEN** the normal Gathering result is still granted as usual and no quest container item is added

### Requirement: Quest monster drops are separate from ordinary drops
Quest-specific monster drops SHALL use a separately configured deterministic chance and SHALL not replace or alter ordinary monster drops. Only eligible active quest instances can receive them, and retry/recovery SHALL NOT award the same result twice.

#### Scenario: Independent monster drop succeeds
- **WHEN** a qualifying battle resolves successfully and the active quest's independent deterministic roll succeeds
- **THEN** the configured quest item is granted once in addition to ordinary drops

#### Scenario: Independent monster drop fails
- **WHEN** the independent quest-drop roll fails
- **THEN** ordinary drops and any qualifying kill objective remain unaffected

### Requirement: Quest-only physical items cannot be traded or stored externally
Quest-only item definitions SHALL be real stackable Inventory items but SHALL be rejected by backend vendor sale, Market listing/purchase, Mail attachment, Warehouse transfer, and player-to-player transfer operations. UI restrictions alone SHALL NOT satisfy this requirement.

#### Scenario: Attempted Market listing of quest item
- **WHEN** a player attempts to list a quest-only item on the Market through any API path
- **THEN** the server rejects the listing before removing the inventory stack or charging gold

### Requirement: Quest reward equipment cannot be listed on Market
Every equipment instance granted as a quest reward SHALL persist validated quest-reward provenance and SHALL be rejected by Market listing even if the base item would otherwise be marketable. This restriction SHALL apply to the specific reward instance, not globally to the base item ID. Existing Worn Lucky Ring (`equip_accessory_sor_t1`) instances without quest-reward provenance remain Market-eligible.

#### Scenario: Listing quest reward equipment
- **WHEN** a player attempts to list a quest-reward equipment instance on the Market
- **THEN** the server rejects it before escrow and leaves Inventory/gold unchanged

### Requirement: Worn Lucky Ring is obtained only through quests going forward
The canonical `items.json` definition for Worn Lucky Ring (`equip_accessory_sor_t1`) SHALL omit `dropPool`, so normal monster equipment-drop resolution cannot select this item. The item SHALL remain a valid equipment reward for Cecilia's quest. Existing inventory instances are not rewritten or migrated and remain tradable until the planned wipe.

#### Scenario: Ordinary monster equipment roll
- **WHEN** the normal monster equipment pool is resolved for any map
- **THEN** Worn Lucky Ring is not an eligible result

#### Scenario: Legacy ring is listed
- **WHEN** a pre-existing Worn Lucky Ring without quest-reward provenance is listed on the Market
- **THEN** the system applies normal Market eligibility and does not reject it solely because of the item ID

### Requirement: Abandonment and repeatability are data-driven
Players SHALL be able to abandon an active quest. Each quest SHALL explicitly define repeatability and reacceptance policy. Abandoning/expiring a quest SHALL remove the quest-only items owned by that instance. A completed non-repeatable quest SHALL not be accepted again.

#### Scenario: Abandonment cleans up quest items
- **WHEN** a player abandons an active quest that owns quest-only physical items
- **THEN** the quest is no longer active, its owned quest-only items are removed, and the quest appears neither in active nor completed UI

#### Scenario: Repeatable quest after completion
- **WHEN** a character completes a quest configured as repeatable and satisfies any reacceptance conditions
- **THEN** the server allows a new distinct quest instance

### Requirement: Turn-in and rewards are atomic
Turn-in SHALL validate the configured NPC, all objectives, required items, expiry, and full reward capacity. Required-item consumption, completion state and every reward SHALL commit atomically.

#### Scenario: Full inventory
- **WHEN** the complete item reward cannot fit into Inventory
- **THEN** turn-in is rejected without consuming requirements, marking completion, or granting partial rewards

#### Scenario: Duplicate turn-in
- **WHEN** two turn-in requests target the same ready quest instance
- **THEN** at most one succeeds and grants rewards

### Requirement: Quest rewards support current progression types
Quest reward definitions SHALL support gold, Character XP, item rewards, and profession XP for supported professions, with a typed extension point for future reward types. All amounts and item references SHALL be server-validated.

#### Scenario: Profession XP reward
- **WHEN** a quest configured with profession XP is turned in successfully
- **THEN** the specified supported profession's authoritative XP is incremented exactly once within the completion transaction

#### Scenario: Item and currency rewards
- **WHEN** a quest grants gold, Character XP, and item rewards
- **THEN** all configured rewards are applied exactly once or none are applied if validation fails

### Requirement: Character Quests panel
The existing Character page SHALL add a `tab=quests` tab. It SHALL focus active quests, showing objectives/progress, optional deadline, reward summary and turn-in NPC. A separate completed section SHALL show only quest title and giver NPC. Abandoned/expired quests and filtering controls SHALL not appear in this panel.

#### Scenario: Completed quest display
- **WHEN** a quest is completed
- **THEN** it appears in completed history with only its name and giver NPC; detailed progress stays focused on active quests
