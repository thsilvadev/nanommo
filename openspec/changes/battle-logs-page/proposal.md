# Proposal

## Why

Resolved battles are already persisted as authoritative audit records, including their complete deterministic combat log, but there is currently no dedicated player-facing history for reviewing past fights. A Battle Logs page turns that existing data into a useful permanent combat-history surface without introducing a second combat-log persistence system or weakening server authority.

## What Changes

- Add a dedicated **Battle Logs** page in the authenticated play experience.
- Add an authenticated battle-history API that returns the character's resolved battles newest-first, with one compact summary row per battle:
  - result (win/loss);
  - enemy name;
  - enemy level;
  - map name;
  - battle date/time.
- Keep the history list payload lightweight: the full `log` JSON is not loaded for every row.
- Add an authenticated battle-detail endpoint for a selected resolved battle, returning the authoritative persisted battle data and full deterministic log.
- Ensure both history and detail endpoints enforce ownership through the authenticated character; a player must never be able to inspect another character's battle.
- Build the Battle Logs list using the existing dark-fantasy game visual language and current desktop UI scale/layout conventions, with each battle represented as a single readable clickable row.
- Clicking a row opens a modal occupying the available screen height, with a clear battle summary/header and a vertically scrollable, readable event feed.
- Render the log from the persisted server log rather than recomputing or simulating combat on the client.
- Present combat events in chronological order and make important combat information visually scannable (actor/action, damage/heal, target, critical hits, item/skill usage, HP state, and final outcome).
- Make the modal easy to close and keep the page usable after closing it; no navigation away from Battle Logs is required to inspect a fight.
- Preserve existing battle-loop behavior, queue semantics, `lastDeathLog`, and the authoritative resolution path. This feature is read-only with respect to gameplay state.
- Add focused API/frontend verification for history ordering, ownership isolation, summary/detail payloads, and modal log rendering.

## Capabilities

### New Capabilities

- `battle-logs`: Persistent player-facing history of resolved battles, including summary rows and a full-screen-height battle-log detail modal.

### Modified Capabilities

- None.

## Impact

- **Backend:** extend the existing Battle module/controller with authenticated history/detail read paths over the already-persisted `BattleQueueEntry` rows; use catalog data to resolve monster level/name and map name for presentation.
- **Frontend:** add the Battle Logs route/page, history state/loading/error handling, battle-row presentation, and a reusable battle-log modal/event-feed presentation.
- **Database:** no new history table is required; resolved `BattleQueueEntry` rows remain the audit source of truth as already defined by SPEC §4.7.
- **Shared models:** add typed DTOs/interfaces for battle-history summaries and full battle-log details as needed.
- **Dependencies:** no new dependency is expected.
- **Gameplay:** no combat calculation, queue generation, resolution, rewards, or persistence semantics change.
