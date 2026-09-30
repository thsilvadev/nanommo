# Grind Panel

## ADDED Requirements

### Requirement: Encounter search presentation
While the character is waiting for an encounter to start, the right panel SHALL show the animated /project/swords_clash(loading).gif asset and the existing battle progress bar component, using authoritative startAt/endAt timestamps for the search interval.

#### Scenario: Searching
- **WHEN** the current queued encounter has a future startAt
- **THEN** the right panel identifies the state as searching, shows the swords-clash GIF, and displays a countdown/progress bar until startAt

### Requirement: Battle information hierarchy
During battle, the right panel SHALL keep monster identity and monster HP at the top, then show monster buffs/debuffs and monster derived stats, then preserve the existing event logs. Character HP and the battle-time progress bar SHALL not be shown.

#### Scenario: Active battle
- **WHEN** a battle is in progress
- **THEN** monster HP remains visible, character HP is absent, battle duration progress is absent, monster status effects are visible, monster derived stats are visible, and existing logs remain below

#### Scenario: No invented monster state
- **WHEN** a monster has no active status effects
- **THEN** the UI shows a neutral no-status state rather than inventing a buff/debuff
