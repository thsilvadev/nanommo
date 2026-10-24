# Design

## Context

See `proposal.md` and the two capability deltas for observable behavior.

The repository already has `MarketOrder`, `MarketDeal`, a `MarketService` with legacy buy/sell matching and escrow logic, a `MailMessage` entity, and authenticated Mail/Market controllers. The current Market UI is not routed and Trade is disabled in the topbar. The Mail controller is partly wired, but send, attachment collection, system mail, search, and expiration are unimplemented; several existing message operations are not scoped to the authenticated sender/recipient. The current Mail `collected` flag also doubles as read/unread state, which is insufficient once viewing a message and collecting its attachments become separate actions.

The current play shell intentionally keeps Character Summary and Grind Info mounted on the left and right of the central router outlet. The existing Grind page embeds the reusable InventoryGrid, with canonical item definitions, item icons, tier styling, tooltips, drag previews, and stack quantities.

## Goals / Non-Goals

**Goals:**

- Deliver an end-to-end sell-only Market and a usable Town Mailbox with one coherent, transactional asset-transfer model.
- Keep asset and gold delivery durable and safe across concurrent requests, offline players, retries, full inventories, and server restarts.
- Reuse the established inventory, item catalog, UI visual language, character queue lock, and future-battle mutation boundaries.
- Keep the code ready for future buy orders/cash without implementing or exposing those features now.

**Non-Goals:**

- Buy orders, cross-side automatic matching, cash pricing, or any cash wallet/accounting.
- Market delivery directly into the recipient Inventory or direct seller balance credit on a completed sale.
- Warehouse delivery, multi-stack mail attachments, mail postage, bulk listing, or new market price-history analytics UI beyond reusing the existing completed-deal data.
- Running database migrations, changing live data, or deploying during proposal/apply coding.

## Decisions

### 1. Market page composition and inventory interaction

Add `/play/market` as a child route and change the topbar Trade button to Market. Keep Character Summary and Grind Info mounted in their existing shell locations. The Market page occupies only the central route and manages its own internal overflow; it must not change the game shell's persistent side-panel contract.

Reuse the existing InventoryGrid rather than recreating icon/tooltip/drag code. Extend it with an optional Market drop target and callback/configuration so normal Grind behavior, stack split, drag-end handling, and inventory refresh stay consistent. Inside the central panel, use a compact two-column workspace when available: inventory/drop target on the left, search/results and order detail on the right. At narrower central widths, stack these sections or expose the inventory area with a clear compact toggle without hiding or replacing the shell side panels. The main results table remains scrollable independently.

The top-level Market views are Browse, My Orders, and My Deals. Browse owns search, filters, sort, and page selection. Dropping an item preselects the catalogue item and opens a sale composer showing competing listings. Own offers remain visible but are marked as the player's own and cannot be purchased. Price suggestion uses the cheapest active listing from another character minus one gold; absent that, it uses the latest completed unit price minus one; with no history it asks the user to enter a price. The server never trusts the displayed suggestion.

### 2. Sell-only scope and order representation

Expose only sell-listing endpoints and UI for this release. Remove or disable the current public buy-order/match-buy path so the old 5% fee and automatic matching cannot run accidentally. Keep the data model extension-friendly rather than inventing buy-order behavior now.

For a sell order, keep the initial listed quantity immutable in `quantity` and use `escrowedItemQuantity` as the current remaining amount. Every successful partial purchase decreases only the remaining escrow. The row's `itemInstanceData` is populated from the locked source InventoryItem by the server. Add a persisted `listingFeeGold` value for audit/display; existing active sell orders that predate this field must not be charged again.

The server verifies the selected InventoryItem belongs to the character, remains in the inventory location, has the expected item/instance and sufficient unreserved quantity, is eligible for listing, and uses a positive integer price. A single drag lists that selected stack in full; equipment remains quantity one. The existing inventory splitting interaction is the player's way to list a smaller stack. Enforce at most 10 active sell listings per character and expire by `expiresAt = createdAt + 7 days`.

### 3. Gold, fee, and maximum transaction value

Use one shared market/mail maximum of **999,999,999 gold** for the gross value of a sell order/purchase and for an individual attached-gold transfer. This is an explicit application-level cap below the signed SQL integer limit; validate all multiplication/addition before persistence and compare against Character's supported gold range before crediting.

Listing fee is `max(1, ceil(grossListingValue * 0.01))`, paid at initial listing from the full listed stack gross value. Store the charged value on the order. It is a one-time, non-refundable listing cost: never refund it on cancellation/expiry and never subtract it again from sale proceeds. On a partial sale the seller receives the gross value of only the units sold; the original fee remains paid against the original listing, even if some units later expire or are returned. The UI labels gross, prepaid listing fee, and expected net for the listed stack so this economic trade-off is explicit.

There is no new 5% buyer fee or 100-gold flat fee. Do not add cash paths, conversions, or a hidden second fee.

### 4. Purchase and escrow-to-mail transaction

A purchase request contains only order ID and requested quantity; the server obtains item, current remaining quantity, seller, instance data, and unit price from the locked order row. Equipment quantity is fixed at one. The request cannot purchase the character's own listing.

The purchase transaction locks/revalidates the order and buyer Character, checks the active expiry deadline, verifies gold and the shared maximum, then debits buyer gold, updates remaining escrow/status, creates the MarketDeal, and creates two MailMessage rows: an Auction House item attachment for the buyer and an Auction House gold attachment for the seller. All rows commit or roll back together. Seller proceeds are **not** credited directly to Character.gold; the buyer's gold is debited at purchase time and is then held by the gold-delivery mail until collection.

Market purchase does not check inventory slots because the item is delivered to Mail. The Mail collection transaction later checks actual capacity in compatible stacks and/or free slots. This means a purchase remains valid with a full inventory, while collection may wait until the player makes room in Town.

Use transaction-scoped repository/manager access for mail creation, rather than calling a nested transaction or writing the mail after the deal commits. Add a unique source/idempotency key for system-generated deliveries: one buyer-item and one seller-gold mail per deal, and one return mail per terminal sell order. A repeated worker/request must find the prior committed result or fail without duplicate assets.

### 5. Sell listing, cancellation, and expiry transactions

Listing is an inventory-affecting Character mutation. Serialize it through the existing per-character queue lock, then a pessimistic Character row lock and locked InventoryItem row; charge fee, remove the quantity, persist the MarketOrder, and commit atomically. Route the resulting inventory mutation through the established future-battle mutation boundary so any already-started battle remains immutable and eligible future battle snapshots see the authoritative inventory. No separate client-side inventory prediction is authoritative.

Cancellation/expiry locks the active order, marks it terminal, and creates one Auction House return mail for `escrowedItemQuantity` using the order's exact instance data. It must not place the return directly into Inventory or require an available slot. Order expiration uses its saved `expiresAt`, not a recomputed age test, and the worker/reconciler is idempotent across retries/restarts. The listing fee is not returned.

The new code must include a rollout reconciliation for any legacy active buy orders from the previous implementation: hide/disable buy matching, compute the remaining escrow using an audited rule, and return it once through Auction House gold mail. Do not silently strand or spend legacy `escrowedGold`. Before enabling the new Market against a database, inspect active legacy order counts/escrow read-only and verify the reconciliation against the deployed schema.

### 6. Mail data and compatibility

Extend MailMessage additively to include:

- nullable sender Character relation plus immutable `senderName` snapshot (null sender relation for Auction House), immutable `recipientName` snapshot, required subject/body, and created/expiry timestamps;
- optional `attachedGold`, optional `itemId`/quantity/instance snapshot, and separate `isRead` and `attachmentsCollected` flags;
- per-side deletion/visibility state so deleting from Sent cannot destroy the recipient's message or assets;
- a unique request/source key for safe send retries and Market-generated deliveries.

Do not infer attachment state from the old `collected` flag for new operations. The forward-only migration derives `isRead` from legacy behavior and initializes `attachmentsCollected` based on whether a legacy row actually has an item/gold attachment. Keep old columns compatible during rollout and remove/repurpose them only if a safe audit proves it is needed. The mail sender/recipient snapshots preserve the displayed names even if a character later changes name or is deleted.

The Mailbox UI is opened from the generic Town NPC panel. Add a Mailbox capability to every canonical map of type `town`, and synchronize root/public map and NPC catalogue copies. The UI provides Inbox, Sent, Compose, and message detail, with a separate unread badge/count. Opening a message marks it read; it does not collect attachments. Compose accepts character name, subject/body, a single optional inventory stack, and optional gold, and requires confirmation before sending. No postage fee is introduced.

### 7. Send, collect, read, and delete ownership

All player mail actions validate settled Town state on the server, not just the UI. A valid Town means map catalogue type town, Character status town, and no active `travelIntent` or `pendingMapTransition`. Market's internal system-mail helper does not require the recipient to be in Town because it only creates a durable letter; only opening/collecting through the mailbox UI is Town-gated.

Sending obtains an authenticated sender identity and recipient resolved by an exact character-name lookup. Disallow self-send. Lock sender Character and source InventoryItem, validate no Cooking reservation conflicts, validate item/gold attachment bounds, then remove assets and create mail in a single transaction. Equipment uses one unit and copies the exact canonical instance data. An idempotency key prevents replay of the same confirmed send request from charging/removing assets twice.

Collecting locks the recipient Character and the message, verifies recipient ownership, Town state, expiry, and uncollected state, then precomputes the full inventory placement using existing compatible-stack/maxStack semantics. If items and gold are both attached, all-or-nothing collection is required: if the complete item cannot fit or gold credit would exceed Character's supported range, transfer nothing and leave the mail available. Use the inventory service's transaction-manager form for actual item insertion. Concurrent collection must yield at most one successful claim.

Read/update/delete endpoints must include the authenticated character relationship in their database query; message IDs alone are never authority. A recipient cannot delete an uncollected-attachment message. Sender-side deletion hides only the sent copy. Recipient deletion of a message with no remaining attachments hides/removes the inbox copy. Messages and uncollected attachments expire 30 days after creation as documented by the existing retention rule; expiration deletes pending attachments without a refund-of-refund chain.

### 8. Server-side expiry and user feedback

Use the existing durable worker/reconciliation patterns rather than assuming a controller request will run cleanup. Market order expiration and mail retention need idempotent scheduled processing with startup/retry recovery and stable source keys. Avoid a tight unbounded scan on each request; use indexed due-time queries and bounded batches.

Use the existing red System Journal path for Market action failures that should be surfaced in-game, especially insufficient gold. Mail compose/read/collect failures also return actionable UI errors. Never log message bodies, authentication secrets, or private attachment contents.

### 9. Tests and verification

Test pure price/fee/limit calculations, stack item-capacity placement, catalogue and town NPC parity, role/ownership guards, transactional mail, exact instance preservation, expiry boundaries, and retry idempotence. Service tests must race purchase vs purchase, purchase vs cancel/expiry, send vs send retry, and collect vs collect. Use a disposable PostgreSQL/Redis runtime for row-lock, transaction rollback, migration preservation, and Bull recovery verification when available; source-contract tests alone are not sufficient evidence for concurrency correctness.

## Risks / Trade-offs

- [Mail attachment expires uncollected] → Keep the existing 30-day retention contract; warn clearly in the inbox and Market UI when mail has attachments approaching expiry. Expired attachments are deleted, not automatically remailed.
- [Listing fee can exceed the realized value of a partially sold order] → Show the fee against the original full listed quantity before confirmation; do not charge fees again per partial fill.
- [Legacy active buy orders may contain historical escrow] → Perform a read-only deployment/schema audit before rollout and run an idempotent one-time return-mail reconciliation before users can trade with new code.
- [Concurrent queue, inventory, and market mutations] → Use the established Character queue-lock and row-lock patterns, a consistent lock order, single-transaction mail creation, and real database concurrency tests.
- [The same gold cap is used by mail and market] → Centralize the cap and validate both client display and authoritative server calculations; never rely on numeric coercion from HTTP JSON.

## Migration Plan

1. Keep this change proposal-only until accepted. During apply, first capture `git status`, inspect existing pending changes without overwriting them, audit API/controller/module dependency wiring, and verify the current deployed database schema/migration history read-only.
2. Add a forward-only migration for MailMessage and MarketOrder additions/indexes. Preserve existing MarketDeal history. Do not execute the migration during coding.
3. Implement the shared mailbox transaction helper first, then the mail UI/Town NPC integration; validate message authorization, collect capacity, and expiry before connecting Market transfers.
4. Implement sell-only Market flows and atomic mail coupling; add idempotent reconciliation for active legacy buy-order escrow and verify no old matching path can be invoked.
5. Run focused tests, shared/API builds, frontend type checks and development/production builds, catalogue validators, strict OpenSpec validation, and `git diff --check`. Complete disposable-database migration/concurrency tests where available. Update root `SPEC.md`, `openspec/specs/SPEC.md`, `ARCHITECTURE.md`, and `STATUS.md` based only on verified outcomes.
6. Do not run the migration or deploy during implementation. Before rollout, stop consumers according to the established migration procedure, verify a proven migration baseline, run read-only migration/escrow audits, apply the approved migration, reconcile legacy buy-order escrow and due expirations, and then start workers.

**Rollback:** Do not simply re-enable the old Market code while new-format orders or Mail messages remain active: its direct-gold and old-fee behavior conflicts with the new delivery contract. Disable new Market mutations, preserve all escrow/mail rows, and use a verified forward recovery/reconciliation path before any code rollback. The new schema should be additive; no destructive removal of legacy columns is required for the first rollout.
