# Spec Delta

## Purpose

Provides a persistent, readable history of resolved battles so players can review past combat results and inspect the authoritative event log without affecting gameplay state.

## ADDED Requirements

### Requirement: Battle history list

The system SHALL provide an authenticated Battle Logs page showing the authenticated character's resolved battles newest-first, with one clickable row per battle containing the result, enemy name, enemy level, map name, and battle date/time.

#### Scenario: History contains resolved battles
- **WHEN** an authenticated character opens Battle Logs
- **THEN** the page displays that character's resolved battles in reverse chronological order, one battle per row, with result, enemy, enemy level, map, and date/time

#### Scenario: No battle history
- **WHEN** an authenticated character has no resolved battles
- **THEN** the page displays an intentional empty-history state instead of an empty table or broken layout

#### Scenario: Loading or history failure
- **WHEN** the history request is loading or fails
- **THEN** the page displays an appropriate loading or error state and does not present fabricated battle data

### Requirement: Battle history ownership

The system SHALL restrict battle history and battle-log detail access to resolved battles belonging to the authenticated character.

#### Scenario: Own battle detail
- **WHEN** the player selects one of their resolved battles
- **THEN** the system returns the authoritative persisted battle summary and full log for that battle

#### Scenario: Foreign battle detail
- **WHEN** a player requests a resolved battle belonging to another character
- **THEN** the request is rejected as inaccessible and no battle log is returned

### Requirement: Full battle log modal

The system SHALL open a screen-height Battle Log modal when a history row is selected, showing the battle summary and chronological authoritative combat events in a readable scrollable feed.

#### Scenario: Open a battle log
- **WHEN** the player clicks a battle row
- **THEN** a modal opens over the Battle Logs page, uses the available screen height, shows the battle result and battle context, and provides a vertically scrollable event feed

#### Scenario: Event readability
- **WHEN** the modal renders a battle log containing attacks, skills, items, damage, healing, critical hits, and HP changes
- **THEN** events are shown chronologically with visually distinct important values and without requiring the player to inspect raw JSON

#### Scenario: Close battle log
- **WHEN** the player closes the modal or activates its backdrop close affordance
- **THEN** the modal closes and the Battle Logs list remains at its prior position/state

### Requirement: Authoritative read-only presentation

The Battle Logs feature SHALL render persisted server data without simulating or modifying combat.

#### Scenario: Historical playback
- **WHEN** a historical battle log is opened
- **THEN** the frontend displays the persisted log events and final outcome as recorded by the server and performs no combat calculation or reward resolution
