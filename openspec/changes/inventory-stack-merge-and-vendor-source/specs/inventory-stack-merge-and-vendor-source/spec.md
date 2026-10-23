# Inventory stack merge and source-specific vendor sale

## ADDED Requirements

### Requirement: Sell from the selected Inventory row
A vendor SELL request originating from an Inventory stack SHALL identify that exact persisted Inventory row. The server SHALL validate that the row belongs to the authenticated Character, is in Inventory, matches the requested item, and contains the requested quantity. The sale SHALL remove only from that row. Other stacks of the same item SHALL remain unchanged. The transaction SHALL continue to validate Town access, current vendor price, gold cap, and Cooking ingredient reservations atomically. Requests without a source row ID may use the legacy aggregate-removal behavior for non-row-specific callers.

#### Scenario: Sell part of a selected stack
- GIVEN stacks of the same item with quantities 20 and 18
- WHEN the player sells 15 from the 20-unit row
- THEN that row contains 5 units
- AND the other row still contains 18 units

#### Scenario: Selected stack is stale or too small
- WHEN the source row no longer exists, belongs to another Character/location/item, or has fewer units than requested
- THEN the transaction is rejected without changing inventory or gold

### Requirement: Merge compatible stacks on Inventory drag/drop
Dropping one Inventory row onto another row of the same stackable item and compatible instance data SHALL merge as many units as fit up to the catalogue `maxStack`. If all source units fit, the source row SHALL be removed. If only some fit, the source row SHALL retain the overflow in its original slot. The target row SHALL remain in its target slot. A compatible target that is already full SHALL leave both stacks unchanged rather than swapping them. Different items or incompatible instance data retain the existing move/swap behavior. All mutation remains server-authoritative and transactional.

#### Scenario: Partial merge
- GIVEN compatible stacks of 18 and 7, with maxStack 20
- WHEN the 7-unit source is dropped onto the 18-unit target
- THEN the target becomes 20
- AND the source remains 5 in its original slot

#### Scenario: Complete merge
- GIVEN compatible stacks of 10 and 5, with maxStack 20
- WHEN the 5-unit source is dropped onto the 10-unit target
- THEN the target becomes 15
- AND the source row is removed
