# Tasks

## 1. Canonical contract and catalogues

- [x]  1.1 Add a forward-only migration for saved stationary stance, travel intent/progress, gatheringLevel (default 1), Gathering cycle state and battle cancellation/audit fields. Preserve savedTownMapId and reconcile legacy pending transitions and unresolved entries idempotently.
- [x]  1.2 Set mapLength to 25 for all current grind maps and 0 for all Town maps in root maps.json and the frontend mirror without changing coordinates, NPCs, rosters, weights or artwork.
- [x]  1.3 Add explicit isAggressive and hard-coded moveSpd to root/frontend monster catalogues. Only mon_slime, mon_thornsprout, mon_saltfangcrab and mon_moonleafarcanist are initially non-aggressive. Seed world moveSpd from current moveSpeedBase values; never level-scale the new field and preserve battle-lane behavior.
- [x]  1.4 Add a materials group and type material items with stable IDs, stack/sale metadata and icons for Wild Blueberries, Wheat, Cooking Oil, Milk, Sugar, Carrot, Cabbage, Herbs, Honeycomb and Meat.
- [x]  1.5 Rename food_blueberry to Blueberry Jelly and food_honey to Honey without changing IDs/effects/ownership. Add 20% independent Meat drops to mon_direwolf and mon_needlebackstalker only.
- [x]  1.6 Add weighted gathering pools to all 36 current grind maps, with a temporary randomized distribution of all nine gatherable materials and total weights of 100 per map. Never add Meat to a gathering pool; Town pools remain empty.
- [x]  1.7 Create the Blueberry Jelly icon and icons for every new material ID following the existing icon conventions. Extend icon lookup to a materials folder.
- [x]  1.8 Extend DataService, CatalogService, all-item lookup, tooltip/category handling, drop resolution, mirror checks and asset validators for materials.

## 2. Authoritative travel and activity state

- [x]  2.1 Add server-authoritative DTO/persisted state for lastGrindStance, route, current segment, progress, timestamps, encounter cycle, Gathering cycle and FLEE cooldown; Traveling is derived from active travel intent.
- [x]  2.2 Implement deterministic cardinal BFS with stable tie-breaks matching the frontend route preview; validate current maps are reachable and route nodes are canonical/clickable.
- [x]  2.3 Derive character world moveSpd from 50 + level, generic equipment/buff flat/multiplicative modifiers and active movement penalties. Clamp 0–250; zero pauses travel. Do not add new speed items or change battle-lane movement.
- [x]  2.4 Implement the approved curve: 51→30 s, 100→20 s, 250→5 s at length 25; linear interpolation for 51–100 and 100–250; below 51 use 30×51/speed; timed floor 5 s; scale by source mapLength/25.
- [x]  2.5 Make cardinal Town↔adjacent-grind edges instant. Ensure a timed edge cannot accidentally be zero-duration solely because a Town source has mapLength 0.
- [x]  2.6 Keep currentMapId, discovery, pin and presence unchanged until a segment commits; atomically commit each intermediate node and start the next segment.
- [x]  2.7 Preserve segment progress when destination changes but nextMapId stays the same. Reset only if nextMapId changes. Current-map click or Hunting/Gathering cancels future travel but never rewinds committed arrival.
- [x]  2.8 Before an authoritative speed-affecting stat/equipment/buff change, accrue progress using old speed and continue with the new rate.
- [x]  2.9 Restore last stationary stance at final arrival, including Town arrival. Passing through Town does not end travel or permit Town NPC transactions.
- [x]  2.10 Implement saved-Town click as instant teleport when idle and FLEE-requesting teleport intent during battle; clear route/Gathering work at committed teleport.
- [x] 2.11 Update death routing to savedTownMapId with valid-Town check and map_town fallback; clear activity jobs without changing existing death penalty/log contract. Preserve plain Return-to-Town and food-exhaustion fallbacks.
- [x]  2.12 Reconcile old pendingMapTransition values/jobs so they cannot override the new travel state on startup.

## 3. Durable offline scheduler and encounters

- [x]  3.1 Implement an idempotent durable activity scheduler for segment progress, search timers, Gathering cycles and post-battle resume using existing distributed per-character locking/recovery.
- [ ] 3.2 Add chronological catch-up for offline/restart intervals. Process encounter and battle timestamps in order and never accrue travel/Gathering through a battle interval.
- [x]  3.3 Replace fixed search delay with inclusive deterministic randInt(2,6) + playersInMap seconds. Count the current character and disconnected residents; avoid Math.random.
- [x]  3.4 Remove the growing frontend search/progress bar but retain text-only “Searching for Monsters...” during server-side encounter cadence.
- [x]  3.5 Hunting always fights; Gathering/Traveling encounters use aggression filtering and a pre-combat FLEE roll. Do not prequeue reward-bearing fights that the current stance may skip.
- [x]  3.6 Keep active battle snapshots/jobs immutable when destination or stance changes; invalidate only future entries and resume according to latest authoritative activity.

## 4. FLEE and exact cancellation

- [x]  4.1 Implement/test the relative-speed FLEE helper, 1%/50%/99% calibration and endpoint-preserving 10% LUK influence using centralized tunable constants.
- [x]  4.2 Use explicit monster world moveSpd and the character’s effective world moveSpd/total LUK at the roll tick without changing lane movement.
- [x]  4.3 Use an independent deterministic FLEE RNG stream keyed by battle and attempt index so failed rolls cannot shift combat RNG.
- [x]  4.4 Manual Traveling selection during battle rolls on the next eligible combat tick and repeats every 10 seconds while Traveling remains active. Destination changes do not reset cooldown; selecting Hunting/Gathering stops future retries only.
- [x]  4.5 An aggressive encounter during Traveling gets an initial pre-combat roll; failure counts as the first failed attempt and the next is in 10 seconds. During Gathering, failed pre-combat FLEE starts a normal fight without changing saved stance.
- [x]  4.6 Add deterministic simulator partial-checkpoint replay returning complete state at an exact tick: HP/SP, item use/theft, food/digestion, buffs, statuses/durations and needed resource/cooldown state. Persist start inventory for new battles; use guarded fallback for legacy active entries.
- [x]  4.7 On successful FLEE after the tick’s ordinary effects, if alive, atomically mark cancelled/resolved, apply only checkpoint state and ordinary pending equipment changes, discard future queue/jobs and resume travel. Never grant XP/Mastery, drops, gold, kill counts or death payout.
- [x]  4.8 Serialize FLEE and normal resolution via Character→BattleQueueEntry locks. Whichever commits first wins; no cancelled battle may later pay rewards.
- [x]  4.9 Exclude cancelled battles from live queue and normal completed win/loss history while retaining immutable snapshot/log and cancel reason/time for audit.
- [ ] 4.10 Test retry timing, no combat RNG interference, route continuation, pre-combat dodge, destination changes and a successful escape near a lethal tick.

## 5. Gathering and material awards

- [x]  5.1 Persist gatheringLevel = 1 and cycle progress/variance.
- [x]  5.2 Implement base duration max(30, 12×mapLength + 30×(playersOnMap−1) − (gatheringLevel−1)) plus one inclusive deterministic randInt(0,5) variance per cycle. Test length 25/population 1/level 1 = 300 s before variance and length 50 = 600 s before variance.
- [x]  5.3 Accrue collection in stationary Hunting and Gathering; pause only in battle or Traveling. Population changes adjust rate while retaining progress/variance.
- [x]  5.4 On completion, weighted-pick the map’s pool and transactionally grant only if Inventory fits. Never overflow to Warehouse/mail; if full, skip and restart cycle.
- [x]  5.5 Preserve partial progress if travel is cancelled before leaving the source map. A committed different-map arrival starts that map’s own cycle; death/teleport clears active cycle.
- [x]  5.6 Validate material types/IDs/icons, mapLength, monster moveSpd/isAggressive, valid gathering references, 100% pool totals, Town emptiness, no Meat in pools and root/frontend parity.
- [ ] 5.7 Test Hunting collection, Gathering collection, population changes, overlap with encounter search, battle pauses, full inventory and excluded Meat.

## 6. Frontend stance/gauges and synchronization

- [x]  6.1 Replace client-only mode state with authoritative Hunting/Gathering and derived Traveling. Only Hunting/Gathering are clickable; boots/Traveling is visually distinct and non-clickable.
- [x]  6.2 Destination clicks activate Traveling immediately but pin stays at currentMapId until arrival. Current-map click or stationary stance cancels route/preview. During battle a new destination requests FLEE without stopping normal combat.
- [x]  6.3 Add reusable map-head activity gauge at upper right above Players in map, opposite Currently in. Traveling is blueberry-blue; Gathering is orange; inner text bold white.
- [x]  6.4 Keep the applicable gauge visible but frozen in battle. Traveling takes precedence; stationary grind in either Hunting or Gathering shows Gathering gauge. Hide active stationary stance styling in Town but preserve selected stance.
- [x]  6.5 Remove only the growing search/progress bar; retain text-only “Searching for Monsters...” while the server searches.
- [x]  6.6 Reconcile intermediate/final arrival, cancellation, FLEE, death, teleport, reload and stale HTTP/socket responses so completed paths/pins do not reappear.
- [x]  6.7 Preserve existing map camera, art, drag-click handling, tooltips, and mobile/desktop behavior.

## 7. Verification and handoff

- [ ] 7.1 Test travel calibration/interpolation, mapLength floor, speed zero/dynamic speed, instant edges, BFS ties, route continuity and cancel.
- [ ] 7.2 Test migrations/defaults, saved-Town validation, stance persistence, Town pass-through guards and legacy pending transition reconciliation.
- [ ] 7.3 Test offline route catch-up, aggression, search intervals, pause/resume, Gathering catch-up and death/teleport clearing.
- [ ] 7.4 Compare partial replay checkpoints across item use, damage/heal, status stack/expiry, buff, food and lethal tick; assert original queued log/outcome never changes.
- [x]  7.5 Run catalogue/world-map validators, focused travel/FLEE/Gathering tests, relevant battle/encounter regressions, shared/API/frontend builds, strict OpenSpec validation and git diff --check.
- [x]  7.6 During apply, update root SPEC.md and openspec/specs/SPEC.md without overwriting unrelated differences; update ARCHITECTURE.md and STATUS.md with verified behavior and test results.
- [x]  7.7 Do not run migrations, mutate production DB or deploy during coding. Follow the stopped-consumer/read-only migration-history audit and queue/presence reconciliation before environment rollout.
