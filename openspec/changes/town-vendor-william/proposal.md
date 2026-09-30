# Town Vendor NPC — William

## Why

The Town already has a server-authoritative data hook for vendors, but the Town service is stubbed and the Play Shell still renders the Grind surface while the character is in Town. This change implements the first real Vendor NPC without creating a parallel inventory, currency, or transaction system.

## Scope

1. Replace the central Grind surface with Town content while the character is in Town.
2. Add a small NPC registry/selector contract with William as the first vendor NPC.
3. Render William's ten-slot vendor inventory using the existing item catalog and visual slot language.
4. Reuse Inventory CDK drag/drop for player→vendor and vendor→player interactions.
5. Add confirmation modals for BUY/SELL with stack quantities, All, unit price and total.
6. Make backend vendor quotes and transactions authoritative and atomic.
7. Reuse the existing Character gold and InventoryItem persistence.
8. Resynchronize character/inventory/vendor state after successful transactions.
9. Add backend integration tests for validation and atomic transaction behavior plus frontend build/smoke coverage.

## Non-goals

- No new currency.
- No weapon XP/progression.
- No player-to-player market changes.
- No warehouse implementation.
- No production deployment.

## Compatibility

William keeps the existing npc_vendor.json rules: seven official sell-stock items, infinite stock, and vendor purchase value derived server-side from the existing item pricing fields/rate. The UI always exposes ten slots; unused slots are empty.

## Acceptance

- Town replaces the central Grind/Battle surface only while Character.status is town.
- Outside Town the current Grind surface is unchanged.
- Right persistent panel shows Choose NPC and William.
- William renders exactly ten vendor slots.
- Player inventory and vendor slots can exchange drag intents only through confirmation.
- Backend validates Town status, NPC/item membership, quantity, ownership, capacity, gold and prices.
- Buy/sell are atomic and cannot double-submit.
- Gold, inventory and vendor state are refreshed after a transaction.
- Shared/API/frontend builds, strict OpenSpec validation and git diff --check pass.
