# Design

## Transition and concurrency invariants

- PostgreSQL Character/queue rows remain authoritative. Redis is used only for a short distributed encounter-chain mutex, not as movement state.
- Map request, `queueBattles()` simulation/insertion, and the authoritative battle payout transaction all acquire `battle:character-queue-lock:<characterId>`. The lock is token-owned, renewed before expiry, and safely released only by its owner. Queue replenishment happens after a resolver transaction releases the lock to avoid re-entrant locking.
- `getOrCreateKillCounter()` first queries, then performs an insert with `ON CONFLICT DO NOTHING`, then queries again. The unique constraint is retained.
- Enter-map reads and writes Character under a transaction and pessimistic Character row lock. Any unresolved queue row with `startAt <= now` counts as a started battle, including a row past `endAt` whose resolver has not committed. `pendingMapTransition` stores `destinationMapId`, `reason` (`town_request` or `map_request`) and client `requestedAt`. A request older than the persisted pending timestamp is ignored. Later clicks replace the pending destination and future queue rows are deleted in the same transaction while the current battle is preserved; Bull delayed jobs are removed after commit.
- If there is no started unresolved battle, map entry is immediate. Otherwise `currentMapId` stays at the origin and presence is removed there. Resolution applies the last accepted destination before queue rebuilding. Death and food exhaustion retain the existing Town fallback.
- Leaving any Grind map resets that source map's kill-counts and increments `epoch`, in the same transaction as immediate movement or battle resolution. A failed move transaction does not reset the sequence.

## Frontend destination preview

The Character DTO includes the pending transition, allowing the map view to resume the waiting indicator after reload. Each accepted map request records the server-accepted destination. A local response generation guard ignores outdated request responses, while monotonically increasing ISO timestamps let the server reject a stale request that arrives after a newer one. The target pin is placed inside the target tile, and a dashed SVG polyline animates `stroke-dashoffset`; its points come from BFS over clickable canonical map nodes with Manhattan distance one. If the nodes are disconnected, no synthetic path is drawn. The line is presentation only: it does not make map movement authoritative or change which maps can be selected. The requested destination remains represented in the UI until another successful map intent or the component/session resets.

## Saved Town waypoint

`Character.savedTownMapId` is nullable and has no backfill, so existing characters begin unsaved. Saving locks Character, verifies `currentMapId` resolves to a Town, `status === 'town'`, and no pending transition, then saves the current Town. The frontend shows the action only in settled Town and changes it to the non-interactive `Saved ✔` state when the DTO identifies that Town. The saved Town icon lives inside the existing map tile button, so it uses the same current map-entry behavior; this change does not introduce saved-only teleport restrictions.

## Verification

Run shared/API/frontend production builds, the direct-run transition/counter concurrency test, Grind food-boundary and battle-distance regressions, mastery combat regression, frontend image/route contract checks, strict OpenSpec validation and `git diff --check`. Confirm both image files are included in the frontend production output and compare source/public/output hashes. Do not run migrations or deploy.
