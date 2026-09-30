# Town Vendor NPC — William

## ADDED Requirements

### Requirement: Town replaces the Grind surface

While the character is in Town, the central Play Shell region SHALL render Town instead of the Grind/Battle surface. Outside Town, the existing Grind surface SHALL remain available.

#### Scenario: Town central surface
- WHEN the authoritative character status is town
- THEN the central region renders Town
- AND the Grind/Battle surface is not rendered in that region.

### Requirement: Extensible NPC selector

The persistent right panel SHALL expose an NPC selector while in Town. Each NPC SHALL be represented by an id, name and type. William SHALL have type vendor.

#### Scenario: William selection
- WHEN the character is in Town
- THEN the selector label is Choose NPC
- AND William is selectable
- AND selecting William renders the vendor UI.

### Requirement: William vendor stock

William SHALL expose exactly ten visual vendor slots. The seven configured sell-stock entries in npc_vendor.json SHALL occupy the first seven slots and the remaining slots SHALL be empty. Vendor stock is infinite unless the data definition says otherwise.

#### Scenario: Vendor inventory
- WHEN William is selected
- THEN ten slots are rendered
- AND catalog item definitions provide item names and icons
- AND buy prices come from the authoritative vendor data.

### Requirement: Vendor dialogue

William SHALL display the title William and the configured greeting about buying goods or selling loot by drag-and-drop.

#### Scenario: William greeting
- WHEN William is selected
- THEN the title is William
- AND the configured greeting is visible.

### Requirement: Confirmed sell flow

Dropping a player inventory item on William SHALL open a blocking confirmation modal and SHALL NOT mutate state before confirmation.

#### Scenario: Sell stack
- WHEN a stackable inventory item is dropped on William
- THEN quantity defaults to 1
- AND All is available
- AND total proceeds update with quantity
- AND confirmation sends an authoritative sell request.

### Requirement: Confirmed buy flow

Dropping a William item on the player Inventory SHALL open a blocking confirmation modal and SHALL NOT mutate state before confirmation.

#### Scenario: Buy item
- WHEN a vendor item is dropped on the player inventory
- THEN quantity defaults to 1
- AND All is available
- AND total cost updates with quantity
- AND confirmation sends an authoritative buy request.

### Requirement: Authoritative pricing and validation

The backend SHALL be authoritative for vendor identity, item membership, quantity, ownership, stock availability, gold, inventory capacity and final price. Frontend quote values are display-only.

#### Scenario: Stale quote
- WHEN a price or inventory quantity changes after a modal opens
- THEN confirmation is revalidated by the backend
- AND the transaction is rejected or applied only using current authoritative state.

### Requirement: Atomic transactions

BUY and SELL SHALL be atomic database transactions. A failed transaction SHALL NOT leave partial gold, inventory or vendor state.

#### Scenario: Atomic buy
- WHEN a buy transaction is accepted
- THEN gold deduction and inventory addition commit atomically.

#### Scenario: Atomic sell
- WHEN a sell transaction is accepted
- THEN inventory removal and gold credit commit atomically.

### Requirement: Gold and capacity UX

The UI SHALL reject impossible requests before confirmation where authoritative state makes that known, while the backend SHALL always revalidate.

#### Scenario: No gold
- WHEN the player cannot afford one unit
- THEN the modal does not open
- AND the Town panel shows Not enough gold.

#### Scenario: Partial affordability
- WHEN the player can afford some but not all requested stack quantity
- THEN the quantity controls cap at the affordable amount
- AND confirmation cannot submit an unaffordable quantity.

### Requirement: Post-transaction synchronization

After BUY or SELL, Character gold, player Inventory and Vendor stock state SHALL be refreshed from authoritative state.

#### Scenario: Successful transaction refresh
- WHEN a BUY or SELL succeeds
- THEN Character gold and Inventory are refreshed
- AND the selected Vendor stock is refreshed.

### Requirement: Drag/drop stability

Vendor drag/drop SHALL reuse the existing Inventory CDK infrastructure and SHALL not introduce slot reflow, resizing, or unstable drag placeholders.

#### Scenario: Stable vendor drag
- WHEN an item is dragged between Inventory and William
- THEN slot dimensions remain stable
- AND the drag preview does not resize or reflow neighboring slots.

### Requirement: Responsive Town vendor

The Town/Vendor UI SHALL fit the desktop shell and a viewport around 390px without horizontal overflow.

#### Scenario: Mobile Town vendor
- WHEN the viewport is approximately 390px wide
- THEN Town and William remain usable
- AND the document has no horizontal overflow.

### Requirement: No unrelated progression

This change SHALL NOT implement weapon XP/progression or unrelated gameplay systems.

#### Scenario: Scope boundary
- WHEN the Vendor change is implemented
- THEN no weapon XP/progression behavior is added or modified.
