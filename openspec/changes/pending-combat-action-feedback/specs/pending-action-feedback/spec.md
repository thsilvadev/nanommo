## ADDED Requirements

### Requirement: Feedback describes the authoritative command lifecycle
Accepted commands MUST show a stationary queued indicator until applied, failed or cancelled by the server. Only submission MUST spin. Unknown connection outcomes MUST show confirmation state rather than success or rejection. No local timeout or omitted list row may remove pending work.

#### Scenario: A mutation misses the next encounter cutoff
- **WHEN** the server retains a command for a later safe window
- **THEN** its local queue marker remains without promising an exact next battle

### Requirement: Indicators remain subtle and local
Markers MUST be 12px, use muted colors, expose keyboard-readable labels/tooltips and honor reduced motion. Only duplicate/conflicting actions MUST be blocked; the remaining interface MUST stay usable.

#### Scenario: A two-handed weapon is queued
- **WHEN** the command affects mainHand and offHand
- **THEN** both affected slots and the precise source inventory instance are identified without changing the equipped loadout early

### Requirement: Food is checked before queue insertion and again before consumption
Food and consumable requests MUST be checked for current eligibility before acceptance. Food still digesting, unavailable quantity or the same food already queued MUST be rejected before insertion. Execution MUST retain canonical quantity, digestion, cooldown and effect checks.

#### Scenario: Food is still digesting
- **WHEN** the user requests that food
- **THEN** the command is rejected with the reason and no item is consumed or queued

### Requirement: Recovery preserves pending work and avoids duplicate mutation
Own-action reads MUST include safe target metadata and every pending action. Lost-response recovery MUST reuse clientRequestId. Terminal notifications and stale HTTP/GET responses MUST NOT restore completed work.

#### Scenario: The user reloads with pending equipment and Gambit changes
- **WHEN** authoritative pending actions are fetched
- **THEN** markers return on their corresponding slots/items/pages

### Requirement: Completion reflects confirmed snapshots and preserves drafts
Applied mutations MUST remain in confirmation state until rendered stores reach post-terminal snapshot revisions. A pending Gambit save MUST be recoverable after editor remount, and applying an earlier save MUST NOT overwrite newer local edits.

#### Scenario: A pre-action character GET is still running
- **WHEN** the server reports the action applied
- **THEN** confirmation uses a new read and requires its revision before removing the marker

#### Scenario: A later Gambit draft exists
- **WHEN** the earlier queued save applies
- **THEN** the later draft remains editable and marked unsaved
