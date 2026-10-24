# Proposal

## Why

NanoMMO already has market-order entities/services and a Mail module scaffold, but the topbar Trade entry is disabled and core Mail operations remain unimplemented. Rework the player market into a gold-only, sell-listing marketplace and complete the minimal Town Mailbox flow so market items and proceeds can be delivered safely without requiring online counterparties or free inventory space at trade time.

## What Changes

- Replace the disabled **Trade** topbar entry with **Market** and add a central-panel route that preserves the persistent left Character Summary and right Grind Info panels.
- Implement sell listings with item-name search, useful combined filters, pagination/sorting (unit price ascending by default), inventory drag-and-drop, server-authoritative stack selection, seller price editing, 1% non-refundable listing fee, and explicit gross/fee/net preview.
- Support partial purchases of stackable listings and whole-item purchases for equipment. A purchase locks/revalidates the listing, debits the buyer, reduces/fills the listing, records deal history, and creates the corresponding buyer item mail and seller gold mail atomically. The buyer pays gold only; the Market does not offer cash in this phase.
- Deliver all market-related assets through Mail: purchased items, sale proceeds, and returned unsold items from cancellation/expiry. Market browsing, listing, purchasing, and order management remain available from any map; Mail access, sending, and attachment collection require the character to be settled in a Town.
- Complete the existing Mail scaffold with Inbox, Sent, message detail/read state, Compose, optional one-stack item attachment plus optional gold attachment, confirmation before sending, atomic attachment collection, unread count, deletion rules, and 30-day expiration. Every Town map receives a Mailbox NPC capability.
- Add strong server-side validation, authorization, canonical item-instance handling, consistent row-lock order, idempotent lifecycle processing, and regression/integration tests against double-purchase, double-collect, insufficient gold, insufficient inventory capacity, stale orders, and order cancellation/expiry races.
- Keep buy orders and automatic cross-side matching out of this release. Preserve a clean extension point for a later gold-or-cash economy, without exposing or implementing those future mechanics now.
- Replace the conflicting legacy Market/Mail rules in the canonical/root SPEC, OpenSpec mirror, and ARCHITECTURE during implementation; record verified results in STATUS. Proposal stage does not edit application code, canonical specs, database migrations, or production data.

## Capabilities

### New Capabilities
- `player-market`: browse, list, partially purchase, cancel, expire, and track sell orders using gold, with Mail-based delivery.
- `mailbox`: Town-only sending/receiving/attachment collection, message ownership/read state, item/gold attachments, and 30-day retention.

### Modified Capabilities
- None. The current OpenSpec capability inventory is empty; the market and mailbox behavior will be introduced as two explicit capabilities and reconciled with the repository's existing full SPEC during implementation.

## Impact

- Frontend: play topbar/navigation, central route/panel, inventory drag/drop integration, item search/tooltip rendering, Market tabs and filters, Town NPC presentation, Mailbox/Inbox/Sent/Compose/detail UI, gold and mail badges.
- API: existing `modules/market` and `modules/mail`, REST controllers/services, shared inventory-capacity/stack-merge behavior, Character gold state, and System Journal error handling.
- Persistence: extend MailMessage to represent sender/recipient snapshots, body, read/attachment state, gold and item-instance attachments; add forward-only migration/indexes/constraints as required. Existing MarketOrder/MarketDeal should be reused where practical.
- Catalogue: register Mailbox for every `type: town` map and keep root/frontend map/NPC data synchronized.
- Operations: idempotent expiry/recovery for listings and mail, safe handling of any legacy active buy-order escrow, migration audit, API/frontend builds, catalog validation, and transaction-focused tests. No migration execution, live database mutation, or deployment is part of proposal.
