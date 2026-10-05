# Design

CatalogService becomes the single frontend source for item tooltip lines. It accepts item id and optional instanceData, applies the existing type-specific filtering and equipment-roll rendering, and returns display-ready lines. Inventory, Character and Vendor render those lines instead of rebuilding metadata independently.

The existing item-tooltip CSS moves to the global stylesheet so Inventory and Vendor share the same visual contract.

Character creation calculates level-1 resources with no weapon contribution and does not persist a mainHand EquippedItem. Starter consumables remain unchanged.

MapService no longer depends on EquipmentService for entry. After email verification and map lookup it validates the food buff and level requirement; no weapon is required.

Blacksmith Loren keeps infinite T1 weapon stock, with an explicit 2,000-gold price for every T1 weapon. Body armor prices remain unchanged.

Weapon-dependent battle skills keep their existing equipped-weapon requirements; only the map-entry gate changes.
