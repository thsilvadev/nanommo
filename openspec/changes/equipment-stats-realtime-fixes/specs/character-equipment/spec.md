## ADDED Requirements

### Requirement: Authoritative equipment contributions in Character state

The Character DTO MUST expose total non-base Attribute contributions in attributeBonuses with keys STR, AGI, DEX, VIT, INT, and SOR. The contribution MUST include fixed item statBonus and equipped-instance rolledAttribute/rolledValue.

#### Scenario: Equipped rolled Attribute is reflected

- **WHEN** an equipment instance grants fixed SOR +2 and its instance roll grants SOR +4
- **THEN** Character.attributeBonuses.SOR is 6
- **AND** the Character Attributes presentation can render the base value followed by green (+6)

### Requirement: Magic ATK is authoritative

The Character DTO MUST expose Magic ATK using the shared formula matk = floor(INT * 2) + weaponFixedMatk, where INT already includes equipment Attribute bonuses.

#### Scenario: INT contributes to Magic ATK

- **WHEN** a character has effective INT 8 and no fixed weapon MATK
- **THEN** the authoritative Magic ATK is 16
- **AND** the Character Stats presentation displays 16

### Requirement: Accessory equipment accepts either ring slot

An equipment definition whose catalog slot is accessory MUST be legal in either persisted slot accessoryLeft or accessoryRight.

#### Scenario: Worn Lucky Ring enters the left accessory slot

- **WHEN** the player equips Worn Lucky Ring into accessoryLeft
- **THEN** the server accepts the request
- **AND** the persisted EquippedItem slot is accessoryLeft

#### Scenario: Worn Lucky Ring enters the right accessory slot

- **WHEN** the player equips Worn Lucky Ring into accessoryRight
- **THEN** the server accepts the request
- **AND** the persisted EquippedItem slot is accessoryRight

### Requirement: Equipment tooltips show granted stats

Equipment tooltips MUST show actual stats granted by the item instance, including fixed stats and rolled Attribute bonuses. Catalog generation metadata, vendor prices and stack metadata MUST NOT be presented as granted stats.

#### Scenario: Sword tooltip shows its attack

- **WHEN** the equipped Worn Sword has fixed ATK +8
- **THEN** its tooltip shows Attack +8

#### Scenario: Rolled Attribute appears in tooltip

- **WHEN** an equipped item has fixed SOR +2 and rolled SOR +4
- **THEN** its tooltip shows both the fixed and rolled contribution

### Requirement: Attribute explanations and contribution presentation

Each Attribute MUST have a tooltip describing which Stats it feeds. Positive non-base Attribute contribution MUST render in green as (+N) adjacent to the base value. Zero contribution MUST omit the suffix.

#### Scenario: STR tooltip explains its effect

- **WHEN** the player hovers the STR Attribute
- **THEN** the tooltip explains that STR feeds Physical ATK

#### Scenario: Attribute bonus is green

- **WHEN** base STR is 150 and equipment contributes +5 STR
- **THEN** the row displays STR 150 (+5)
- **AND** the (+5) contribution is styled green

### Requirement: Stats presentation includes Magic ATK

The Character sheet MUST label the derived section Stats and MUST include Magic ATK alongside the existing HP/SP, Attack, Defense, Attack Speed, Cast Speed, Evasion, Accuracy, regeneration and Critical values.

#### Scenario: Stats section is complete

- **WHEN** the Character sheet is rendered
- **THEN** the section title is Stats
- **AND** Magic ATK is present with its authoritative value

### Requirement: Equipment HTTP response converges character presentation

After a successful equip or unequip HTTP request, the frontend MUST apply the authoritative Character and Equipment/Inventory state contained in the response immediately. It MUST NOT wait for a separate Character poll before Attributes and Stats change.

#### Scenario: Equip response updates Attributes and Stats immediately

- **WHEN** an equip request succeeds
- **THEN** the frontend applies the returned Character and equipment/inventory state in the same success handler
- **AND** the Character Attributes and Stats update without a second Character GET

#### Scenario: Unequip response updates Attributes and Stats immediately

- **WHEN** an unequip request succeeds
- **THEN** the frontend applies the returned Character and equipment/inventory state in the same success handler
- **AND** the Character Attributes and Stats update without waiting for polling

### Requirement: Consumable success converges affected state

After an authoritative consumable-use response, affected Character resources/stat/buff presentation and Inventory MUST converge from that response immediately.

#### Scenario: Potion use outside battle updates HP immediately

- **WHEN** a potion-use HTTP request succeeds outside battle
- **THEN** the frontend applies the authoritative Character HP/SP and Inventory state from the response immediately
