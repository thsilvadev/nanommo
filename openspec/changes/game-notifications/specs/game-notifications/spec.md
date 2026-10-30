# Game Notifications

## ADDED Requirements

### Requirement: Persistent in-game discovery acknowledgements
The system SHALL persist discovery acknowledgements per character for newly available Gambit parameter options, NPCs, and quest introductions, and synchronize changes across sessions.

#### Scenario: Newly learned Gambit option
- **WHEN** a skill or eligible consumable becomes newly available in an Action block parameter-row select
- **THEN** that option displays a dot until selected
- **AND** Condition selectors and Action-type selectors never display discovery dots
- **AND** selecting the option immediately acknowledges it without requiring a save

#### Scenario: Eligible Gambit item
- **WHEN** an item option is added to Gambit item parameters
- **THEN** only consumables other than food are eligible options

### Requirement: Progression dots
The system SHALL show attribute and mastery dots while the character has points available to spend.

#### Scenario: Attribute points
- **WHEN** the character has unspent attribute points
- **THEN** show dots on topbar Character, Character tab, and beside the allocation heading
- **AND** hide them when all points are spent

#### Scenario: Mastery points
- **WHEN** a weapon has mastery upgrade points available
- **THEN** show a dot on topbar Character and Mastery tab
- **AND** show a dot beside that weapon's row only when that weapon has points available

### Requirement: NPC and quest discovery dots
The system SHALL show NPC discovery indicators only when the NPC is currently available and the city has been revealed.

#### Scenario: Fogged city
- **WHEN** a city is still hidden by fog
- **THEN** no city discovery dot is shown

#### Scenario: Newly available NPC in revealed city
- **WHEN** a new NPC becomes available in a revealed city
- **THEN** show a dot on the city and on that NPC selector option until the NPC is selected

#### Scenario: Quest introduction
- **WHEN** a quest becomes available through an NPC
- **THEN** show quest dots on the NPC option and the first quest-specific dialogue/action
- **AND** clear the quest acknowledgement when that first interaction is opened, even if it does not start or accept the quest

### Requirement: Mailbox unread dots
The system SHALL show a dot for each unread message and keep it until read and all available attachments are claimed.

#### Scenario: Message with attachments
- **WHEN** a message has items or currency attached
- **THEN** its dot remains until the message is read and every attachment is claimed

### Requirement: Native browser notifications
The system SHALL support Web Push notifications while the game tab is closed, subject to browser permission and push support.

#### Scenario: Latest pending notification
- **WHEN** one or more notification events occur while no subscribed browser client is available
- **THEN** only the most recent event is retained
- **AND** it has no expiry
- **AND** all earlier pending events are discarded
- **AND** it is cleared after the Service Worker confirms it invoked display

#### Scenario: Real-time delivery
- **WHEN** the browser is available and a new eligible event occurs
- **THEN** notify each event individually in real time rather than aggregating events

#### Scenario: Inventory full
- **WHEN** inventory transitions from not-full to full
- **THEN** send one notification
- **AND** send another only after inventory space is freed and it becomes full again

#### Scenario: Rare drop discarded
- **WHEN** a Bliss Stone or Divine Shard drop is discarded because inventory is full
- **THEN** send one notification for that drop without aggregation

#### Scenario: Level up
- **WHEN** the character levels up
- **THEN** send at most one level-up notification

#### Scenario: Market sale
- **WHEN** an item is sold in the Market
- **THEN** send one notification for each sold item

#### Scenario: Notification click
- **WHEN** the user clicks a native notification
- **THEN** focus an existing game window or open the game
- **AND** navigate to the relevant feature after authentication

#### Scenario: Localization
- **WHEN** a native notification is displayed
- **THEN** its title and body use the character's configured game locale
