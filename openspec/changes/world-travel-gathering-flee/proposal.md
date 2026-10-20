# Proposal

## Why

The world-map waypoint and BFS route are currently presentation-only: selecting a destination generally commits it immediately. The saved Town field exists but does not yet drive teleport or death respawn. There is no authoritative per-segment travel progress, persisted Hunting/Gathering/Traveling lifecycle, monster-aggression contract, or gathering loop.

FLEE cannot safely be added as a normal combat action. Battles are pre-simulated and queued, while HP/SP, inventory changes and rewards are committed during resolution. A successful escape therefore needs deterministic partial-battle state, exact cancellation and reward suppression without mutating the original battle snapshot.

These behaviors are interdependent and must be proposed as one authoritative activity lifecycle.

## What Changes

- Replace direct map changes with server-authoritative cardinal BFS traversal. All current grind maps receive mapLength 25; all Towns receive mapLength 0. For mapLength 25, constant Move Speed 51 takes 30 seconds, 100 takes 20 seconds and 250 takes 5 seconds. Apply the agreed piecewise curve, low-speed extension, 5-second timed-travel minimum and linear mapLength scaling. Town↔cardinally-adjacent grind edges are instant in both directions.
- Persist a route and segment gauge. currentMapId, map presence, discovery and location pin change only when a segment commits. If a new destination preserves the next map ID, retain the current segment progress; reset it only when the next map ID changes. Saved-Town teleport is the only waypoint-based instant travel exception. Death respawns at savedTownMapId, with map_town fallback.
- Persist Hunting/Gathering as the last selected stationary stance. Traveling is automatic, non-clickable UI state derived from an active route/teleport intent. Keep the last stance while traveling and in Town; show neither Hunting nor Gathering as active in a settled Town.
- Add hard-coded monster moveSpd for world encounter/FLEE calculations, independent of monster level, and isAggressive on every monster. Initial non-aggressive monsters are Slime, Thornsprout, Saltfang Crab and Moonleaf Arcanist; all others are aggressive. Preserve existing battle-lane movement calculations.
- Add independent speed-based FLEE attempts. FLEE is not a Gambit/action and does not interrupt normal combat actions. Manual FLEE starts on the next combat tick and retries every 10 seconds while Traveling remains active. An aggressive encounter during Traveling gets an initial pre-combat roll; a failed roll starts battle and counts as the first failed attempt. Successful FLEE cancels the battle without XP, Mastery XP, drops, gold, kill count or death payout, while preserving the exact character state at the successful roll.
- Replace the fixed search gap with deterministic randInt(2,6) + playersInMap seconds, counting the character and disconnected residents. Remove the “Searching for monster…” progress UI. Hunting fights all monsters; Gathering and Traveling skip non-aggressive monsters without a travel delay and use the same FLEE chance to avoid combat with aggressive monsters.
- Add passive Gathering while stationary on a grind map in both Hunting and Gathering. Its base duration is max(30, 12 × mapLength + 30 × (playersOnMap − 1) − (gatheringLevel − 1)) seconds plus a deterministic 0–5 second variance sampled once per cycle. Population changes alter the fill rate without discarding progress. Gathering Level begins at 1; progression is out of scope.
- Add weighted cooking-material pools to approximately one-third of the current grind maps. Preserve food_blueberry’s ID/effect but rename it Blueberry Jelly and create its icon; create Wild Blueberries as a separate material. Rename Wild Honey to Honey without changing its ID/effect. Meat is not gatherable and drops only from Dire Wolf and Needleback Stalker, at 20% independently per kill.
- Add a blueberry-blue Traveling gauge and orange Gathering gauge in the upper-right map-head, above Players in map and opposite Currently in. Both use bold white “Traveling…” / “Gathering…” labels and freeze during battle. Traveling uses the boots icon and is visibly distinct/non-clickable; only Hunting/Gathering can be selected. Preserve existing map artwork, path preview, pinpoints, Town guards and battle snapshot immutability.

## Capabilities

### New Capabilities

- authoritative-map-travel: Map-by-map traversal, dynamic speed gauge, saved-Town teleport/respawn, stance preservation and authoritative offline progression.
- combat-flee-and-aggression: Monster aggression/speed, deterministic encounter cadence, pre-combat dodging and reward-free parallel FLEE cancellation.
- map-gathering: Passive Gathering gauges, map-specific weighted material pools and material catalogue/assets.

### Modified Capabilities

None. The repository has no registered capability specs under openspec/specs/<capability>/spec.md; this change introduces focused capability deltas rather than claiming an existing registered capability is being modified.

## Impact

Canonical and mirrored maps.json, monsters.json and items.json; Character state/DTOs and migration; map, presence, battle, inventory and activity scheduling services; shared deterministic battle-engine checkpoint support; catalogue validators/tests; MapBoard, activity gauges, stance controls and item icons. Update SPEC.md, its openspec/specs/SPEC.md mirror, ARCHITECTURE.md and STATUS.md during apply, not during this proposal-only session.

No gameplay implementation, canonical documentation edits, database migration execution, live database mutation or deployment is part of this proposal session.
