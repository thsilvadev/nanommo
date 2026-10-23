# Inventory stack merging and source-specific vendor sales

## Why
Vendor sale requests currently identify only an item template and quantity, so the server removes matching items by slot order rather than from the exact stack the player dragged. Inventory drag/drop also swaps identical stacks instead of consolidating them.

## Scope
- Carry the selected inventory row ID through the vendor sell modal and request.
- Atomically validate and remove the requested quantity from that exact row, preserving Cooking reservations and the existing authoritative price/gold transaction.
- When dragging a stack onto another compatible stack of the same item, merge up to the canonical `maxStack` limit. Any overflow remains in the source stack; if fully merged, remove the source row. Different items and incompatible instance data keep existing swap/move behavior.
- Keep the existing drag/drop interaction as the merge affordance; do not couple the rule exclusively to drag/drop so future action menus can call the row-ID-based sell flow.

## Non-goals
- No changes to buy behavior, stack limits, vendor pricing, market rules, warehouse transfer semantics, or database schema.
- No deployment or database migration.
