## ADDED Requirements

### Requirement: Group presentation follows authorized revisioned state
The interface SHALL show CHARACTER and GROUP tabs only while grouped, compact named HP/SP/status panels and a leader marker without portraits, food or damage flashes. A shared live log and individual current target SHALL use explicit actor IDs and numbered duplicate species. The log SHALL scroll in available space while preserving Session Loot and skills; an arena SHALL not be rendered.

#### Scenario: Reconnect after a membership update
- **WHEN** a client reconnects and receives an older Socket revision after current HTTP state
- **THEN** it keeps current membership and only displays authorized member state without private Gambits or inventory

### Requirement: Pending actions and controls reflect server permissions
The interface SHALL expose invitation acceptance and pending synchronization, cancelable pending departure, formation/leader stance controls, AutoParty preference and command pending/applied/failed feedback. Chat names and Town characters SHALL offer authorized invitation actions. Server endpoints and events SHALL enforce ownership, leadership and existing appearance prerequisites.

#### Scenario: Nonleader attempts to reorder or change route
- **WHEN** a member submits an unauthorized action
- **THEN** the server rejects it and the UI preserves authoritative formation and activity

### Requirement: Teleport feedback is accessible
The activity area SHALL show effective progress and black “Teleporting…” text over white/blue blinking at 100 ms. Reduced motion SHALL provide a legible static alternative; controls SHALL remain keyboard accessible and localized on desktop and short viewports.

#### Scenario: Reduced motion is enabled
- **WHEN** teleport progresses or pauses for battle
- **THEN** the indicator reflects server progress and pause without flashing
