# Spec Delta

## Purpose

Provides a minimal but complete in-game mailbox for player-to-player messages and item/gold attachments, as well as system correspondence from the Auction House. Mail is accessed through the Mailbox NPC in every Town, while durable attachments let players trade safely even when either party is offline or has a full inventory.

## ADDED Requirements

### Requirement: Mailbox access is Town-only

The system SHALL provide a Mailbox NPC capability in every map whose canonical map type is `town`. Sending mail, opening the mailbox, collecting attachments, and other mailbox operations SHALL require the character to be settled in a Town: the authoritative current map MUST be a Town, character status MUST be Town, and no travel intent or pending map transition may be active. Market-generated mail may be created from any map, but its attachments may only be collected in a Town.

#### Scenario: Open the Mailbox in Town

- **WHEN** the character is settled in a Town and chooses the Mailbox NPC
- **THEN** the Inbox, Sent, Compose, and message-detail views are available

#### Scenario: Attempt mailbox operations during Travel

- **WHEN** the character tries to send mail or collect an attachment while travelling, on a grind map, or in a pending map transition
- **THEN** the server rejects the operation and leaves every message, attachment, item, and gold balance unchanged

#### Scenario: Market delivery while away from Town

- **WHEN** a market purchase creates an item or gold delivery while the recipient is on a grind map
- **THEN** the message persists in the recipient's mailbox, but the recipient cannot collect its attachments until settled in a Town

### Requirement: Mail messages have sender, recipient, content, and independent read and attachment state

Each mail message SHALL show a sender name, recipient name, subject, body, and creation/expiry time. Character names SHALL be stored as snapshots for display, and Auction House-generated mail SHALL show “Auction House” as the sender. Mail SHALL support at most one attached item stack (including the exact equipment instance when applicable) and an optional gold attachment; a message may carry either attachment or both. Read/unread state SHALL be independent from attachment collection state. The mailbox SHALL show Inbox and Sent views and an unread-message count. Messages and their uncollected attachments expire 30 days after creation, in line with the existing retention contract.

#### Scenario: Open an Auction House delivery

- **WHEN** a player opens a market-generated delivery message
- **THEN** the sender is displayed as “Auction House”, the recipient name is correct, the subject/body explain the delivery, and the attached item or gold is shown

#### Scenario: Read mail with attachments

- **WHEN** a player opens an unread message that still has attachments
- **THEN** the message becomes read but its attachments remain uncollected and available

#### Scenario: Expire uncollected mail

- **WHEN** a message reaches 30 days old with attachments that were not collected
- **THEN** the message and its uncollected attachments are deleted and cannot be collected afterward

### Requirement: Sending mail escrows attachments atomically

The system SHALL let a settled Town resident compose mail to another existing character by character name, with a required subject and body, one optional item stack attachment, and one optional gold attachment. The UI SHALL request explicit confirmation before sending. Sending SHALL validate recipient, quantity, gold, canonical item identity, and exact source inventory row; gold and item attachments MUST be removed from the sender in the same transaction that creates the message. Equipment attachments SHALL have quantity one and preserve the source instance data. Sending mail has no postage fee in this release.

#### Scenario: Send item and gold

- **WHEN** the sender confirms a message with a valid item stack and gold attachment
- **THEN** the selected quantity and gold are escrowed and exactly one message containing those attachments is created for the recipient

#### Scenario: Reject an invalid attachment

- **WHEN** the sender lacks the stated item quantity or gold, selects a stale inventory row, exceeds the attachment limits, or targets an invalid recipient
- **THEN** sending fails atomically and creates no message or partial asset transfer

#### Scenario: Confirm before sending

- **WHEN** the player submits a composed message
- **THEN** the UI presents a confirmation naming the recipient and summarizing the subject and attachments before the server commits the send

### Requirement: Collecting mail attachments is atomic and capacity-aware

The system SHALL allow the recipient to collect message attachments only in a settled Town. Collection MUST validate that the message belongs to the authenticated recipient, that it has not expired, and that its attachments have not already been collected. Item capacity SHALL account for free inventory slots and available room in compatible existing stacks up to each item's canonical maximum stack size. Gold, item insertion, and attachment-state update MUST commit atomically. A capacity or validation failure SHALL leave the attachment available and must not partially credit gold or insert items.

#### Scenario: Collect a stack into existing inventory stacks

- **WHEN** the recipient has enough combined capacity in compatible stacks and/or free slots for the attached quantity
- **THEN** the whole item attachment is inserted into inventory, attached gold is credited, and the message's attachment state is marked collected in the same transaction

#### Scenario: Inventory capacity is insufficient

- **WHEN** the recipient lacks enough combined stack room and free slots for the entire attachment
- **THEN** collection fails with a clear inventory-space message, no gold or item is transferred, and the message remains available for a later attempt

#### Scenario: Collect gold-only mail with a full inventory

- **WHEN** the recipient collects a gold-only message while their inventory has no free capacity
- **THEN** gold is credited and the attachment state is updated without requiring an inventory slot

#### Scenario: Concurrent collect attempts

- **WHEN** two collection requests concurrently target the same message
- **THEN** at most one request receives the attachments and the other cannot duplicate the item or gold

### Requirement: Message access and deletion are authorized per character

The system MUST ensure that Inbox, Sent, message read state, attachment collection, and deletion queries are scoped to the authenticated character's recipient or sender relationship. A character SHALL NOT read, mutate, collect, or delete another character's message by guessing its ID. Deleting a received message with uncollected attachments SHALL be rejected; sender-side deletion SHALL only hide the message from that sender's Sent view and MUST NOT destroy recipient attachments. Messages with no outstanding attachment may be deleted from the recipient's Inbox view.

#### Scenario: Attempt to access another character's mail

- **WHEN** a character requests a message ID that is not in their Inbox or Sent folder
- **THEN** the request is rejected without exposing or changing the message

#### Scenario: Delete mail with uncollected assets

- **WHEN** the recipient tries to delete a message that still contains an uncollected item or gold attachment
- **THEN** deletion is rejected and the attachment remains recoverable until collection or expiry

#### Scenario: Delete a sent copy

- **WHEN** a sender deletes a message from Sent
- **THEN** it disappears from that sender's Sent view but remains in the recipient's Inbox with all attachments intact

### Requirement: Market and system mail use the same durable mailbox

The system SHALL let trusted server-side workflows create mail with an optional item-instance attachment and/or gold attachment without impersonating a player character. Market purchases SHALL create an Auction House item message for the buyer and an Auction House gold-proceeds message for the seller in the same transaction as the deal. Cancelling or expiring a sell listing SHALL create an Auction House return message for the remaining item escrow. Repeated or retried workflows MUST NOT create duplicate mail or duplicate attachments.

#### Scenario: Complete a market purchase

- **WHEN** a sell listing is purchased
- **THEN** the buyer's item mail and seller's gold mail are persisted together with the order/deal changes, and neither asset is credited directly to the seller's Character or buyer's Inventory

#### Scenario: Return a cancelled or expired listing

- **WHEN** a listing is cancelled or expires with remaining item escrow
- **THEN** the Auction House sends exactly one item-return message for that remaining escrow

#### Scenario: Retry system delivery

- **WHEN** the market or expiry processor retries an operation that already committed
- **THEN** the existing operation is recognized and no second message or attachment is created
