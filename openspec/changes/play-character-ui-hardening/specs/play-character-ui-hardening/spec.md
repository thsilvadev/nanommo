# Play/Character UI Hardening and Progression

## ADDED Requirements

### Requirement: Access token refresh and session recovery
The application SHALL refresh an expired access token with a valid refresh token,
retry the failed request once, and navigate to /login when the refresh/session
cannot be recovered.

#### Scenario: Expired access token with valid refresh token
- **WHEN** an authenticated API request receives an access-token expiry response
- **THEN** the client SHALL call the refresh contract once
- **AND** SHALL retry the original request with the new access token
- **AND** SHALL keep the user on the current gameplay route.

#### Scenario: Invalid refresh token
- **WHEN** refresh fails because the refresh token is expired, invalid, or revoked
- **THEN** the client SHALL clear the local session
- **AND** SHALL navigate to /login with an appropriate session-expired reason.

#### Scenario: Session invalidated elsewhere
- **WHEN** the backend rejects the session because activeSessionId no longer matches
- **THEN** the client SHALL NOT silently recreate the session
- **AND** SHALL navigate to /login.

### Requirement: Fresh character bootstrap
A newly created character SHALL receive the starter gameplay state required for an
immediately testable grind loop.

#### Scenario: Starter sword
- **WHEN** a character is created
- **THEN** the character SHALL have sword_t1 equipped in the valid main-hand slot
- **AND** the item SHALL be represented by the normal authoritative equipment state.

#### Scenario: Starter Gambit page
- **WHEN** a character is created
- **THEN** the default Gambit page SHALL contain the two legal starter lines
- **AND** line 1 SHALL be self hp is < 30% -> use potion
- **AND** line 2 SHALL be always -> attack nearest foe.

### Requirement: Authoritative derived stats
The backend SHALL expose authoritative derived stats calculated from the documented
character attributes and equipment, and the frontend SHALL render those values.

#### Scenario: Initial derived stats
- **WHEN** a level-1 character has 5 points in each base attribute and the starter
  equipment
- **THEN** max HP and max SP SHALL be derived from VIT/INT plus equipment contribution
- **AND** the character SHALL start with current HP/SP consistent with those maxima
- **AND** the values SHALL NOT depend on a frontend hardcoded 100/100 default.

#### Scenario: Attribute-to-derived mapping
- **WHEN** derived stats are calculated
- **THEN** Attack SHALL use FOR plus equipment contribution
- **AND** Defense SHALL use equipment contribution
- **AND** Max HP SHALL use VIT plus equipment contribution
- **AND** Max SP SHALL use INT plus equipment contribution
- **AND** Attack Speed SHALL use AGI
- **AND** Cast Speed SHALL use DEX
- **AND** Evasion SHALL use AGI
- **AND** Accuracy SHALL use DEX
- **AND** HP Regen SHALL use VIT with recovery every 10 ticks
- **AND** SP Regen SHALL use INT with recovery every 10 ticks
- **AND** Critical Chance SHALL use SOR.

### Requirement: Grind weapon invariants
The backend SHALL enforce weapon requirements for grind entry and equipment changes.

#### Scenario: Enter grind without weapon
- **WHEN** a character attempts to enter a grind map without a valid required weapon
- **THEN** the backend SHALL reject the map entry
- **AND** the character SHALL remain outside grind.

#### Scenario: Unequip required weapon during grind
- **WHEN** a grinding character attempts to unequip the required weapon
- **THEN** the backend SHALL reject the mutation
- **AND** the character SHALL remain in a valid grinding equipment state.

#### Scenario: Replace weapon during grind
- **WHEN** a grinding character replaces the current weapon with another legal weapon
- **THEN** the backend SHALL accept the replacement
- **AND** the resulting equipment SHALL satisfy the normal weapon-combination rules.

### Requirement: Testable map selection
The play map board SHALL expose each authoritative map as an explicit selectable UI
element while keeping the town/city visually central.

#### Scenario: Map tiles
- **WHEN** /maps returns available maps
- **THEN** the board SHALL render a distinct tile/card for each map
- **AND** each tile SHALL expose enough identity to distinguish the map.

#### Scenario: Start grind from map tile
- **WHEN** the user activates an accessible map tile
- **THEN** the client SHALL call the real map-entry endpoint
- **AND** SHALL present the resulting server-driven grinding state.

#### Scenario: Locked map
- **WHEN** a map is not accessible to the current character
- **THEN** the tile SHALL be visibly non-enterable
- **AND** the client SHALL rely on authoritative access information rather than
  inventing a second unlock rule.
### Requirement: Responsive play layout
The play and character UI SHALL remain usable across desktop, tablet, and mobile
viewport sizes without unintended horizontal scrolling.

#### Scenario: Desktop
- **WHEN** the viewport has desktop width
- **THEN** the three-zone composition SHALL remain available where space permits
- **AND** the existing visual language and hover highlights SHALL be preserved.

#### Scenario: Tablet
- **WHEN** the viewport has tablet width
- **THEN** side panels SHALL reflow or collapse
- **AND** core controls SHALL remain reachable without horizontal overflow.

#### Scenario: Mobile
- **WHEN** the viewport has mobile width
- **THEN** the UI SHALL use a deliberate stacked/single-column presentation
- **AND** map tiles, inventory, equipment, battle progress, and Gambit rows SHALL
  remain usable by touch and keyboard.

### Requirement: Inventory and asset presentation
The main play inventory SHALL use a minimal header and all existing semantic SVG
assets SHALL resolve on nested gameplay routes.

#### Scenario: Inventory presentation
- **WHEN** the main play inventory is rendered
- **THEN** it SHALL show only the Inventory heading above the grid
- **AND** it SHALL render exactly 50 cells
- **AND** it SHALL NOT enumerate the cells or display a 50 slots subtitle.

#### Scenario: SVG asset resolution
- **WHEN** the user visits /play, /play/character, or /play/gambits
- **THEN** referenced UI SVG assets SHALL load successfully
- **AND** the implementation SHALL not replace missing assets with emoji or Unicode icons.

### Requirement: Character derived-stat presentation
The character screen SHALL display authoritative covered derived stats instead of
contract-unavailable placeholders.

#### Scenario: Character stats
- **WHEN** the character screen receives the authoritative character/loadout data
- **THEN** it SHALL show HP max, SP max, Attack, Defense, Attack Speed, Cast Speed,
  Evasion, Accuracy, HP Regen, SP Regen, and Critical Chance
- **AND** it SHALL show the current HP/SP alongside their maxima
- **AND** it SHALL not display the unavailable-character-contract placeholder
  for a covered stat.
## Future Requirement Notes

The Gambit editor needs richer parameter controls such as
Self HP is [< 30%] -> Use Skill [Heal]. This is intentionally NOT part of this
change. The next implementation must only preserve the valid starter Gambit data and
record the parameterized editor gap for a later change; it must not invent a new
parameter schema here.
