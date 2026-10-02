# Spec Delta

## Purpose

Provides a dedicated touch-first game shell so NanoMMO remains fully usable on phones without hiding core character, battle, map, inventory, Gambit, and town interactions.

## ADDED Requirements

### Requirement: Mobile shell composition
The mobile Play experience SHALL use a fixed header, a five-item bottom navigation, a full-height character panel on the Battle/Town cockpit, and an overlaid bottom sheet for contextual Battle or Town content.

#### Scenario: Mobile Play loads
- **WHEN** an authenticated player opens `/play/grind` or one of `/play/m/battle`, `/play/m/map`, `/play/m/items`, `/play/m/gambits`, `/play/m/character` below 900px wide
- **THEN** the player sees the mobile shell; `/play/grind` resolves to the Battle cockpit and the `/play/m/*` route selects the corresponding mobile tab.

#### Scenario: Desktop remains unchanged
- **WHEN** an authenticated player opens `/play/grind`, `/play/character`, or `/play/gambits` at 900px or wider
- **THEN** the existing desktop shell remains the rendered shell and mobile-only navigation is not shown.

### Requirement: Mobile navigation and routes
The mobile shell SHALL expose exactly these tab routes: `/play/m/battle`, `/play/m/map`, `/play/m/items`, `/play/m/gambits`, and `/play/m/character`. `/play/grind` SHALL remain the desktop Grind route and SHALL act as the Battle alias below 900px. At viewport >=900px, each `/play/m/*` route SHALL redirect to its equivalent desktop route, with mobile Gambits redirecting to `/play/gambits` so the desktop Gambits/Character chrome is preserved.

#### Scenario: Bottom navigation changes route
- **WHEN** the player taps one of the five mobile navigation items
- **THEN** the router navigates to that item's real route and the selected item exposes an accessible current-state indicator.

#### Scenario: Android back navigation
- **WHEN** the player navigates between mobile tab routes and presses the browser or Android back action
- **THEN** the browser returns to the previous mobile `/play/m/*` route rather than collapsing or replacing the shell.

### Requirement: Sheet detents
The contextual mobile sheet SHALL support exactly three detents representing approximately 10%, 50%, and 90% of the available body height, SHALL never be shorter than 88px, and SHALL persist the selected grind and town detents independently in local storage.

#### Scenario: Default detents
- **WHEN** the player first enters mobile Battle
- **THEN** the sheet starts at 50%, and when first entering Town it starts at 90%.

#### Scenario: Detent persistence
- **WHEN** the player changes a grind or town detent and reloads or revisits that context
- **THEN** that context restores its last selected detent without changing the other context's saved detent.

#### Scenario: Sheet drag
- **WHEN** the player drags the sheet handle
- **THEN** the sheet follows the pointer during the drag and snaps to the nearest of the three detents on release.

#### Scenario: Handle tap
- **WHEN** the player taps the sheet handle without dragging
- **THEN** the sheet cycles 10% to 50% to 90% to 10%.

### Requirement: Mobile item interaction
On touch devices, item interaction SHALL use a single-tap action sheet with touch targets of at least 44px and SHALL not require double-tap or drag-and-drop.

#### Scenario: Consumable action
- **WHEN** the player taps a consumable item
- **THEN** an action sheet opens with Usar, Detalhes, and Fechar actions, and Usar delegates to the existing authoritative inventory action.

#### Scenario: Equipment action
- **WHEN** the player taps an equipment item in inventory
- **THEN** an action sheet offers Equipar or Substituir <current>, Detalhes, and Fechar as applicable.

#### Scenario: Equipped item action
- **WHEN** the player taps an equipped item
- **THEN** an action sheet offers Desequipar, Detalhes, and Fechar as applicable.

#### Scenario: Vendor sale
- **WHEN** the player is in Town and taps a sellable monster part in the Items tab
- **THEN** the action sheet offers Vender and the existing authoritative vendor flow is used.

### Requirement: Mobile battle presentation
The mobile Battle route SHALL keep the character panel behind the contextual sheet and SHALL expose the complete active battle log for the current battle, with search, active, reconnecting, idle, and Town states represented without inventing gameplay facts.

#### Scenario: Active battle log
- **WHEN** a BattleQueueEntry is active
- **THEN** the mobile sheet can show all log events whose ticks have elapsed, in ascending tick order, and the log is scrollable.

#### Scenario: Log auto-follow
- **WHEN** new log lines arrive while the player is already at the bottom
- **THEN** the log follows the new lines; when the player has scrolled away from the bottom, the UI does not steal the scroll position and instead exposes a new-lines affordance.

### Requirement: Mobile character summary
The mobile character panel SHALL expose the character identity and progressively reveal portrait, HP/SP, food/diet state, status, and equipment as the sheet rises, without making diet or combat calculations client-authoritative.

#### Scenario: Sheet coverage
- **WHEN** the sheet is at 10%, 50%, or 90%
- **THEN** the sheet covers the character panel from the bottom so that the visible character information decreases from equipment and detail toward only identity at the highest sheet detent.

### Requirement: Mobile menu and settings
The mobile menu SHALL expose Chat, Configurações, and Sair da conta; Settings SHALL expose volume and the existing account deletion flow; Chat SHALL remain the existing mock rather than becoming a realtime implementation.

#### Scenario: Settings
- **WHEN** the player opens Configurações
- **THEN** a modal exposes the existing persisted volume control and the existing account deletion confirmation flow.

#### Scenario: Reconnecting
- **WHEN** the game socket is reconnecting
- **THEN** the mobile header visibly communicates the reconnecting state without hiding the gameplay shell.

### Requirement: Touch and accessibility safety
Interactive mobile controls SHALL provide at least 44px touch targets, SHALL use manipulation-safe touch behavior, SHALL support visible keyboard focus where keyboard input exists, SHALL respect reduced motion, and SHALL use safe-area insets for notched devices.

#### Scenario: Safe-area device
- **WHEN** the shell is rendered on a device with top or bottom safe-area insets
- **THEN** the header and bottom navigation include the relevant inset without causing horizontal overflow.

#### Scenario: Reduced motion
- **WHEN** prefers-reduced-motion is enabled
- **THEN** sheet transitions and decorative diet animation do not animate the layout or decoration continuously.

### Requirement: Shared presentation ticker
The four Play presentation clocks SHALL use one 250ms TickerService signal: CharacterSummary battle display, InventoryGrid elapsed display, BattleProgress, and GrindInfo. The ticker SHALL stop while `document.hidden` and resume on `visibilitychange`. The CharacterSummary 1s Town polling and MapBoard 1s Town polling SHALL remain unchanged, and LoginMusicService `requestAnimationFrame` SHALL remain unchanged.

#### Scenario: Hidden document
- **WHEN** the document becomes hidden
- **THEN** TickerService stops its 250ms interval without changing server-side grind/battle processing.

#### Scenario: Document becomes visible
- **WHEN** the document becomes visible again
- **THEN** TickerService immediately refreshes its time signal and resumes the 250ms interval.

### Requirement: Shared modal sizing
TradeModalComponent and AccountDeleteModalComponent SHALL each exist as a single shared component. TradeModal SHALL remain a centered dialog on desktop and SHALL become a bottom-anchored rounded-top panel below 900px with max-height 90dvh and slide-up motion. Its mobile controls SHALL use the specified readable font sizes, 48px button targets, 8px action gap, and numeric input mode. AccountDeleteModal SHALL remain centered at all sizes, use a 16px confirmation input, 14px body text, and 48px buttons, without bottom-sheet dismissal behavior.

#### Scenario: Mobile trade confirmation
- **WHEN** a touch viewport opens a trade confirmation
- **THEN** the same TradeModalComponent renders anchored to the bottom with a stable quantity stepper and readable mobile typography.

#### Scenario: Destructive confirmation
- **WHEN** account deletion is opened on any viewport
- **THEN** the same centered AccountDeleteModalComponent requires the existing DELETE confirmation flow.

### Requirement: Existing server authority
The mobile shell SHALL use the existing Character, Inventory, Battle, Vendor, Diet, Gambit, and socket contracts and SHALL NOT calculate battle outcomes, mutate authoritative game state locally, or add backend endpoints for this feature.

#### Scenario: Authoritative item action
- **WHEN** a mobile item action is confirmed
- **THEN** the existing REST/store operation performs validation and the UI converges to the resulting authoritative state.

#### Scenario: No mobile drag preview
- **WHEN** a touch device is used
- **THEN** CDK drag interaction is disabled for inventory, equipment, vendor, and Gambit reordering; no drag preview is required for mobile actions.