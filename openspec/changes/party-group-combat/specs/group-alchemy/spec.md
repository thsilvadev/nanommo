## ADDED Requirements

### Requirement: Super Tonics share a persistent sixty-second cooldown
Alchemy SHALL present `super_tonics` separately from Potions and Tonics. Fairy and Sapupema Leaf Tea SHALL share the acting character's `item:super_tonic` cooldown of 60 seconds, preserved across battles and offline boundaries. Fairy SHALL retain self-KO triggering, full HP/SP restoration and complete cleanse, with recipe level 10 and ten Mystic Dust preserved.

#### Scenario: Fairy follows Tea before cooldown expires
- **WHEN** the same actor reaches KO less than 60 seconds after using Tea
- **THEN** Fairy cannot consume or revive until the shared cooldown is available

### Requirement: Sapupema Tea revives an ally without cleansing
The system SHALL craft Sapupema Leaf Tea at Alchemy level 7 from 25 Herbs and eight Sapupema Leaves, awarding 25 Alchemy XP. A legal ally-KO Gambit SHALL consume the acting character's Tea and restore the target to `max(1,floor(maxHp*0.5))` HP and `floor(maxSp*0.5)` SP without removing other effects. Direct targetless self-use SHALL fail without consumption.

#### Scenario: Revive a poisoned ally with odd maximum values
- **GIVEN** a KO ally has maximum HP 101 and SP 51 and poison
- **WHEN** Tea revives that ally
- **THEN** the ally has HP 50 and SP 25, poison remains and only the acting character pays one Tea

### Requirement: Sapupema Leaves preserve regional gathering balance
The system SHALL define localized Sapupema Leaf material and framed/unframed icons. Caetê 6 SHALL give it weight 10 while preserving Herbs/Mystic Dust at 63/27 and total 100.

#### Scenario: Validate resource distribution
- **WHEN** canonical and frontend catalogues are loaded
- **THEN** the leaf material resolves and both catalogues contain the same Caetê 6 pool with positive preexisting resources

### Requirement: Antidote is a level-one Potion
Antidote SHALL use the Potion category and shared Potion cooldown while retaining its poison-only cure. Its recipe SHALL require Alchemy level 1 and two Herbs, subject to normal crafting capacity, reservation and inventory checks.

#### Scenario: Antidote is used during an Elixir cooldown
- **WHEN** the Potion cooldown is still active
- **THEN** Antidote is rejected without removal or changing status effects
