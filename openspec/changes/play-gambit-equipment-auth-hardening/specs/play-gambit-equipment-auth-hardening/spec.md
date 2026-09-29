# Play, Gambit, Equipment and Auth Hardening

## ADDED Requirements

### Requirement: Character navigation defaults to Character
The frontend SHALL navigate the Character navbar action to the Character page with the Character sub-tab selected.

#### Scenario: Open Character from navbar
- **WHEN** the user clicks Character in the main navbar
- **THEN** the route is `/play/character?tab=character`
- **AND** the Character sub-tab is rendered active

### Requirement: Town regeneration
A character in town SHALL regenerate HP and SP using the same authoritative derived regeneration rates used by the game engine.

#### Scenario: Regenerate in town
- **GIVEN** a character is in town with current HP or SP below maximum
- **WHEN** at least ten real-time ticks have elapsed
- **THEN** HP and SP increase by their applicable ten-tick regeneration values
- **AND** values never exceed authoritative maximums

### Requirement: Equipment interaction
Equipment changes from the play UI SHALL use the authoritative equipment API and support both drag/drop and double-click fallback.

#### Scenario: Equip from Inventory
- **GIVEN** an equipment item exists in Inventory
- **WHEN** the user drags it to its compatible Character slot
- **THEN** the Character slot is highlighted while the item is dragged
- **AND** dropping it equips the item through the backend

#### Scenario: Unequip to Inventory
- **GIVEN** an equipment item is equipped
- **WHEN** the user drags it to the Inventory drop area or double-clicks it
- **THEN** the item is returned to Inventory through the backend

### Requirement: Inventory is inventory-only
The main play Inventory panel SHALL contain only inventory cells and shall not duplicate the equipment panel.

#### Scenario: Main Inventory presentation
- **WHEN** the play grind screen is rendered
- **THEN** the panel heading is `Inventory`
- **AND** exactly 50 inventory cells are rendered
- **AND** no equipment slots are rendered in that panel

### Requirement: Parameterized Gambit editing
Every Gambit line SHALL expose its condition, condition params, action and action params using the authoritative Gambit catalog metadata.

#### Scenario: Edit a parameterized line
- **GIVEN** a line with a parameterized condition or action
- **WHEN** the Gambit editor renders it
- **THEN** the selector for the condition/action is visible
- **AND** each declared catalog parameter has an appropriate input
- **AND** changing a parameter updates the line params sent to the server

### Requirement: Starter Gambit condition catalog
The authoritative Gambit catalog SHALL include `self_hp_below_percent` with a numeric `value` parameter.

#### Scenario: Save the starter low-HP condition
- **GIVEN** a Gambit line uses `self_hp_below_percent`
- **WHEN** the user saves the page
- **THEN** server validation accepts the condition id
- **AND** the numeric threshold is stored under `conditions[].params.value`

### Requirement: XP progress transparency
The XP progress bar SHALL use the current level's `xpToNext` requirement.

#### Scenario: Inspect XP
- **WHEN** the user hovers the XP bar
- **THEN** the tooltip shows current XP and XP required for the current level

### Requirement: Live consumable quantities
The frontend SHALL reduce displayed consumable quantities when a character `use_item` event in the active battle log becomes due.

#### Scenario: Potion consumed during battle
- **GIVEN** an active battle log contains a character `use_item` event
- **WHEN** its event tick is reached
- **THEN** the corresponding visible item quantity decreases immediately
- **AND** the authoritative inventory still replaces the temporary display after battle resolution

### Requirement: Email verification gate
Registration SHALL not create a browser-authenticated session, and users whose email is not verified SHALL not enter the game.

#### Scenario: Finish registration
- **WHEN** registration succeeds
- **THEN** the browser remains logged out
- **AND** the user is shown a confirmation page explaining that email verification is required
- **AND** the page provides a link back to login

#### Scenario: Unverified login
- **GIVEN** the account exists but email verification is incomplete
- **WHEN** the user submits valid login credentials
- **THEN** login is rejected with a verification-related message

#### Scenario: Verified login flow
- **GIVEN** email verification succeeds
- **WHEN** the verification page is shown
- **THEN** the user is directed to return to login
- **AND** the page does not auto-navigate into the game

### Requirement: Weapon XP remains deferred
Weapon XP/proficiency progression SHALL remain outside this change.

#### Scenario: Weapon progression is not part of this change
- **WHEN** this change is reviewed
- **THEN** no weapon XP behavior is required for acceptance
