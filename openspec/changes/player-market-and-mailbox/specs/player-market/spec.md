# Spec Delta

## Purpose

Provides a global, gold-only marketplace where players list items for sale, browse comparable listings, and purchase all or part of a stack. All traded assets are delivered through the Town Mailbox, so a trade does not depend on either player being online or having an inventory slot available at the moment of sale.

## ADDED Requirements

### Requirement: Market navigation preserves the shared play layout

The system SHALL expose a Market entry in the game topbar and a dedicated Market route inside the central play panel. Opening the Market MUST preserve the left Character Summary and right Grind Info panels. Market browsing and order actions SHALL be available regardless of the character's current map or activity.

#### Scenario: Open Market while grinding

- **WHEN** a character opens Market while on a grind map
- **THEN** the Market renders in the central panel while the shared side panels remain mounted and visible

#### Scenario: Open Market from any map

- **WHEN** a character browses, lists, purchases, or cancels an order while on any map
- **THEN** the Market action is not rejected solely because the character is outside a Town

### Requirement: Market listings are searchable, filterable, and sortable

The system SHALL let players search active sell listings by canonical item name and combine that search with relevant item category/type, tier, and unit-price filters. Results SHALL support pagination and sorting by unit price, total listing value, quantity, and listing time. The default ordering SHALL be lowest unit price first, then oldest listing first, with a stable tie-breaker. Item name, icon, and tooltip information SHALL come from canonical catalogue data; equipment tooltips SHALL include the exact rolled instance attributes being offered. When no active sell orders match the selected item or filters, the UI SHALL display a clear empty state.

#### Scenario: Default item results

- **WHEN** the player searches for an item with multiple active sell orders and does not change sorting
- **THEN** the system displays matching offers from the lowest unit price to the highest, with older offers first for equal prices

#### Scenario: No matching sell orders

- **WHEN** a search resolves to an item with no active sell orders
- **THEN** the UI displays “No sell orders found for this item.” rather than an empty or broken results table

#### Scenario: Display an equipment listing

- **WHEN** a sell listing represents equipment with rolled attributes
- **THEN** its canonical name and icon are shown and its tooltip describes the exact equipment instance that will be delivered

### Requirement: A sell listing escrows the exact selected inventory stack

The system SHALL let a player drag an inventory stack into the sell area, review existing sell offers for that item, edit a positive integer unit price, and confirm a listing. The listing SHALL use the exact selected inventory row and server-owned item instance data; it MUST NOT remove items from an arbitrary matching stack or trust client-supplied rolled attributes. Listing a stackable item SHALL list the full selected stack; equipment SHALL be listed as one instance. Only unreserved, eligible inventory quantities may be listed. A character SHALL have at most 10 active sell listings. A listing SHALL expire seven days after creation unless completed or cancelled earlier.

#### Scenario: Suggest a competitive price

- **WHEN** the player drops an item with at least one active sell offer from another character
- **THEN** the composer shows the lowest competing unit price minus one gold, with a minimum suggested price of one gold, and lets the player edit it before confirmation

#### Scenario: No competing offers

- **WHEN** the player drops an item with no competing active sell offer
- **THEN** the composer uses the last completed market unit price minus one gold when available, or leaves the price empty if there is no usable price history

#### Scenario: Reject a stale or reserved stack

- **WHEN** the chosen inventory row no longer belongs to the character, its quantity changed, or part of it is reserved by another game system
- **THEN** listing fails without charging the fee, removing any item, or creating an order

### Requirement: Listing fees are charged once and are not refundable

The system SHALL charge a 1% listing fee immediately when a sell listing is confirmed. The fee SHALL be rounded up to the next whole gold, with a minimum fee of one gold. The fee is calculated from the full initial gross listing value, is never refunded on cancellation or expiry, and SHALL NOT be charged again when items sell. The composer SHALL show unit price, full stack gross value, fee, and expected net proceeds before confirmation. The gross value of any market order and the maximum gold attachment on a mail SHALL share a documented maximum of 999,999,999 gold; both per-unit price and quantity-times-price calculations MUST be validated without overflow.

#### Scenario: Show and charge the fee

- **WHEN** the player confirms a listing whose full gross value is 980 gold
- **THEN** the system charges a 10 gold listing fee immediately, escrows the selected stack, creates the sell order, and shows expected net proceeds of 970 gold

#### Scenario: Listing fee cannot be paid

- **WHEN** the character lacks enough gold to pay the listing fee
- **THEN** the operation fails atomically and leaves the character's gold, inventory, and active orders unchanged

#### Scenario: Fee is not charged again on sale

- **WHEN** a listed item is purchased later
- **THEN** the seller's proceeds equal the gross purchase price and no second market fee is deducted from those proceeds

### Requirement: Stackable listings support partial purchase

The system SHALL let buyers purchase any positive integer quantity up to the remaining quantity of a stackable listing. Equipment listings SHALL be purchased as exactly one instance. The purchase confirmation SHALL show quantity, unit price, and total gold cost. A successful purchase SHALL debit the buyer immediately, create item delivery mail for the buyer and gold-proceeds mail for the seller, record a deal, and reduce or complete the listing in one atomic operation. Buyers SHALL NOT be able to purchase their own listing. The buyer SHALL pay gold only in this release; cash payments and buy orders are out of scope.

#### Scenario: Buy part of a stack listing

- **WHEN** a buyer purchases 15 units from an active stack listing containing 100 units
- **THEN** the buyer is charged for 15 units, a 15-unit item mail and matching seller-proceeds mail are created, the deal is recorded, and 85 units remain escrowed on the active listing

#### Scenario: Buy the remaining quantity

- **WHEN** a buyer purchases all remaining units of an active listing
- **THEN** the listing becomes fulfilled and no remaining item quantity is available for another purchase

#### Scenario: Reject insufficient gold

- **WHEN** the buyer does not have enough gold for the requested quantity
- **THEN** the purchase fails without changing the listing, seller assets, buyer assets, or deal history and a red System Journal error says “Insufficient funds for this purchase.”

#### Scenario: Mail delivery does not depend on inventory capacity

- **WHEN** the buyer completes a purchase while their inventory is full
- **THEN** the purchase can still complete because the item is held in Mail; inventory capacity is checked when the buyer later collects the attachment in a Town

### Requirement: Market transactions are atomic and concurrency-safe

The system MUST use server-side validation and PostgreSQL transactions with consistent row-lock ordering for every market operation that changes gold, inventory escrow, listing quantity/status, deal history, or market-generated mail. The same listing quantity MUST NOT be sold twice, an order MUST NOT be both cancelled and purchased, and no duplicate item or gold may be produced by concurrent or retried requests. Inventory-affecting market mutations SHALL respect established Character queue-lock and future-battle mutation boundaries so an already-started battle remains immutable and future snapshots reflect authoritative inventory changes.

#### Scenario: Two buyers compete for the last units

- **WHEN** two purchase requests concurrently target the same remaining listing quantity
- **THEN** at most one valid transaction can claim each unit, and every rejected or stale request leaves gold and items unchanged

#### Scenario: Cancellation races with purchase

- **WHEN** cancellation and purchase requests concurrently target the same active order
- **THEN** exactly one valid terminal/update path commits, and the item is either sold or returned through Mail, never both

#### Scenario: Mail creation fails during a purchase

- **WHEN** either required market-generated mail cannot be persisted
- **THEN** the complete purchase transaction rolls back, including buyer gold, listing quantity, deal history, and the other mail

### Requirement: Players can manage and review sell listings

The system SHALL provide a My Orders view showing the player's active sell listings and their remaining quantities, unit prices, and expiry times. A player SHALL be able to cancel only their own active listing. Cancellation returns the remaining escrowed item through Mail and does not refund the listing fee. Expiry SHALL use the saved expiration deadline and a retry-safe process to create exactly one return mail. My Deals SHALL show the latest 15 completed deals involving the character, newest first, including item, quantity, unit price, total gold, counterpart name, and deal time.

#### Scenario: Cancel a listing

- **WHEN** the owner cancels an active sell listing
- **THEN** the listing is made unavailable and its remaining escrowed items are returned through a Mail attachment without refunding the original listing fee

#### Scenario: Expire a listing

- **WHEN** the saved expiry time for an active sell listing is reached
- **THEN** the listing becomes unavailable and its remaining escrowed items are returned through exactly one Mail message, even if expiry processing retries

#### Scenario: Inspect deal history

- **WHEN** the player opens My Deals
- **THEN** the UI shows up to the 15 most recent completed deals involving that player in newest-first order
