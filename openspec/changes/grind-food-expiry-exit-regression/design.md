# Design

## Investigation-first rule

Do not assume the suspicious `queueBattles()` branch is the sole production cause. Treat it as the leading hypothesis because the current implementation projects food expiry across future queued battles and has a Town transition branch that tests only whether a battle is active at `Date.now()`. The reported logs are consistent with queue exhaustion but do not prove the transition's call stack or exact food timestamp.

Before changing production logic:

1. Read root `SPEC.md` and `STATUS.md`, the current `diet-auto-feed` and `diet-autofeed-boundary-reliability` changes, and relevant code/tests.
2. Trace every server-side path that can set `status = 'town'` or `currentMapId = TOWN_MAP_ID`, distinguishing death, explicit leave-map requests, pending transitions, food exhaustion, and recovery.
3. Instrument the test setup with explicit timestamps and assertions for `activeFoodBuff.expiresAt`, `Date.now()`, queue entry `startAt/endAt`, food projection, Auto Feed eligibility, queue size, status/map before and after, and presence synchronization.
4. Reproduce the early exit with a deterministic clock / injected timestamps or direct service test. Do not use a flaky test that sleeps two minutes.
5. If the suspected branch does not reproduce the symptom, follow the actual failing assertion through the resolver, queue top-up, recovery, and map-transition paths until the cause is identified. Update this design with evidence rather than preserving a disproven hypothesis.

## Confirmed root-cause evidence

The leading hypothesis reproduced in `apps/api/test/grind-food-expiry-exit-regression.test.js` before the production change. The deterministic fixture sets `activeFoodBuff.expiresAt = now + 120000`, with no queued battle active at `now`, and one unresolved future entry starting before food expiry but ending after it. `projectFoodFromQueue()` clears the projected buff because the future entry's `endAt` is later than the expiry. The old branch then sees no active battle at `now` and writes `currentMapId = map_town` / `status = town`, calls map-presence synchronization, discards unresolved entries and publishes an empty queue. The pre-fix test failed with `actual: 'town', expected: 'grinding'`.

The fix distinguishes current persisted food from future queue projection: a projected null buff cannot trigger Town while the persisted expiry is still in the future. Queue generation also checks food against the actual encounter `startAt` after adding the encounter-search delay. If no battle can legally start before expiry and the queue is empty, it schedules an existing `queue-battles` worker job for the exact expiry timestamp so the server re-evaluates the real boundary without a browser timer. At actual exhaustion with no active battle, the existing Auto Feed path is attempted before the Hungry/Town fallback.

The supplied production logs remain corroborative rather than conclusive: they show wins, an empty queue update and later socket disconnect/reconnect, but do not expose the persisted food expiry timestamp or prove the exact production transition call stack. The deterministic test proves the code path and regression independently; it does not retroactively prove which exact call ran for Sauro in production.

## Required invariant

A living character on a grind map remains on that map while their authoritative active food buff is valid. The character must not be sent to Town because a future simulated battle crosses the expiry timestamp, because a projected buff was cleared while walking the queue, because the queue is temporarily empty, or because the resolver ran during the gap between encounters.

Food eligibility is based on the **start of the next encounter/battle**, not on a speculative future battle's end and not on the current wall-clock instant in isolation. The queue must not contain a new battle whose start is at or after the active food expiry unless an eligible food has authoritatively been consumed and the queue is rebuilt using that new food state.

When the active food has expired (remaining duration is 0m, i.e. `expiresAt <= nextEncounterStartAt` under the server's exact timestamp semantics), the character cannot start the next battle without another valid food buff. At that boundary:
- If Auto Feed is enabled and an eligible configured Diet food is available, consume it through the existing authoritative inventory/Diet service, update Character + Inventory, invalidate only future queued battles as needed, and rebuild the queue.
- Otherwise, transition to Town and synchronize map presence.
- Never cancel, rewrite, or retroactively alter a battle already in progress. If its completion is the first point at which food exhaustion is enforced, let that battle resolve normally and prevent only the next encounter from starting.
- A food with positive remaining duration must not be treated as expired merely because it is close to expiry. No arbitrary safety margin (e.g. two minutes) may be introduced.
- Match the existing food-duration units and `MS_PER_TICK` conversion exactly; do not introduce a seconds-vs-milliseconds conversion error.

## Test strategy

Prefer focused service-level tests with a controllable clock and mocks for repositories, BullMQ, Auto Feed/inventory, gateway, and map presence. Reuse the existing integration harness for end-to-end proof when its setup can deterministically seed food expiry and queue rows. Do not rebuild or deploy production as part of test creation.

Tests must cover both the leading suspected bug and alternate paths that could produce the same symptom:

1. **Reproduce early Town routing:** food expiry is approximately two minutes in the future; no battle is active at the current instant; a queued future battle ends after food expiry; invoking queue generation must not route the character to Town while food is still valid now. Assert location/status, queue state, and map presence.
2. **Expiry is during a future battle:** current food is valid at next encounter start but expires during that battle. The character may start that battle; it must not be sent to Town before its start. The resolver must enforce the food boundary only for the following encounter, without altering the active battle.
3. **Food expires before next encounter starts:** the final queued battle resolves, food expiry is at/before the next safe encounter start (including encounter search delay), and no eligible replacement exists. Assert no new battle starts, character transitions to Town once, queue is empty, and presence is synchronized once.
4. **Food has positive time remaining:** vary remaining time across large, small, and near-zero positive values; no early exit is allowed solely due to proximity to expiry.
5. **Auto Feed replacement available:** at the real boundary, eligible configured food with inventory quantity > 0 and digestion complete is consumed exactly once; active buff is replaced and queue is rebuilt from the resulting authoritative state. No intermediate Hungry/Town transition may win the race.
6. **Auto Feed disabled / no eligible food:** once the next encounter cannot legally start due to food expiry, route to Town and do not queue a new battle.
7. **Already expired at evaluation:** `expiresAt <= now` and no eligible replacement means Town; eligible Auto Feed means consume/rebuild first.
8. **Death precedence:** a real battle loss routes to Town through death handling regardless of food duration, and the food fix does not suppress or duplicate death effects.
9. **Explicit player transition:** a player-requested Town/map leave still works and remains distinct from food-exhaustion logic.
10. **Queue top-up / resolver boundary:** cover a queue that stops short because food is predicted to expire and a queue that empties naturally after a win; both must converge to the same correct boundary behavior.
11. **Idempotency/concurrency:** queue top-up and battle resolution racing at the expiry boundary cannot double-consume food, duplicate Town transitions, or create a battle without valid food.
12. **Realtime/presence:** final Character/Inventory snapshots reflect the committed state; map presence remains while the character is still grinding and is removed only on an actual Town transition.

## Implementation constraints

- Keep battle simulation deterministic and server-authoritative.
- Keep existing food consumption on the authoritative consumption service; do not duplicate inventory/Diet mutation logic.
- Keep the current battle immutable. Only unresolved future entries may be discarded/rebuilt, and only according to established queue invalidation rules.
- Do not conflate online socket connection with gameplay map membership.
- Do not add a generic heartbeat or frontend timer to repair server state.
- Preserve existing map presence semantics and canonical Town identity.
- Add tests first; change only the smallest production path that makes the failed regression pass.
- If an existing test or spec encodes the opposite behavior, report the conflict explicitly and update the authoritative contract intentionally rather than silently changing expectations.
