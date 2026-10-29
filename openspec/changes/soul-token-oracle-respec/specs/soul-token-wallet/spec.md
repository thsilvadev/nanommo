# Soul Token Wallet

## ADDED Requirements

### Requirement: Initial Soul Token grant
Each existing Character MUST receive an initial balance of 1,000 Soul Tokens through a one-time migration. Each newly created Character MUST start with 1,000 Soul Tokens.

#### Scenario: Existing character receives the initial balance
- **WHEN** the Soul Token migration is applied to a legacy database
- **THEN** each existing Character has a balance of 1,000 Soul Tokens

#### Scenario: New character is created
- **WHEN** an account creates its Character after the feature is available
- **THEN** that Character starts with 1,000 Soul Tokens

### Requirement: Visible wallet
The play topbar MUST display the authoritative Soul Token balance next to Gold with a glowing blue-violet coin icon featuring a square hole.

#### Scenario: Character opens the play interface
- **WHEN** the authoritative Character snapshot is rendered
- **THEN** the topbar shows both Gold and Soul Token balances

### Requirement: No acquisition path in this release
The system MUST NOT expose any drop, vendor, market, mail, gathering, quest, or other earning route for Soul Tokens in this release.

#### Scenario: Player checks gameplay reward systems
- **WHEN** the player fights, gathers, completes quests, trades, or uses a vendor
- **THEN** Soul Tokens are not awarded or transferred by those systems
