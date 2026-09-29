# Capability: play-and-character-ui

## ADDED Requirements

### Requirement: shared game shell

The frontend SHALL render /play as a NanoMMO fantasy MMORPG client using semantic Angular
components and CSS grid/flex, with a persistent top bar, left character summary, center
map/context and inventory, right grind/proficiency panel, and collapsible chat drawer.

#### Scenario: desktop shell
- GIVEN a viewport at least 1200px wide
- WHEN /play is rendered
- THEN the three gameplay zones and top HUD are simultaneously visible
- AND the center map is the primary visual focus
- AND the interface uses the centralized dark fantasy visual tokens
- AND no concept/reference image is used as the complete UI

#### Scenario: responsive shell
- GIVEN a viewport below 1200px
- WHEN the shell renders
- THEN secondary panels collapse or stack according to PLAY_WINDOW_SPEC.md
- AND the map, current battle state, character identity, and inventory remain usable
- AND mobile is not implemented by simply scaling the desktop screenshot

### Requirement: gameplay routes

The frontend SHALL expose authenticated routes /play, /play/grind, /play/character,
and /play/gambits.

#### Scenario: grind route
- WHEN an authenticated client opens /play/grind
- THEN the shared game shell renders the grind view
- AND map selection, battle status, inventory, and progression are available

#### Scenario: character route
- WHEN an authenticated client opens /play/character
- THEN the Character management shell renders with Character selected by default
- AND its Character, Gambits, and Equipment sub-tabs are available

#### Scenario: gambit deep-link
- WHEN an authenticated client opens /play/gambits
- THEN the same Character management shell is rendered
- AND the Gambits tab is selected
- AND the Gambit editor implementation is the same component tree used by /play/character

### Requirement: authoritative gameplay state

The frontend SHALL bootstrap character and live battle state from REST and SHALL use
the existing /game WebSocket only for synchronization. It SHALL NOT alter backend
contracts or infer authoritative state from animation completion.

#### Scenario: initial bootstrap
- GIVEN an authenticated player enters the gameplay shell
- WHEN the page initializes
- THEN authoritative character state is loaded from the existing REST contract
- AND the live unresolved battle queue is loaded from GET /battles/queue
- AND the stores expose loading, loaded, empty, error, and reconnecting states

#### Scenario: reconnect
- GIVEN the socket disconnects while the character is grinding
- WHEN the socket reconnects
- THEN the frontend resynchronizes character state and GET /battles/queue
- AND stale local queue state is replaced by the REST snapshot
- AND the client does not replay or infer missed battles locally

#### Scenario: queue update
- GIVEN a battle:queueUpdated event with entries
- WHEN the event is received
- THEN BattleStore replaces the live unresolved queue with those entries
- AND the active battle is selected from the authoritative timestamps/order
- AND the client does not append, remove, reorder, or resolve entries from a local timer

### Requirement: server-timed battle presentation

The frontend SHALL render battle progress solely from server-provided startAt and endAt.
It SHALL never compute battle outcomes, resolution timing, XP rewards, drops, or queue
refills as authoritative actions.

#### Scenario: active battle progress
- GIVEN an unresolved queue entry with startAt and endAt
- WHEN the battle bar renders
- THEN progress is derived from those timestamps and the current clock
- AND the UI can animate the presentation without scheduling a server resolution

#### Scenario: battle resolution event
- GIVEN battle:resolved with characterAfter and reward fields
- WHEN the event is received
- THEN CharacterStore updates from characterAfter
- AND the reward/event presentation uses the supplied values
- AND the frontend waits for the subsequent authoritative queue state instead of inventing one

#### Scenario: death event
- GIVEN character:died with a deathLog
- WHEN the event is received
- THEN the active battle presentation stops
- AND the death information is surfaced
- AND the client resynchronizes character and queue state
- AND it does not create a replacement queue

### Requirement: grind presentation

The grind view SHALL present the current map as an illustrated selectable board rather
than a live combat scene, with a 50-slot inventory and compact battle/progression data.

#### Scenario: map board
- GIVEN map data and the character's current map state
- WHEN /play/grind renders
- THEN the title shows the current location using authoritative map state
- AND selectable grind tiles expose selected, locked, hover, and keyboard-focus states
- AND the map contains no character movement or moving monster simulation

#### Scenario: inventory grid
- WHEN the main grind view is loaded
- THEN exactly 50 inventory cells are visible in the desktop inventory grid
- AND empty cells remain visible
- AND stack counts and equipment item identity are represented from InventoryStore

#### Scenario: grind states
- GIVEN no active queue, an active queue, reconnecting state, or dead/town-bound state
- WHEN the grind view renders
- THEN the corresponding empty/searching/active/reconnecting/dead presentation is shown
- AND the UI does not manufacture a battle outcome from the state label

### Requirement: character management

The Character view SHALL expose authoritative character attributes, derived stats,
status, equipment, weapon proficiency, and pending attribute allocation.

#### Scenario: attribute allocation pending
- GIVEN the character has unspent attribute points
- WHEN the player changes one or more +/- controls
- THEN only local pending allocation state changes
- AND current server values remain available for Reset
- AND a preview delta is visible

#### Scenario: apply allocation
- GIVEN pending attribute changes
- WHEN the player selects Apply Changes
- THEN the frontend sends the existing allocation REST request
- AND on success the authoritative CharacterStore state replaces pending state
- AND on rejection pending state is discarded and the server error is shown

#### Scenario: zero points
- GIVEN unspentAttributePoints is zero
- WHEN the Character tab renders
- THEN all six attribute rows remain visible
- AND allocation controls are disabled with an explanatory state

### Requirement: equipment and Gambit interactions

The frontend SHALL represent the eight equipment slots and SHALL use Angular CDK
drag/drop for equipment management. It SHALL implement the existing three-page Gambit
model without changing its catalog, validation, or battle restrictions.

#### Scenario: equipment layout
- WHEN the Character Equipment tab renders
- THEN all eight slots are visible: head, body, mainHand, offHand, shoes, cape,
  accessoryLeft, and accessoryRight
- AND the selected item detail uses authoritative inventory/equipment data

#### Scenario: equipment drop rejection
- GIVEN an attempted equipment drop is rejected by the server
- WHEN the mutation fails
- THEN the previous authoritative visual state is restored
- AND a specific rejection state is shown

#### Scenario: Gambit editor
- WHEN the Gambits tab renders
- THEN three pages and the active-page state are visible
- AND each page supports up to 20 reorderable rows
- AND each row supports condition 1, optional AND/OR plus condition 2, action, and enabled state
- AND unavailable actions remain visible but disabled with explanatory feedback
- AND field-level server validation can identify the failing control

### Requirement: shared visual system and accessibility

The frontend SHALL centralize the PLAY_WINDOW_SPEC.md visual tokens and SHALL provide
visible interaction states without relying on color alone.

#### Scenario: visual consistency
- WHEN any gameplay screen renders
- THEN panels use the shared dark fantasy surface/frame language
- AND headings/data use the specified readable typography roles
- AND no gameplay screen uses a SaaS card grid, glassmorphism, or white modern-app theme

#### Scenario: accessibility and reduced motion
- WHEN an interactive element receives keyboard focus
- THEN a visible focus treatment is rendered
- AND when prefers-reduced-motion is enabled, nonessential animations are disabled
- AND unavailable/disabled states have text or icon context beyond color alone
