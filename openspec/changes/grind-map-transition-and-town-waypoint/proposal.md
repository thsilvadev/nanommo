# Proposal

## Why

Changing directly from one Grind map to another can race with battle resolution and queue generation. The API uses a check-then-insert kill-counter helper that can violate the `(characterId, mapId)` unique constraint, the frontend only waits for Town movement, and an unresolved battle whose scheduled `endAt` has passed may be mistaken for a completed battle. Players also need an explicitly saved Town waypoint and a visual preview of requested destinations before the future walk/path system is implemented.

## What Changes

- Serialize encounter queue generation, authoritative battle-resolution transactions and map requests with a distributed per-character Redis lock.
- Make `MapKillCounter` creation concurrent-safe with `INSERT ... ON CONFLICT DO NOTHING` and a re-read.
- Treat any started, unresolved battle as a transition blocker, even if `endAt` has elapsed; persist the latest requested destination and cancel stale future encounters. A late older click cannot overwrite a newer request.
- Commit destination and rebuild the queue only after the battle transaction commits. Reset the source Grind map's encounter epoch for every departure, including Grind-to-Grind, deferred movement, Town return and food fallback.
- Unify frontend Town/Grind transition waiting. After a successful request, show `/project/destination_pinpoint.png` and an animated dashed shortest route over adjacent canonical map nodes; show `waiting for battle to end to move...` while the transition remains pending.
- Persist `Character.savedTownMapId` via a forward-only nullable-column migration and a settled-Town `POST /maps/save-town` endpoint. Show `Save here`/`Saved ✔` in the Town panel and `/project/T_waypoint.png` on the saved Town tile. Leave current map-click teleport semantics unchanged for now.

## Impact

Shared transition type, API queue/resolver/map services, Character entity/DTO and frontend model, a forward-only migration, map UI and shipped assets, SPEC mirrors, ARCHITECTURE.md, STATUS.md, and direct-run concurrency/UI-contract regressions. No migration execution, live database mutation or deployment.
