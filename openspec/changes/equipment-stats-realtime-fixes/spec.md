# Specification Delta

## Character Attributes and Stats

### Requirement: Equipment contributions are authoritative

The Character DTO MUST expose total non-base Attribute contributions in attributeBonuses with keys STR, AGI, DEX, VIT, INT, and SOR.

The contribution MUST include both fixed item fixedStats.statBonus and the equipped instance instanceData.rolledAttribute / rolledValue.

The Character DTO MUST expose Magic ATK. Its authoritative formula is the existing shared formula: matk = floor(INT * 2) + weaponFixedMatk, where INT already includes equipment Attribute bonuses.

### Requirement: Accessory compatibility

An equipment definition with catalog slot accessory MUST be legal in either persisted slot accessoryLeft or accessoryRight.

A persisted equipment row MUST continue to use the explicit left/right slot values.

### Requirement: Immediate character-sheet convergence

After a successful equip or unequip HTTP request, the frontend MUST apply the authoritative Character and Equipment/Inventory state contained in the response immediately. It MUST NOT wait for a separate Character poll before Attributes and Stats change.

After an authoritative consumable-use response, affected Character resources/stat/buff presentation and Inventory MUST converge from that response immediately.

### Requirement: Equipment tooltips

Equipment tooltips MUST show actual stats granted by the item instance, including fixed and rolled bonuses. Catalog generation metadata and economic/stack metadata MUST NOT be presented as granted stats.

### Requirement: Attribute presentation

Each Attribute MUST expose a tooltip describing the Stats it feeds.

Positive non-base Attribute contribution MUST render in green as (+N) adjacent to the base value. Zero contribution MUST not render a suffix.

### Requirement: Stats naming and Magic ATK

The Character sheet MUST label the derived section Stats.

The Stats section MUST include Magic ATK alongside the existing HP/SP, Attack, Defense, Attack Speed, Cast Speed, Evasion, Accuracy, regeneration and Critical values.
