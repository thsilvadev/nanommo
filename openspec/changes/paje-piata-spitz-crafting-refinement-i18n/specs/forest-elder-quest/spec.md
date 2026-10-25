## ADDED Requirements

### Requirement: Pajé's Forest Elder quest is level-gated and persistent
The Forest Elder quest SHALL be offered only at Character Level 35 or above, use the existing persistent quest instance and quest log, require five Forest Ancient's Teardrops, and reward one Grounded Boots item plus exactly 31,630 Character XP. The XP award SHALL remain this fixed absolute value regardless of current XP curves. Acceptance, drop progress, turn-in consumption and rewards SHALL be server-authoritative and turn-in SHALL be atomic.

#### Scenario: Character below required level
- **WHEN** a Character below Level 35 selects Pajé
- **THEN** the quest offer/action is not shown

#### Scenario: Character accepts the offer
- **WHEN** a Level 35+ Character chooses the explicit “Estou indo!” acceptance action
- **THEN** one active quest instance is created
- **AND** the optional “O que o senhor fará com essas lágrimas?” explanation branch does not accept the quest

#### Scenario: Active quest receives a tear
- **WHEN** a Character with this quest active defeats mon_flamingtreant
- **THEN** an independent 35% quest drop roll may issue part_flamingtreant_common
- **AND** the item is marked quest-only and stamped with that quest instance ID
- **AND** no teardrop is issued by Flaming Treant to a Character without the active quest

#### Scenario: Existing ordinary drop is replaced
- **WHEN** Flaming Treant's ordinary common-drop entry is evaluated
- **THEN** the old part_flamingtreant_common entry is removed from ordinary drops
- **AND** a new ordinary item, provisionally Charred Treant Bark, drops at the former 35% common rate

#### Scenario: Character turns in five matching tears
- **WHEN** the Character has five tears from this quest instance and turns the quest in to Pajé in Kwaiouá-Taba
- **THEN** the server consumes exactly five matching tears and grants Grounded Boots plus exactly 31,630 Character XP in the same transaction
- **AND** retrying or concurrent turn-in cannot duplicate the reward

#### Scenario: Quest item and reward cannot be transferred
- **WHEN** the quest-only tears or the Grounded Boots quest reward are handled by Market, Vendor, Mail or Warehouse
- **THEN** the quest-owned items are rejected from sale, listing, mail or transfer
- **AND** Grounded Boots receives no rolled attribute bonus
