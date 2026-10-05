# Food Tooltip Stats

## ADDED Requirements

### Requirement: Food effect tooltip
The shared item tooltip formatter SHALL show the concrete stats configured in a food's `food_buff` effect instead of a generic description.

#### Scenario: Food shows HP and SP regeneration
- GIVEN Bread has `hpRegenPerTenTicks = 4`, `spRegenPerTenTicks = 1`, and `durationSeconds = 3600`
- WHEN its tooltip is rendered
- THEN the effect text includes `HP Regen: +4 / 10 ticks`
- AND includes `SP Regen: +1 / 10 ticks`
- AND includes the duration.

#### Scenario: Different foods show their own values
- GIVEN two foods have different HP/SP regeneration values
- WHEN their tooltips are rendered
- THEN each tooltip reports its own configured values.

### Requirement: Shared tooltip source
Food effect formatting SHALL live in the shared catalog item tooltip formatter used by item panels, rather than a panel-specific food formatter.

#### Scenario: Vendor uses the same food formatter
- GIVEN a Vendor stock slot contains Bread
- WHEN its item tooltip is rendered
- THEN it uses the same catalog formatter as the Inventory tooltip
- AND it shows Bread's concrete HP/SP regeneration values.
