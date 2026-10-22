# Character Professions

## ADDED Requirements

### Requirement: Query-parameter-driven Professions tab
The Character page SHALL expose a Professions tab through the existing query-parameter navigation at `/play/character?tab=professions`. Directly loading this URL SHALL select the Professions tab. Selecting any existing tab SHALL continue to preserve its existing behavior and query-parameter deep link.

#### Scenario: Open Professions directly
- **WHEN** a Character page is opened at `/play/character?tab=professions`
- **THEN** the Professions tab is selected and its content is visible without navigating to a new route

#### Scenario: Existing tabs remain compatible
- **WHEN** the user selects Character, Gambits, or Mastery
- **THEN** the corresponding existing tab is selected and the existing query-parameter behavior remains unchanged

### Requirement: Display four profession progress rows
The Professions tab SHALL display Gathering, Cooking, Blacksmith, and Alchemy in that order. Each row SHALL display the profession name, level, and current-level XP progress in the format `Level {level} — {currXp}/{xpToNxtLvl}`, where currXp is XP accumulated within the current level and xpToNxtLvl is the XP required to advance from that level. Gathering SHALL use its existing authoritative progression data. Cooking SHALL use the authoritative Cooking progression introduced by this change. Until Blacksmith and Alchemy progression systems are separately implemented, they SHALL display the documented placeholder baseline `Level 1 — 0/100` and SHALL NOT imply that crafting or XP earning for those professions is implemented.

#### Scenario: Existing and new progression
- **WHEN** the Professions tab loads
- **THEN** Gathering and Cooking show their respective current level and current-level XP progress, and Blacksmith and Alchemy show the documented Level 1 — 0/100 baseline

#### Scenario: XP crosses a level threshold
- **WHEN** the Character's authoritative Gathering or Cooking progress changes and the Professions tab is displayed or reopened
- **THEN** the corresponding row reflects the latest level and XP progress without calculating authoritative XP in the frontend
