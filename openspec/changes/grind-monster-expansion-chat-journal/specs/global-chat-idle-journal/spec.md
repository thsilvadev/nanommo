# Capability: global-chat-idle-journal

## ADDED Requirements

### Requirement: Global is the only player-send channel and history is durable

The authenticated player chat SHALL expose only the Global channel. Valid Global messages SHALL be persisted in PostgreSQL and broadcast to connected clients across API instances. The newest CHAT_HISTORY_RETENTION_LIMIT messages SHALL be retained, with the environment variable defaulting to 20 and required to parse as a positive integer. Historical records SHALL contain a stable ID, sender-name snapshot, message text and server timestamp; the sender association SHALL be nullable/SET NULL if the character is deleted.

#### Scenario: Global message is sent
- GIVEN an authenticated character sends a valid message to Global over Socket.IO `/game` event `chat:send`
- WHEN the server validates, persists, and accepts it
- THEN the Socket.IO acknowledgment returns the persisted message DTO (including ID and server timestamp)
- AND the frontend displays the row and clears the draft only when that acknowledgment is valid
- AND it is broadcast to all connected Global subscribers with the original server timestamp
- AND other destinations such as Town, Party or Whisper are rejected as unsupported.

#### Scenario: Global history survives API restart
- GIVEN accepted Global messages in PostgreSQL
- WHEN the API restarts or a client reloads/reconnects
- THEN the newest retained Global messages are loaded from PostgreSQL in chronological order
- AND no duplicate or client-invented messages are introduced.

#### Scenario: Retention is bounded and configurable
- GIVEN CHAT_HISTORY_RETENTION_LIMIT is set to a positive integer N
- WHEN new Global messages are committed, including concurrent sends
- THEN the retained table history is bounded to the newest N messages
- AND an absent environment value defaults to 20
- AND an invalid non-positive/non-integer value fails startup configuration validation rather than creating an unbounded table.

#### Scenario: Message safety and limits
- GIVEN a character sends a Global message
- WHEN text is empty, exceeds 200 characters, the channel is invalid or the user exceeds one accepted message every five seconds
- THEN the server rejects the message with an appropriate transient error
- AND it is neither persisted as an accepted message nor broadcast.
- AND text is rendered as escaped text, never trusted HTML.

### Requirement: Transient channels and Idle Journal history use Redis only

The channel-history abstraction SHALL store personal Idle Journal events and future transient channel history in Redis, not in PostgreSQL. Journal keys/room delivery SHALL be scoped to the authenticated character, and transient lists SHALL respect the configured bounded retention. Reconnection may restore entries still present in Redis; Journal history has no PostgreSQL durability guarantee.

#### Scenario: Journal belongs to one character
- GIVEN a Journal event is produced for character A
- WHEN character A and character B load or subscribe to Journal
- THEN character A can retrieve/receive the event
- AND character B cannot retrieve or receive it
- AND the Journal event creates no PostgreSQL chat-message row.

#### Scenario: Redis restarts or loses a journal key
- GIVEN a Journal event previously existed only in Redis
- WHEN its Redis history no longer exists
- THEN the application does not reconstruct or claim it from PostgreSQL
- AND new Journal events resume normal collection.

### Requirement: Global chat and Idle Journal interleave in the Grind panel

The Grind column SHALL render a chat panel directly below the map and SHALL not use the old floating drawer. The panel SHALL show five message rows at a time, provide a scrollable history, show a single-line message input and Send button, and submit on Enter. The frontend SHALL display no more than the latest 20 combined visible rows irrespective of server retention configuration.

#### Scenario: Submit from either control
- GIVEN a valid Global message in the input
- WHEN the player clicks Send or presses Enter
- THEN exactly one send operation is issued through the same validation path
- AND the input is cleared only after acceptance.

#### Scenario: Restore and combine histories
- GIVEN retained Global history and Redis Journal history exist
- WHEN the Grind panel loads/reconnects
- THEN both sources are loaded through their service APIs
- AND are merged by server timestamp
- AND only the latest 20 combined rows are rendered while five rows remain visible at once.

#### Scenario: System toggle is enabled by default
- GIVEN a new browser preference with no saved choice
- WHEN the chat panel first loads
- THEN System display is enabled
- AND Global messages are always visible regardless of the System toggle.

#### Scenario: System toggle hides without stopping collection
- GIVEN the System toggle is off
- WHEN System events arrive
- THEN they continue to be stored for that character in Redis but are hidden from the combined view
- AND switching the toggle on restores still-retained System rows
- AND the toggle choice persists locally across reloads.

#### Scenario: System rows have no sender label
- GIVEN a System/Journal row is displayed
- WHEN it is rendered in the combined view
- THEN no synthetic “Idle Journal” sender label is shown
- AND normal System messages are green while explicit error-severity messages are red.

#### Scenario: Read older messages while new messages arrive
- GIVEN the user has scrolled above the newest messages
- WHEN a new Global or Journal event arrives
- THEN the current reading position is preserved
- AND automatic scrolling follows new messages only when the view was already at the bottom.

### Requirement: Idle Journal emits only confirmed gameplay events

The server SHALL generate personal Journal rows for exactly these event families, using committed state and these English display templates:
1. “You have gathered {gatherQuantity}x {itemName} in {mapName}”
2. “You passed by a {fledMonsterName} and moved on.”
3. “{aggressiveMonsterName} found you, but you misled it!”
4. “You managed to flee the battle against {aggressiveMonsterName}”
5. “{monsterName} has stolen {stolenQuantity}x {stolenItem} from you! Such a shame...”
6. “You just ate {eatenFood}”

#### Scenario: Gathering award
- GIVEN a material and quantity were successfully awarded and committed
- WHEN the collection event is published
- THEN one gathered-item entry names the real quantity, canonical item name and map
- AND no entry is produced for an empty map pool or failed award.

#### Scenario: Passive encounter or pre-combat dodge
- GIVEN Gathering/Traveling selects a non-aggressive monster, or a seeded pre-combat dodge of an aggressive monster succeeds
- WHEN the encounter is projected while constructing the future battle queue
- THEN its pass-by/dodge decision may be computed ahead of time, but its System row is scheduled for the projected encounter's start timestamp and is not published during queue generation
- AND the delayed publisher verifies the Character is still in the same relevant Gathering/Travel activity before publishing
- AND the corresponding passive-pass-by or misled-aggressive entry is produced once at that scheduled boundary
- AND a failed dodge produces no successful-dodge entry.

#### Scenario: Successful FLEE during a battle
- GIVEN a battle is active while the character is Traveling/FLEEing
- WHEN a successful FLEE state is committed
- THEN one “managed to flee” entry is emitted
- AND an unsuccessful attempt or a normal battle end emits none.

#### Scenario: Item theft
- GIVEN the resolved/checkpoint inventory state confirms that a named quantity was stolen
- WHEN that battle/checkpoint mutation commits
- THEN the Journal reports the actual monster, quantity and item
- AND a failed theft roll or uncommitted attempt does not produce a message.

#### Scenario: Food consumption
- GIVEN manual eating or Auto Feed actually consumed a named food item
- WHEN the inventory/diet result commits
- THEN one “You just ate …” Journal row is produced
- AND mere Auto Feed eligibility, an unavailable stack or a digestion skip produces none.

### Requirement: Chat persistence and fan-out have separated responsibilities

Chat orchestration/validation, PostgreSQL Global history, Redis transient history, Journal event formatting and Socket.IO adapters SHALL have separate service responsibilities. Persistence retention SHALL not be implemented in the gateway or frontend. Global broadcasting SHALL use cross-instance delivery; private Journal publication SHALL target only the owning character.

#### Scenario: Redis publication failure
- GIVEN a Global message has been durably committed
- WHEN live event fan-out fails
- THEN the durable history remains correct, the failure is logged and clients can retrieve the message from the next history refresh
- AND the service does not roll back already committed Global history.

### Requirement: Hungry Town exit failures appear as red System rows

When a character tries to leave a Town for a Grind map while hungry, the server SHALL reject the travel and publish one character-scoped System entry with error severity. The frontend SHALL suppress the duplicated generic map-error display for this specific rejection while leaving other map errors visible.

#### Scenario: Town Guard blocks departure while hungry
- GIVEN a character is in Town with no active food or digestion remaining
- WHEN they click a Grind map
- THEN travel is rejected and location stays in Town
- AND System shows “Town Guard: You are hungry! Eat something or go cleanse your sins for a change.” in red
- AND the same rejection is not also shown as the generic map error.
