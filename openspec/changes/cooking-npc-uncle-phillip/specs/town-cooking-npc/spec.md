# Town Cooking NPC

## ADDED Requirements

### Requirement: Uncle Phillip exists only in Sierra Village
The generic Town NPC catalogue SHALL define `uncle_phillip`, named **Uncle Phillip**, with a `cooking` capability, and `map_town` SHALL list him in its `npcIds`. He SHALL not be listed by other Town maps. His greeting SHALL be exactly: “Hmmm… delicious… this might go well with tha - Oy! Young traveler! I know you have a great taste for food. You wanna use my kitchen? Fell free to, oy!”

#### Scenario: NPC placement
- **WHEN** a Character is settled in Sierra Village and loads the Town NPC list
- **THEN** Uncle Phillip appears in the generic selector with the requested greeting and Cooking action
- **WHEN** a Character is in another Town
- **THEN** Uncle Phillip is absent from that Town's NPC list and cooking cannot be started there

### Requirement: Cooking modal interaction
The NPC's dialogue UI SHALL expose `[I'd like to cook]`. Selecting it SHALL open a centered Cooking modal approximately 50% of desktop viewport width (responsive on narrow screens), with a vertically stacked list of nearly full-width horizontal recipe cards. Each card SHALL style the food name distinctly, display its existing food icon, ingredients and quantities, required Cooking level, and a `COOK` button. The button SHALL be disabled when the Character lacks the required level, ingredients, or reservable output capacity. Future recipes SHALL be clearly marked and remain disabled until their level unlocks and ingredient requirements are met. After a level-up, the modal SHALL refresh progression and immediately expose newly unlocked recipes below the already unlocked recipes.

#### Scenario: Ineligible recipe
- **WHEN** the Character lacks required level or one or more ingredients
- **THEN** the card's `COOK` button is visibly disabled and no cooking request is submitted

#### Scenario: Start cooking
- **WHEN** the Character selects an eligible recipe
- **THEN** `COOK` changes to `Cancel` and an in-modal Cooking progress bar fills over 10 seconds from the authoritative start/deadline timestamps

#### Scenario: Recipe unlock during the session
- **WHEN** session completion grants enough XP to advance Cooking level
- **THEN** the UI applies the authoritative XP/level immediately and updates recipe unlocks without a full-page refresh

### Requirement: Town guard and authoritative endpoints
Cooking start SHALL be accepted only for a Character settled in `map_town` with Town status and without a pending transition or active travel intent. Start, status, Cancel, and completion SHALL be server-authoritative and authenticated. Client recipe IDs/ingredient counts/XP/deadlines SHALL never override the canonical recipe. The timer and result SHALL remain valid if the modal is not mounted; successful completion SHALL return authoritative inventory and Cooking progress.

#### Scenario: Invalid location or forged recipe data
- **WHEN** a request starts cooking outside Sierra Village or attempts to provide altered recipe requirements, XP, output, or completion timestamps
- **THEN** the server rejects it without changing inventory/progression/session state
