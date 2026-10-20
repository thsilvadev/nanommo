# Design

## Context

The root maps.json is canonical and mirrored at apps/frontend/public/data/maps.json. The world contains 41 locations: five Towns and 36 grind maps. The map UI already shows the location pin, saved-Town marker and deterministic cardinal BFS route, but the route is only a preview. Character.savedTownMapId already exists. The battle simulator separately uses moveSpeedBase for lane movement; this contract must not be changed by world traversal.

BattleQueueEntry stores pre-simulated events, outcome and final resources. BattleService applies inventory consumption, XP/Mastery, drops, kill counters and death at its exactly-once resolution boundary. FLEE must preserve that invariant and keep the queued original battle simulation immutable.

## Goals / Non-Goals

**Goals**
- Keep travel, encounter timing, FLEE, stance and gathering authoritative across reloads, disconnections and server restarts.
- Reuse canonical map topology, weighted rosters, seeded randomness, per-character queue locks, map presence and InventoryService transactions.
- Reproduce an exact deterministic partial-battle checkpoint without granting the precomputed result’s rewards.
- Preserve the last Hunting/Gathering selection when Traveling or settled in Town.

**Non-Goals**
- No recipes, crafting, cooking, alchemy, Gathering XP or Gathering-level progression beyond level 1.
- No new Move Speed potions/equipment and no balance pass for them; add only generic modifier support.
- No changes to battle-lane Move Speed, ordinary battle formulas or unrelated drops.
- No production DB mutation, migration execution or deployment in proposal/apply coding.

## Decisions

### 1. Persisted activity state

Persist the last stationary stance (Hunting or Gathering, default Hunting), travel intent, route/next segment, normalized segment progress, last accrued timestamp, deterministic encounter cycle/timing, gatheringLevel (default 1), gathering-cycle progress/variance, and next FLEE attempt/cooldown. Traveling is derived from active travel intent rather than overwriting the saved stationary stance. The frontend hides active Hunting/Gathering styling while settled in Town but does not erase the persisted selection.

A travel intent distinguishes a normal route from a saved-Town teleport. Do not overload pendingMapTransition to represent both generic multi-segment travel and an old deferred Town request. Reconcile legacy pending transitions during startup/migration, so old jobs cannot later overwrite the new activity state.

Character/PostgreSQL state is authoritative; Redis is runtime coordination/cache. All transition and battle state changes use the existing per-character distributed lock and Character-first DB row-lock ordering. Delayed jobs are idempotent and validate the current intent/generation before committing. Frontend timers are presentation only.

### 2. Map length, adjacency and route

Add mapLength to all maps and mirrors: current grind maps are 25; all Town maps are 0. The build/catalog validator rejects missing values, Town values other than 0 and grind values below 25. Preserve all user-adjusted map coordinates/assets/rosters. Routes traverse only clickable canonical map nodes along cardinal Manhattan-distance-1 edges. Backend BFS uses stable map-ID tie-breaking to agree with the frontend path preview; validate that every current map is reachable.

A cardinal edge with one Town and one grind map is instant both ways. Every other edge is timed; a timed edge must use at least length 25 even if a future source Town has length 0. A timed segment uses the source map’s mapLength. At each segment completion, commit currentMapId, discovery and MapPresenceService together, then start the next segment. An intermediate Town does not end the route or expose NPC transactions; only final settled Town arrival switches to Town status and enables Town services.

### 3. Dynamic Move Speed and traversal gauge

World Move Speed is distinct from battle-lane movement. Character base speed remains the current 50 + level. Add generic world moveSpd calculation from that base, equipment flat modifiers, buff flat/multiplicative modifiers and active applicable movement-speed penalties. Clamp to 0–250. If speed is zero, travel progress pauses. Equipment/buff/status changes must accrue progress at the old speed before changing the future fill rate. Do not add speed items and do not repurpose the monster lane-combat moveSpeedBase field.

For mapLength 25:
- speed 51 takes 30 seconds;
- speed 100 takes 20 seconds;
- speed 250 takes 5 seconds.

Interpolate linearly between 51–100 and 100–250. Below 51, duration is 30 × 51 / speed. Cap effective speed at 250, apply 5 seconds as the timed-traversal minimum, and scale duration linearly by mapLength / 25. A speed increase changes the bar’s fill rate, not the progress already accumulated. Progress accrued while a battle is active must be zero.

Travel activity needs durable scheduled work and ordered timestamp catch-up, not only a frontend timer or unqualified wall-clock delta. On offline catch-up, process encounters and their battle intervals chronologically so travel resumes after those intervals rather than moving through them.

When a destination changes, recompute the route from the current authoritative node. If the next map ID is the same, keep the segment gauge even if later path nodes differ. If the next map changes, reset only the current segment gauge. Clicking the current map or selecting Hunting/Gathering cancels the route and path preview without changing currentMapId. Already committed map arrivals/discoveries are never rolled back.

### 4. Saved Town and death

Clicking savedTownMapId is an instant teleport intent; it does not use a timed segment. If idle, teleport immediately, update map discovery/presence, clear travel/gathering work and settle the destination. While in combat, activate Traveling/teleport intent and request FLEE on the next eligible combat tick. If FLEE succeeds, cancel battle and teleport immediately. If it fails, normal battle continues with attempts on the independent cooldown; if the battle resolves first, apply its normal outcome and teleport immediately unless death occurs. The marker/route preview clears only when authoritative location confirms arrival.

Death keeps the existing death-log/penalty contract, cancels travel, encounter and gathering jobs, and respawns at a valid Town stored in savedTownMapId, otherwise map_town. Plain Return to Town and food-exhaustion fallback still target map_town; savedTownMapId changes death respawn and an explicit saved-Town click only.

### 5. Stances and UI

Hunting and Gathering are selectable and persisted. Traveling is automatically active and not clickable, represented with boots.svg and visually separated from the two selectable stance controls. If the user selects Hunting/Gathering during travel, cancel path/progress and stop future FLEE retries, but do not cancel an active battle. Clicking another map activates Traveling immediately. Clicking the current map cancels travel and stays in place.

On final arrival, restore the stored Hunting/Gathering selection even if the destination is a Town. While settled in Town neither stationary stance appears active, but the selected stance remains stored for a future departure. The Town’s NPC panel/services stay blocked while traveling through it.

In map-head, keep Currently in on the left and put the activity gauge above Players in map at upper right. Traveling gauge is blueberry-blue with bold white “Traveling…”; Gathering gauge is orange with bold white “Gathering…”. Traveling gauge takes precedence over Gathering while a route intent exists. While stationary on a grind map, show Gathering gauge in both Hunting and Gathering. The applicable gauge stays visible but frozen during battle. Remove only the growing/progress bar; retain the text-only “Searching for Monsters...” state while the next queued battle has not reached startAt and clear the previous monster details during that gap. Gauge projection subtracts recorded fight intervals; server-persisted cycle progress controls actual grants. Pinpoint movement remains tied only to authoritative currentMapId.

### 6. World monster aggression and encounter cadence

Add explicit isAggressive and moveSpd to every monster record and mirror. Non-aggressive IDs are exactly mon_slime, mon_thornsprout, mon_saltfangcrab and mon_moonleafarcanist; all other current monsters are aggressive. Seed the new hard-coded per-species world moveSpd value from each species’ existing moveSpeedBase field for the first pass, then never apply monster-level scaling to moveSpd. Keep existing moveSpeedBase + monster level − 1 lane-combat behavior untouched. Applicable active movement penalties can affect effective speed during a particular FLEE roll without rewriting the catalogue baseline.

Each encounter-search cycle selects an inclusive deterministic random integer from 2–6 seconds plus playersInMap seconds. The count includes the current character, all persisted residents and disconnected residents; it is not online/socket count and not “other players”. Use seeded randomness plus persisted cycle identity, never Math.random. Encounter selection uses the current map’s weighted monsters pool. Gathering’s pre-combat avoidance has a separate persisted batch-cycle ID; when an entire bounded batch is skipped, schedule another queue-battles continuation at the next planned search boundary and alter the next deterministic stream/roster selection so the empty queue cannot become permanent.

Hunting always fights. Gathering and Traveling ignore a selected non-aggressive monster with no battle and no additional travel delay. For an aggressive monster, make one pre-combat roll using the same FLEE chance as manual escape. A successful roll skips battle; a failed roll starts a normal battle. In Gathering, a failed pre-combat roll leaves Gathering as the saved stance and the fight proceeds normally unless the player clicks a destination. During Traveling, a failed pre-combat roll counts as the first failed in-battle FLEE roll and the route pauses until the battle ends or FLEE succeeds.

Gathering progress accrues during non-battle encounter-search time in both Hunting and Gathering. Dodging a monster does not grant an artificial extra progress bonus; those non-battle seconds already advance the collection gauge.

### Pre-combat FLEE stream continuity

Each generated encounter batch persists a deterministic pre-combat FLEE cycle identity. If all bounded candidates are skipped, a later empty-queue retry must use a different stream rather than replaying the same finite list of rolls indefinitely. The initial cycle keeps its established seed for compatibility; subsequent cycles append the persisted cycle index. This is separate from the resolved kill counter and does not grant rewards or change battle RNG.

### 7. FLEE formula and independent retry

FLEE is a parallel roll, never a Gambit, cast, action-gauge consumer or replacement for normal combat intent. Normal combat actions continue unchanged. Manual Traveling selection during an active battle attempts FLEE on the next eligible combat tick. A failed roll schedules another attempt 10 seconds later while Traveling remains active. Changing destination does not reset or bypass cooldown; selecting Hunting/Gathering cancels future retry attempts without changing the active battle.

Compute relative speed r = clamp(characterMoveSpd / max(monsterMoveSpd, 1) − 1, −0.5, +0.5), then speed chance = 1 + (r + 0.5) × 98 percentage points. This guarantees 1% at 50% slower, 50% at equal speed, and 99% at 50% faster. To implement the accepted 10% LUK influence while keeping the endpoints absolute, use luckScore = clamp(50 + 2 × (totalCharacterLUK − 5), 1, 99), t = (speedChance − 1) / 98, edgeWeight = 4 × t × (1 − t), and finalChance = clamp(speedChance + 0.10 × (luckScore − speedChance) × edgeWeight, 1, 99). Centralize these tunable constants and helper. LUK influence tapers to zero at the 1%/99% endpoints. Use the effective character Move Speed/total LUK and the monster’s fixed world moveSpd adjusted for applicable movement penalties at the roll tick. FLEE uses an independent deterministic RNG stream keyed by battle ID and attempt index; failure cannot advance or alter the battle RNG.

On successful in-battle FLEE, capture state after the normal combat effects of the scheduled tick, provided the character is still alive after those effects. If HP reaches zero before the parallel roll, normal death wins. Rerun the stored original deterministic battle from its immutable starting snapshot/seed to the requested tick and return a complete checkpoint: HP/SP, inventory use/theft, food/digestion, food buffs, statuses with remaining duration, temp buffs and necessary resource/cooldown state. Event hp/spRemaining fields alone are insufficient. Persist starting inventory with new battle snapshots; use a guarded fallback for legacy active entries lacking that data.

Under the existing per-character queue lock and Character→BattleQueueEntry lock order, mark the battle resolved/cancelled with reason/timestamp for audit; do not mutate its original log/outcome/snapshot. Apply only the checkpoint state plus pending equipment changes normally committed at battle exit. Cancel obsolete future queue rows/jobs. Award no XP, Mastery XP, drops, gold, kill counter or death payout, and do not send a death event. Publish the resulting Character/Inventory state using existing stateRevision/realtime rules. Exclude cancelled rows from active queue, normal win/loss history and reward projections while retaining their audit snapshot.

### 8. Gathering cycles and materials

Persist gatheringLevel = 1 and Gathering cycle progress. For mapLength L, playersOnMap P including the character, and level G, base duration seconds = max(30, 12 × L + 30 × (P − 1) − (G − 1)). At the start of each cycle add a deterministic inclusive random integer from 0–5 seconds; keep that variance fixed for that cycle. The base examples are 300 seconds at length 25 with one player/level 1 and 600 seconds at length 50 with one player/level 1; the random variance is additional. The minimum total is 30 seconds.

While stationary on a grind map in Hunting or Gathering and not in battle, add elapsedSeconds / currentCycleDuration to the normalized progress. A population change recalculates the fill rate while retaining progress and the current variance. Pause during battle or Traveling. On completion, deterministically weighted-pick from the current map’s gathering pool; grant transactionally only if Inventory capacity allows. If full, skip the item and restart the cycle; never route drops to Warehouse/mail/hidden overflow. Preserve progress if travel is cancelled before leaving the map; a committed arrival at a different map starts fresh progress for its own pool. Death and committed saved-Town teleport clear the cycle.

Add a canonical materials group with type material and icons; extend API/frontend item lookup, category routing, tooltips, reward resolution and validation. Keep food_blueberry ID/effect and rename it Blueberry Jelly; add mat_wild_blueberries separately. Keep food_honey ID/effect and rename it Honey. Add materials sufficient to support future Bread (Wheat + Cooking Oil), Cheese (Milk), Blueberry Jelly (Wild Blueberries + Sugar), Hunter’s Stew (Carrot + Cabbage + Meat), Herbal Tea (Herbs) and Honey (Honeycomb). These are data-only concepts; no recipe execution. Meat (mat_meat) is a 20% independent monster drop from Dire Wolf and Needleback Stalker only and never appears in a gathering pool. Roughly 12 of 36 current grind maps receive pools, each weighted to 100%; Town pools are empty.

### 9. Recovery and transaction safety

- currentMapId changes only at segment completion, instant Town↔adjacent-grind transition, saved-Town teleport, or existing fallback/death routing. A click alone never moves the pin or map presence.
- Map discovery and absolute gameplay map presence update exactly once per committed node. A character traveling within a segment remains on its source map even when disconnected.
- A durable activity scheduler owns travel segments, encounter times, battle pauses, Gathering cycles and offline catch-up. Catch-up processes timestamped activity/battle boundaries chronologically, so travel/Gathering never advances during battle intervals.
- Normal battle resolution pays exactly once and resumes latest activity. Successful FLEE applies the partial checkpoint and no reward, then resumes travel. Death clears activity and respawns at saved Town.
- Scheduled jobs have generation/revision guards and re-read authoritative state under the per-character lock. Startup recovery reconciles persisted activity/jobs before queue processing opens; inconsistent state fails closed.
- Reconcile route pins/preview after cancel, intermediate/final arrival, successful FLEE, teleport, death, reload and out-of-order HTTP/socket data. Stale snapshots may not resurrect a completed route.
- Inventory grants obey InventoryService capacity/locking. Warehouse is never a fallback for gathering/battle loot.

## Risks / Trade-offs

- Offline catch-up could incorrectly move during battle: process timestamped encounters and battle intervals in chronological order.
- FLEE could pay an old outcome: use atomic cancellation, cancelled/resolved guards and queue cleanup while keeping original battle data immutable.
- Partial checkpoint could omit a status or consumed item: replay the deterministic start snapshot and seed; test exact event boundaries and remaining durations.
- A stale delayed job could duplicate travel/reward: validate activity generation under the per-character lock.
- Destination updates might reset progress incorrectly: test same next edge versus changed next edge.
- Catalogue mirrors/assets can drift: validate mapLength, isAggressive, moveSpd, material references/icons, pool totals and root/frontend parity.
- LUK could alter endpoint odds: assert exact 1%/50%/99% reference cases independent of LUK.
- Existing five-deep Hunting queues can include future encounters that Gathering/Traveling might skip: only prequeue fights where the active authoritative stance guarantees fighting; activity-mode future encounters are resolved through the server scheduler before creating a payout-bearing battle.
- Migration execution remains subject to the repository’s stopped-consumer, read-only migration-history audit and queue/presence reconciliation safeguards.
