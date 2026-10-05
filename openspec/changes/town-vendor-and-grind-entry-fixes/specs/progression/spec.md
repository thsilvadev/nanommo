## ADDED Requirements

### Requirement: Character creation bootstrap
New characters MUST start without any equipped weapon. The starter pack MUST contain 50 Small HP Potions and 5 Bread, and no weapon item may be granted or equipped by the creation bootstrap.

#### Scenario: New character starts unarmed
- **WHEN** a character is created
- **THEN** the main-hand equipment slot is empty
- **AND** the inventory contains the existing starter consumables
- **AND** the authoritative level-1 stats are calculated without weapon ATK or MATK

### Requirement: Grind map entry
A character MAY enter an unlocked grind map without a weapon. The character MUST have an active food buff; existing email-verification and map-level requirements remain enforced.

#### Scenario: Unarmed fed character enters Green Grounds
- **WHEN** an email-verified level-1 character with an active food buff enters Green Grounds without a main-hand weapon
- **THEN** map entry is accepted and the character enters grinding

#### Scenario: Hungry character is rejected
- **WHEN** a character without an active food buff attempts to enter a grind map
- **THEN** map entry is rejected with the existing Hungry gate

### Requirement: Blacksmith Loren T1 weapon prices
Blacksmith Loren MUST sell each canonical T1 weapon for exactly 2,000 gold with infinite stock. His body armor stock retains its configured prices.

#### Scenario: T1 weapon stock pricing
- **WHEN** the client requests Blacksmith Loren's vendor stock
- **THEN** sword, greatsword, dagger, bow, staff, wand and shield T1 entries each have buyPrice 2000

### Requirement: Reusable item tooltips
All item surfaces that render an item MUST use the shared catalog tooltip-line generator rather than rebuilding item metadata independently. Vendor stock MUST render the same tooltip content and tier naming rules as Inventory and Character equipment.

#### Scenario: Vendor equipment tooltip
- **WHEN** the player hovers a Blacksmith Loren equipment item
- **THEN** the tooltip shows the item name and its actual granted fixed stats
- **AND** tier coloring follows the shared item tooltip rules
