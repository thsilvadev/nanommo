# Oracle Respec

## ADDED Requirements

### Requirement: Town availability
The Oracle MUST be present on every map with type `town` except Outpost. Server-side service access MUST follow the canonical map NPC list.

#### Scenario: Oracle appears in a capital
- **WHEN** a character enters a Town map other than Outpost
- **THEN** the Oracle appears in the Town NPC selector

#### Scenario: Oracle is excluded from Outpost
- **WHEN** a character enters Outpost
- **THEN** the Oracle is not listed or accessible

### Requirement: Paid attribute respec
A settled character in a Town with the Oracle MAY pay 600 Soul Tokens. The server MUST atomically deduct the fee, reset STR/AGI/DEX/VIT/INT/LUK to 5, and add all points invested above those base values to `unspentAttributePoints`, preserving already unspent points. Insufficient balance or invalid location MUST leave currency and attributes unchanged.

#### Scenario: Respec succeeds
- **WHEN** a settled character has at least 600 Soul Tokens and confirms the Oracle respec in a valid Town
- **THEN** 600 Soul Tokens are deducted, all six attributes become 5, and the spent points are returned

#### Scenario: Insufficient balance
- **WHEN** the character has fewer than 600 Soul Tokens
- **THEN** the request is rejected and no Character fields are changed

#### Scenario: Invalid location or unsettled movement
- **WHEN** the character requests a respec outside a valid Town, in Outpost, or while traveling/transitioning
- **THEN** the request is rejected without charging currency or resetting attributes

### Requirement: Confirmation and feedback
The UI MUST present the cost and confirmation before the request. It MUST play the respec sound only after a successful server response.

#### Scenario: Confirmed successful respec
- **WHEN** the server confirms a successful reset
- **THEN** the updated Character snapshot is applied and `respec.mp3` plays
