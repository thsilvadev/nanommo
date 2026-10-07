# Design

## Context

BattleQueueEntry already keeps resolved rows as the combat audit trail and stores the full deterministic log required by SPEC §7.7. The current battle API only exposes unresolved queue state, while the play shell already provides the three-column layout whose center zone stretches to the floor beside the left and right panels.

## Goals / Non-Goals

**Goals:**
- Expose a lightweight summary list and on-demand full-log detail endpoint.
- Resolve monster name/level and map name server-side from existing static data.
- Keep ownership enforcement in the authenticated API.
- Make Battle Logs visually native to the existing play shell, with the center panel filling the complete available height and aligning its bottom edge with both side panels.
- Render historical events as readable prose rather than raw JSON.

**Non-Goals:**
- No new battle-history table.
- No combat simulation or replay engine.
- No changes to battle resolution, queue generation, rewards, or death handling.
- No pagination controls in the initial version; the endpoint returns a bounded recent history.

## Decisions

### 1. Reuse resolved BattleQueueEntry rows

Query only resolved=true rows for the authenticated character, newest by battle start time. This preserves the existing audit source of truth and avoids duplicating immutable historical data.

### 2. Separate summary and detail reads

The list endpoint returns only metadata needed for rows. The detail endpoint returns the selected resolved row's full log. This keeps the initial page small even when logs contain many events.

### 3. Server-side presentation metadata

The backend resolves monster name/level and map name using DataService. The client receives stable display DTOs and does not need to duplicate server catalog rules for history rows.

### 4. Native center-panel layout

Battle Logs uses a root panel with height:100%, min-height:0, and no bottom margin, matching the play shell's center-zone contract. Internal scrolling belongs to the list/log content, never to the outer shell.

### 5. Modal uses available viewport height

The detail modal backdrop fills the viewport and the modal itself uses a near-viewport height with a fixed header and an independently scrolling event feed. This makes long logs fluid without pushing the shell.

### 6. Read-only frontend

The client treats the history/detail responses as presentation data only. No BattleStore mutation or combat timer is involved.

## Risks / Trade-offs

- [Risk] Resolved rows can grow indefinitely → Mitigation: history endpoint returns a bounded recent window of 100 rows and orders by startAt descending.
- [Risk] Static catalog names can change after a battle → Mitigation: historical identity remains based on persisted IDs; current catalog metadata is used only for display.
- [Risk] Very large logs can make a modal heavy → Mitigation: fetch full log only after row selection and keep event rendering compact.
- [Risk] Existing shell CSS can be accidentally overridden → Mitigation: keep page styles scoped to the Battle Logs component and explicitly preserve the shell's full-height contract.
