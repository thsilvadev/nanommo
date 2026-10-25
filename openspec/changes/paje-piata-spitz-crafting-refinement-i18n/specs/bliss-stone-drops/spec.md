## ADDED Requirements

### Requirement: Global rare materials drop independently from every monster
The reward resolver SHALL perform independent deterministic global drop rolls for Bliss Stone and Divine Shard on every monster victory, regardless of map or the monster's regular drop configuration. The global rules SHALL be configured separately from individual monster records, preferably in global_item_drops.json. Each item SHALL use its own stable deterministic stream keyed by monster, kill index and global item ID; adding the rolls SHALL NOT alter existing drop results.

#### Scenario: Bliss Stone chance scales by monster level
- **WHEN** a global drop roll is resolved for a monster
- **THEN** Bliss Stone chance is 0.501% at Level 1 and increases by 0.001 percentage point for each level above 1
- **AND** chance is capped at 0.600%

#### Scenario: Divine Shard chance scales by monster level
- **WHEN** a global drop roll is resolved for a monster
- **THEN** Divine Shard chance is 0.0501% at Level 1 and increases by 0.0001 percentage point for each level above 1
- **AND** chance is capped at 0.0600%

#### Scenario: Independent global streams
- **WHEN** either or both global drops are added to reward resolution
- **THEN** each uses a unique stable deterministic stream
- **AND** existing per-monster, consumable-pool, equipment-pool and stat-roll outcomes remain unchanged

#### Scenario: Both global materials are tradable
- **WHEN** a player obtains Bliss Stone or Divine Shard
- **THEN** the item can be listed on the Market and sold to NPC vendors using a configured vendor-sell value

#### Scenario: Global-drop catalogue remains decoupled
- **WHEN** global rare material rules are authored or rates are adjusted
- **THEN** the rules are modified in the global drop catalogue rather than duplicated into every monster's drops list
