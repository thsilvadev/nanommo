## ADDED Requirements

### Requirement: Pajé Piatã is a multi-service NPC in Kwaiouá-Taba
The Town NPC catalogue SHALL expose Pajé Piatã in Kwaiouá-Taba with vendor and Alchemy capabilities, using the existing portrait convention. His vendor SHALL copy William's current potion/antidote stock and add Greater Elixir for 1,200 Gold. William SHALL remain in his other existing towns.

#### Scenario: Character interacts below quest level
- **WHEN** a Character is settled in Kwaiouá-Taba and is below Level 35
- **THEN** Pajé's vendor and Alchemy services are available
- **AND** the Forest Elder quest is not offered

#### Scenario: Level 35+ Character opens Pajé's services
- **WHEN** a Character is settled in Kwaiouá-Taba and is at least Level 35
- **THEN** the persistent quest can be offered with the branched dialogue
- **AND** Greater Elixir is purchasable for exactly 1,200 Gold

### Requirement: Whitesmith Spitz is a vendor, Blacksmith and refiner in Caelum
The Town NPC catalogue SHALL expose Whitesmith Spitz in Caelum with vendor, Blacksmith and refinement capabilities. His vendor SHALL use the same base stock and prices as Blacksmith Loren and add equip_rune_t1, equip_head_phys_t1 and equip_head_magic_t1.

#### Scenario: Character selects Whitesmith Spitz
- **WHEN** a Character is settled in Caelum and selects Spitz
- **THEN** the vendor, Blacksmith and refinement entry points are visible
- **AND** the three specified T1 items are stocked
- **AND** all capabilities compose in the existing Town NPC panel using his existing portrait
