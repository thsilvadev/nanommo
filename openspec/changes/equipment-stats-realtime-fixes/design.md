# Design

## Authoritative stat aggregation

EquipmentService.calculateEquipmentStats remains the backend source for equipment contribution. It must aggregate fixed atk, matk, def, mdefPercent, maxHp, maxSp, fixed statBonus, and per-instance rolledAttribute + rolledValue.

Character DTO construction must consume this same aggregation rather than maintaining a second incomplete copy of the calculation.

The shared BattleEngine.calculateDerivedStats remains the formula source. Magic ATK is floor(INT * 2) + weaponFixedMatk; equipment weapon MATK is passed through when present. No frontend formula is introduced.

The Character response exposes attributeBonuses as the total non-base Attribute contribution currently supplied by equipment. Shape: {STR, AGI, DEX, VIT, INT, SOR}. This is a contribution field so future authoritative buffs/debuffs can be added without changing presentation.

## Accessory slots

Canonical item data keeps slot: accessory because the item is compatible with either accessory slot. The backend accepts accessory items for either accessoryLeft or accessoryRight, while the frontend drag predicates expose the same compatibility. Persisted EquippedItem rows continue using explicit left/right slots.

## Immediate HTTP convergence

Equipment mutation endpoints return an authoritative snapshot containing the resulting equipment array, Character DTO, and Inventory snapshot/state revision where applicable.

The frontend applies these values directly to existing stores when the HTTP response resolves. A fallback refresh is not the primary success path. Existing websocket revision guards remain intact.

For generic consumable use outside battle, the authoritative Character + Inventory response path is extended/consumed so HP/SP and other affected presentation updates together with Inventory.

## Tooltips

Equipment tooltips render only actual granted stats, not catalog metadata such as random-roll generation, vendor prices or stack limits. Fixed and rolled contributions are shown separately when both exist.

Examples:
- Attack +8
- SOR +2
- SOR +4 (rolled)
- Defense +6
- Max HP +20

Attribute tooltips explain each Attribute's Stats mapping. Attribute rows display base value plus total positive contribution, e.g. STR 155 (+5). Zero contribution omits the suffix.

## Verification strategy

Add focused backend assertions for accessory acceptance, rolled attribute aggregation, MATK, and Character DTO output. Add frontend regressions for accessory predicates, tooltip formatting, Attribute/Stats rendering, and immediate store convergence after equip/unequip. Run shared/API/frontend builds, focused tests, strict OpenSpec validation and git diff --check.
