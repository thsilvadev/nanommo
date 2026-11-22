## ADDED Requirements

### Requirement: Actor HUD uses uniform typed icons
The HUD MUST show 28 × 28 px icons in Character Status, Grind target Status and below HP/SP for each Group member. Buffs MUST have green borders, debuffs red, skills white and items gray.

#### Scenario: An ally has both an effect and a recovering skill
- **WHEN** the ally has an active buff and a skill on cooldown
- **THEN** both icons appear below that ally's resources with their corresponding borders

### Requirement: Cooldowns follow authoritative time and category sharing
Skills and items MUST appear only while on cooldown, using a clockwise radial mask. Potions, tonics and super tonics MUST each use one category icon and independent existing shared cooldowns. Cast start and fizzle MUST NOT initiate a cooldown. Future events MUST NOT affect the HUD.

#### Scenario: Potion category cooldown expires
- **WHEN** the authoritative potion cooldown reaches zero
- **THEN** its category icon disappears without waiting for another snapshot

#### Scenario: Cast is still pending
- **WHEN** a skill has started casting but has not successfully resolved
- **THEN** its cooldown icon is not shown for that cast

### Requirement: Effects show duration without a radial mask
Buffs and debuffs MUST show remaining seconds rounded up, with stacks in their tooltip. Permanent effects MUST NOT receive an invented duration. Removed or expired effects MUST disappear.

#### Scenario: A stacked effect lasts another 4.1 seconds
- **WHEN** the actor has two stacks with a maximum remaining duration of 4.1 seconds
- **THEN** the icon shows 5 and the tooltip identifies two stacks

### Requirement: Public timer metadata preserves actor identity and privacy
Timer projection MUST remain specific to the selected actor and preserve deadlines across battle boundaries and reloads. Public snapshots MUST expose only timer data needed for display and MUST NOT expose inventory, Gambits or Diet.

#### Scenario: The current target changes
- **WHEN** the authoritative visible events select a different actor
- **THEN** the HUD displays that actor's effects and cooldowns
