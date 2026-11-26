# GM commands in chat, `/start-event`, and readable speech bubbles

## Why

Testing the Smashing Spree in production meant waiting for 03:30/09:30/15:30/21:30, and the existing cheats were unauthenticated dev URLs aimed at "the most recently updated character". The owner needs a game-master role with chat commands that are easy to extend (more cheats now, a GM panel and quest authoring later). Separately, speech bubbles in town shrank with zoom-out until unreadable.

## Scope

1. `users.role` ('player' | 'gm'), forward-only migration `1800800000000-UserRole` that makes the owner of `thiagosauro` a GM; `maintenance/set-user-role` for later GMs. The column is outside every ORM read/write so a deploy that lands before the migration still works (nobody is GM until it runs).
2. `modules/gm`: a command registry (`GmCommand`, one class per command, listed in `GM_COMMAND_CLASSES`), `GmService` (parse, role check from the database, dispatch, `[gm]` audit log), `GmAccessService`, socket intent `gm:command { line }`. Non-GMs and unknown commands get `UNKNOWN_COMMAND`.
3. Commands: `/gm-help`, `/start-event <event-code> <minutesToEvent>`, `/grant-equip`, `/grant-foods`, `/reset-diet`, `/upgrade-diet`, `/reset-skilltree` (the existing cheats, now targeting a named character); the unauthenticated `/inventory/__dev_7f3a91c2/*` URLs are no longer registered.
4. Events a GM can start are `GmSchedulableEvent`s (`GM_EVENT_CLASSES`); the first is `smashing-spree`: delayed `smashing-spree-gm-phase` jobs on the `town-event` queue, key `ss-gm-<startMs>`, countdown = configured announcements that fit in the lead (20 → 15, 5, 1; 3 → 1; 0 → none).
5. Chat: any slash command other than `/sleep`, `/dance`, `/sit` is sent as `gm:command`; answers appear as System lines.
6. Town speech bubbles keep one on-screen size at every zoom.

## Non-goals

- No GM web panel yet, no quest authoring, no per-command permissions beyond the single role.
- No cancel of a scheduled GM event (restart the API or let it run).
- No deployment; the migration is written, not run.
