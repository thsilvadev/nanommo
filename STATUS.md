### Closing the crafting modal cancels active Cooking — 2026-10-24

Closing Uncle Phillip's Cooking modal via its X or backdrop now calls the existing server-authoritative cancel endpoint before closing. If cancellation cannot be confirmed and the session remains active, the modal stays open; a session that has already reached its completion deadline is handled by the existing server completion/reconciliation flow. Reloading the page still does not cancel a session. Documented in root SPEC, OpenSpec SPEC and ARCHITECTURE. Frontend spec TypeScript check, development build and `git diff --check` passed. No API logic, migration, database mutation or deployment.

### Inventory stack split — 2026-10-24

Ctrl+clicking a stackable inventory stack now opens a Split modal with quantity bounded by the original stack minus one. Added `PUT /inventory/split`; server locks Character and inventory rows, checks stack eligibility, integer quantity and free slot, and atomically creates the new stack while subtracting from the original. Failed validation/transaction rolls back and emits a red System Journal error; modal closes and original stack stays unchanged. Updated root/OpenSpec SPEC and ARCHITECTURE. API build, frontend spec TypeScript check, frontend development build and `git diff --check` passed. No migration or deployment.

### Chat error visibility and scroll behavior — 2026-10-24

System Journal already had `severity: 'success' | 'error'` and red styling for error rows; no new classification was needed. Incoming System error rows now automatically enable System and scroll to the latest message even if it was hidden or the user had scrolled up. Activating a channel and changing text size with plus/minus also scrolls to the bottom. Documented in root SPEC, OpenSpec SPEC and ARCHITECTURE. Frontend development build and `git diff --check` passed; no API/gameplay/database/deployment changes.

### Cooking XP curve — 2026-10-24

Cooking thresholds reduced to 20% of the previous curve: L2 20, L3 44, L4 78, L5 128, L6 328, L7 828, L8 1578 XP. Rate is defined in `apps/api/src/modules/town/town.service.ts`, `cookingThresholds()`. Updated root and OpenSpec SPEC. API build and `git diff --check` passed. No migration or deployment.

### Battle queue UI recovery after missed realtime updates — 2026-10-23

Investigated the new Traveling freeze report against production logs and the frontend/backend flow. The backend queued the Venom Viper loss at 22:07:30.560 UTC, published `battle:queueUpdated` with one entry at 22:07:30.561, and the gateway logged forwarding it to the character socket at 22:07:30.563; death was committed and `battle:resolved` forwarded at 22:07:54.64. The available logs do not prove whether the browser received/applied the queue event, so the exact failure is not claimed as confirmed. The frontend had no periodic recovery of an empty local BattleStore queue while the character remained Grinding: if a queue push was missed or not applied, Grind Info could stay on `Searching for Monsters...` until another event (such as death) forced a resync.

Added a low-frequency frontend safety reconciliation: every 3 seconds, while the Character is Grinding and the local battle queue is empty, `BattleStore` reads the authoritative `/battles/queue` endpoint and restores any unresolved entries. It does not replace a non-empty realtime queue, uses a realtime-generation guard to reject a response raced by newer socket events, filters entries already marked resolved locally, and ignores transient request failures. Added a focused regression test for recovering a missed Venom Viper queue entry. This is a client resilience fix, not a change to server combat/travel authority.

Validation: frontend spec TypeScript check passed; frontend development build passed; `git diff --check` passed. Focused Karma test bundle compiled, but execution is blocked on this workstation because ChromeHeadless has no browser binary (`CHROME_BIN` unset). No backend gameplay logic, migration, database mutation or deployment changed.

### Off-battle resource regeneration and manual consumables — 2026-10-23

Extended persisted HP/SP regeneration from Town-only to Town and Grind-map off-battle time, including Travel, Gathering and encounter-search gaps. Regeneration uses the existing fixed `regenAnchorAt` clock and 10-second boundaries, current derived stats, and the same individually expiring Diet food bonuses as before. It subtracts intervals owned by BattleQueueEntry rows, treats a started unresolved battle (even an overdue one) as a hard write barrier, and does not credit the final battle boundary a second time. `resourceRegenAt` records the last processed boundary independently of `lastSeenAt`; battle resolution and successful FLEE advance it through the last globally aligned boundary owned by that immutable battle/replay, preventing delayed recovery from replaying pre-battle regen on top of terminal HP/SP. The WorldActivityProcessor's 10-second recovery pulse reconciles resources for persisted characters and publishes snapshots when HP/SP changed; Character GET and manual use also settle overdue off-battle boundaries.

Removed the incorrect `status === 'grinding'` manual-item prohibition. Food retains the canonical `consumeFood()` checks (inventory, Diet/digestion/streak rules and Cooking reservations); usable consumables retain inventory/effect validation and now persist absolute cooldown expirations. HP/SP potions use the existing shared `item:potion` category and selected item's configured duration; other configured consumables use `item:<itemId>`. These deadlines are passed into each immutable battle snapshot as remaining ticks and initialized in BattleEngine, so wall time while off-battle elapses and any remainder continues through battle. The InventoryGrid now shows item-use validation errors, including remaining cooldown/digestion errors, instead of silently swallowing them.

Added forward-only migration `1799910000000-OffBattleResourcesAndConsumableCooldowns` for the two new Character columns. It has **not** been executed. Validation passed: shared/API builds; frontend spec TypeScript check and development build; `node apps/api/test/off-battle-resources-cooldowns.test.js` (including base/food regen, battle-interval exclusion, final knockout boundary, Grind-map potion and food use, cooldown rejection/expiry and unresolved-battle protection); `node apps/api/test/inventory-manual-use-queue-invalidation.test.js`; Jest `battle-food-regen.spec.js` + `diet-auto-feed.spec.js` (6/6); `node apps/api/test/world-travel-gathering-flee.test.js`; and `git diff --check`. The new migration remains unexecuted. No deployment or live database mutation.

### Character load error routing and world-job lifecycle tracing — 2026-10-23

Fixed a frontend guard defect: `CharacterStore.load()` records request failures in its `error` state rather than rejecting, but route guards had swallowed the distinction and interpreted a missing in-memory Character as a genuinely absent saved Character. `characterGuard`, `createCharacterGuard`, and `guestGuard` now route failed/interrupted loads to an unguarded `/error` page; only a successful `loaded` state with no Character can lead to `/create-character`. The page apologizes, identifies a possible temporary server/communication failure, clarifies that this screen alone does not mean the save was lost, and offers a retry to the original in-app route with external/protocol-relative return URLs rejected.

Added normal-level lifecycle logs around Travel enqueue/removal, job execution, generation/schedule-version stale checks, segment results, battle encounter pauses, recovery re-arming and the special case where an unresolved battle's `endAt` has already passed. Gathering now logs scheduled job/cycle identity, actual available non-battle seconds, completed cycle count/grants and stale rejection reason. Travel/Gathering/FLEE workers log job ID and attempt counts; BattleQueueProcessor's completion/failure methods are now registered with Bull decorators and log retries/completions for battle resolution and relevant world jobs. These logs are diagnostic only; no job/retry/authority rules were intentionally changed.

Validation passed: API build; frontend development and production builds; frontend spec TypeScript check; auth-guard Karma suite in Chrome Headless (14/14); `node apps/api/test/world-travel-gathering-flee.test.js` (contract + checkpoint replay); `node apps/api/test/saved-town-route-warp-contract.test.js`; and `git diff --check`. Production Angular build completed with the repository's existing non-fatal component CSS-budget and CommonJS warnings. `node apps/api/test/grind-monster-expansion-chat-journal.test.js` remains blocked by an unrelated stale catalogue assertion: it expects Mutant Bee weight 60 on `map_green_grounds_1`, while the unmodified catalogue reports 15; no monster/catalogue balance was changed to mask it. No migration, live database mutation or deployment.

### Traveling preview recovery and Gathering XP progression — 2026-10-22

Made the active server `travelIntent` authoritative for the map's destination tile and remaining route polyline, even when local preview state has been cleared during a battle-resolution snapshot. The map board now reconstructs the destination/path from the persisted `destinationMapId`, `routeMapIds`, and `segmentIndex`; local BFS remains the fallback before an active route is available. The moving 88px location marker receives a 7px upward visual correction only during a valid cardinal route leg; settled placement remains unshifted.

Added cumulative persisted `Character.gatheringXp`. Each resource that is actually inserted into Inventory by `advanceStationaryActivity()` awards exactly +30 XP in that same transaction; missing pool/capacity-discarded cycles give no XP. `gatheringLevel` is derived as `floor(gatheringXp / 100) + 1`; Level 2 requires 100 total XP. The existing server/UI duration formula already uses `gatheringLevel`, so the level-up affects the next gathering cycle with the existing one-second reduction per level above 1. Added forward-only migration `1799900000000-GatheringProgression` (not executed) and updated the Professions progress projection/specs.

Validation passed: shared/API builds; frontend development and production builds; eight focused `location-pin-motion.spec.ts` tests in Headless Chromium; saved-Town route contract; world-travel/Gathering checkpoint tests; Gathering grant/XP regression; new route/XP contract; strict OpenSpec validation; and `git diff --check`. Production Angular emits the existing non-fatal component CSS-budget and CommonJS warnings. No migration, live database mutation, or deployment.

### WorldActivityProcessor TownService dependency injection — 2026-10-22

Fixed API startup failure after Cooking recovery was added to `WorldActivityProcessor`: `MapModule` now imports `TownModule`, which exports `TownService`. The processor can therefore reconcile overdue Cooking sessions and execute `complete-cooking` jobs in its own Nest module context. Added a focused source-contract regression for the MapModule import, TownService export, and both processor call sites. API build and the focused contract test pass. No migration, database mutation, or deployment.

### Saved-Town route waypoint and Traveling location pin — 2026-10-22

Added a deterministic shared helper that recognizes the character's saved Town only when it appears strictly between the current map and a different requested destination on the canonical clickable BFS route. MapService persists a one-time `saved-town-route-teleport` intent, keeps the original destination, waits for a started battle to resolve before committing the Town waypoint, then recomputes BFS from that Town. If the character dies during this special route, death respawn at the saved Town preserves the route intent and travel continues to the original target; ordinary death handling is unchanged outside the special route. The existing direct saved-Town click keeps its original intent.

The MapBoard location pin now follows the authoritative current route segment with the same percentage and pause semantics as the Traveling gauge. It moves edge → center → edge on cardinal tile geometry; the outgoing edge on one map and incoming edge on the next map share the same world coordinate. The incoming edge is kept in browser-local UI state so the pin remains at the arrival edge after final arrival/refresh. Pin animation is disabled inline while any travel intent is active; settled bounce returns when travel ends. No client movement timer or gameplay-state write was introduced.

Validation passed: shared/API builds; `node apps/api/test/world-travel-gathering-flee.test.js`; `node apps/api/test/saved-town-route-warp-contract.test.js`; frontend development and production builds; the five focused location-pin tests in Headless Chromium; strict OpenSpec validation; and `git diff --check`. The production build emits existing CSS-budget/CommonJS warnings, but the new pin behavior does not add a map-board CSS budget warning. Other unrelated working-tree checks currently fail on existing Town-count/map-catalogue mirror and stale `Save here` label expectations; those files/data were left unchanged. No migration, live database mutation, or deployment was performed.

### Monster sprite style refresh — 2026-10-22

Replaced `apps/frontend/assets/monsters/mon_mutantbee.svg`, `mon_giantmantis.svg`, and `mon_flamingtreant.svg` with isolated transparent 167×199 sprites rendered in the same detailed, dark-outlined pixel-art RPG style as the existing monster sheet. Mutant Bee is a menacing wasp with segmented yellow-black armor, red eyes and large veined wings; Giant Mantis follows the attached side-profile/praying pose with purple underwing and leg details; Flaming Treant is burning, furious and distressed, with icy tears. Each SVG embeds an optimized transparent PNG payload so existing catalogue paths and layout stay unchanged. UI asset validation, frontend development build, and frontend production build pass. The production build still reports existing non-fatal CSS-budget and CommonJS warnings. No gameplay data, database, migration, or deployment was changed for the sprite refresh.

### System Journal timing, chat history identity and Town Guard feedback — 2026-10-22

Pre-computed Gathering/Traveling pass-by and successful-dodge decisions no longer publish their System/Journal rows immediately when a future queue is built. Each decision now schedules an `idle-journal-precombat` Bull job for its projected encounter boundary; the worker checks that the Character is still on the same map and in the same activity before publishing. The persisted successful-dodge timestamp uses that projected boundary and the Grind Info hint does not display early when it lies in the future.

Fixed chat history's REST character context: the JWT strategy supplies `userId`, not `characterId`, so the history controller now resolves the authenticated account's Character before reading its private Redis System feed. Global and System history requests fail independently rather than a single rejected request hiding both; history errors and accepted Global sends now produce backend logs. Global sending remains on the authenticated Socket.IO `/game` `chat:send` flow (durable PostgreSQL history is retrieved with REST): the UI requires an active socket and a valid server acknowledgment DTO before appending its own accepted row or clearing the draft. No optimistic local message is added on send failure.

Hungry Town-to-Grind attempts still reject travel, but now publish `Town Guard: You are hungry! Eat something or go cleanse your sins for a change.` as a red error-severity System row and suppress the duplicate generic map-error text. The toggle is labelled **System**; System entries have no sender label, normal rows are green, and error rows are red.

Validation passed: shared/API builds; frontend development and production builds; `node apps/api/test/grind-monster-expansion-chat-journal.test.js` (including REST account-to-Character resolution, hunger severity and delayed-precombat event guard); `node apps/api/test/world-travel-gathering-flee.test.js`; `node scripts/validate-world-map.js`; `node scripts/validate-monster-catalog.js`; `pnpm --filter @nanommo/frontend validate:ui-assets`; strict OpenSpec validation; and `git diff --check`. Angular production emits existing non-fatal CSS-budget and CommonJS warnings. No migration, live database integration test, production inspection or deployment was performed.

### Vercel production build CSS budget — 2026-10-22

Fixed the Vercel production build failure caused by `apps/frontend/src/app/features/play/character-summary.css` exceeding Angular's 5.12 kB hard error budget. Removed two responsive `.diet-slot` rules identical to its base rule, merged the split `.diet-slot > img` declarations, and removed the unused `.panel-title button` rule (the component template has no matching button). No build budget was increased. Verified the full Vercel command chain — `node scripts/sync-frontend-data.js && pnpm --filter @nanommo/shared build && node scripts/set-env.js && pnpm --filter @nanommo/frontend build --configuration production` — passed with exit code 0. The stylesheet is now 4.99 kB in the optimized component output, below the 5.12 kB hard limit but still above Angular's non-fatal 3.07 kB warning threshold. Other existing CSS-budget and CommonJS warnings remain. No deployment performed.

### Apply — `grind-monster-expansion-chat-journal` (2026-10-21)

Implemented three canonical monster species (Mutant Bee, Giant Mantis, Flaming Treant), their six common/rare monster-part records and icons, transparent 167×199 sprites, Sting/Tip of Pain in the shared simulator, the aggression badge and the six exact roster percentages, with the Mutant Bee roster moved to current Green Grounds 4 (former GG5) and current GG5 retaining its old GG6 roster. The root catalogue files and public frontend mirrors are synchronized. XP rewards follow the current standard curve and approved level-1–6 bonus rule. Deterministic assertions cover the new stats, rosters, regional allow-lists, item names/assets, and Sting's self-target/cast/SP/cooldown, one-use buff, miss consumption, doubled raw physical ATK and Disarm-on-hit.

Gathering validates explicit per-map allow-lists rather than requiring a pool on every Grind map. Assigned maps have weighted pools; maps without an approved material assignment omit `gatheringPool`, and the authoritative cycle advances/resets without a fallback item or success Journal row. Pools now follow the current Green Grounds IDs: GG2 Cabbage/Carrot 50/50 (former GG3), GG3 Wheat 100 (former GG4), GG4 Sugar/Honeycomb 80/20 (former GG5), and GG5 Sugar 100 (former GG6). Honeycomb is limited to Green Grounds 1/4 and Meat remains drop-only. The Mutant Bee roster is on current GG4 (former GG5), with current GG5 retaining the former GG6 Mudcrawler/Thornsprout roster.

Implemented the forward-only `1799700000000-GlobalChatIdleJournal` migration (not executed), GlobalChatMessage persistence/retention in PostgreSQL, per-account Redis NX/EX rate limiting (one accepted message every five seconds), Redis-only bounded character-scoped Journal lists/pub-sub, authenticated Global send/history, and post-commit Journal hooks for material awards, encounter skip/dodge, food, theft and successful FLEE. Global sender-name snapshots survive Character deletion through the nullable FK. The floating ChatDrawer/header toggle was removed and a Global/Idle Journal composer now sits below the map. Unsupported legacy mute/report operations reject requests rather than silently succeeding. The aggression tooltip is available on hover and keyboard focus using the canonical `isAggressive` flag.

**Verified offline:** `pnpm --filter @nanommo/shared build`, `pnpm --filter @nanommo/api build`, `pnpm --filter @nanommo/frontend exec ng build --configuration development`, `pnpm --filter @nanommo/frontend validate:ui-assets`, `node apps/api/test/mastery-skill-simulator.test.js`, `node apps/api/test/battle-distance-movement.test.js`, `node apps/api/test/world-travel-gathering-flee.test.js`, `node apps/api/test/grind-monster-expansion-chat-journal.test.js`, `node scripts/validate-monster-catalog.js`, `node scripts/validate-world-map.js`, `pnpm exec openspec validate grind-monster-expansion-chat-journal --strict`, and `git diff --check` pass. At the end of the initial validation for this change, the production Angular build was blocked by `apps/frontend/src/app/features/play/character-summary.css` exceeding the 5.12 kB hard CSS budget; the follow-up fix and passing production build are recorded in the 2026-10-22 entry above. Integration verification against a disposable PostgreSQL database, concurrent retention/restart, multi-instance Redis/Bull behavior, browser-level UI interaction, and authoritative no-pool/failed-trigger Journal tests remain outstanding. No migration or deployment was performed.

### Grind stance UI synchronization regression — 2026-10-21

Fixed a second stale-state path behind the Hunting sword appearing selected after the server confirmed Gathering. `CharacterStore.applyPatch()` previously updated a full DTO without advancing (or checking) the local `stateVersion` watermark; also, stance changes may not be represented by a newer shared state revision. `GrindComponent` now sends successful `/maps/stance` responses through `applyConfirmedStance()`: it applies the requested stance even when the accompanying DTO is stale for other Character fields, remembers the response's server `updatedAt`, and preserves the confirmed stance against older-timestamp queue/battle snapshots while still accepting their newer HP/SP/etc. Later snapshots with newer timestamps can synchronize a stance change from another tab. Full DTO patches and attribute-mutation responses now respect/update the state revision watermark too. Added regressions for the older-revision stance response, a higher-revision-but-older-timestamp socket snapshot, stale full DTO patches, and the direct attribute-mutation update path. Validation passed: focused CharacterStore Karma suite (12/12), frontend development build, and `git diff --check`. No backend/database changes, migration, or deployment in this fix.

### New characters start with Sierra Village saved — 2026-10-21

`CharacterService.createCharacter()` now explicitly persists `currentMapId: 'map_town'` and `savedTownMapId: 'map_town'`, so a new character is both born in Sierra Village and has it set as their saved Town without relying solely on a database default. Added source-contract and registration integration assertions; the API build passed. The broader `map-transition-frontend-contract.test.js` currently fails an existing stale assertion expecting the UI label `Save here`, while the current UI intentionally renders `Save`; the failure is unrelated to the new-character waypoint change. No database migration execution or deployment.

### Regression fixes — Poison carryover and stale Grind stance (2026-10-20)

Implemented persistent status-expiry normalization: finite Character status effects now use absolute `expiresAt`, convert to battle-local ticks only in each new snapshot, and expire against wall time between fights. Successful FLEE persists remaining status duration as timestamps instead of reusing the prior battle's relative ticks. Queue generation removes legacy finite-tick-only Character statuses and rebuilds unstarted queued battles, but preserves any already-started immutable battle. World Move Speed ignores expired/legacy relative-tick status penalties. Added focused tests for conversion, expiry, legacy cleanup, and the Antidote Gambit requiring active Poison.

The Grind stance control now derives its active mode directly from `CharacterStore.character().lastGrindStance`; it no longer mirrors that value into a second local signal or starts a redundant `/characters` request on Grind mount (the parent Play view owns initial loading). `CharacterStore.load()` still protects newer state from older revisions, but merges the persisted `lastGrindStance` from a non-raced GET even when the rest of that response has an older `stateVersion`, preserving current HP/SP and other newer fields. This addresses stance writes that are not reflected by the shared Character state revision. Added regression coverage for same-revision refresh and lower-revision stance-only merge.

Validation: shared/API production builds, frontend development build, frontend app/spec TypeScript checks, and the focused CharacterStore Karma suite (9/9) passed. Focused persistent-status, world travel/FLEE, battle-distance, status-timeline, and BattleService food-regeneration tests passed, as did `git diff --check`. The full frontend Karma run reached 50/53; its three existing failures are in Vendor/Town request mocks and old Mastery XP expectations, not the changed files. Frontend production build remains blocked by `character-summary.css` exceeding its 5.12 kB budget by 78 bytes; that CSS file is unchanged. No database mutation, migration, or deployment.

### Pre-apply OpenSpec handoff — `cast-time-reduction-intent` (2026-10-19)

Proposal/design/spec/tasks are ready under `openspec/changes/cast-time-reduction-intent/`. Approved contract: derived CTR is `floor(DEX × 2)` (starting DEX 5 = 10, no +100 baseline); effective player-skill duration is `max(0, ceil(baseCastTicks - CTR / 100))`, allowing same-tick resolution at 0 ticks. Character Cast Gambit skill intent starts at T0, targeted skills move without spending SP/starting cooldown until in range, positive-duration skill effects resolve at `startTick + effectiveCastTicks`, and monsters keep their separate existing cast path. Non-skill Cast actions retain their existing scheduling and Gambit priority. Strict OpenSpec validation and `git diff --check` passed for the proposal artifacts. No gameplay code, canonical SPEC, database, migration, or deployment was changed in this proposal-only session; apply and run the enumerated regression/build tasks in the next session.

### Character XP and Mastery balance — 2026-10-19

Locally adjusted the character XP table with higher early-level requirements through level 13, a geometric bridge toward the prior late-game curve, and synchronized root/frontend public copies. Grind XP now applies a character-to-monster level-gap multiplier from the immutable battle snapshot: 100% through +3 levels, 70% at +4, 50% at +5, 30% at +6, and 5% at +7 or more. Mastery now calculates each level requirement recursively: `floor((previous requirement + 50) × 1.5)`, starting at 50 XP; the current cap remains 10, and the formula extends automatically beyond it. Added forward-only migration `1799400000000-FormulaMasteryXpThresholds` to reconcile stored levels without editing prior migrations. Validation is in progress. No database mutation, migration execution, or deployment.

### Bow precision, Fearless Focus, and stale active battle UI — 2026-10-19

Implemented locally: Bow equipment halves derived Precision with floor rounding instead of applying the old tier-specific -75/-74/-73 modifiers; the shared CatalogService appends the red final tooltip line `Bows reduce precision by a half` to all Bow item tooltips. Fearless Focus now adds `5 × rank + 5 × empty-space distance` Precision at basic-attack resolution and no longer changes damage. Root/frontend `items.json` and `skill_trees.json`, source calculations, tooltip surfaces, focused simulator/contract tests and root/canonical SPEC wording have been updated. Existing unrelated edits in `apps/frontend/src/app/features/play/grind-info.html` and `map-board.css` were preserved.

Investigated the reported 0-HP Grind panel stall. Frontend `BattleStore.load()` previously accepted an HTTP response even if a newer `battle:resolved`/`battle:queueUpdated` socket event arrived while the request was in flight; the store also retained the resolved entry until a later queue event. Added a realtime generation guard for stale HTTP responses, immediate removal of an entry on `battle:resolved`, and filtering of remembered resolved IDs from subsequent queue payloads. Added focused frontend race regressions. Empty queue payloads after filtering trigger an authoritative refresh rather than leaving an empty stale projection.

Verification passed: shared/API builds; frontend production build (existing CSS-budget and CommonJS warnings); `node apps/api/test/hand-equipment-mastery-contract.js`; `node apps/api/test/mastery-skill-simulator.test.js`; `node apps/api/test/battle-distance-movement.test.js`; strict OpenSpec validation; catalogue/mirror checks; `git diff --check`. The Angular queue regression spec compiled, but Karma could not execute it because no ChromeHeadless binary/CHROME_BIN exists on this workstation. The Mastery test's existing Violent Shot cooldown expectation was aligned with the current canonical root catalogue value of 25; no gameplay/catalogue cooldown was changed to resolve that pre-existing frontend mirror mismatch.

No database access/migration/deployment. The provided logs name `mon_thornsprout` rather than `mon_fieldbat`; the queue synchronization correction is monster-agnostic. Browser/live-production verification remains outstanding.

### Map discovery and deferred Town transition regression fixes (2026-10-19)

Fixed the exploration veil's one-cell vertical offset: fog-cell coordinates now use the same `row = 6 - y` conversion as map tiles, so discovering Green Grounds 0 at (-1, 0) reveals its own cell and the four cardinal neighbors in the correct visual positions. Fixed deferred Town entry during a live battle: MapService keeps the character in `grinding` while recording `pendingMapTransition`, repairs the prior premature `status = town` state, and relies on the battle resolver to commit the destination and Town status after the active battle ends. The map board's existing waiting message remains visible; Town NPC panels must not appear before the committed transition.

Verification passed: shared/API/frontend production builds, `node scripts/validate-world-map.js`, focused coordinate regression assertions, strict OpenSpec validation and `git diff --check`. The SPEC map-transition text was updated in both copies; the repository's pre-existing final-paragraph wording difference between `SPEC.md` and `openspec/specs/SPEC.md` was preserved. Browser verification remains pending. No deployment, database operation or migration.

### Implementation — `definitive-world-map-viewport` (2026-10-18)

Implemented the 41-location canonical world catalogue and frontend mirror, all `unlockLevel: 0`, recommended-level advisory metadata, native 2295×1989 map artwork and pinpoint assets, a fixed 761×660 viewport with contiguous 153px cells, mouse/touch pointer panning and drag-click suppression, current-location pin, per-character discovery persistence/reveal projection, Town/grind map entry separation, multi-Town destinations and forward-only migration `1799200000000-DefinitiveWorldMapViewport`. Added `scripts/validate-world-map.js`.

Validation: OpenSpec strict validation, the focused world-map validator, shared/API builds and frontend production build passed. The existing monster catalogue validator still fails on a pre-existing root/frontend `skill_trees.json` mismatch (`violent_shot.cooldownTicks` 25 vs 15); this unrelated catalogue difference was not overwritten. Production build emitted existing CSS-budget and CommonJS warnings. No browser visual test, database migration, live DB mutation or deployment was performed. Migration integration, real pointer/viewport review and active-battle transition verification remain rollout checks.

### Regression review — `world-travel-gathering-flee` (2026-10-20)

User-reported regressions were traced locally without touching a live database or deploying. NPC catalogues no longer use a fake William-only fallback; late responses that race a Town-to-Town transition trigger a fresh catalogue load for the settled destination, and catalogue errors are visible even with no NPC selected. The `MapService` remains map-owned for NPC lists: `map_town` declares William, Father Marcelus, Blacksmith Loren, Cecilia, and Storage; `map_outpost` currently declares Storage only. That placement is canonical data, not a frontend refresh rule, and needs product confirmation before adding William to Outpost/all Towns.

The Grind Info template now distinguishes a future queued battle from an active fight: it displays text-only `Searching for Monsters...` while the queue entry's `startAt` is in the future, with no growing search bar and no stale foe details. The original white-outline `boots.svg` was restored. The Traveling indicator remains visible when inactive but is only selected while `travelIntent` exists; the user's manual removal/commenting of the icon `filter` was preserved. The map-head Gathering projection subtracts known battle intervals from wall time. Resolved FLEE events now retain start/end/cancel timestamps so the Gathering projection can stop a cancelled combat interval at its actual FLEE time, and successful FLEE emits the requested transient `You managed to flee battle!` notice near map feedback.

Two server-side empty-queue paths are covered: completed stationary collection can grant a weighted material and restart the cycle; an entire bounded batch of passive/successfully dodged Gathering candidates advances a persisted deterministic pre-combat cycle and schedules a continuation, changing the next roster/FLEE stream rather than remaining empty indefinitely. Focused tests for both paths passed along with encounter cadence, checkpoint replay, migration contract, diet, movement, world/map catalogues and production builds. The high-level 99% FLEE cap remains the current balance contract; as a result, a faster character facing a slow Guardian can avoid many consecutive aggressive encounters legitimately. Whether to change that balance is awaiting user direction.

Verified locally: shared/API builds, frontend production build, `node apps/api/test/gathering-cycle-regression.test.js`, `node apps/api/test/grind-food-expiry-exit-regression.test.js`, `node apps/api/test/encounter-search.test.js`, world-travel/checkpoint/migration contract tests, diet and movement regression tests, map/monster validators, strict OpenSpec validation and `git diff --check`. The production frontend build has CSS budget and CommonJS warnings only. The Angular/Karma NPC test is authored but not browser-executed on this workstation because ChromeHeadless is unavailable. This is not live PostgreSQL/Redis/Bull concurrency testing. No migration execution, database mutation, production repair or deploy occurred.

### Implementation — `world-travel-gathering-flee` (2026-10-20)

Implemented locally: added `mapLength` to all 41 map records (Town 0, Grind 25), fixed per-species `isAggressive`/world `moveSpd`, twelve 100%-weighted gathering pools, ten data-only material entries/icons, Blueberry Jelly/Honey display renames that preserve item IDs/effects, and independent 20% Meat drops only for Dire Wolf and Needleback Stalker. Updated API/frontend catalogue loading, validation, material icons and the current-world validator (the prior monster validator still expected the obsolete seven-map catalogue).

Added shared deterministic cardinal BFS, instant Town↔adjacent-Grind edges, world Move Speed/travel-duration helpers, seeded FLEE chance and Gathering-duration helpers. Persisted Character world-activity state and BattleQueueEntry cancellation/replay snapshot fields; added forward-only migration `1799600000000-WorldTravelGatheringFlee` with guarded reconciliation of legacy pending transitions and future queue projections. `MapService` now owns route intent/progress, map commits/discovery/presence refresh, saved-Town teleport/death respawn, selectable persisted Hunting/Gathering stance, world encounter checks, and durable Gathering awards. `WorldActivityProcessor` uses the existing queue and shared processing gate for travel, FLEE and stationary-activity jobs. Town/NPC/Warehouse guards reject active travel intent. New battle snapshots retain starting combatant/inventory/Gambit data; the simulator supports a deterministic partial-tick checkpoint; FLEE uses an independent RNG stream and atomically records reward-free cancellation without rewriting the original battle log/outcome/snapshot. The frontend has Hunting/Gathering stance controls, non-clickable Traveling boots, activity gauges, and a text-only “Searching for Monsters...” state without the prior growing/progress bar.

Verification passed: shared/API builds, frontend production build, `node scripts/validate-monster-catalog.js`, `node scripts/validate-world-map.js`, `node apps/api/test/world-travel-gathering-flee.test.js`, strict OpenSpec validation and `git diff --check`. Focused tests cover BFS/route reachability, calibration of travel speeds, instant Town edges, FLEE speed/LUK endpoints, deterministic random values, Gathering duration, catalogue materials/aggression/drop/pool integrity, and deterministic checkpoint replay. The frontend build emits the repository's existing CSS-budget and CommonJS warnings. The stale validator was updated for the definitive 41-map catalogue; the known unrelated `skill_trees.json` mirror/cooldown discrepancy was not changed.

**Not yet verified / rollout boundary:** no live database inspection, migration execution, production mutation, deploy, browser visual review or live PostgreSQL/Redis/Bull concurrency test. The focused replay test does not yet cover every combination of item theft/consumption, status expiry, buff, food/digestion and a near-lethal tick. Long offline periods are persisted and travel/Gathering catch-up excludes recorded battle intervals, but a full chronological catch-up replay across every segment, encounter and collection boundary is not complete. Speed changes are picked up by the durable travel pulses rather than a tested pre-mutation integration hook. Keep these tasks open; do not mark the change complete or roll it out until those checks are addressed.

# NanoMMO — Implementation Status

### Unified monster Move Speed across combat and FLEE (2026-10-20)

Monster `moveSpd` is now hard-coded in both `monsters.json` copies to the previous combat formula `moveSpeedBase + level - 1`. BattleEngine reads this final catalog value instead of independently scaling the species base, so the same monster speed is used for in-battle lane movement, pre-encounter FLEE in Gathering/Traveling, and during-battle FLEE while Traveling/FLEEing. Updated the monster catalogue validator and SPEC/ARCHITECTURE/proposal wording to remove the contradictory fixed-world-speed rule.

### Regression fixes — `world-travel-gathering-flee` follow-up (2026-10-20)

The Gathering pre-combat path now records each aggressive encounter's seeded FLEE roll (chance and roll, success/failure) in backend logs. A successful pre-combat dodge persists its timestamp in `encounterCycle.lastFleeSuccessAt`; Grind Info displays `Gathering...` instead of `Searching for Monsters...` during the Gathering search interval and briefly shows `You fled an aggressive enemy.` after a successful dodge. When a Gathering cycle awards a material, the backend now publishes an authoritative queue/state snapshot so the frontend inventory and Gathering gauge update immediately instead of waiting for a later battle/death event. Successful/failed in-battle FLEE attempts also emit backend logs. Battle Logs label a reward-free cancelled entry `FLED` rather than `DEFEAT`, while preserving its original deterministic battle log/outcome as audit data. Corrected Sacred Forest Guardian to be aggressive, matching the existing world rule that only Slime, Thornsprout, Saltfang Crab and Moonleaf Arcanist are non-aggressive.

Validation passed: shared/API/frontend production builds, `node apps/api/test/world-travel-gathering-flee.test.js`, `node apps/api/test/gathering-cycle-regression.test.js`, `node scripts/validate-world-map.js`, `node scripts/validate-monster-catalog.js`, and `git diff --check`. Existing CSS-budget and CommonJS warnings remain. No database migration, live database inspection, deployment, or browser verification was performed. The current 99% FLEE chance cap remains unchanged; with world Move Speed 101 against Move Speed 45, an aggressive encounter is expected to break through only about 1% of the time. Town NPC data still intentionally lists William/Father Marcelus/Blacksmith Loren/Cecilia/Storage in Sierra Village and Storage alone in the other Towns; no unsupported William placement was added. `VendorStore` now independently fetches the map/NPC/vendor JSON files when the general frontend catalogue load fails, so an unrelated catalogue-file failure cannot blank the Town resident list before `/town/npcs` responds. Runtime/browser confirmation against the actual Character status and `/town/npcs` response remains outstanding.


### Town NPC art + neutral selection state (2026-10-17)

Installed five transparent 167×199 PNG portraits under `apps/frontend/assets/npcs/`: William, Father Marcelus, Blacksmith Loren (female blacksmith), Cecilia, and Storage (with a large chest in front). The updated package was validated against its SHA-256 manifest; every asset has the expected dimensions and real alpha transparency. Grind Info's Town selector and store start empty rather than defaulting to William, show “Choose NPC to interact”, reset NPC-specific dialogue/stock/warehouse/modal/error state whenever Town is re-entered, and ignore late async responses for NPCs that are no longer selected. The selected portrait is rendered centered above the NPC title.

Validation: `pnpm --filter @nanommo/frontend build --configuration production` passed. Confirmed all five PNGs are copied to the production distribution byte-for-byte and `git diff --check` passes. Angular/Karma test bundle compilation succeeds, but browser tests cannot run on this machine because the ChromeHeadless binary is not installed. No backend/gameplay changes or deployment.


### Grind monster artwork — original sheet crops installed (2026-10-17)

The initial simplified SVG approximations were replaced with the user-approved art packaged in project/nanommo-real-monster-art-overrides.zip. All 27 files at apps/frontend/assets/monsters/<monsterId>.svg now embed the matching original pixel-art crop as a transparent WebP data image on the same 167×199 canvas. The existing /assets/monsters/<id>.svg URL and centered Grind foe layout remain unchanged. Validation confirmed every canonical monster ID has exactly one sprite, each payload decodes as a transparent 167×199 WebP, the production build passes, and all 27 output assets byte-match their source versions. Previous SVGs are backed up outside the repository at /tmp/nanommo-old-monster-sprites-1792220411. No gameplay or backend changes and no deployment performed.


### Battle resolution stall — Auto Feed inventory scope (2026-10-16)

Investigated the reported offline Grind stall where the client showed a monster at 0 HP but the character neither advanced to another encounter nor returned to Town. The resolver runs Auto Feed inside the same transaction as battle payout. `InventoryService.getItemCount()` previously used an unrestricted `findOne({ characterId, itemId })`, so a food stack stored only in Warehouse could falsely satisfy the Auto Feed inventory check. `consumeFood()` then searched only `location = inventory`, found no stack and threw `Insufficient item quantity`. The transaction rolled back, leaving the battle unresolved with its precomputed 0-HP monster snapshot; Bull retries then hit the same failure, explaining the persistent dead-looking battle. This is a code-path match for the reported error; production DB rows were not inspected, so the exact character/battle row has not been independently confirmed.

Fix applied locally: `getItemCount()` now sums every matching Inventory stack and filters to `location = inventory`; `removeItem()` is also explicitly inventory-only, preventing other inventory operations from consuming Warehouse stock. Auto Feed now treats `Insufficient item quantity` like `Food is still digesting` when eligibility changes during the attempt, skipping that candidate rather than aborting battle resolution. Added `apps/api/test/inventory-item-count.spec.ts` with four focused tests for multiple stacks, Warehouse-only stock, inventory-only removal and Auto Feed's insufficient-quantity skip. SPEC mirrors document the invariant. No database mutation, production repair, migration or deployment performed yet.

Validation: API/shared builds passed; the focused Jest regression suite passed (4 tests); `node apps/api/test/diet-autofeed-streak-fixes.spec.js` passed; SPEC mirror equality and `git diff --check` passed. `grind-food-expiry-exit-regression.test.js` reached an existing test-harness error (`this.dataService.getStatusEffects is not a function`) because its mock is missing a method; it is not a failed gameplay assertion. A combined Jest invocation also reports the standalone `diet-autofeed-streak-fixes.spec.js` script as having no Jest tests when incorrectly loaded as a Jest suite. No production repair, migration or deployment performed. The existing stuck production battle still needs safe recovery after deploying the fix and verifying its persisted state.


### Implementation — `monster-catalog-map-overhaul` (2026-10-16)

**Implementation in progress; no deploy and no database migration executed.** Canonical `maps.json` now contains Town plus six level-banded maps and weighted monster rosters; `monsters.json` contains species only. Root/frontend catalogues have 27 monsters and 54 monster-part items, retuned target levels, XP rewards at 75% of the level formula (Thornsprout at 30%), map-owned roster weights, and the new monster material drops. Item drop pools now reference level map IDs. LUK/luk replaced SOR/sor in app/shared/frontend attribute identifiers and catalogue keys; a migration was added to rename the character column, preserve numeric values, rewrite rolled attribute keys, and remap current character map IDs by level. In-flight queued battle snapshots retain their original map IDs; the equipment reward resolver maps only legacy drop-pool lookups to the monster's new level band. Fire/Light skill elements, JSON-driven category/element damage multipliers, generic Save Butt Luck, Poison periodic magic damage, Pickpocket whole-stack removal with permanent inventory consumption, player-triggered Prowess, conditional physical/magic reflection, Rage, opening spear, and disabled future FLEE metadata are wired into the shared simulator/catalogues. Ice Bolt retains its established zero-SP/no-cooldown behavior; Arcane Wisp owns the insufficient-SP magic-reflection reaction via Arcane Surge. The frontend map board now places tiles from map coordinates.

Validation: `pnpm --filter @nanommo/shared build`, `pnpm --filter @nanommo/api build`, `pnpm --filter @nanommo/frontend build --configuration production`, `node scripts/validate-monster-catalog.js`, `node apps/api/test/battle-distance-movement.test.js`, `pnpm exec openspec validate monster-catalog-map-overhaul --strict`, and `git diff --check` passed on the latest verification pass. Frontend reports existing CSS budget and CommonJS warnings only. A full `jest --runInBand` attempt is not a clean project test command here: Jest picks up direct-execution `.test.js` scripts as suites without Jest tests and an unrelated existing assertion in `map-presence-cleanup.test.js` fails because its mock omits a transaction manager. The focused battle-distance test originally asserted old monster stats and was updated for the new catalogue/free Ice Bolt contract; it now passes. A seeded simulator smoke test also confirmed Pickpocket emits a permanent `item_stolen` event and removes one full stack. The catalogue validator checks map coordinates/weights, unique IDs, exact roster bands, level <=30 single-map assignment, drop references, Thornsprout and elemental tags. The database migration has not been run. No deploy.

**Remaining before this change can be called complete:** add focused tests for the new reaction/action paths (especially Pickpocket idempotence and reflection/Rage edge cases), reconcile persisted map presence/queued encounters, add migration integration tests, add weapon/element matchup table tests, and verify the map board in-browser. Boot-time catalogue schema validation and coordinate-driven map-board rendering are implemented, but not browser-verified. Do not mark this change complete until these pass. A pre-existing local `items.json` change increasing Lucky Ring SOR values to 5/10/15 was preserved numerically and renamed to LUK; it was not reverted.

### Pre-apply proposal handoff — `monster-catalog-map-overhaul` (2026-10-16)

**Historical proposal checkpoint before implementation began.** The new change lives in `openspec/changes/monster-catalog-map-overhaul/` and contains `proposal.md`, `design.md`, `tasks.md`, and the capability delta at `specs/monster-catalog-map-overhaul/spec.md`.

Approved scope captured: canonical `maps.json` with Town plus six level-named maps and non-overlapping 1–30 rosters; monster-owned map references become map-owned weighted rosters; retune existing named monsters and add the four separately named creatures plus eight additional monsters; standard `xpReward` becomes 75% of `round(18 * level^1.15)` and Thornsprout becomes 30% of its standard level-5 reward; character XP curve and global `GRIND_XP_RATE` remain untouched. `SOR/sor` is renamed to `LUK/luk` with a data-preserving migration. The change also specifies data-driven weapon/element matchups, Fire and Light skill elements, Save Butt Luck, Pickpocket full-stack permanent theft, Poison Sting, player-triggered Prowess, conditional non-recursive damage reflection, Rage, Sacred Forest Guardian's opening spear, monster materials and disabled future FLEE metadata.

Verification performed for proposal only: `pnpm exec openspec validate monster-catalog-map-overhaul --strict` passed. No gameplay catalog, source code, database, migration, build or deployment was changed/run as part of this proposal. A pre-existing worktree modification to root `items.json` was observed and deliberately left untouched. During implementation, preserve unrelated user changes and active battle immutability.

### Handoff — `diet-unique-food-streak-rotation` OpenSpec proposal (2026-10-14)

**Implementation session — shared transition and legacy repair implemented; verification in progress.**

The Diet defect was structural, not merely visual. `buildDietStateAfterFoodConsumption()` previously appended repeats without deduplication. It now normalizes unique retained IDs, computes a retained food's next level before eviction, advances a full window by evicting its oldest entry, and preserves digestion lockouts separately from streak levels. Auto Feed re-normalizes each pass and checks `dietLevels.lastDigestUntil`; battle-resolution reconciliation uses the same transition helper. A one-time `1797000000000-DietUniqueFoodStreakRotation` migration repairs existing duplicate JSON without changing Inventory quantities. `BattleService.applyResolvedFoodState()` uses the same helper, while projected queue state and the frontend depend on the resulting Diet/dietLevels values.

The existing documentation also conflicts: the original `diet-auto-feed` design describes permanent per-food levels; `diet-autofeed-streak-fixes` defines retained-window streaks but still appends duplicates; the canonical food section described levels as permanent. Root `SPEC.md` and `openspec/specs/SPEC.md` now agree on the new target contract, and the older streak-fixes proposal is explicitly marked superseded for the repeat/slot semantics.

Approved target semantics: at most three unique food IDs, oldest left/newest right; consuming a retained food moves it to the right and increments its level up to 3; a full Diet drops its oldest entry on every successful meal, even if the selected food is the newest entry; a food that is absent when consumed starts at level 0. An evicted food loses its streak but must retain any still-future `lastDigestUntil`, so evicting it cannot bypass digestion. Legacy duplicates need deterministic normalization preserving the highest retained level and safe latest digestion boundary, without consuming Inventory.

OpenSpec artifacts: `openspec/changes/diet-unique-food-streak-rotation/`. API build and focused diet regression passed after the transition changes; expanded rotation/legacy normalization assertions are included in `apps/api/test/diet-autofeed-streak-fixes.spec.js`. Verification completed: `pnpm --filter @nanommo/api build`, `node apps/api/test/diet-autofeed-streak-fixes.spec.js`, `pnpm exec openspec validate diet-unique-food-streak-rotation --strict`, `git diff --check`, `pnpm --filter @nanommo/shared build`, and `pnpm --filter @nanommo/frontend build --configuration production` all passed. Frontend emitted existing CSS-budget/CommonJS warnings only. Migration has been added but not executed against any database. No production deployment.


### Handoff — `refining-hand-equipment-mastery-skills` discovery (2026-10-13)

### Finalized user decisions — proposal must use these (2026-10-13)

These decisions supersede any older open questions or inferred expected behavior in this handoff. They are design requirements, not claims that application code has been implemented:

- **Light Wisp:** sample `current SP / 5` before paying Light Wisp's own SP cost and before any Arcane Dynamo refund from that action.
- **Global Mastery reset:** a one-time transactional data reset clears every existing character's allocated skill ranks in every category, setting `skillRanks = {}` and `spentSkillPoints = 0`, but preserves each category's `level`, `xp`, character ID and category ID. All points earned at the preserved levels are available to redistribute. Do not migrate Stored Essence ranks; those ranks are cleared along with all other allocations. Do not execute this reset automatically on every app start.
- **Targeted cheat:** add `POST /reset-skilltree/:characterName` for the same reset on one exact, unambiguous character name. It is a development/administrative route protected from unauthorized/production use, transactional and idempotent; missing, ambiguous or unauthorized requests must leave all data unchanged.
- **Ice Bolt cooldown:** cooldown begins when an action resolves and blocks the next `cooldownTicks` ticks; no next-cast progress during those blocked ticks. Ice Bolt resolves at T2; T3 is blocked; next cast starts at T4, continues at T5, and resolves T6; then T7 is blocked and the next cast resolves T10. Resolved events follow T2/T6/T10/T14..., not a two-tick cadence.
- **Movement:** movement gauge starts at zero at battle start/T0 and accrues effective Move Speed on every tick, even without `movementIntent`. Actual movement still requires a legal selected out-of-range action that needs approach; move at most one space per tick when gauge >=100, keep overflow banked, and do not clear the gauge just because intent is absent. Move Speed 98 means 98 gauge at T1 and a first eligible move at T2; 100+ permits movement at T1 when legal approach intent is active.
- **Wailing Wraith Gambit:** preserve canonical semantics/order `silence → attack` first and Ice Bolt as the default cast-gauge line. Sync the frontend row/order to root without overwriting unrelated catalogue differences; validator still checks cooldown, SP and range. Disarm's no-approach behavior changes the player character only; retain current monster-specific Disarm behavior.

This session changed documentation and OpenSpec artifacts only; it did not intentionally change application implementation for this refinement. At final inspection, additional worktree modifications were present in `apps/api/src/modules/battle/battle.service.ts`, `apps/api/src/modules/character/character.service.ts`, `apps/api/src/modules/equipment/equipment.service.ts`, `monsters.json`, `packages/shared/src/index.ts`, and new `packages/shared/src/attributes.ts`, in addition to the pre-existing Character UI CSS/HTML edits. These code/catalogue changes are outside the refinement-documentation edits and were left untouched; confirm their ownership/context before editing them next session. One focused test command was attempted (`node apps/api/test/battle-distance-movement.test.js`) before the latest timing decisions were supplied. Its then-current assertions for first Ice Bolt at T2, a two-tick repeat cadence and high-speed movement at T2 passed under the old contract, but its cadence/movement expectations must be replaced: the approved cooldown cadence is now T2/T6/T10/... and the movement gauge must charge from T0 (Move Speed 98: 98 at T1, first eligible move T2; Move Speed >=100 can move T1 with valid approach intent). The run also exited non-zero at line 285 because the canonical root Wailing Wraith Gambit lists `silence → attack` first while the test/frontend mirror expected Ice Bolt first. No build, browser session, migration, database write or deployment was performed.

**Confirmed implementation defects/gaps for the next session:**

- **Bleed target in logs (game state itself targets the foe):** `packages/shared/src/battle-engine/index.ts` calls `applyStatus(foe, 'bleed', ...)` after a successful character hit, so the monster is the actual target. But the live Grind formatter in `apps/frontend/src/app/features/play/components.ts` and Battle History formatter in `battle-logs.component.ts` name the `actor` as the status recipient and ignore `target`. DOT events intentionally retain `sourceActor` as the actor, so a source-oriented formatter is especially misleading. Fix the target/source presentation in both screens and assert that the foe, not the character, gains Bleed/takes DOT damage.
- **Bleed status payload/log defect:** `applyStatus(foe, "bleed", ...)` correctly targets the monster, but both UI event formatters name the source actor as the affected unit. The currently implemented `damagePerTick: 5 * Swordsmanship rank` matches the user-approved formula; the refinement must make this catalogue-driven and explicit: 5 × rank pure damage per stack every five ticks, up to five stacks, bypassing DEF/MDEF. Fix target-aware lifecycle events/logs and ensure DoT never grants Mastery action XP.
- **Status icons and live status state:** the Character summary currently handles only `freeze`, and the Grind monster STATUS list only reads initial `monsterSnapshot.statusEffects`. Reconstruct both targets from each opening snapshot and status events up to `elapsedTicks`; cover all eight IDs: freeze, bleed, slow, burn, stun, disarm, war-cry (`war_cry_def`), and magic barrier. Preserve the Freeze badge frame/blue palette/size/position and replace only its “Fre” lettering with a centered snowflake. Provided references are in `project/status_icons.png` (14×10, user coordinates are 1-based `[row,column]`), `project/skill_icons.png`, and `project/skill_tree_example.png`.
- **Mastery XP/points aren't live in the open screen:** `CharacterPageComponent.loadWeaponLevels()` only runs during component initialization. `BattleStore` consumes `battle:resolved` for Character/Inventory snapshots, but Mastery rows are not part of that state; refresh `GET /characters/weapon-proficiency` after each battle resolution and update XP, XP-to-next, level, available points, and rank state.
- **Mastery allocation UI must move from immediate-post to staging:** current `allocate()` posts each click immediately. Server-side allocation already uses `BattleService.runFutureCombatMutation()`; preserve that queue boundary when Apply submits an atomic pending batch. Reset may clear only pending changes and cannot refund already persisted ranks. The user confirmed separate pending drafts per category; Apply and Reset affect only the currently selected category.
- **Mastery visual structure:** the current nodes are text cards in a two-column grid; redesign as 64×64 icon-only skills connected top-to-bottom (node 1 → node 2), hover/focus full detail tooltip with all numeric values bold. Ensure the right-side selector includes all eight categories, including Rune. User decision: crop status sprites from the supplied atlas only when background removal looks clean; otherwise create matching SVGs. Update Freeze by replacing “Fre” with a snowflake while preserving the existing badge visual. Create original high-quality PNG skill icons in the supplied skill-art style, matched to each skill effect. Rod node 1 is renamed Light Wisp (MATK + 25 × rank + current SP / 5); War Cry becomes +10 DEF × rank for 15 seconds; Rune node 1 becomes Arcane Dynamo, which refunds 2 × passive rank SP per successful basic attack/active skill. Stored Essence remains hidden legacy data.
- **Monster skills UI:** the canonical monster skill catalog currently has four special skills (Enraged Strike, Regenerate, Ground Slam, Ice Bolt). Discoverable skills per monster are those referenced by `use_skill` in its `monsters.json` Gambit. The planned row belongs below combat logs and above `DROPS THIS SESSION`, with icons and hover details.
- **Monster mana implementation is pending, design values are confirmed:** current code still uses `sp: 0` / `maxSp: 0`; the target design is max SP 60 for all monsters except Venom Viper/Wailing Wraith at 80, plus 2 SP regen per 10 ticks. Costs: Enraged Strike 30, Regenerate 15, Ice Bolt 10, Ground Slam 30. The refinement must implement the values as authoritative simulator state.

- **Cooldown and duplicate-tick investigation:** the observed implementation decrements monster cooldowns while the cast gauge keeps accumulating, causing Ice Bolt cast 2/cooldown 1 to repeat every two ticks; this behavior is superseded by the now-approved sequential contract. Ice Bolt resolves at T2, T3 is blocked, the next cast starts T4, advances at T5 and resolves at T6; later resolutions are T10, T14, etc. The supplied log has one Ice Bolt damage event and a Freeze application both marked T4; that is expected when Ice Bolt procs Freeze, not duplicate damage. Compare newly generated vs older immutable precomputed queue entries and the running backend build. The prior focused test also failed later at line 285 because root/public Wailing Wraith Gambit order differed. This is not implemented/tested yet and remains a required regression.
- **Movement gauge / no legal action:** the current implementation only increments the gauge while `movementIntent` is true; that is a confirmed defect against the latest rule, not the desired behavior. Initialize gauge 0 at T0 and accrue effective Move Speed every tick even without intent. At Move Speed 98, the gauge is 98 at T1 and crosses 100 at T2; move then only if a legal selected out-of-range action requires approach. At Move Speed >=100, movement can occur T1 when valid approach intent is active. If no legal line remains, do not synthesize an action or movement and clear/prevent stale approach intent; bank gauge progress without moving until a legal intent exists. Freeze/status penalties are applied according to the action-before-movement phase order.
- **Disarm behavior to implement:** the character `attack` Gambit line must be illegal while the player is disarmed. If that is the only eligible action, it does not attack or approach even while distant; legal skill/item lines still follow normal Gambit order. The Disarm rule for this refinement explicitly covers the player-controlled character; the current monster-specific disarmed movement behavior is left unchanged unless the user approves widening the rule.
- **Previously open skill decisions — resolved:** Light Wisp samples SP before paying its own cost; all existing Mastery allocations are reset once while preserving XP/levels and returning spent points; Stored Essence ranks are cleared rather than migrated; Ice Bolt uses sequential cooldown with resolutions T2/T6/T10/...; player-only Disarm/no-approach changes preserve existing monster behavior. No additional requirement was attached to the earlier standalone “4.”

**Confirmed design decisions received (2026-10-13):** current monsters start each battle at full mana, with max SP 60 except Venom Viper/Wailing Wraith at 80; mana regenerates by 2 SP per 10 ticks. Skill costs: Enraged Strike 30, Regenerate 15, Ice Bolt 10, Ground Slam 30. These values must be catalogued and used by the real simulator resource, not displayed as placeholders. Mastery XP, derived level, points and ranks are category-specific; using a Bow does not grant Rod Mastery. Status sprites may be cleanly cropped/background-removed from the supplied sheet when viable, otherwise matching SVGs can be drawn; skill icons should be original high-quality PNGs in the reference style, matched to each effect.

**Queue boundary already in place:** `POST /characters/mastery/allocate` persists learned ranks through `BattleService.runFutureCombatMutation()`. With staging, no request happens until Apply; the pending allocation must be validated/persisted atomically, preserve the current active battle/job, and invalidate/rebuild future battle entries only through this existing BattleService-owned path. Do not add a second invalidation mechanism. Apply/Reset scope is resolved: each category retains an independent draft and only the selected category is applied/reset.

**Required follow-up verification (not run in this checkpoint):** shared/API/frontend builds; focused simulator regressions for Bleed target/damage/cadence/stack cap and status event payloads; frontend reducer tests for icon appearance/stack/refresh/expiry; tooltip/rank and pending Apply/Reset tests; battle:resolved refresh test for Mastery rows; queue boundary test proving active entry untouched and future entries rebuilt after Apply; monster mana/skill catalog tests for the confirmed values; strict OpenSpec validation; `git diff --check`; and browser-level desktop/mobile visual review.

### Hand Equipment / Mastery follow-up (2026-10-13)

Implemented the catalogue-driven hand compatibility matrix and two skills per category; added Mastery allocation, rank resolution, transactional XP/level advancement, and deterministic simulator coverage for the named positional skills. Gambit choices are filtered to known items and learned active skills. The shared XP thresholds currently satisfy the four requested anchors under a documented action-count proxy using the production per-kill `floor(xpReward × 0.25)` Grind payout; the late threshold gap is steep and remains provisional until combat simulation/live telemetry validates pacing. The root SPEC and its OpenSpec mirror match.

Verification for this follow-up: shared, API and production frontend builds passed; `mastery-progression-ranks.test.js` passed with L23 two-handed M5, L28 one-handed M5/M5, and L50 two-handed M10 / one-handed M7/M7; `mastery-skill-simulator.test.js` passed; strict OpenSpec validation, `git diff --check`, and SPEC mirror comparison passed. Frontend emitted the existing CSS-budget and CommonJS warnings. No migration or deployment was performed. Still open: task 1.2's DEX decision, Mastery reward retry/idempotency integration and broader skill gates, migration preservation integration, visual/browser verification of the Gambit warnings/handedness, and live-combat pacing review. The prior summary's claims that thresholds/level advancement and positional effects were unimplemented are superseded by the latest follow-up below; unrelated historical status entries remain historical.

### Latest follow-up — CDK placeholder activation and drag tooltip lifecycle (2026-10-13)

Corrected the remaining inventory/vendor slot expansion: `InventoryGrid` had written `cdkDragPreview` and `cdkDragPlaceholder` templates but had not imported the corresponding standalone CDK directives. Angular therefore did not activate those custom templates, and CDK could fall back to cloning the full draggable item (with its intrinsic dimensions). The component now imports both directives, so inventory drags use the icon-only preview and the intentionally hidden `item-drag-placeholder`; the existing VendorPanel imports its preview/placeholder directives and uses its hidden fixed-slot placeholder. This applies when dragging over the vendor and when returning to inventory.

Added a shared document drag lifecycle event for Inventory, equipment, and Vendor drags. Every floating item tooltip now hides immediately and stops its live-content timer at drag start, refuses to reopen while dragging, and is only eligible to appear on a subsequent pointer-enter after drag end. No MutationObserver or continuous tooltip-positioning observer was introduced.

Verification: API build passed; inventory-layout Jest regression passed (4/4); production frontend build passed with existing CSS-budget/CommonJS warnings; `git diff --check` passed. Real-browser visual verification remains outstanding; no production deployment.


### Inventory sorting and drag/drop stabilization (2026-10-13)

Added persistent inventory-slot moves and sorting to the authenticated API. Dragging an inventory row onto an occupied slot swaps positions; dropping on an empty slot moves it there without compacting the rest of the inventory. The Sort button orders rows by catalog item type, then localized display name with deterministic tie-breakers; the server stores the supplied order compactly from slot 0 without merging/splitting stacks.

The shared `InventoryGrid` used by Grind and Character now exposes the Sort control, tracks the slot under the pointer during a drag, and applies complete server-returned Inventory + Character snapshots with revision checks. CDK source placeholders for inventory and vendor stock are hidden so they cannot contribute their 72px preview dimensions to slot tracks. The selected vendor drop-list receives a dashed outline during an item drag; the outline does not affect layout, and existing sell/buy confirmation flows remain intact.

Verification: API build passed; focused Jest regression `test/inventory-layout.spec.js` passed (4 tests for occupied-slot swaps, moves to empty slots, compact order persistence, and invalid requests); production frontend build passed with existing CSS-budget/CommonJS warnings; `git diff --check` passed. Browser-level drag/drop visual verification was not performed. No production deployment.


### Latest correction — Battle food regeneration double-count (2026-10-13)

Fixed the battle snapshot so `hpRegenPerTenTicks` and `spRegenPerTenTicks` contain only the character's derived base regeneration. Active-food HP/SP bonuses remain in their dedicated `foodBuff*RegenPerTenTicks` fields; `BattleEngine` adds those bonuses once while the buff is active and stops adding them after expiry. This matches the SPEC rule that food regen is added on top of normal regeneration. It fixes the reported case from 22 HP per 10 ticks to 15 (8 base + 7 three-star bread) and prevents the corresponding SP bonus from being doubled as well.

Added `apps/api/test/battle-food-regen.spec.js` for snapshot separation and expired-food behavior, and extended `apps/api/test/battle-distance-movement.test.js` to assert battle simulation regenerates exactly 15 HP and adds SP food regen only once. Verification: shared and API builds passed; focused Jest tests passed (3 suites, 9 tests, including the new regression); battle-distance-movement assertions passed; `git diff --check` passed. Existing precomputed `BattleQueueEntry` simulations are immutable and are not retroactively changed by this code fix. No production deployment or active-battle mutation was performed. Follow-up documentation in both `SPEC.md` and `openspec/specs/SPEC.md` now codifies the status-effect application lifecycle, including the current limitation that character-originated skills do not yet apply catalog statuses, and explicitly protects the separate base-regen/food-bonus snapshot fields.

### Latest implementation session — Status Attack Speed penalties (2026-10-13)

Implemented catalog-driven Attack Speed penalties in the shared battle engine and added the typed `StatusEffectDefinition` catalog contract in `packages/shared/src/types/index.ts` (exposed by the API's `DataService`). Character basic-Attack gauge refill now uses a universal 0–800 rating scale: effective Attack Speed 0 fills in 10 ticks, 800 or above fills in 1 tick. `attackSpeedPenaltyPerStack` and `attackSpeedPenalty` are fixed rating-point subtractions; the effective rating cannot go below 0. The gauge retains fractional progress while the refill rate is recalculated each eligible tick, so applying, stacking, or expiring a status affects future progress without clearing progress already earned. Skill/cast timing remains on the independent DEX-based gauge. Monster basic attacks keep their catalogued `atkSpeedTicks` baseline; an attack-speed penalty adds fractional delay without imposing the character's 10-tick cap.

Freeze's canonical catalog currently defines a five-second duration, -25 Move Speed and -25 Attack Speed per stack, and a maximum of three active stacks. Both root and frontend status-effect JSON copies match. The character summary tooltip now explains both penalties and shows their totals. The old `weaponBaseAttackTicks` catalog values are retained for compatibility/metadata but no longer control the character basic-Attack interval; this is an explicit consequence of the universal Attack Speed scale.

Verification: shared, API and production frontend builds passed (frontend emitted existing CSS-budget and CommonJS warnings); `node apps/api/test/battle-distance-movement.test.js` passed, including 0/800 bounds, Freeze delaying a basic attack, and skill cast timing remaining independent of Attack Speed; `node apps/api/test-phase3-determinism.js` passed all four available determinism assertions (stored-battle replay skipped because the local API was unavailable); focused Jest tests passed (2 suites, 7 tests: direct damage variance and Diet/Auto Feed); `git diff --check` passed. `node apps/api/test-phase3-gambits.js` could not run because its required `http://localhost:3010` backend was not running; the app stack was not started for this task. No production deployment.

### Latest implementation session — Ice Bolt initial cast timing and Character Move Speed (2026-10-12)

Corrected the monster ranged-skill cast counter so tick 0 is treated as the initial instant rather than a full elapsed second. Wailing Wraith's two-tick Ice Bolt now first resolves at T2 and repeats every two ticks with zero cooldown; added regression assertions for the initial tick and repeat cadence. Added Move Speed to the Character page's derived Stats grid, calculated as 50 + character level (level 48 = 98), and simulator assertions for that base value and movement timing at T2. Preserved the user's Wailing Wraith Evasion rebalance at 101 and synchronized that field to the frontend monster catalog; the focused catalog test treats it as an explicit Wraith-specific override while retaining the general -10% checks for other monsters. The full root/frontend monster JSON files still differ in existing drop-chance tuning for other monsters, which was intentionally left untouched rather than overwritten during this targeted fix. No deployment.

### Latest implementation session — battle-distance-movement (2026-10-11)

Applied further `battle-distance-movement` adjustments requested on 2026-10-11. Monster Evasion values are reduced by 10% from the prior calibrated values and mirrored in `apps/frontend/public/data/monsters.json`. Root Ice Bolt timing/range edits were preserved and synchronized to the frontend catalog: zero SP cost, two-tick cast, zero cooldown, `maxRange: 7` inclusive of the target space. Wailing Wraith's current root-catalog MATK 39 was preserved and mirrored to the frontend catalog; its basic attack is melee with range 0; while Ice Bolt is legal and in range the Wraith remains stationary. The fallback Gambit line now explicitly requires the `silence` status; Wraith cannot basic-attack while Ice Bolt is usable, and approaches/attacks only while silenced.

Ice Bolt now has a seeded 25% chance per successful cast to apply the player-side Freeze status. Canonical duration, stackability, max stacks and Move Speed penalty are in root `status_effects.json`, mirrored under frontend public data; Ice Bolt retains only `applyStatus: "freeze"` and `statusChance: 0.25`. Slow is also catalogued as non-stackable, refreshable -50 Move Speed for 20 seconds. Status expiration now emits `status_stack_lessened` with the remaining count when a stackable effect is still active and `status_ended` when its final stack or any non-stackable effect expires. Both Grind and Battle History format these events as named status messages instead of generic "status expired"; the Grind feed now also includes resolved skill damage (for example, `Wailing Wraith casts Ice Bolt for 39 damage`). The two screens retain the actual-position arrow behavior for movement. The character summary's Freeze tooltip reads duration, per-stack penalty and stack cap from the status catalog. A custom SVG ice icon was added; no attachment image was present in the conversation to match exactly.

Verification after these adjustments: shared and API builds passed; frontend production build passed with existing CSS-budget and CommonJS warnings; `node apps/api/test/battle-distance-movement.test.js` passed, including Ice Bolt damage fields, status-catalog ownership, Freeze stack loss/final expiry, Slow ending, deterministic movement and Wraith's Silence fallback. Focused API Jest tests passed (2 suites, 7 tests: direct damage variance and Diet/Auto Feed); monster, skill-tree and status-effect catalog mirrors match; Ice Bolt retains castTicks=2 and statusChance=0.25; strict OpenSpec validation and `git diff --check` passed. Browser visual verification was not performed. No production deployment.


### Latest planning and combat-catalog update — 2026-10-11

Prepared two complete OpenSpec changes using the spec-driven schema:
- `battle-distance-movement` defines the eight-space lane, empty-space distance, RANGED classification, deterministic movement gauge, range-blocked Gambit behavior, Slow/Ice Bolt and movement logs.
- `hand-equipment-mastery-skills` now consumes that contract, renames Backstab to Blinkstrike, sets Violent Shot to push to distance 6, records Bow precision modifiers (-75/-74/-73), and keeps AoE/group battles out of the current single-target scope. The Mastery change remains dependent on applying battle-distance-movement first.

Catalog-only groundwork explicitly requested during planning was added:
- Added `equip_rune_t1/t2/t3` to root `items.json` and frontend `public/data/items.json`, with provisional DEF/MDEF values T1 2/10%, T2 5/20%, T3 10/35%. Values are intentionally easy to edit in JSON.
- Added Rune SVGs to both frontend equipment icon paths (framed and unframed).
- Added `combatStyle`, `basicAttackDamageType`, `basicAttackRange` and `moveSpeedBase` metadata to all 15 monster rows in `monsters.json` and its frontend data mirror. Field Bat and Dune Raider are RANGED with ranged-physical basic attacks; Wailing Wraith is classified RANGED because of the planned magic Ice Bolt Foe action, but its basic attack is ranged magic and adjacent-only; the other 12 monsters are MELEE with physical basic attacks. Move speeds are provisional JSON defaults.
- Appended the future PvE/PvP up-to-5x5 roadmap to root `SPEC.md`, its `openspec/specs/SPEC.md` mirror, and `ARCHITECTURE.md`.

Important runtime boundary: the new monster metadata is not yet consumed by BattleEngine. Ice Bolt has not been wired into the executable monster Gambit/data because the current engine does not yet implement the intended Slow effect/range behavior. Rune entries and icons exist, but Rune equip validation, Mastery XP/passives and active skill mechanics remain unimplemented until the OpenSpec changes are applied.

Verification: both OpenSpec changes pass strict validation; both item JSON mirrors parse and contain all three Rune tiers; all proposal/runtime Rune SVGs parse as valid XML; shared, API and frontend production builds passed; `git diff --check` passed. Frontend build emits the existing CSS-budget and CommonJS warnings. No production deployment was performed.

Review item still open before implementation: the approved hit formula is `clamp(100 + Precision - Evasion, 5, 95)`; the shared BattleEngine still runs the old formula until the distance/movement change is implemented. The total-DEX rule `Precision = 79 + floor(total DEX / 3)` preserves initial Precision 80 with DEX 5, but with a -75 T1 Bow DEX total 225 yields Precision 79 and DEX total 228 yields 80. This one-point checkpoint conflict is documented in the Mastery change and must be resolved rather than hidden by a special case.

---


### Latest correction — atomic battle resolution + Auto Feed duplicate-food eligibility (2026-10-09)

Fixed the Diet duplicate-entry eligibility mismatch: Auto Feed now evaluates only the newest retained occurrence for each `itemId`, skips the food if that occurrence is still digesting, and can continue to a different eligible food. The expected `Food is still digesting` guard is treated as a skipped candidate; unrelated exceptions still propagate.

Reworked `BattleService.resolveBattle()` so authoritative PostgreSQL effects and the final `BattleQueueEntry.resolved = true` commit in one transaction. Lock order is Character then BattleQueueEntry. Simulated inventory consumption, XP/HP/SP and level-up changes, Diet/Auto Feed, pending equipment substitutions, drops, kill counter, death/Town routing, and invalidated future queue rows all use the same transaction manager. A DB failure rolls them all back so BullMQ retry/boot recovery can apply the battle completely. BullMQ job cleanup, map-presence synchronization, queue rebuilding, and Socket.IO publication remain post-commit. Post-commit queue/event snapshot failures are logged without turning a committed payout into a failed/retried battle. Duplicate deliveries now return an explicit skipped result so `BattleQueueProcessor` does not race the winning caller's queue maintenance with a redundant top-up; recovery counts only battles actually resolved by its call.

Verification in this session: API build passed; targeted standalone Diet/Auto Feed regression passed including an older expired bread occurrence plus a newer still-digesting bread occurrence while meat remains eligible; existing `diet-auto-feed.spec.js` passed 3/3; idempotency integration script syntax passed after updating it to the transaction/row-lock contract; strict OpenSpec validation and `git diff --check` passed. The full concurrent BullMQ/recovery integration could not run because Docker Desktop is unavailable, API on `localhost:3010` is not running, and local Redis is unavailable. No production deploy was performed.

Historical caution: this code change does not retroactively repair battles already marked `resolved = true` by the previous implementation after a partial failure. Those rows require inspection against their Character state, inventory, kill counter and event history before any manual reconciliation; automatic replay would risk duplicate rewards.


### Latest correction — Nest module import cycle (2026-10-09)

The new CharacterService → BattleService mutation boundary exposed a pre-existing module graph that was not fully covered by `forwardRef`: `CharacterModule → BattleModule → InventoryModule → CharacterModule`, plus the equivalent `CharacterModule → BattleModule → EquipmentModule → CharacterModule` cycle. Nest could therefore evaluate `CharacterModule` as `undefined` while scanning `InventoryModule` (and then `EquipmentModule`). Added deferred module references on the Inventory/Character, Equipment/Character, Equipment/Inventory, and Battle/Inventory/Equipment edges. The API build passes, and runtime startup now gets past Nest module scanning/InstanceLoader initialization; the local smoke run then stops retrying PostgreSQL/Redis because local services are not running (`127.0.0.1:5432` / `6379`). No production deployment.

### Latest follow-up — `character-mutation-queue-invalidation` correction (2026-10-08)

Corrected the character-mutation queue boundary so active combat-state mutations are accepted without ever modifying the battle already in progress. Attribute-point spending, activation of a different Gambit page, and edits to the currently active Gambit page now persist during an active battle; the active `BattleQueueEntry` and its BullMQ resolution job are preserved, while stale future entries after it are discarded. No replacement future battle is scheduled during the active battle. After that battle resolves, the normal queue-advance boundary rebuilds the future chain from the updated Character + Equipment + Inventory + active Gambit state.

When no battle is active, the same BattleService-owned boundary still discards the unresolved stale chain and immediately rebuilds the canonical five-entry queue when the character remains eligible to grind. Inactive Gambit edits remain queue-neutral, and activation of the already-active page is a no-op. Nest circular dependency between CharacterModule/BattleModule remains handled with `forwardRef`; queue ownership stays in BattleService. No schema migration or new socket event was introduced.

The previous implementation incorrectly introduced an HTTP 409 rejection for active-battle mutations; that behavior was not authorized by the OpenSpec and has been removed. The committed regression script was updated to verify active-battle preservation and post-resolution rebuilding instead of rejection.

Verification after the correction: API build passed; shared build passed; frontend production build passed; strict OpenSpec validation passed; the mutation regression script passes Node syntax checking but its live run cannot execute because the local backend at `http://localhost:3010` is not running. `git diff --check` passed. No production deployment.

---

### Latest follow-up — realtime map presence Socket.IO transport (2026-10-08)

Investigated the complete `playersOnMap` realtime chain. The frontend already creates a Socket.IO client for the `/game` namespace from `PlayComponent.ngOnInit()`, uses the production API origin, forces WebSocket transport, authenticates with the JWT, and `BattleStore.bindEvents()` already consumes `map:presence`. `MapBoard.playersInMap()` already derives the displayed value from the current map and the latest absolute presence snapshot.

The concrete gateway defect was that `NanommoGateway.server` had `@WebSocketServer()` commented out. Redis presence/transition subscribers therefore attempted to use an uninitialized Socket.IO server when forwarding `map:presence` and joining/leaving map rooms. The decorator was restored; no new namespace or alternate transport was introduced.

Caddy does not require a separate WebSocket proxy route for this architecture. The intended deployment is one `reverse_proxy` for the complete NestJS backend host; Caddy's `reverse_proxy` supports WebSocket HTTP upgrade/tunneling automatically. The known local Caddyfile pattern (`api.idlelords.com { reverse_proxy nanommo-backend:3000 }`) is therefore compatible with Socket.IO `/game`. If the production Caddy differs from this pattern, inspect that external Caddyfile before changing application routing.

Verification after the fix: API build passed; frontend production build passed (existing CSS-budget/CommonJS warnings only); strict OpenSpec validation passed; `git diff --check` passed. No production deployment was performed. Browser-level production WebSocket connectivity was not claimed because the production Caddy host/container is not available from the development workstation.

---

### Latest follow-up — existing production database migration adoption (2026-10-08)

The remote database had a valid existing schema but an empty TypeORM `migrations` table. Because `migrationsRun=true` now correctly runs migrations while `synchronize=false` protects the schema from pre-migration synchronization, the first startup exposed historical migrations trying to recreate columns already present (initially `characters.stateVersion`).

Historical migrations that only add schema elements already present in the deployed schema were made idempotent where necessary: CharacterStateVersion, DietAutoFeed, SplitRegistrationCharacterCreation, and GoogleOAuth now inspect/guard existing schema state before applying their changes. This preserves existing character/account data and allows an adopted database with empty migration history to traverse the migration chain safely. The TownAsMapAndGenericTransition migration remains responsible for the actual data transition from legacy `currentMapId IS NULL` to canonical `map_town`, adding `pendingMapTransition`, and removing `returnToTownAfterBattle`.

The database itself was not reachable from the development workstation, so no claim is made that the remote migration run has completed. API build, strict OpenSpec validation, and `git diff --check` passed. The next deployment/startup should run the migrations against the real database; if the database matches the inspected schema, the historical guards will advance to the Town migration instead of failing on existing columns.

---

### Latest follow-up — `map-presence-event-driven-membership` (2026-10-08)

Refactored map presence around the actual gameplay state transition instead of the battle lifecycle. A dedicated `MapPresenceService` now owns the authoritative predicate and the reusable `syncCharacter(characterId, previousMapId)` hook. Map entry, map-to-map movement, immediate Town return, deferred Town return, death, and food-exhaustion routing all converge on this same presence boundary.

The existing `map:presence` Socket.IO event remains the transport to the frontend, but the event is now emitted from actual map-membership/count changes and carries the absolute `{ mapId, playersOnMap }` snapshot. Battle start is no longer a presence trigger, and the previous delayed BullMQ `refresh-map-presence` job was removed.

Redis remains a lightweight self-healing runtime cache: timestamped per-map hashes are still pruned before counting, while a 10s reconciliation repairs missed writes/process crashes and disconnected grinders. PostgreSQL remains the gameplay authority. Encounter-search timing now uses the same centralized active-grinder definition, eliminating another independent presence predicate.

Online/socket presence was separated into reusable `OnlinePresenceService`; its `touch()` hook is intentionally reserved for the future heartbeat/friends online-list work and is not used for gameplay map presence.

OpenSpec `map-presence-authoritative-reconciliation` was updated to this ownership model. Regression coverage: map presence 12/12; map cleanup immediate/deferred/death/resolve/queue-generation all use the centralized sync hook; encounter search 5/5. API build passed. No production deployment.

---

### Previous follow-up — `map-presence-authoritative-reconciliation` (2026-10-08)

The previous revision established authoritative Redis-backed reconciliation and disconnect semantics. Its battle-start refresh mechanism was subsequently removed in favor of the event-driven membership architecture documented above.

---


**Last Updated:** 2026-10-08 (event-driven authoritative map presence)
**Session Focus:** Centralized gameplay map membership, realtime map population snapshots, and separation of online presence from future heartbeat.

### Latest follow-up — diet-food-type-autofeed-correction (2026-10-06)

Corrected the Auto Feed eligibility boundary discovered during manual testing: `tryAutoFeed()` is called during authoritative battle resolution, but an existing guard previously returned early whenever `activeFoodBuff.expiresAt` was later than the calculated next battle boundary. That made a state such as `[blueberry 0m] [hunter's stew 0m] [bread 46m]` fail to consume the two ready Diet foods even though they were available in Inventory.

Auto Feed now evaluates the Diet on every battle-resolution boundary. Any configured `food` whose Diet entry has digestion at 0 and whose Inventory count is positive is eligible, even when another food buff is still active. It consumes all currently eligible Diet foods (up to the three slots) through authoritative `consumeFood()`, re-reading Diet after each consumption. The Grind-entry trigger remains absent.

The regression suite explicitly covers this case by giving the character an active food buff that expires after the supplied boundary while all three Diet foods are ready; the expected result is still consumption of all three. OpenSpec/root SPEC now describe this as the authoritative behavior. No production deployment was performed.

### Latest follow-up — direct-damage-variance (2026-10-06)

Implemented a server/shared BattleEngine rule for direct damage: every successful basic Attack or damaging Skill from either character or monster now rolls one uniform seeded multiplier in the 0.99–1.01 range. The roll is applied after hit/crit, mitigation and existing direct-damage modifiers, immediately before the existing integer rounding/minimum-damage handling. Misses stay at 0 and do not consume a variance roll.

The variance is centralized in `BattleEngine.applyDirectDamageVariance()` and uses the existing Mulberry32 battle RNG, so the battle remains deterministic/replayable for the same seed while different seeds can produce small damage differences.

The current engine has no active damage-over-time tick implementation. The OpenSpec/root SPEC contract therefore explicitly excludes DOT ticks from direct variance and establishes the future invariant: when a DOT is implemented, its per-tick damage N and tick interval M are fixed at application time and reused without rerolling/recalculation on later ticks.

Regression coverage: 4/4 focused direct-damage tests passed (±1% range, same-seed determinism, different-seed variation, and misses remaining zero). Shared build, API build, frontend build, strict OpenSpec validation, and git diff --check passed. Frontend still reports the repository's existing non-fatal component CSS-budget/CommonJS warnings. No production deployment was performed.

### Latest follow-up — diet-autofeed-boundary-reliability (2026-10-06)

Fixed a server-side Auto Feed race at the boundary between a resolved battle and the next Grind encounter. Previously, when queue generation stopped because the active food could not safely cover another encounter, the resolver had no future queue row and passed Date.now() to Auto Feed. Food that expired shortly after the current battle could therefore be treated as still valid, leaving the future queue empty and eventually routing the character to Hungry/Town.

Auto Feed now prefers the existing first unresolved battle startAt; when no future battle exists, it uses the authoritative resolved battle endAt plus the same encounter-search delay used by queue generation (2s + 0.1s per other grinder on the map). A successful automatic consumption still uses the existing transactional consumeFood() path, discards unresolved precomputed battles, and rebuilds the Grind queue from the resulting authoritative Character + Inventory state. No frontend timer/polling workaround was introduced.

Regression coverage now includes the empty-queue boundary and the search-delay calculation. Verification passed: API build, shared build, frontend build, 9 focused Auto Feed boundary assertions, strict OpenSpec validation, and git diff --check. Existing frontend CSS budget/CommonJS warnings remain non-blocking. No production deployment was performed.

### Latest follow-up — Login/Auth visual shell + persistent login music (2026-09-29)

Implemented the shared login/auth presentation on `/login`, `/forgot-password`, `/verify-email`, `/verify-email-pending`, `/reset-password`, and `/register`: `login-background.png` is now the full-screen artwork, with the main content panel transparent and borderless and positioned in the open area below the Idle Lords artwork. Inputs, buttons, focus/hover/disabled states, and links use the existing dark-fantasy/gold visual language instead of browser/default blue UI.

Implemented a singleton `LoginMusicService` using `ragnarok-login.mp3`. The track loops continuously through SPA navigation across the auth flow without restarting when moving to Forgot Password. Volume is persisted locally and exposed through a compact music icon + draggable range control on auth screens and in the logged-in shell header. Successful login fades the track out over 2 seconds, stops it, resets playback, then navigates into `/play`. The header control does not auto-start the login track after authentication.

Verification: frontend production build passed; `git diff --check` passed. Browser smoke on the development server verified the wallpaper shell, transparent panel, controls across all auth routes, audio source/playback, persistence across Forgot Password, login transition fade/stop, and logged-in header volume control: **17/17 assertions passed across the shell/audio checks** (12 shell assertions plus 5 audio assertions).

The browser audio smoke used Chromium autoplay permission and a captured native Audio instance so playback continuity/fade could be verified deterministically. No backend contract or server-authoritative game logic was changed.

---

### Latest follow-up — `play-shell-mastery-gambit-polish`

Implemented: Grind now has only the central map selector; the main Inventory remains exactly 50 slots and is compact enough for the intended desktop layout; stack counts remain visible; Character equipment icons are rendered light with the existing icon pack; the right shell is a single contextual Info Panel for Town/Grind; the old standalone Weapon Proficiency component was removed. Character tabs are now Character/Gambits/Mastery, with Character limited to Attributes + Derived Stats and Mastery exposing the existing seven weapon proficiency levels through a read-only API path plus a left skill-tree workspace. No weapon XP/progression logic was added.

Implemented: the active Gambit page title is shown immediately above the XP bar; Gambit value controls use the game UI styling; Gambit rows use the two-level condition/action layout with inline params and a minimal switch; the navbar uses the existing `lords-transparent.png` equivalent asset instead of the old wordmark.

Browser-tested: temporary Playwright smoke covered 18/18 UI assertions, including central-only maps, 50 inventory cells/no vertical scroll, readable stack count, light equipment icons, Town/Grind Info Panel states, Mastery weapon selection, Character tab cleanup, active Gambit title, Gambit layout/value/switch, and navbar logo. A separate 390px responsive smoke passed for Grind and Gambits with no horizontal overflow and all 50 inventory slots present.

Build/validation: `pnpm --filter @nanommo/shared build`, `pnpm --filter @nanommo/api build`, `pnpm --filter @nanommo/frontend build`, `pnpm exec openspec validate play-shell-mastery-gambit-polish --strict`, and `git diff --check` all passed. Frontend build completes with existing/expected component-style budget warnings, but no build errors. Docker was unavailable on this workstation during the session, so the browser smoke used mocked REST responses rather than a live backend. No production deploy was performed.

Evidence note: the browser smoke harness was temporary and was not added as a committed verification script, so it is recorded as an executed browser check rather than as a formal re-runnable evidence artifact under the repository's evidence rule. Weapon XP remains deferred.

---

### Latest follow-up — `play-gambit-equipment-auth-hardening`

Implemented: Character navbar defaults to `?tab=character`; Town HP/SP regeneration is applied server-side and refreshed by the play sidebar; Character equipment slots are real drag targets with compatible-slot focus plus double-click equip/unequip fallbacks; main play Inventory is inventory-only; Gambit condition/action parameters are editable from catalog metadata and `self_hp_below_percent` is now catalogued; XP bar uses `xpToNext`; active-battle consumable counts update from due log events; registration no longer stores browser auth tokens and shows the email-confirmation page; unverified login is rejected.

Verified: `pnpm --filter @nanommo/shared build`, `pnpm --filter @nanommo/api build`, `pnpm --filter @nanommo/frontend build`, `pnpm exec openspec validate play-gambit-equipment-auth-hardening --strict`, `git diff --check`, and a 10-point static integration check all passed.

Not yet browser-verified in this session: physical drag/drop interaction, Town regeneration visual timing, full Gambit save/edit interaction, live inventory decrement in the browser, and the end-to-end registration/email flow. Weapon XP remains deferred.

> **Evidence rule adopted in Phase 3 and still in force.** A verification result is only recorded in this
> document if the script that produced it is committed and re-runnable
> (SPEC delta `grind-loop-verification`, "Edge-case guarantees are covered by re-runnable
> verification scripts"). Every claim in §7 below names the script and the assertion that
> produced it. Claims carried over from earlier sessions that were not re-proven by a
> script are marked **[re-verified 2026-09-28]** or **[carried forward, not re-proven]**.

---


### Latest follow-up — `play-ui-scale-layout` (2026-10-05)

Implemented the desktop UI scale/layout pass: application-level scale tokens now make the intended enlarged readability the default at 100% browser zoom; the three play zones use a fixed viewport-derived height with aligned bottoms and a wider left/right distribution; Grind now uses a 4:3 map beside a 5×10 vertical inventory; item icons occupy most of their slots consistently in inventory, equipment and vendor stock; and the Character quick panel uses left/right equipment columns around the portrait with a reserved Status area. Mobile remains on the existing responsive composition.

Updated `PLAY_WINDOW_SPEC.md` with the new desktop layout contract. No gameplay/API behavior was changed. Frontend production build, `git diff --check`, and strict OpenSpec validation passed. Browser visual smoke/drag interaction for this change remains to be run.

### Latest follow-up — play-ui-scale-layout correction (2026-10-05)

Corrected the desktop layout after visual review: the left/center/right play zones now share the same fixed viewport height; Grind owns one central framed workspace containing the inventory below the Location header and to the left of the 4:3 map; equipment and diet cells are fixed square dimensions with larger vertical equipment gaps; and play typography/tooltips were explicitly doubled through CSS font-size values/tokens, without browser zoom.

### Latest follow-up — character-ui-scale-layout (2026-10-06)

Implemented the Character desktop presentation pass using the existing shared InventoryGrid: Character now has Inventory + Attributes + Stats as three bottom-aligned central panels, Stats is a single column, and Attributes/Stats typography is doubled at desktop scale. The shared InventoryGrid keeps the existing tooltip, stack, consumable, drag/drop and double-click interaction path, including the global CharacterSummary equipment targets.

Gambits now use doubled desktop typography (except the sheet-header character name), the selected page tab uses a solid 8px green border instead of the textual ACTIVE marker, and Add line/Save Page/Activate are semantically inside page-meta. Condition/action parameter groups are constrained to stay on one desktop row with matching node/line footprints. Mastery and Weapons now fill the shared desktop baseline with doubled typography.

Validation: git diff --check passed; strict OpenSpec validation passed; frontend production build passed after reducing the Character CSS below its 5.12 kB component budget. The build still reports the repository's existing non-fatal style-budget warnings for several other components and the Gambit CSS. A live backend was unavailable on localhost during this session, so live interaction/browser smoke was not completed; no browser smoke result is claimed. No production deploy.

### Latest follow-up — play-ui-scale-layout alignment + Active Gambit (2026-10-05)

Corrected the remaining desktop composition issues: equipment-column vertical spacing now matches the horizontal paper-doll gap; Grind now has an unbordered Active Gambit selector above the inventory, using the existing authoritative Gambit activation endpoint; inventory and map sub-panels are borderless; Auto Feed's checked thumb is restored; and the right Grind panel fills the shared shell height with top-aligned dynamic content.

## 0. Executive summary

| Aspect | State | Evidence |
|--------|-------|----------|
| **Core loop (Phase 1–2)** | ✅ verified | `test-phase3-all.js` — every stack-dependent scenario bootstraps a real character and drives the real endpoints |
| **Full suite** | ✅ **163/163 assertions pass**, aggregate exit 0 | `node apps/api/test-phase3-all.js --restart` |
| **Known divergences from SPEC** | ✅ **0 open** — #3 fixed in code; #1/#2/#4 settled by updating SPEC to match the code | §6.1 |
| **Blocker issues** | none | No scenario failed |
| **Proof gaps from last session** | ✅ both closed (drop idempotency, SP never topped up) | §6.4 |
| **Tech debt** | ⚠️ 4 items, all pre-existing | §6.3 |

**Production code changed this session: one fix** — the level-up HP/SP ratio now derives both
ends from the character's real loadout (`battle.service.ts:453-484`). No new dependency, no new
endpoint, no WebSocket work.

---

## 1. How to reproduce

```bash
# 1. Build — required; the API runs packages/shared/dist, not the TypeScript source
pnpm build

# 2. Start the stack (backend is published on host :3010, not :3000)
docker compose up --build -d
#    wait for: curl -s -o /dev/null -w '%{http_code}' http://localhost:3010/maps

# 3. Run the suite
cd apps/api
node test-phase3-all.js             # 5 scenarios; crash recovery self-skips
node test-phase3-all.js --restart   # all 6, restarts the backend container twice
```

Individual scenarios:

```bash
node test-phase3-determinism.js                 # engine only, no stack needed for most assertions
node test-phase3-gambits.js
node test-phase3-levelup.js                     # 4 scenarios: single, multi-level, equipped, SP
node test-phase3-death.js
node test-phase3-idempotency.js
PHASE3_RESTART=1 node test-phase3-recovery.js    # gated: restarts the container
```

### Environment variables the scripts honour

| Variable | Default | Effect |
|----------|---------|--------|
| `PHASE3_API_URL` | `http://localhost:3010` | Backend base URL. `test-s63.js`'s hardcoded `:3000` is the container-internal port and is wrong from the host. |
| `PHASE3_API_MIN_INTERVAL_MS` | `13000` | Paces HTTP calls. The API is globally throttled to **5 requests / 60 s** (`app.module.ts:28`, registered as an `APP_GUARD`, so one budget for the whole process). Set to `0` to disable pacing. |
| `PHASE3_RESTART=1` | unset | Enables crash recovery / the restart-race mode. |
| `PHASE3_IDEMPOTENCY_DELAY_MS` | `0` | Gap between the two racing job submissions. `2000` forces serial delivery — the run still passes and prints the overlap outcome. |
| `PGHOST` / `PGPORT` / `PGUSER` / `PGPASSWORD` / `PGDATABASE` | `127.0.0.1` / `5432` / `nanommo` / `nanommo_dev_password` / `nanommo` | Postgres access from the host. `.env` has `DB_HOST=db` / `REDIS_HOST=redis`, which are container-internal names and do not resolve from the host. |

---

## 2. What was built

| File | Role |
|------|------|
| `apps/api/test/helpers/phase3.js` | Shared harness: throttled HTTP, `pg`, `ioredis`, `bull`, character bootstrap, seeded preconditions, assertion tally |
| `apps/api/test-phase3-determinism.js` | SPEC §3.1 / §11.2 — engine purity, stored-battle replay |
| `apps/api/test-phase3-gambits.js` | SPEC §8.4 save-time + §7.2/§7.3 runtime |
| `apps/api/test-phase3-levelup.js` | SPEC §6.3 / §3.4 — level-up mid-queue: single, multi-level, **equipped**, **SP not topped up** |
| `apps/api/test-phase3-death.js` | SPEC §7.6 / §6.4 / §7.7 — death |
| `apps/api/test-phase3-idempotency.js` | design.md D4 — exactly-once resolution, **with a real drop** |
| `apps/api/test-phase3-recovery.js` | SPEC §7.5 — crash recovery |
| `apps/api/test-phase3-all.js` | Aggregate runner (spawns child processes; `--restart` flag) |

**No dependency was added.** `bull`, `pg` and `ioredis` were already direct dependencies of
`apps/api`. The only production change is the one-line-scope fix in `battle.service.ts` (§6.1 #3).

---

## 3. Scenario results

All figures from `node apps/api/test-phase3-all.js --restart` on 2026-09-28.

| Scenario | Assertions | Wall clock | Exit |
|----------|-----------|-----------|------|
| determinism | 6/6 | 52 s | 0 |
| gambits | 41/41 | 338 s | 0 |
| levelup | 46/46 (was 28) | 358 s | 0 |
| death | 32/32 | 515 s | 0 |
| idempotency | 19/19 (was 17) | 93 s | 0 |
| recovery | 19/19 | 139 s | 0 |
| **total** | **163/163** (was 143) | **~25 min** | **0** |

`6 ran, 0 skipped, 0 failed` — every scenario of the previous 143 is still green; the 20 new
assertions are additive.

Without `--restart`, recovery self-skips with a printed notice and the run reports
`5 ran, 1 skipped, 0 failed`, exit 0. The runner never folds a skipped
scenario into the pass count.

**Gambits and death dominate the wall clock** because the global 5-req/60-s throttler forces
13 s between HTTP calls, and those two scripts make ~35 and ~30 calls respectively. This is
the API's real behaviour, not harness overhead; running against a stack with a raised
`THROTTLE_LIMIT` (and `PHASE3_API_MIN_INTERVAL_MS=0`) cuts the suite to roughly 2 minutes.
The levelup script grew from ~157 s to ~6 min for the same reason: it now performs two extra
character bootstraps, two extra map entries and (in the equipped scenario) three `PUT
/equipment/equip` calls, all paced at 13 s each. This is the main reason Phase 4A took ~45 min
of wall clock end to end; the fix itself is 20 lines and the evidence work is two scenarios.



---

## 4. Scenario-by-scenario detail

### 4.1 Determinism — `test-phase3-determinism.js`

| Assertion | Result |
|-----------|--------|
| §3.1 identical (snapshot, monster, page, seed) → byte-identical results | ✅ 2917 bytes identical, `outcome=win durationTicks=34 hpAfter=158` |
| The compared fingerprint is non-trivial (log + events included) | ✅ 13 events, header carries `monsterId, seedUsed, characterSnapshot, monsterSnapshot` |
| A different seed changes the simulation (non-vacuity control) | ✅ `34 ticks` vs `41 ticks` |
| No `Math.random()` in `packages/shared/src` code | ✅ 12 files scanned with comments stripped, 0 matches |
| §3.4 re-simulating a stored battle's `seedUsed` + `characterSnapshot` reproduces the persisted log | ✅ 2414 bytes identical for a real API-built entry |
| §3.4 the stored log header records the seed that reproduces it | ✅ `header.seedUsed` matches the `seedUsed` column |

**The non-vacuity control is verified against a deliberately broken engine.** The
"a different seed changes the simulation" assertion compares only *produced* output
(`events`, `outcome`, `durationTicks`, `hpAfter`, `spAfter`, `itemsConsumed`) — not the log
header, which echoes the seed string back verbatim. With `Mulberry32(seed)` hardcoded to a
constant in the built bundle, the suite drops to **4/6** and the control fails with
`both seeds produced identical output (outcome=win ticks=34 hpAfter=158 events=13)`. The
dist was restored afterwards; `packages/shared/dist` is unmodified.

### 4.2 Gambit validation — `test-phase3-gambits.js`

**Save-time (§8.4), over `PUT /gambits/:pageId`.** All eight rejection cases answer 400 with a
non-empty `fieldErrors` array naming the offending path, **and leave the stored page
byte-identical** — the second half is asserted by re-reading with `GET /gambits/:pageId`, since
a status code alone cannot prove the write never reached the repository.

| Rule | Submitted | Status | `fieldErrors[].path` | Page unchanged |
|------|-----------|--------|---------------------|----------------|
| >20 lines | 21 lines | 400 | `lines` | ✅ |
| condition arity | 3 conditions | 400 | `lines[0].conditions` | ✅ |
| 2 conditions, null combinator | 2 conditions | 400 | `lines[0].combinator` | ✅ |
| 1 condition, non-null combinator | 1 condition | 400 | `lines[0].combinator` | ✅ |
| unknown action | `summon_dragon` | 400 | `lines[0].action.id` | ✅ |
| out-of-enum band | `band: 'ANGRY'` | 400 | `lines[0].conditions[0].band` | ✅ |
| unknown item | `use_item pot_imaginary` | 400 | `lines[0].action.itemId` | ✅ |
| unknown skill | `use_skill sword_katana_slash` | 400 | `lines[0].action.skillId` | ✅ |
| **control: a valid page is accepted** | 4 legal lines | 200 | — | 4 lines stored and read back |

**Runtime (§7.2/§7.3), through the engine.**

| Assertion | Result |
|-----------|--------|
| §7.3 step 4 condition-true-but-illegal `use_item` is skipped and the next line runs | ✅ first event is `attack` at tick 5; 0 `use_item` events; 0 consumed |
| §7.2 the shared `item:potion` category gates a *different* potion | ✅ distinct `use_item` gaps `[6]` against a 3-tick cast-gauge period — a per-item cooldown would have fired every 3 ticks |
| §7.2 no two potion uses closer than the 5-tick `POTION_COOLDOWN` | ✅ minimum gap 6 |
| §7.2 control: with the priority-1 potion out of stock the priority-2 line fires on the first cast fire | ✅ `pot_sp_small` at tick 2 |
| §7.3 with two legal lines the higher priority executes, the lower never fires | ✅ 25 `defend`, 0 `wait`; max 1 character action per tick |
| §7.3 an out-of-stock-potion page saved over HTTP produces no `use_item` in the queued battle | ✅ 0 of 30 events |

### 4.3 Level-up mid-queue — `test-phase3-levelup.js`

Four scenarios. The first two are unchanged from Phase 3; the last two are new.

**Scenario 1 — single level-up, default unequipped character.**

| Assertion | Result |
|-----------|--------|
| The seeded first entry is a `win` | ✅ `mon_slime`, kill counter pinned to the scanned index |
| level increments by exactly the thresholds crossed | ✅ 1 → 2 (`xp=16` + `xpGain=18`, `xpToNext(1)=17`) |
| `unspentAttributePoints` += 5 per level | ✅ 0 → 5 |
| maxHp / maxSp recomputed upward | ✅ 158 → 176 and 98 → 106 |
| `hpCurrent` = `round(hpAfter × newMax/oldMax)`, clamped | ✅ 169 (ratio 1.11392) |
| `spCurrent` = `round(spAfter × newMax/oldMax)`, clamped | ✅ 106 (ratio 1.08163) |
| `hpCurrent` strictly below the new maxHp — not topped up | ✅ 169/176 = 96.0 % |
| `xp` is toward-next-level; the loop subtracted `xpToNext` once | ✅ 17 |
| The 4 surviving entries each had a BullMQ job before the resolve | ✅ 4/4 (captured **pre**-resolve) |
| Every surviving entry was discarded by the level-up | ✅ all 4 ids gone |
| The rebuilt chain was simulated against the new stats | ✅ `characterSnapshot.maxHp=176` vs the discarded chain's 158 |
| No BullMQ job remains for the discarded entries | ✅ 0 of 4 |
| Each rebuilt entry has a job; `GET /battles/queue` returns 5 | ✅ 5/5 and 5 |

**Scenario 2 — multi-level, two thresholds in one resolve** (level 10, `mon_thornsprout`, +64 XP):
2 thresholds crossed → level 12, `unspentAttributePoints` 0 → 10, `hpCurrent` 234 matches the
single-step ratio. This is divergence #4, which stays a recorded footnote (SPEC §6.3) and not a
code change.

**Scenario 3 — the ratio on an EQUIPPED character (new; proves the §6.1 #3 fix).**

The character equips tier-1 physical armour through the real `PUT /equipment/equip` endpoint
(head + body + cape = `VIT + 3`, `def 15`, all `levelReq 1`) and each piece carries the SPEC §10.3
eternal roll (`VIT + 6` stored in `equipped_items.instanceData`, seeded because `equipItem()`
nulls that column on every write), for a total `VIT 5 → 26`. It then spends its 5 unspent points
in STR — legal game state, and the reason the fight is short enough (23 ticks) that HP and SP are
both still below maximum when the level-up runs.

| Assertion | Result |
|-----------|--------|
| the loadout really carries the summed VIT bonus and DEF | ✅ `GET /equipment/stats/total` → `statBonus.VIT = 21`, `def = 15` |
| the equipment actually moves `maxHp`, so the scenario can discriminate | ✅ equipped 410 vs equipment-blind 158 |
| the entry was simulated against the EQUIPPED stats | ✅ `log.header.characterSnapshot.maxHp = 410` (the blind reading would say 158) |
| **`hpCurrent` = `round(hpAfter × newMax/oldMax)` on the equipment-aware maxima** | ✅ 364 from `hpAfter=349`, 410 → 428 (ratio 1.04390) |
| the two readings are far enough apart that a pass is not a rounding accident | ✅ gap **188 HP** (364 vs 176) |
| `hpCurrent` strictly below the new maxHp | ✅ 364/428 = 85.0 % |
| `spCurrent` ratio-adjusted on the same pass | ✅ 75 from `spAfter=69` (the loadout moves no INT, so both readings agree here) |
| the rebuilt chain is simulated against the equipment-aware maxima of the new level | ✅ `characterSnapshot.maxHp = 428` |

**The fix is proven by a failing run, not only by a passing one.** The same scenario was executed
against the pre-fix backend (the container built before the change) and produced
`45/46 assertions passed`, with exactly one failure:

```
[FAIL] §6.3 hpCurrent is ratio-adjusted with the REAL loadout — expected 364, got 176
       (entry.hpAfter=349; equipped maxHp 410 -> 428 (ratio 1.04390), so 349 x ratio = 364.
        The equipment-blind reading gives 176.)
```

176 is exactly the clamped equipment-blind value, so the old code is not "close but off by a
rounding" — it scaled by `176/158` and then clamped against the wrong maximum, leaving the
character at 41 % of its real maximum after a level-up.

**Scenario 4 — SP is never topped up (new; closes the §6.4 gap).**

A bare level-1 character with its 5 unspent points in STR and `spCurrent = 0`, fighting a
`mon_slime` over 23 ticks. `spRegenPerTick` is 3, so 23 ticks return 69 SP against a `maxSp` of
98: the entry genuinely hands the resolver a partial pool, which is what makes "not topped up"
distinguishable from "the engine refilled it first".

| Assertion | Result |
|-----------|--------|
| the entry really did hand the resolver a partial SP pool | ✅ `spAfter=69 < maxSp 98` over 23 ticks, from a chain that started at `sp=0` |
| `spCurrent` = `round(spAfter × newMaxSp/oldMaxSp)` | ✅ 75 (98 → 106, ratio 1.08163) |
| **`spCurrent` is STRICTLY below the new maxSp** | ✅ 75/106 = 70.8 % — a top-up would have set 106 |
| the SP *percentage* of the maximum is preserved, not raised to 100 % | ✅ 70.41 % → 70.75 % |
| the same resolve kept HP ratio-adjusted, so the SP result is not a different code path | ✅ `hpAfter=122`, 158 → 176, `hpCurrent=136` |

This retires the Phase 3 claim that "never topped up" was provable on HP but not on SP. The
character that makes it observable is not exotic: it is a level-1 character that spent its five
starting points in STR, and the constraint that made the old scenario's fights 39 ticks long was
simply that nobody had spent them.


### 4.4 Death — `test-phase3-death.js`

| Assertion | Result |
|-----------|--------|
| The setup is coherent: the killing blow is `sequenceIndex 0` and the only loss | ✅ 1 loss, 5 unresolved (1 killing + 4 survivors) |
| `status` → `town`; `currentMapId` → `null` | ✅ `null` explicitly (TypeORM skips `undefined` on save, so the explicit `null` matters) |
| `hpCurrent` → exactly 1 | ✅ |
| Every remaining unresolved entry deleted with the death | ✅ 0 of 4 remain; the rows are **deleted**, not marked resolved |
| No BullMQ job survives for the deleted entries | ✅ 0 of 4 (captured pre-resolve) |
| XP loss = `floor(xpToNextLevel(L) × 0.05)`, applied once | ✅ level 10, seeded 25, `floor(30 × 0.05)=1` → 24 |
| XP seeded **below** the penalty lands on exactly 0, never negative | ✅ level 20, seeded 1, `floor(73 × 0.05)=3` → 1−3 = −2 → clamped to 0 |
| The character is never de-leveled by a death | ✅ level 20 stays level 20 |
| `lastDeathLog` holds the killing battle's full log | ✅ monsterId matches, marker `death-1`, 27 events, `header` present |
| A second death **overwrites** rather than appends | ✅ second character carries only `death-2` |
| No new battles queued after the death | ✅ observed for the full duration of the longest discarded battle + 20 s |
| The character stays in town for the whole window | ✅ the processor's own top-up is gated on `status === 'grinding' && currentMapId` |
| Nothing pending in BullMQ for this character | ✅ 0 entries, 0 jobs |

### 4.5 Idempotency — `test-phase3-idempotency.js`

Two `resolve-battle` jobs are injected for the same `battleId` with **different** `jobId`s
(reusing the id would make BullMQ keep only one job and stage no race at all).

| Assertion | Result |
|-----------|--------|
| The staged entry is a `win` | ✅ `mon_fieldbat`/`mon_slime` depending on the scanned index |
| **the entry carries a real drop, and it is the one the preview predicted** | ✅ `perMonsterKillCount[mon_fieldbat] = 2` → `[{itemId: "food_honey", quantity: 1}]`, identical in preview and in the row the API built |
| xp reflects exactly one `xpGain` after the §4.2 level-up loop | ✅ 0 + 40 → xp 5 at level 3; a double application gives xp 6 at level 5 |
| `unspentAttributePoints` += 5 per level gained | ✅ 0 → 10; a double application would grant 20 |
| gold += exactly one `goldGain` | ✅ 0 → 6; a double application would show 12 |
| **each drop added exactly once** | ✅ `food_honey +1` observed against `+1` expected; a double application would show `+2` |
| `map_kill_counters.map_kill_count` += exactly 1 | ✅ 1 → 2 |
| consumed items decremented exactly once, clamped at stock | ✅ 12 → 1 of 11 consumed, with the drop included in the same expectation |
| total stock moved by exactly (consumption − drops), counted once | ✅ 12 → 2, i.e. 11 − 1; a double application would move 20 |
| the conditional claim matches 1 row, then 0 rows | ✅ asserted directly: 1 then 0 |
| a claimed row disappears from the live queue read path | ✅ |
| **the losing caller logged `already resolved - skipping`** | ✅ 1 skip line; exactly 1 `Resolved battle` line |

**The drop is arranged, not hoped for.** `resolveDrops()` (SPEC §11.2/§11.5) derives its stream
from `${monsterId}:${perMonsterKillCount}:${entryIndex}` and nothing else — the battle seed is not
part of it — so for a fixed monster the drop roll is a pure function of the per-monster kill
count. `findRaceKillIndex()` scans a winnable fight, then scans per-monster kill counts for one
that rolls a drop (a few tens of attempts at the 5 % + 1 % + 0.1 % + 0.01 % rates) and seeds it
with `setKillCounter()`. The API then rolls the drop itself, and the scenario asserts the row
matches the in-process prediction — which is what makes the add-drop branch reachable at all
rather than a 6 %-per-run coincidence.

**Consumption and drops are asserted against one combined inventory expectation**, not two. A
drop can be the very item the gambit drank (the §11.5 consumable pool is all 15 consumables,
potions included), so only the combined state is what a single application is supposed to
produce. In the run recorded here the drop was `food_honey` and the drink was `pot_hp_small`, so
the two happened not to collide; the expectation is built to survive that either way.

**The overlap is real, not assumed.** The script greps `docker compose logs backend` for
`already resolved - skipping` and fails if absent, so an exit 0 cannot come from two
sequential resolves wearing a concurrency test's clothes. Every run observed the contention.

**Restart-race mode** (`PHASE3_IDEMPOTENCY_WITH_RESTART=1 node test-phase3-idempotency.js`): the container is
stopped after the jobs are submitted, so on boot the §7.5 recovery pass and the delayed jobs
contend. **17/17, exit 0, overlap observed** (Phase 3 run; not re-run in Phase 4A — the staged entry
now also carries a drop, which this mode has not yet been re-verified with).


### 4.6 Crash recovery — `test-phase3-recovery.js` (gated on `PHASE3_RESTART=1`)

**Ordered application.** The chain is normalised before the restart so ordering is
*observable*: all wins, `hpAfter` strictly decreasing `[150, 120, 90, 60, 30]`, `spAfter`
`[90, 75, 60, 45, 30]`, distinct `goldGain` `[1,2,3,4,5]`, and `xpGain` 0. The reason is
recorded in the script: the chain the API produces *cannot* answer the ordering question —
a level-up mid-recovery deletes and rebuilds the rest of the chain (observed as "1 of 6 rows
resolved"), consecutive wins regen HP to the maximum so every `hpAfter` is identical
(observed `[156, 156, 156, 0, 0]`), and a loss truncates the chain. Each row's own `log` is
left untouched, so log-based assertions still see real engine output.

| Assertion | Result |
|-----------|--------|
| the `hpAfter` values are distinct enough for order to be observable | ✅ `[150, 120, 90, 60, 30]` — every permutation gives a different final HP |
| the chain contains no loss | ✅ 5 wins |
| the chain grants no XP, so no level-up can truncate it | ✅ |
| entries applied **sequentially**: `hpCurrent` = the last entry's `hpAfter` in `endAt` order | ✅ 30 |
| `spCurrent` = the last entry's `spAfter` | ✅ 30 |
| every stale entry marked resolved | ✅ 5/5 |
| gold advanced by the **sum** — a double application would double it | ✅ 15, not 30 |
| the kill counter advanced once per entry | ✅ 0 → 5 |
| backend logged `SPEC §7.5 crash recovery complete` with a non-zero count | ✅ resolved counts `[5, 5, 5]` |
| each entry paid out exactly once (one `Resolved battle` line each) | ✅ `1, 1, 1, 1, 1` |
| a still-alive character on a map is topped back up to 5 | ✅ 5 entries, sequenceIndex 0–4 |
| the topped-up chain used post-recovery stats | ✅ `characterSnapshot.maxHp=158` |

**Death resolved by recovery.**

| Assertion | Result |
|-----------|--------|
| routed to town, not topped up | ✅ `status=town`, `currentMapId=null` |
| `hpCurrent` → 1 | ✅ |
| left with 0 unresolved entries | ✅ after an 8 s settle window |
| XP loss applied exactly once | ✅ 12 → 11, not 10 |
| `lastDeathLog` written by the recovery pass | ✅ correct monsterId and marker |

---

## 5. Phase 1–2 loop (carried forward, re-verified where a script touches it)

| Component | State | Evidence this session |
|-----------|-------|----------------------|
| Registration → auto-created character | ✅ | every scenario bootstraps through it |
| Email verification gate | ✅ | bypassed via `UPDATE users SET "emailVerified" = true` — the column is camelCase, **not** `email_verified` as the task prose assumed |
| Map entry + `queueBattles(5)` | ✅ | [re-verified 2026-09-28] — gambits, levelup, death, idempotency, recovery all build a real 5-deep chain |
| XP curve loading | ✅ | [re-verified 2026-09-28] — `xpToNext(1)=17`, `xpToNext(10)=30`, `xpToNext(20)=73` read from `char_xp_curve.json` |
| Level-up +5 points, ratio HP/SP | ✅ | [re-verified 2026-09-28] — see §4.3, now including an **equipped** character (the ratio uses the real loadout) and the SP "never topped up" case |
| Queue discard + rebuild on level-up | ✅ | [re-verified 2026-09-28] — see §4.3 |
| Death → town, HP 1, XP loss, chain discarded | ✅ | [re-verified 2026-09-28] — see §4.4 |
| Gambit save-time validation (6 rules) | ✅ | [re-verified 2026-09-28] — see §4.2 |
| Gambit runtime evaluation | ✅ | [re-verified 2026-09-28] — see §4.2 |
| Recovery pass on boot | ✅ | [re-verified 2026-09-28] — see §4.6 |
| Idempotent resolution | ✅ | [re-verified 2026-09-28] — see §4.5 |
| Determinism / no `Math.random()` | ✅ | [re-verified 2026-09-28] — see §4.1 |
| WebSocket battle events | ✅ integrated | `/game` gateway, authenticated character room, map socket intents, battle/progression events, and REST resync contract implemented; dedicated `test-battle-gateway.js` passes |

---

## 6. Issues

### 6.1 SPEC divergences — all four settled in Phase 4A

| # | Divergence | Resolution | Where |
|---|-----------|-----------|-------|
| 1 | Death XP penalty: `floor` vs `round`, and an undefined `cumulativeXp` clamp | **SPEC updated to match the code** (code unchanged) | SPEC §6.4 |
| 2 | Resolve marks rows resolved instead of deleting them | **SPEC updated to match the code** (code unchanged) | SPEC §4.7, §7.4.3 |
| 3 | Level-up ratio computed with an empty equipment argument | **Code fixed** (the only production change of this change) | `battle.service.ts:453-484` |
| 4 | Multi-level scaling is one step, and the question is unobservable | **SPEC footnote added**, no code change — the question is unobservable, so deferring it is safe | SPEC §6.3 |

**#1 — settled in SPEC.** The code was kept: `Math.floor` and a clamp at 0
(`battle.service.ts:545-546`). SPEC §6.4 now says `floor`, states explicitly that there is **no**
`cumulativeXp` floor (it is undefined under the §4.2 toward-next-level model that
`characters.xp` actually holds, which was the spec-internal half of this divergence), and names the
`test-phase3-death.js` assertions that pin both halves: level 10 → `floor(30 × 0.05) = 1`, and a
level-20 character seeded at 1 XP with `floor(73 × 0.05) = 3` landing on exactly 0 with its level
untouched. `design.md`'s open question ("which XP model is canonical?") is answered by §4.2, which
the schema already follows.

**#2 — settled in SPEC.** The code was kept. SPEC §4.7 and §7.4.3 now describe the row as **marked
resolved, not deleted**, and name what *is* deleted: the rest of the chain after a death (§7.6) and
the chain invalidated by a level-up (§3.4/§6.3). The two paths that used to disagree with each
other are now spelled out as two different rules, so §7.6 is no longer an exception. The recovery
pass re-reading already-applied rows is a consequence, not a bug: the conditional claim at
`battle.service.ts:371-383` is what makes re-reading them a no-op, and that claim is asserted
directly by `test-phase3-idempotency.js`.

**#3 — FIXED, with a failing run as evidence.** `battle.service.ts` derived both ends of the
level-up ratio from bare attributes and an empty equipment argument, while
`buildCharacterSnapshot()` (`battle.service.ts:144-160`) folds `statBonus` into the attributes and
passes the real `def`/`mdefPercent`/weapon ATK. The resolver now calls
`equipmentService.calculateEquipmentStats()` and derives both ends the same way. The scenario that
proves it, and the pre-fix run that fails it, are in §4.3 — the pre-fix run is the load-bearing
part: `expected 364, got 176` on a 188 HP gap, with every other assertion in the scenario
green, so the failure isolates the bug rather than the setup.

**#4 — settled as a SPEC footnote, no code change.** The code applies one ratio step from the
pre-first-level stats to the post-last-level stats. The suite measures the alternative: the two
readings differ by **0–1 HP**, because `maxHp = floor(80 + VIT*12 + level*18)` is *linear* in
level, so compounding telescopes to the same product and only the `Math.round` at each intermediate
step can differ. With the current formulas the "one step or compounded" decision is **not
observable** in `hpCurrent`, and becomes observable only if `maxHp`/`maxSp` ever gains a
non-linear level term. SPEC §6.3 now records both the rule as implemented and the reason the
alternative is unobservable, so the next reader does not have to re-derive it. This closes
`design.md`'s open question empirically: the choice can be deferred safely.

**#5 (testability note, not a divergence) — the shared potion cooldown is invisible at
default DEX.** `castGaugeThreshold(dex) = max(3, 8 − floor(dex × 0.05))`, so at the default
`dex=5` the cast gauge fires every 8 ticks while the potion category cooldown is 5 ticks — it
has always expired before the next fire. The shared-category assertion therefore uses a
`dex=100` fixture (3-tick cast period). It is a property of the engine, not of any character
the API currently builds with low DEX and a potion gambit. **Still open, out of scope here** —
same as the WebSocket gap, it needs a character build the API does not currently produce.


### 6.2 Test-evidence defects found and fixed in Phase 3

These were real bugs — in the *evidence*, not the product — and each one had produced a
misleading green result before. They are listed unchanged from Phase 3; Phase 4A found no new
one of this class, because the two gaps it closed (§6.4) were gaps in coverage, not defects that
had been passing for the wrong reason.

| # | Defect | Why the earlier evidence was wrong |
|---|--------|--------------------------------------|
| 1 | `bull` v3 stores jobs as a flat `bull:<queue>:<id>` key, with **no** `:id:`/`:data:` suffixes, and **retains** the key after completion (no `removeOnComplete`). | `test-s63.js` scans for those suffixes, so it *always* observed zero jobs. Its `orphaned jobs: 0` output was never evidence of anything. The harness now counts membership of the `wait`/`active`/`delayed`/`paused` lists. |
| 2 | Pinned a fixed `mapKillCount` in the idempotency scenario. | The monster at index N comes from `rngForIndex(charId:mapId:epoch, N)`, so index 0 is a slime for one character and a direwolf for the next. One run staged a **loss**, routing the resolve into `handleCharacterDeath()` and never touching xp/gold/drops. The scenario now scans for a suitable index. |
| 3 | Seeded progression, then built the queue from the pre-seed bootstrap chain. | A delayed bootstrap job fired in between and rewrote `hpCurrent` (seeded 80, arrived as 192). Draining afterwards cannot close the window, because an `active` job cannot be removed. Scenarios now seed first and enter the map once. |
| 4 | Compared inventory maps by exact object equality. | `inventoryService.removeItem()` **deletes** the stack row once the quantity reaches 0, so a battle that drains the last potion leaves no row rather than a row of zeroes. "Absent" and "0" are the same state, and the strict comparison reported it as a double-deduction failure. Now compared per item with absent treated as 0, plus a total-removed cross-check. |

### 6.3 Pre-existing issues carried forward

| # | Issue | Severity | Note |
|---|-------|----------|------|
| 1 | `maxHp: null` on the attribute-allocation response | Low (cosmetic) | DTO does not compute derived stats. The suite reads maxHp/maxSP from Postgres instead, since `GET /characters` also omits them. |
| 2 | Level-1 characters lose most Green Grounds fights organically | Medium (balance) | Not a code defect. A level-1 character with an `always → attack` gambit is genuinely too weak, so every scenario pins the kill counter or seeds progression. |
| 3 | No gambit page → no legal action on any gauge | Medium (design/data integrity) | With `activeGambitPageId = null`, the character has no legal action; without a duration cap the battle continues until the monster defeats the character. Registration normally activates slot 0, so this only bites a hand-edited/corrupt row. Consider a separate data-integrity guard; do not reintroduce a duration-based defeat. |
| 4 | `pnpm --filter @nanommo/api lint` cannot run | Low (tooling) | `ESLint couldn't find a configuration file` — no eslint config resolves in `apps/api`. Pre-existing: it fails identically with this change's files removed, and its glob `{src,test}/**/*.ts` does not target the new `.js` scripts either way. Not a regression from this change. |

### 6.4 Limits of what the suite can prove

Recorded so a future green run is not over-read. The two Phase 3 entries that were gaps are now
closed; the two that remain were never gaps in the suite, they are facts about what the scenario
can reach.

- ~~**"Never topped up" is demonstrable on HP but not SP.**~~ **CLOSED in Phase 4A.** The claim
  was true of the Phase 3 character, not of the system: every fight *that character* could win
  lasted ≥ 33 ticks with `spRegenPerTick = 3`, because its five unspent attribute points were
  never spent and it fought with base STR 5. A level-1 character that spends them in STR kills a
  slime in 23 ticks instead of 39, and a chain that starts at `spCurrent = 0` hands the resolver
  `spAfter = 69 < maxSp 98`. Scenario 4 in `test-phase3-levelup.js` asserts the ratio result
  (75), the strict inequality (75 < 106) and the preserved percentage (70.4 % → 70.8 %). See §4.3.
- ~~**The drop branch of idempotency is unexercised.**~~ **CLOSED in Phase 4A.** The drop roll is
  a pure function of the monster and its per-monster kill count, so
  `test-phase3-idempotency.js` now seeds a kill count that rolls one and asserts the API rolled
  the same item the in-process preview did, before racing two resolve jobs over the entry. See §4.5.
- **`lastDeathLog` overwrite is observed across two characters**, each of which died once. A
  character cannot die twice without re-entering a map, so a same-character double death is a
  separate scenario.
- **The recovery pass is global.** The scenario deletes other characters' unresolved rows first
  (145 on a dirty database) so the ordering assertion is unambiguous; on a shared database that
  deletion is worth knowing about before running it.
- **The level-up ratio is proven on one build shape** — VIT gear, level 1, one threshold
  crossed. The fix is general (it derives both ends from `calculateEquipmentStats()` exactly as
  `buildCharacterSnapshot()` does) but the *assertion* is one character. A future build that
  moves `maxSp` from gear rather than `maxHp` would need its own scenario: the loadout here adds
  VIT only, so the SP assertion passes identically under both readings and proves the ratio
  formula, not the equipment's effect on SP.


---

## 7. Still stub / TODO (outside loop scope)

| Module | Status | Note |
|--------|--------|------|
| **ChatService** | Stub (`throw new Error('Not implemented')`) | Future: server-side message persistence |
| **MailService** | Stub | Separate from `MailerService` (auth emails) |
| **TownService** | Stub | Vendor, warehouse, NPC interactions |
| **MarketService** | Stub (not started) | Buy/sell orders, order matching |
| **WebSocket gateway** | Integrated | `/game` is enabled with JWT + `activeSessionId` handshake auth, `char:<characterId>` rooms, socket map entry/leave, battle/progression publication through Redis, non-blocking event emission, and frontend REST resync documentation. Dedicated gateway smoke test passes. |

---

## 8. Architecture notes

- **Port mapping:** the backend runs on `:3000` inside the container and is published on host
  `:3010`. `test-s63.js`'s hardcoded `http://localhost:3000` is wrong from the host.
- **`.env` names are container-internal:** `DB_HOST=db`, `REDIS_HOST=redis`. Scripts use
  `127.0.0.1:5432` / `127.0.0.1:6379` (the published ports) and read credentials from
  `PG*` env vars.
- **Email table:** `users` (plural); the verification column is `"emailVerified"`.
- **Queue response:** `GET /battles/queue` returns a bare array, not `{entries: [...]}`.
- **`GET /characters`** returns a single object (not an array) and omits `maxHp`/`maxSp`.
- **The resolver's contract is "fired after `endAt`", not "fired exactly at `endAt`."** That is
  what makes rewriting `endAt` into the past and injecting a job a legitimate way to shorten an
  in-game battle in a test.
- **Level-gated maps are checked at enter time**, so a scenario needing one must seed the level
  before `POST /maps/:mapId/enter`, not after.
- **Attributes are seeded as ordinary game state.** A level-1 character has 5 in each attribute
  and 5 unspent points (SPEC §6.3), so `str = 10` with `unspentAttributePoints = 0` is a
  character that spent its starting points — not a hand-edited row. That allocation is what
  makes a Green Grounds fight short enough (23 ticks instead of 39) for the SP regen window to
  stay open, which is how §4.3 scenario 4 is reachable at all.
- **`equipItem()` nulls `equipped_items.instanceData` on every write** (equipment.service.ts:266),
  so the SPEC §10.3 eternal roll can only be seeded directly. `PUT /equipment/equip` also does
  not check the inventory and does not invalidate the queue (the `TODO` at equipment.service.ts:277),
  so equipping before `POST /maps/:mapId/enter` is safe and race-free.

---

## 9. Change state

| Item | State |
|------|-------|
| Previous change | `grind-loop-phase3-edge-cases` — complete, `openspec validate --strict` ✅ |
| This change | `battle-loop-websocket-gateway` — applied; gateway + frontend synchronization contract integrated |
| Production code changed | **one fix:** `battle.service.ts:453-484`, the level-up HP/SP ratio now uses `calculateEquipmentStats()` |
| SPEC changed | §6.3 (equipment-derived ratio + the #4 footnote), §6.4 (`floor`, no `cumulativeXp` floor), §4.7 and §7.4.3 (marked resolved, not deleted). `openspec/specs/SPEC.md` re-synced from it. |
| Tests changed | `test-phase3-levelup.js` +2 scenarios / 18 assertions, `test-phase3-idempotency.js` +2 assertions, `test/helpers/phase3.js` +4 helpers, `test-phase3-death.js`/`test-phase3-recovery.js` notes re-worded (divergences #1/#2 are no longer divergences against SPEC) |
| Dependencies added | none |
| Full-suite result | `163/163`, `6 ran, 0 skipped, 0 failed`, exit 0 |
| Not done, deliberately | no WebSocket work, no new functionality, no SPEC §19.3 balance pass |

**Status: 163/163 assertions pass across the six scenarios; the suite is re-runnable with
`node apps/api/test-phase3-all.js --restart`. All four recorded SPEC divergences are settled
(one code fix, three SPEC corrections). Both Phase 3 proof gaps are closed.**

### 9.1 What this change did NOT do

Left open on purpose, so the next session does not re-derive them:

| Item | State | Why it is still open |
|------|-------|----------------------|
| **WebSocket event delivery** (`battleResolved`, `characterDied`) | ❌ unverified, not implemented | Explicit non-goal of this change and of Phase 3. No socket scenario exists in the suite; the gateway is not wired to the resolver. |
| `maxHp: null` on the attribute-allocation response | ⚠️ open (Low, cosmetic) | Pre-existing §6.3 #1. The suite reads derived stats from Postgres instead. |
| Idempotency **restart-race mode** with the new drop-bearing entry | ⚠️ not re-run | `PHASE3_IDEMPOTENCY_WITH_RESTART=1 node test-phase3-idempotency.js` was last run in Phase 3 (17/17, no drop). The staged entry now carries a drop, so that mode is worth one re-run (~2 min) before it is quoted as drop-under-restart evidence. |
| Level-up ratio proven on one build shape | ⚠️ narrow by design | Only VIT gear at level 1 with one threshold. A loadout that moves `maxSp` rather than `maxHp` needs its own scenario (§6.4). |
| `pnpm --filter @nanommo/api lint` | ⚠️ cannot run (Low, tooling) | Pre-existing §6.3 #4 — no eslint config resolves in `apps/api`. `npx tsc --noEmit -p apps/api/tsconfig.json` passes and was used instead. |
| SPEC §19.3 balance pass, stub services (`Chat`, `Mail`, `Town`, `Market`) | ⏸️ out of scope | Unchanged from Phase 3. |

### 9.2 How to re-derive the Phase 4A evidence

```bash
# The fix alone (levelup is the only scenario whose expectations changed)
docker compose up --build -d backend
cd apps/api && node test-phase3-levelup.js       # 46/46, exit 0

# The pre-fix run that proves the test is not vacuous: revert battle.service.ts
# to `calculateDerivedStats(preLevel, attributes, {})` / `(…, {})`, rebuild,
# re-run test-phase3-levelup.js, and observe 45/46 with
#   [FAIL] §6.3 hpCurrent is ratio-adjusted with the REAL loadout — expected 364, got 176
# then restore the fix and rebuild.
```

Both runs were executed in this order (pre-fix first, on the container built before the change)
so the failing evidence is not a reconstruction.



---

## 10. Frontend play/character status — 2026-09-28

The first implementation of 'play-and-character-ui' is **implemented MVP**, not fully
verified. The visual direction was validated manually by the user: the dark fantasy /
bronze / gold treatment is working well and slot hover highlights are considered good.

| Area | State | Notes |
|------|-------|-------|
| /play, /play/grind, /play/character, /play/gambits | ✅ implemented | Angular routing and shared shell are in place |
| REST + /game state stores | ✅ implemented | Character, inventory, battle queue and reconnect resync exist |
| Server-timestamp battle progress | ✅ implemented | Uses startAt / endAt; no client battle resolution |
| 50-slot inventory | ⚠️ needs polish | Keep 50 cells, remove slot numbering and 50 slots subtitle |
| 8-slot equipment | ✅ implemented | Hover/highlight behavior is good; grind invariants still need backend enforcement |
| Derived stats | ❌ incomplete | Character contract currently lacks authoritative values; frontend shows unavailable placeholder |
| Weapon proficiency | ⚠️ incomplete | Backend exposes levels; current UI integration still needs completion |
| Map selection | ⚠️ needs correction | Current visual map is too blurred to test; add explicit clickable map tiles |
| Responsive layout | ❌ incomplete | Desktop works as a composition, but tablet/mobile require a dedicated pass |
| SVG assets | ❌ broken in browser pass | Existing SVG references did not render; asset path/build handling needs correction |
| Auth refresh | ❌ broken/incomplete | Frontend calls /auth/refresh, but backend currently has no matching controller endpoint |
| 401 handling | ⚠️ incomplete | Some 401s are visible only in console; final unauthorized state must navigate to /login |
| Fresh character starter loadout | ❌ missing | New character should start with sword_t1 equipped |
| Fresh character starter Gambit | ❌ missing | Default page should contain the two specified starter lines |
### 10.1 Next change

OpenSpec change: 'play-character-ui-hardening'

The proposal covers the following next-session work:

1. Implement real access-token refresh/retry and final 401 → /login behavior.
2. Bootstrap sword_t1 equipment and the two-line default Gambit page on character creation.
3. Make HP/SP and derived stats authoritative and expose them to the frontend.
4. Apply the new derived-stat source mapping: FOR/VIT/INT/AGI/DEX/SOR as documented in
   the proposal, with HP/SP regeneration occurring every 10 ticks.
5. Enforce weapon-required grind entry and forbid required-weapon unequip during grind,
   while allowing legal weapon replacement.
6. Replace the blurred map board with explicit clickable map tiles backed by /maps.
7. Make the play shell responsive across desktop, tablet, and mobile.
8. Simplify the main inventory header and fix SVG asset resolution.

The existing Gambit parameter gap is explicitly **future work** and is not part of the
next implementation: the editor needs controls such as 'Self HP is [< 30%] -> Use Skill
[Heal]', but no new parameter schema should be invented in this change.

### 10.2 Verification limits carried forward

- Angular Karma/browser tests were not completed because the environment lacks a
  ChromeHeadless binary.
- Production Angular build passed for the first UI implementation.
- openspec validate play-and-character-ui --strict passed for the previous change.
- The next change must add real browser/session verification for the observed 401,
  responsive layouts, map entry, fresh-character bootstrap, and asset loading.
### 10.3 Architecture decision for the next pass

The frontend must not reproduce battle formulas locally. Derived stats are an
authoritative backend/game-engine concern and the Angular character screen consumes
server values. Any formula change must be reflected in the engine/spec/tests first,
then surfaced through the API contract.

Likewise, weapon restrictions are gameplay invariants and must be enforced by the
backend even if Angular disables or hides the corresponding controls.

### Latest session close — `play-shell-mastery-gambit-polish` (2026-09-29)

The product SPEC was reconciled with the finalized design decisions where it had drifted. Important corrections include: one-time starter bootstrap (`sword_t1` + 10 Small HP Potions + 5 Bread), Hungry blocks grind, Town HP/SP regeneration, item-defined consumable cooldowns, starter Gambit activation/default behavior, target-aware Gambit params, and the Character/Grind UI contract.

New OpenSpec change created: `openspec/changes/play-shell-mastery-gambit-polish/`.

Next-session scope:
- remove the redundant lower map selector/list;
- compact the 50-slot inventory so it fits without vertical scrolling;
- make Character equipment icons white;
- replace right-side Weapon Proficiency with one contextual Info Panel;
- replace Character Equipment tab with Mastery + Weapons;
- show active Gambit page title above XP;
- leave only Attributes + Derived Stats in Character tab;
- polish Gambit value inputs and rebuild rows as conditions-above/action-below with a minimal switch;
- replace navbar `NANOMMO online` with `assets/lords.png`.

Reference: `project/image.png` for the Gambit row composition. Weapon XP/proficiency progression remains deferred; this session only exposes existing weapon levels in the UI.

No implementation from the new OpenSpec change was performed in this closing session. The SPEC reconciliation was documentation-only; the new UI work is intentionally left for the next OpenSpec session.

### Verification at session close

- `SPEC.md` reconciled: yes.
- New OpenSpec files created: yes.
- `openspec validate play-shell-mastery-gambit-polish --strict`: passed.
- `git diff --check`: passed.
- Browser verification of the new UI scope: not performed.
- Production deployment: not performed.

### Latest follow-up — Equipment slot icons vs. equipped item colors (2026-09-30)

Corrected the equipment-icon implementation without changing the approved visual style:

- generated/replaced the **30 root UI SVG icons** in `apps/frontend/assets/ui/*.svg` as explicit white SVGs (`#ffffff`);
- deliberately **did not touch `apps/frontend/assets/ui/items/**`**, so the item artwork/catalog remains unchanged;
- removed the white-color filter from the **equipped-item renderer** in Character Summary, leaving only the drop shadow;
- kept the white styling for the empty equipment-slot icons, now provided by the SVG assets themselves;
- this separates **slot chrome/icon assets** from **actual item artwork**, so equipped items retain their original colors.

### Verification

- `pnpm --filter @nanommo/frontend build`: passed (existing Angular style-budget warnings only).
- `git diff --check`: passed.
- No backend/gameplay changes.
- No production deployment.

### Latest follow-up — Login startup volume + login-only visual fade (2026-09-30)

Adjusted the auth music default volume from 0.38 to 0.85 for a fresh browser/local-storage state; the user's persisted volume remains respected once they have changed it. Added a login-only 2-second visual fade-in from black/near-black on the full login artwork, without applying that entrance animation to Forgot Password, Register, Verify Email, Pending Verification, or Reset Password.

Verification: `pnpm --filter @nanommo/frontend build` passed (existing Angular style-budget warnings only) and `git diff --check` passed. No backend/gameplay changes and no production deployment.

### Latest follow-up — Gambit naming and editor alignment (2026-09-30)

- Styled the Gambit page-name input to match the bronze/dark UI and added a compact page metadata shell.
- Gambit page tabs now display the actual page title instead of forced `Page N` labels.
- The default slot is now named `Default Gambit` for newly created characters; existing slot-0 pages still named `Page 1` are canonicalized to `Default Gambit` when Gambits are loaded.
- Condition/action selectors are now fixed to equal 50% width and aligned to the right edge of each node block, so `ACTION` no longer receives more width than `CONDITION` based on label length.
- Condition/action parameter controls are right-aligned at the end of their row.
- Existing selector arrows/cursor affordances and themed number spinners remain intact.
- Verification: `git diff --check`, `pnpm --filter @nanommo/api build`, and `pnpm --filter @nanommo/frontend build` passed. Angular still reports the existing non-blocking style-budget warnings on several feature styles.
- No production deployment.

### Previous follow-up — Equipment drag/drop stability + single-condition Gambits (2026-09-30)

Fixed equipment drag/drop behavior in the Character Summary: equipment slots no longer sort/reflow while an item is dragged over them, only the matching equipment slot accepts the item, and drag previews are icon-only so an equipped item name cannot bleed into an Inventory slot or resize its layout. Inventory/equipment drag placeholders are kept visually inert and do not alter slot dimensions.

Updated Gambits so every line has exactly one condition. Removed the frontend + condition/second-condition/combinator UI, added themed selector arrows and pointer cursors, and kept numeric value inputs at a contained compact height with themed spinner treatment. The backend now validates exactly one condition, rejects non-null legacy combinators, and canonicalizes accepted writes without the legacy combinator field. The shared evaluator now evaluates only the single configured condition. Catalog, shared types, starter Gambits, SPEC, OpenSpec delta, and the Phase 3 Gambit verification script were synchronized.

Verification: shared build passed, API build passed, frontend production build passed (existing Angular style-budget warnings only), OpenSpec strict validation passed, and git diff --check passed. No production deployment.

### Latest session — `town-vendor-william` (2026-09-30)

Implemented the first Town Vendor NPC, William, under OpenSpec. Town now replaces the central Grind/Battle surface while the character is in Town; outside Town the existing Grind surface remains. The persistent right panel now has `Choose NPC` and renders William as a `vendor` type.

#### Backend
- Implemented authoritative William catalog/stock from `npc_vendor.json` with 10 UI slots, 7 configured stock entries and infinite stock.
- Added `GET /town/npcs`, `GET /town/vendor/:vendorId/stock`, `GET /town/vendor/:vendorId/quote/:itemId`.
- Added `POST /town/vendor/:vendorId/buy` and `POST /town/vendor/:vendorId/sell`.
- BUY and SELL run inside database transactions with pessimistic character/inventory locking.
- Reuses existing Character gold and InventoryItem persistence; no second currency or inventory system.
- Backend revalidates Town status, vendor/item membership, quantity, ownership, gold, stock and inventory capacity.
- Vendor sell value uses the existing official 40% rule server-side; buy prices come from vendor stock data.

#### Frontend
- Added extensible NPC selector and `VendorStore` using shared vendor contracts.
- Added William vendor panel, 10 stable slots, catalog icons, drag previews and responsive styling.
- Reused Inventory CDK drag/drop; drops only open confirmation flows and do not mutate state immediately.
- Added blocking BUY/SELL modal with quantity, All, unit price, total, confirm/cancel and insufficient-gold/inventory feedback.
- After successful transactions, Character, Inventory and Vendor state are reloaded from the backend.

#### Contracts / docs
- Added shared `VendorNpc`, `VendorStockItem`, `VendorQuote` and `VendorTransactionResponse` types.
- Updated `npc_vendor.json`, `openspec/specs/SPEC.md`, and the OpenSpec change `openspec/changes/town-vendor-william/`.
- Added `apps/api/test/town-vendor.service.test.js` and `apps/frontend/smoke-vendor-ui.js`.

#### Validation
- `pnpm --filter @nanommo/shared build`: passed.
- `pnpm --filter @nanommo/api build`: passed.
- `pnpm --filter @nanommo/frontend build`: passed; existing Angular style-budget warnings remain non-blocking, including `grind-info.css`.
- `node apps/api/test/town-vendor.service.test.js`: passed, 10 assertions.
- `node apps/frontend/smoke-vendor-ui.js`: passed: Town → William → SELL → BUY → gold/inventory refresh → 390px no-overflow.
- `pnpm exec openspec validate town-vendor-william --strict`: passed.
- `git diff --check`: passed.
- Existing `apps/api/test-phase3-gambits.js` was attempted; it stopped at preflight because no backend was reachable at `http://localhost:3010`. Docker was unavailable on this machine, so no HTTP integration result is claimed.

#### Warnings / pending
- The full authenticated HTTP/E2E Vendor transaction path against a live local API/database was not executable in this session because the Docker daemon/services required by the repository were unavailable. The atomic transaction logic was exercised with a real service test harness, and the UI flow was exercised with Playwright API mocks.
- No production deployment was performed.

**Production deployment: NOT performed.**

### Latest session — `npc-framework-father-marcelus` (2026-09-30)

Implemented a generic Town NPC capability framework and the first quest NPC, Father Marcelus, without replacing the existing Vendor architecture.

#### NPC framework
- Added `npc_catalog.json` as the data-driven catalog for non-vendor NPC capabilities.
- Shared NPC contracts now support `vendor` and `quest` capability types and reusable dialogue state/choice types.
- NPC capabilities are composable. The Town right panel renders vendor/inventory first and quest/dialogue below it when an NPC has both.
- Quest dialogue is server-authoritative: the backend re-evaluates conditions and applies effects inside a database transaction.
- Quest NPCs do not have an NPC inventory unless they also expose the vendor capability.

#### Father Marcelus
- Added `father_marcelus` as a `quest` NPC.
- Opening text and hungry/non-hungry dialogue branches match the requested copy.
- Hungry + no food: Bread is granted only transiently and immediately consumed; no Bread inventory row is created.
- Hungry + existing food: one food item is consumed and its existing food-buff definition becomes active.
- Non-hungry branch does not mutate character or inventory state.
- Invalid/repeated state transitions are rejected server-side.

#### Town / frontend
- `GET /town/npcs` now returns the generic Town NPC contract while preserving William's vendor endpoints.
- Added `GET /town/npcs/:npcId/dialogue` and `POST /town/npcs/:npcId/dialogue`.
- Town NPC selector is now generic; Father Marcelus appears alongside William.
- Quest dialogue renders in the same persistent right-side Town panel and uses clickable choices.
- The central Grind/map surface was not replaced or altered by this change.
#### Verification

- `pnpm --filter @nanommo/shared build`: passed.
- `pnpm --filter @nanommo/api build`: passed.
- `pnpm --filter @nanommo/frontend build`: passed; existing Angular style-budget warnings remain non-blocking.
- `node apps/api/test/npc-framework.test.js`: passed, 12 assertions.
- Focused test covers hungry branch, hungry/no-food transient Bread, preservation of unrelated inventory, non-hungry branch, and rejection after the character is no longer hungry.
- `pnpm exec openspec validate npc-framework-father-marcelus --strict`: passed.
- `git diff --check`: passed.
- No production deployment performed.
- Live authenticated HTTP/E2E against Docker was not run because Docker services were unavailable on this workstation; the focused service test exercises the compiled TownService behavior with authoritative state mocks.

### Latest session — encounter-search-time-and-map-presence (2026-09-30)

Implemented server-authoritative monster encounter search time, realtime map population, and the requested Grind/Battle right-panel hierarchy.

#### Encounter search
- Every queued monster encounter now has a search gap before its battle start.
- Formula: 2 seconds + 0.1 seconds for every other character whose status is `grinding` on the same `currentMapId`.
- The current character is excluded from the count.
- The delay applies before the first encounter and between subsequent encounters.
- Search time is not stored as a separate battle row; `BattleQueueEntry.log.searchStartAt` records the client-facing search interval while `startAt` remains the actual battle start.
- Existing 1-second combat ticks and battle-duration formulas are unchanged.
#### Realtime map population
- Added `map:presence` over the existing `/game` Socket.IO connection.
- Redis map membership is updated on gateway connect, enter, leave, disconnect and explicit REST-to-socket presence synchronization.
- Connected players on a map receive the current `playersOnMap` count when membership changes.
- Central LOCATION header now shows `Players in map: X` aligned on the right.
- Encounter timing uses authoritative Character status/map rows rather than relying on potentially stale socket presence.
#### Grind/Battle right panel
- While waiting for `startAt`, the right panel shows `/project/swords_clash(loading).gif` and the existing BattleProgress component for the search interval.
- During battle, monster HP remains first.
- Removed character HP bar and battle-time progress bar from the active battle panel.
- Added monster STATUS EFFECTS section using the authoritative monster snapshot status effects; empty state does not invent effects.
- Added monster DERIVED STATS using the existing monster snapshot values (ATK, MATK, DEF, MDEF, ACC, EVA, CRIT).
- Existing battle reward and event logs remain below the monster information.
- Town/Vendor/Quest NPC UI and the central map remain unchanged.
#### Verification
- `pnpm --filter @nanommo/shared build`: passed.
- `pnpm --filter @nanommo/api build`: passed.
- `pnpm --filter @nanommo/frontend build`: passed; pre-existing Angular style-budget warnings remain non-blocking.
- `node apps/api/test/encounter-search.test.js`: 5 assertions passed.
- `node apps/api/test/map-presence.test.js`: 4 assertions passed.
- `pnpm exec openspec validate encounter-search-time-and-map-presence --strict`: passed.
- `git diff --check`: passed.
- No production deployment performed.

## 2026-09-30 — Grind Corrections / Realtime Progression

Implemented the OpenSpec change `grind-corrections-realtime-progression` (no production deployment).

### Implemented
- Item hover now uses a single catalog-backed tooltip string for inventory and equipped items, including all non-empty fields available in the current item definition.
- Town click during an active battle now records the battle id, shows `Waiting for battle to end to return to Town...`, and leaves automatically after that authoritative `battle:resolved` event. During encounter search, the existing leave flow remains immediate and cancels the pending queue safely.
- Grind right panel no longer mirrors inventory consumables; it shows transient `Drops this session`, reset on map entry and stacked by item id from authoritative battle-resolution drops.
- Character HP/SP panel uses the authoritative queued battle log projection during an active battle and the authoritative Character state outside it; resolved battles resync Character and Inventory through the existing Socket.IO flow.
- Regen and critical events are represented in the existing battle event log; critical hits now render as `CRITICAL!` and regen renders HP/MP regeneration amounts.
- Monster gold rewards are disabled in the shared resolver and removed from `monsters.json`; Vendor gold remains unaffected.
- New characters now receive 50 `pot_hp_small` and 5 Bread.
- Bread is now configured as sellable through William's existing Vendor sell path (`sellPriceToVendor: 7`).
- Monster XP uses the canonical catalog values with a global Grind payout multiplier of `0.25`; one XP resolution consumes every crossed level threshold and excess XP remains stored.
- Monster drop rates were deliberately doubled from 5%/1%/0.1%/0.01% to 10%/2%/0.2%/0.02%, preserving relative rarity. The deterministic chance implementation was reviewed; no probability multiplication/guarantee bug was found.
- Added `Character.regenAnchorAt` and a migration. Battle simulation now uses the absolute character regen timeline, and queued encounter gaps preserve 10-tick boundaries instead of resetting regen per battle.

### Verification
- `pnpm --filter @nanommo/shared build`: passed after the final engine/reward changes.
- `pnpm --filter @nanommo/api build`: passed.
- `pnpm --filter frontend build`: passed; existing Angular style-budget warnings remain non-blocking.
- `node apps/api/test-grind-corrections.js`: passed (reduced XP rate, multi-level threshold resolution, no monster gold, continuous regen boundary, critical log).
- `node apps/api/test-phase3-levelup.js`: attempted but local backend `http://localhost:3010` was not running, so the integration suite could not execute.

### Latest follow-up — `grind-followup-fixes` (2026-10-01)

Implemented the requested Grind corrections: item tooltips are now custom and instant, omit Tier and every field after it, and color Tier 2/3/4/5 names green/blue/purple/gold. Town return during an active battle is now authoritative on the server: future queued battles are cancelled, the active battle is allowed to finish, and the character is already in Town so no new battle can start. Inventory is refreshed on every authoritative queue-resolution websocket update, in addition to the existing `battle:resolved` refresh. XP resolution once again consumes every crossed threshold; the Grind `0.25` multiplier remains unchanged.

OpenSpec change: `openspec/changes/grind-followup-fixes/`.

Verification: frontend build passed; API build passed; `node apps/api/test-grind-corrections.js` passed; `openspec validate grind-followup-fixes --strict` passed; `git diff --check` passed. Live browser smoke and full local-stack integration remain pending because the backend stack was not running during this session.
- `openspec validate grind-corrections-realtime-progression --strict`: passed in final verification.
- `git diff --check`: passed in final verification.
- No production deployment performed.

### Pending verification
- Full live Grind smoke test against a running local stack: encounter search → Town click, active battle → Town click, potion consumption, drops, Character HP/regen, critical logs, and William Bread sale.
- Dedicated frontend automated tests/smoke coverage for tooltip, Town-return feedback, session drops, and Character/Inventory realtime presentation.

### Latest follow-up — Grind sync/tooltips/Town (2026-10-01)

- Item hintboxes now filter metadata by item type: consumables omit vendor/stack metadata and render effects as human-readable text; monster parts omit crafting/vendor/stack/drop-source metadata; equipped Character tooltip layout was corrected so each field is readable on its own line.
- Town return is now a server-authoritative deferred request: clicking Town during an active battle records returnToTownAfterBattle, cancels future queued battles, lets the current battle finish, then transitions to Town before publishing the next queue state. Entering a map clears the pending request.
- Character, Inventory, and Battle frontend loads now use request sequencing so stale HTTP responses cannot overwrite newer authoritative websocket state. This addresses HP/SP reverting during encounter search and inventory quantities briefly showing stale values during battle transitions.
- Added migration 1770300000000-ReturnToTownAfterBattle.


### Latest follow-up — Character equipment presentation and Town transition (2026-10-01)

- Character quick equipment slots now show icons only: empty slots use the default white slot icons, while equipped items keep their original item icon colors. Equipment names remain available in the instant tooltip only, with Tier 2/3/4/5 title colors matching the inventory tooltip.
- Fixed deferred Town return publication ordering: the server now transitions the character to Town before emitting `battle:resolved`, so the realtime `characterAfter.status` is `town`. This prevents the right panel from briefly showing the nonexistent `NO BATTLE QUEUED` state after the final battle.
- Grind right-panel fallback was changed to `SEARCHING FOR MONSTER`; Town remains the Town/Vendor panel whenever the character has no current map.

Verification: API build passed; frontend build passed with existing non-blocking CSS budget warnings; Grind correction checks passed; OpenSpec strict validation passed; `git diff --check` passed. No live browser smoke was run and no production deployment was performed.


### Latest follow-up — Town hardening / no-limbo invariant (2026-10-01)

- Town return is now driven by the server response (`deferred` plus authoritative battle id) rather than frontend timing inference.
- A failed cleanup of future queue entries no longer rejects an otherwise valid Town request; the persistent `returnToTownAfterBattle` flag is saved first and the resolving battle performs the final Town transition.
- A `grinding` character with a map and an empty queue is now repaired by the authoritative `/battles/queue` read path, preventing the UI from remaining in a fake `SEARCHING FOR MONSTER` idle state.

Verification: API build passed; frontend build passed with existing non-blocking CSS budget warnings; Grind correction checks passed; OpenSpec strict validation passed. Live browser smoke remains pending. No production deployment.


### Latest follow-up — Town response/state convergence (2026-10-01)

- `/maps/leave` now returns the authoritative Character status/map state along with whether the return is deferred. The frontend applies that response immediately instead of waiting for a later `/characters` race.
- Deferred Town returns now poll authoritative Character state until `town` (or no current map), so a delayed/missed Socket.IO `battle:resolved` event cannot leave the client on a map with an empty queue.
- The Town control is idempotent for an already mapless character and locally converges to Town before refreshing battle state.

Verification pending final API/frontend builds and OpenSpec validation. No production deployment.


### Latest follow-up — Food exhaustion / Town invariant (2026-10-01)

- Restored the original Grind invariant for hunger: when a battle resolves without a valid active food buff, the authoritative server moves the character to Town, discards unresolved Grind encounters, and publishes an empty Town queue state.
- Queue reconstruction now also repairs a no-food/non-active-battle state by moving the character to Town instead of leaving `status=grinding` with no meaningful encounter.

Verification: final API/frontend builds and OpenSpec validation passed; no production deployment.

### Latest follow-up — Authoritative Character/Inventory realtime synchronization (2026-10-01)

- Root cause: the previous loadSeq/request-ordering strategy only ordered HTTP responses within a store. It did not establish causal ordering between an HTTP snapshot that began before a newer Socket.IO snapshot and the realtime snapshot itself. In parallel, the Character Panel and Inventory presentation still projected HP/SP and item quantities from battle-log timing/events, so entering the next battle.active() state could temporarily select an older snapshot.
- The authoritative source is now the persisted Character state plus the complete Inventory snapshot emitted by battle:resolved. Character has a TypeORM VersionColumn (stateVersion) used as a monotonic server revision; the resolver saves Character after inventory/drop mutations and publishes Character + Inventory from that completed state.
- Frontend CharacterStore and InventoryStore now maintain both a realtime revision and a realtime generation. HTTP loads capture the generation and are discarded if a newer realtime update arrives while they are in flight; snapshots with an older/equal server revision are ignored. Inventory REST reads also carry the Character state revision for stale-snapshot rejection.
- Persisted Character HP/SP and Inventory quantities remain authoritative outside an active battle. During an ACTIVE battle, Character Summary uses only a transient read-only projection of the immutable queued battle log/timestamps for visual combat progress; it never writes that projection into authoritative stores.
- Added deterministic frontend regressions covering old Character HTTP after realtime, old Inventory HTTP after realtime, older realtime snapshots, newer realtime snapshots, and the battle-resolved -> searching -> next-update inventory progression. The focused suite passes 4/4.
- Extended apps/api/test-battle-gateway.js to assert the new authoritative battle:resolved snapshot and the post-resolution queue advance. This live smoke could not run in this session because no local API was listening at http://localhost:3010.
- Verification: shared build passed; API build passed; frontend build passed with existing non-blocking CSS budget warnings; focused realtime frontend tests passed 4/4; full frontend suite had 6/7 passing with only the pre-existing AppComponent should render title assertion failing; OpenSpec strict validation passed; git diff --check passed.
- No production deployment performed.


### Latest follow-up — Final grind synchronization cleanup / failure-mode documentation (2026-10-01)

The Character/Inventory synchronization fix is now finalized. The important implementation detail is that there are **two different responsibilities** in the frontend and they must not be conflated:

- `CharacterStore` / `InventoryStore` are the authoritative persisted-resource state. `Character.stateVersion` is the server revision. Stores reject stale HTTP responses using request sequence + realtime generation, and reject realtime snapshots at an equal/older revision.
- During an actually ACTIVE battle, `CharacterSummary` still needs a visual HP/SP projection so the bars/totals follow the precomputed battle log tick-by-tick. `BattleStore.currentBattleCharacterResources()` provides that read-only projection. It does not mutate CharacterStore and is immediately abandoned once the battle is no longer ACTIVE.
- Inventory quantities never use a battle-log projection. They come from `InventoryStore` only.

#### Traps found during the investigation

1. **`loadSeq` is not causal synchronization.** It only orders HTTP responses within a store. An HTTP request that started before a realtime update can still arrive after it; without a realtime generation/revision barrier, the old payload can overwrite the new state.
2. **Removing the active-battle projection completely freezes the Character Panel.** The server persists HP/SP at battle resolution; it does not stream every combat tick as Character state. Therefore active-battle visual HP/SP must remain a presentation projection, while the persisted store stays authoritative for transitions/search/Town.
3. **`battle:resolved` and `battle:queueUpdated` do not have a guaranteed delivery order.** They are published through separate Redis pub/sub channels and forwarded independently by the gateway. `queueUpdated` can therefore put the client into SEARCHING before `battle:resolved` arrives. The final fix attaches the same Character + Inventory snapshot and `stateRevision` to the post-resolution `battle:queueUpdated`, so either event safely converges the client.
4. **The revision must represent the complete post-resolution resource state.** Inventory drops/consumption are applied separately from Character persistence. The resolver therefore saves Character again after inventory mutations before publishing the final snapshot, advancing `stateVersion` only after the combined Character + Inventory state is ready to expose.
5. **TypeORM `VersionColumn` + schema synchronization needs an explicit default on an existing table.** Adding a non-null version column without `DEFAULT 1` caused API startup to fail because existing `characters` rows contained NULL. The entity and migration now both initialize `stateVersion` to `1`.
6. **`GET /inventory` needed its revision metadata.** Returning only the item array left the client unable to determine whether an HTTP inventory response belonged to an older Character state. It now returns `{ items, stateVersion }`.

#### Final realtime contract

`battle:resolved` carries `entryId`, reward data, `stateRevision`, full `characterAfter`, and complete `inventoryAfter`. The **post-resolution** `battle:queueUpdated` carries the same snapshot and revision plus the new queue. Ordinary queue updates (for example initial map entry) may still contain only `entries`.

This intentionally duplicates a small amount of realtime payload data. The duplication is a correctness boundary: Redis pub/sub channel order is not treated as an application-level causal guarantee.

#### Cleanup performed

- Kept the causal revision/generation guards because they solve the HTTP-vs-realtime race and future stale realtime payloads.
- Kept the active-battle HP/SP projection because removing it caused the verified frozen-panel regression.
- Removed an unused `Character` parameter from the battle-resolved publisher and consolidated the authoritative snapshot construction into one backend helper instead of maintaining two nearly identical readers.
- Renamed the BattleStore helper from `currentBattleCharacterHp` to `currentBattleCharacterResources` because it supplies both HP and SP.
- Updated SPEC.md, openspec/specs/SPEC.md, ARCHITECTURE.md, and the active OpenSpec change to describe the final contract instead of the failed intermediate model.

#### Final verification

- Focused frontend realtime suite: **5/5 passed** in Chrome Headless, including the regression where `battle:queueUpdated` arrives before the authoritative resolution snapshot.
- Frontend production build: passed; existing component CSS budget warnings remain non-blocking.
- API production build: passed.
- OpenSpec strict validation: passed.
- `git diff --check`: passed.
- No production deployment performed.
- Live API gateway smoke remained unavailable because no local API was listening on `http://localhost:3010`.


### Latest feature — Diet & Auto Feed (2026-10-01)

- Follow-up fix: Father Marcelus' provided bread now uses the canonical server-side food consumption path, so NPC-provided food also enters Diet, updates digestion/level state and activates the same food buff rules.
- Added temporary development-only food QA cheat: `GET /inventory/__dev_7f3a91c2/grant-all-foods`, granting 10 of every food to the most recently updated character. Explicit removal debt is recorded in `SPEC.md`.

- Created OpenSpec change `diet-auto-feed` with proposal, design, spec and implementation tasks. Strict OpenSpec validation passes.
- Character now persists `diet` (up to three ordered food entries), `dietLevels` (per-food level + last digestion boundary) and authoritative `autoFeed`.
- Food consumption is centralized on a transactional backend path with Character/Inventory row locks. The original version shifted the three Diet slots, prevented repeating a food while its prior digestion was active, and described stars as permanent per-food levels capped at ★★★. **Historical wording/semantics superseded on 2026-10-14 by `diet-unique-food-streak-rotation`; implementation of the clarified unique-slot streak behavior is still pending.**
- The shared battle engine now carries tick-based per-food digestion state, so generic `use_item` food actions cannot consume the same food twice while it is still digesting inside the pre-simulated queue.
- Auto Feed is evaluated server-side during battle resolution before a future encounter would cross the food-expiry boundary. When an eligible Diet food exists in Inventory, it is consumed and the unresolved queue is rebuilt from the new authoritative state. No frontend timer/polling decides gameplay continuity.
- Manual food use remains the existing generic consumable action; frontend refreshes authoritative Character + Inventory after manual use.
- Removed `self_hungry` from shared enum/catalogs and runtime references. Food remains available through generic `use_item`; Auto Feed is not a Gambit substitute.
- Character Panel now renders Diet below equipment with three food slots, food placeholder icons, authoritative Diet stars and an Auto Feed switch. Existing tooltip infrastructure is reused.
- Realtime success-path resolution now emits `battle:resolved` and the post-resolution `battle:queueUpdated` from the same final Character + Inventory + Diet revision.
- Added backend/shared regression coverage for digestion legality and generic food-use behavior. Frontend realtime coverage now includes Diet/Auto Feed stale-event ordering.

Verification for this feature:
- Shared build: passed.
- API build: passed.
- Frontend production build: passed; existing component CSS budget warnings remain non-blocking.
- Focused Diet backend test: 2/2 passed.
- Frontend suite: 7/8 passed; the only failure is the pre-existing `AppComponent should render title` assertion expecting `Hello, frontend`.
- Focused frontend realtime suite: 5/5 passed in Chrome Headless, including Diet/Auto Feed out-of-order convergence.
- Strict OpenSpec validation: passed; all 15 existing changes validate.
- git diff --check: passed.
- Live browser smoke for the Diet UI was not completed because the local API is not currently running; no production deployment performed.

### Latest feature — Diet level stat bonus (2026-10-02)

- Implemented Diet level as a real food-stat modifier: each Diet level adds +1 to every regeneration stat the food grants, capped at level 3. Level 0 remains exactly the catalog value; levels 1/2/3 are catalog+1/+2/+3.
- Centralized the formula in shared `effectiveFoodStatValue`, used by manual/Auto Feed consumption, battle-engine `use_item`, battle-resolution reconstruction, and the Diet tooltip.
- Battle snapshots now carry the persisted per-food Diet levels so precomputed battles derive the same level the authoritative resolver will apply.
- Added focused assertions for the formula and engine application. No database migration was required; existing `dietLevels` persistence is reused.
- Verification: shared build passed; API build passed; frontend build passed with the existing non-blocking Angular component CSS-budget/CommonJS warnings; `diet-auto-feed.spec.js` passed 4/4; `openspec validate diet-level-stat-bonus --strict` passed; `git diff --check` passed. No production deployment performed.


### Latest feature — Mobile responsive shell (2026-10-02)

Started and implemented OpenSpec change `mobile-responsive-shell` from the Kilo execution plan `.kilo/plans/1790967686382-mobile-responsive-shell.md`. Before implementation, `STATUS.md`, `SPEC.md`, `openspec/specs/SPEC.md` and `PLAY_WINDOW_SPEC.md` were read. OpenSpec proposal/spec/design/tasks were created and `openspec validate mobile-responsive-shell --strict` passes.

Implemented in this session:
- Added `viewport-fit=cover` and a dedicated mobile branch in PlayComponent, preserving the desktop shell at desktop widths.
- Added mobile routes for Battle, Map, Items, Gambits and Character, plus a /play/grind compatibility route.
- Added ViewportService, TickerService, UiPrefsStore and the initial shared GameFormatService.
- Added MobileShellComponent with fixed header, HP/SP/XP micro-bars, reconnecting indicator, menu surface and five-item bottom navigation.
- Added MobileCharPanelComponent and SheetPanelComponent with 10/50/90% detents, 88px floor, handle-only Pointer Events, snapping and separate Town/Grind localStorage preferences.
- Added MobileItemsComponent with 4x2 equipment presentation, 5x10 inventory and single-tap action sheet for use/equip/sell.
- Added a mobile battle sheet with elapsed battle-log events and Town/NPC presentation.

Verification:
- `pnpm --filter @nanommo/frontend build`: passed. Existing Angular CSS-budget/CommonJS warnings remain non-blocking.
- `pnpm --filter @nanommo/shared build`: passed.
- `pnpm --filter @nanommo/api build`: passed.
- `pnpm exec openspec validate mobile-responsive-shell --strict`: passed.
- `git diff --check`: passed.
- No backend/database/API contract was changed and no production deployment was performed.

Known gaps / traps discovered:
1. The existing four 250ms component timers are still present; TickerService exists but migration was not completed. Do not claim timer consolidation yet.
2. TradeModal and AccountDeleteModal are still embedded in their original parents; mobile Settings currently reuses the music control but not the full account-delete modal extraction.
3. Existing desktop CDK drag/drop bindings still need the single `canDrag()` gate; the mobile shell itself does not depend on drag, but the planned cross-component touch gate is not complete.
4. Mobile Gambit still lacks the planned ▲/▼ controls and explicit mobile CDK disablement.
5. The current Map mobile route reuses the Grind component rather than a dedicated MapBoard-only mobile tab; this is functional reuse, not the final task-23 UX smoke target.
6. No live browser smoke was run in this session because the local backend stack was not running. The mobile behavior therefore still needs real 390x844 and 360x740 browser verification, including safe-area, sheet gestures, route back behavior, and authoritative item actions.
7. The OpenSpec plan remains intentionally unmarked for tasks that are not actually complete; its artifact set is complete and strictly validated, but implementation task checkboxes should be reconciled after the remaining integrations are finished.


### Latest follow-up — Mobile responsive shell completion (2026-10-02)

The mobile shell integration was completed according to the decisions closed during the implementation session. This section supersedes the earlier mobile-shell gap list above.

Implemented/finalized:
- Mobile navigation now uses the exact routes `/play/m/battle`, `/play/m/map`, `/play/m/items`, `/play/m/gambits`, and `/play/m/character`.
- Desktop routes `/play/grind`, `/play/character`, and `/play/gambits` remain on the existing desktop components/chrome. `/play/m/*` redirects to the corresponding desktop route at viewport >=900px, including a reactive redirect when an already-open mobile route crosses the breakpoint.
- `/play/grind` is the mobile Battle alias; Map uses the existing `MapBoard`; Items uses the dedicated mobile Items surface; mobile Gambits loads `GambitEditorComponent` directly; mobile Character shows only Attributes + Mastery.
- Removed global `viewport-fit=cover`; safe-area padding is confined to the mobile shell so desktop/iPad landscape does not inherit a global notch-overlap policy.
- Added the single shared `TickerService` for the four requested 250ms presentation clocks only: CharacterSummary battle display, InventoryGrid, BattleProgress, and GrindInfo. The ticker pauses on `document.hidden` and resumes with an immediate time refresh. `townTimer`, `townPoll`, and LoginMusicService `requestAnimationFrame` were left intact.
- Added the single shared `TradeModalComponent` and `AccountDeleteModalComponent`. Trade keeps the desktop dialog and becomes a bottom-anchored <=90dvh slide-up panel on mobile with the requested readable typography, 48px controls, 8px gaps, numeric input mode, and tracking. Account deletion remains centered, uses 16px confirmation input, 14px copy, 48px buttons, and no bottom-sheet dismissal.
- Added `ActionSheetComponent` as a separate item-action menu. Mobile Items uses one tap; sale opens the existing TradeModal confirmation. Desktop double-click and CDK handlers remain available through the desktop components.
- Added the requested CDK gates in CharacterSummary, InventoryGrid, VendorPanel and GambitEditor via `canDrag()` / `cdkDropListDisabled`; mobile does not depend on drag/drop.
- Mobile Gambits now support tap-to-toggle/greyed rows, touch-sized enable control, ▲/▼ priority movement with priority renormalization, and `inputmode="numeric"` for numeric parameters.
- Mobile Character cockpit now exposes authoritative diet/Auto Feed state and equipment remains visible behind the sheet at the 10% detent; no equipment was added to the Character page.
- Added `BattleLogComponent` with all elapsed events in ascending tick order, scroll preservation, and a new-lines affordance when the user has scrolled away from the bottom.
- Kept the Town sheet on the existing VendorPanel and made vendor stock tappable on touch so the authoritative buy modal opens. The Town 10% sheet exposes the Map CTA.
- Updated the active OpenSpec proposal/design/spec/tasks to match these final decisions; tasks are marked complete except the intentionally skipped browser smoke task.

Verification after final integration:
- Frontend production build: passed. Angular reports existing/non-blocking component CSS-budget and CommonJS warnings; no TypeScript/template build errors remain.
- Shared build: passed.
- API build: passed.
- `pnpm exec openspec validate mobile-responsive-shell --strict`: passed.
- `git diff --check`: passed.
- Browser smoke: intentionally not run, per session decision.
- No backend/database/API contract changes and no production deployment.

Traps to preserve for the next session:
1. Do not reintroduce `/play/gambits` as a mobile route. Mobile Gambits is `/play/m/gambits`; desktop `/play/gambits` remains the existing Character/Gambits chrome.
2. Do not restore global `viewport-fit=cover`; safe-area handling is deliberately localized to mobile shell surfaces.
3. Do not replace `townTimer`, `townPoll`, or LoginMusicService `requestAnimationFrame` with TickerService; they serve different timing/network responsibilities.
4. Do not re-enable CDK drag on coarse/touch pointers. `canDrag()` is the single cross-component gate.
5. The mobile Battle surface currently reuses the existing Grind component inside the mobile shell because the repository does not have a separate BattleCockpitComponent; do not invent new battle gameplay logic to change that.
6. The frontend still has the pre-existing Angular component CSS-budget/CommonJS warnings shown by the build; they are warnings, not validation failures.


### Latest feature — Town NPCs: Blacksmith Loren, Cecilia, Father Marcelus heal (2026-10-04)

Implemented OpenSpec change `town-npcs-loren-cecilia-father-heal`.

- Added **Blacksmith Loren** as a data-driven Town vendor with the nine canonical T1 equipment pieces: sword, greatsword, dagger, bow, staff, wand, shield, physical body armor and magic body armor. Stock is infinite and uses existing item pricing fields; greeting is data-driven.
- Added **Cecilia** as a quest NPC with the requested dialogue and server-authoritative material exchange: 3 Slime Gel + 1 Golem Core Shard + 1 Viper Fang → 1 Worn Lucky Ring. Conditions are checked from authoritative inventory and the removal/reward transaction is atomic.
- The requested reward id `quip_accessory_sor_t1` did not exist in the canonical item catalog; the implementation uses the existing canonical `equip_accessory_sor_t1` item (Worn Lucky Ring) rather than inventing a new item.
- Updated the generic Town NPC vendor path so William remains backed by `npc_vendor.json`, while catalog vendors such as Loren own their stock in `npc_catalog.json`.
- Vendor greetings are now supplied by NPC data in the frontend instead of hardcoding William's text.
- Speaking to **Father Marcelus** in Town now always restores authoritative HP and SP to their maximums before returning the dialogue state. Existing Marcelus dialogue/food behavior remains unchanged.

Verification:
- `pnpm --filter @nanommo/shared build`: passed.
- `pnpm --filter @nanommo/api build`: passed.
- `pnpm --filter frontend build`: passed; existing Angular CSS-budget/CommonJS warnings remain non-blocking.
- `node apps/api/test/npc-framework.test.js`: 12 assertions passed.
- `node apps/api/test/npc-town-additions.test.js`: 12 assertions passed.
- `pnpm exec openspec validate town-npcs-loren-cecilia-father-heal --strict`: passed.
- `git diff --check`: passed.
- No production deployment performed.


### Latest bugfix — Equipment Stats, Accessory Slots & Realtime Character Sheet (2026-10-04)

Implemented OpenSpec change `equipment-stats-realtime-fixes`.

- Fixed authoritative equipment aggregation so fixed stats and per-instance rolled Attributes are included consistently in Character-derived state.
- Starter `equip_sword_t1` now contributes its canonical +8 ATK to Character Stats; the level-1 starter snapshot is ATK 18 with base attributes at 5.
- Added authoritative Magic ATK to the Character contract and frontend Stats: `floor(INT * 2) + weaponFixedMatk`.
- Fixed generic accessory compatibility: catalog items with `slot: accessory` can be equipped into `accessoryLeft` or `accessoryRight`; Worn Lucky Ring is no longer rejected by the slot check.
- Character DTO now exposes `attributeBonuses`, including fixed equipment Attribute bonuses and instance rolled Attribute bonuses.
- Equipment tooltips now show actual granted stats (fixed + rolled) instead of catalog metadata.
- Character Attributes now have explanatory hover tooltips and render positive non-base contributions in green as `(+N)`.
- Character screen renamed `Derived Stats` to `Stats` and now renders Magic ATK.
- Successful equip/unequip HTTP responses now return authoritative Character + Equipment + Inventory + stateVersion; the frontend applies that snapshot immediately instead of waiting for a second Character GET.
- Successful manual consumable HTTP use now returns the same authoritative Character + Inventory convergence payload, so HP/SP/buff state updates immediately with the inventory mutation.
- Resolved pre-existing conflict markers in the Town Vendor template by preserving the current data-driven NPC greeting behavior.

Verification:
- `pnpm --filter @nanommo/shared build`: passed.
- `pnpm --filter @nanommo/api build`: passed.
- `pnpm --filter frontend build`: passed; existing non-blocking Angular CSS-budget/CommonJS warnings remain.
- `node apps/api/test/equipment-stats-realtime.js`: 5 assertions passed.
- `pnpm exec openspec validate equipment-stats-realtime-fixes --strict`: passed.
- `git diff --check`: passed.
- No production deployment performed.


### Latest follow-up — Town vendor tooltip / first-weapon progression (2026-10-05)

Implemented OpenSpec change `town-vendor-and-grind-entry-fixes`.

- Item tooltip line generation is now centralized in frontend `CatalogService`; Inventory, Character equipment and Vendor stock use the same helper.
- Vendor stock items now render the shared item tooltip, including equipment fixed stats and tier-colored names.
- Blacksmith Loren's seven T1 weapons now cost exactly 2,000 gold each; body armor prices are unchanged.
- Map entry no longer requires a main-hand weapon. Existing email verification, map level and Hungry gates remain authoritative.
- New characters no longer receive or equip `equip_sword_t1`; they start unarmed while retaining the existing starter consumables.
- Weapon-dependent battle skills still require their appropriate equipped weapon; only the map-entry gate changed.
- No production deployment performed.


### Latest bugfix — Diet Auto Feed / retained food streak (2026-10-05)

Implemented OpenSpec change `diet-autofeed-streak-fixes`.

- Fixed Diet streak semantics: Diet stars are now a streak attached to the retained three-slot window, not permanent per-food mastery.
- Expired food entries remain in their Diet slots as transparent/marked history until a later authoritative food consumption shifts them out.
- Consuming a retained expired food increments its streak (0 → 1 → 2 → 3, capped at 3).
- When a food is evicted from the oldest slot, its `dietLevels` record is removed. If that food is eaten again later, it starts at 0 stars.
- Manual and Auto Feed food consumption continue through the same transactional `consumeFood()` path.
- Character DTOs no longer prune expired Diet entries; the frontend visually marks expired entries instead of mutating Diet locally.
- Auto Feed boundary logic remains server-authoritative and now works with retained Diet entries, consuming an eligible configured food before Grind falls into Hungry and rebuilding the future queue afterward.
- Added `apps/api/test/diet-autofeed-streak-fixes.spec.js` with 6 focused assertions covering streak progression, eviction/reset, retained streak preservation and Auto Feed boundary consumption.

Verification:
- `pnpm --filter @nanommo/shared build`: passed.
- `pnpm --filter @nanommo/api build`: passed.
- `pnpm --filter frontend build`: passed; existing Angular CSS-budget/CommonJS warnings remain non-blocking.
- `node apps/api/test/diet-autofeed-streak-fixes.spec.js`: 6 assertions passed.
- `pnpm exec openspec validate diet-autofeed-streak-fixes --strict`: passed.
- `git diff --check`: passed.
- No production deployment performed.


### Latest follow-up — Food tooltip concrete stats (2026-10-05)

Implemented OpenSpec change `food-tooltip-stats`.

- The shared `CatalogService.itemTooltipLines()` / `formatItemEffect()` path now formats `food_buff` effects with the concrete configured values instead of the generic `Regenerates HP/SP` text.
- Food tooltips now show each non-zero stat, e.g. `HP Regen: +4 / 10 ticks`, `SP Regen: +1 / 10 ticks`, plus duration.
- Because Vendor, Inventory and other catalog-backed item panels use the same formatter, the correction applies consistently without panel-specific tooltip implementations.
- No food gameplay formulas or buff behavior were changed.

Verification:
- `pnpm exec openspec validate food-tooltip-stats --strict`: passed.
- `pnpm --filter frontend build`: passed; existing non-blocking Angular CSS-budget/CommonJS warnings remain.
- `git diff --check`: passed.


### Latest QA cheat fix — /reset-diet finishes digestion only (2026-10-05)

Implemented OpenSpec change `reset-diet-finishes-digestion`.

- `GET /inventory/__dev_7f3a91c2/reset-diet` no longer wipes the Diet configuration.
- It preserves all retained Diet slots, each entry's `dietLevel`, the `dietLevels` map, and the Auto Feed setting.
- It only moves each retained food's `digestUntil` to the current time and clears the active food buff, making the character hungry and ready to consume again.
- Pending queued food-use events are still stripped so a previously queued battle cannot immediately resurrect the food digestion/buff state.
- This allows the intended QA loop: eat food → `/upgrade-diet` → `/reset-diet` → eat the retained food again or another food → observe streak/eviction behavior.

Verification:
- `pnpm exec openspec validate reset-diet-finishes-digestion --strict`: passed.
- `pnpm --filter @nanommo/api build`: passed.
- `git diff --check`: passed.
- No production deployment performed.


## Grind layout and tooltip correction — 2026-10-05

- Continued OpenSpec change `play-ui-scale-layout`.
- Fixed the Grind inventory 5×10 grid so intrinsic square rows no longer stretch vertically from the flex layout; Active Gambit stays at the top and Inventory at the bottom with a dedicated middle area.
- Added local-only Hunting / Defensive / Fleeing mode icons using `hunting.svg`, `defensive.svg`, and `fleeing.svg`; Hunting is highlighted by default. No backend behavior is attached yet.
- Removed Inventory panel padding so its usable width matches the Active Gambit control.
- Reworked shared item tooltips to use a document-level floating clone, independent of the originating container, with maximum stacking order and cursor-aware left/right + above/below placement.
- Tooltip content now has 10px padding, intrinsic height, no internal clipping/scrollbar and viewport-safe width/wrapping, so it does not push Diet/Inventory/Vendor layout or get clipped by parent containers.
- Preserved the centralized `CatalogService.itemTooltipLines()` content path and existing tier colors.
- Verification passed:
  - `pnpm --filter @nanommo/frontend build` (existing non-blocking CSS-budget/CommonJS warnings remain)
  - `pnpm exec openspec validate play-ui-scale-layout --strict`
  - `git diff --check`
- No production deployment performed.


## Equipment hand-swap fix — 2026-10-05

- Implemented OpenSpec change `two-handed-offhand-swap`.
- Equipping an offHand item while a two-handed weapon is equipped now moves the two-handed weapon to inventory and leaves mainHand empty.
- Equipping a two-handed weapon now moves any offHand item to inventory and leaves offHand empty.
- The same rule applies to staged equipment changes during Grind; pending `null` changes now mean authoritative desequip-and-return-to-inventory.
- Existing valid one-handed combinations remain unchanged.
- Verification passed:
  - `pnpm exec openspec validate two-handed-offhand-swap --strict`
  - `pnpm --filter @nanommo/api build`
  - `node apps/api/test/equipment-hand-swaps.js` — 12 assertions passed
  - `git diff --check`
- No production deployment performed.


## Session closeout — Character UI follow-up prepared (2026-10-05)

Prepared OpenSpec change character-ui-scale-layout for the next session. The proposal is grounded in the Grind UI scaling/layout work and records the traps discovered during implementation.

Key handoff rules:
- Character Inventory must reuse the existing InventoryGrid and current item/tooltip path; do not fork item rendering for the Character page.
- Desktop enlargement is implemented with explicit CSS sizing, never browser zoom or transform scaling.
- The three Character central panels (Inventory / Attributes / Stats), Gambit editor, and Mastery/Weapons panels must respect the existing shell fixed-height/bottom-alignment invariant.
- Gambit typography is enlarged without sacrificing one-line condition+parameter and action+parameter rows; do not hide wrapping with overflow or shrink the requested font scale.
- The selected Gambit page is represented by an 8px solid green border instead of the textual ACTIVE marker; action buttons belong semantically inside page-meta.
- Do not reintroduce the former MutationObserver tooltip implementation: it caused severe Firefox CPU/UI freezes. The current document-level floating tooltip clone using pointer events is the stable implementation.
- Mobile remains a separate responsive composition; desktop scale selectors must be scoped so they do not leak into mobile.
- SPEC.md was not changed for this handoff because the requested work is visual/layout-only and introduces no gameplay/API contract.

Next-session OpenSpec: openspec/changes/character-ui-scale-layout/.

Validation note: the new OpenSpec artifacts were created at session close. Implementation is intentionally deferred to the next session.

## Character/Gambit/right-panel UI follow-up — 2026-10-06

Finalized the follow-up corrections to `character-ui-scale-layout` and the contextual right-panel typography.

- Gambit selected-page border was reduced from 8px to 2px while retaining the solid green active-state treatment.
- Empty Gambit pages no longer collapse the editor area: the `app-gambit-editor` host is explicitly block-level and full-width inside the Character Gambit panel.
- Gambit line controls were restructured so the enable/disable switch sits below the remove button in a dedicated vertical `line-tools` column; this keeps the toggle from increasing the main condition/action row footprint.
- Previously enlarged Character, Gambit and Mastery typography was reduced by approximately 10% after visual review; the sheet-header character name remains excluded from the scaling rule.
- Right-panel event log text was increased by approximately 30% (`16px` → `21px`).
- Quest NPC dialogue `.quest-text` was doubled (`11px` → `22px`). Quest choice-button sizing was intentionally left unchanged.

Validation after the final UI corrections:
- `git diff --check`: passed.
- `pnpm --filter @nanommo/frontend build`: passed; only existing/non-blocking Angular CSS-budget and CommonJS warnings remain.
- No backend/gameplay/API contract was changed.
- No production deployment performed.
- Live backend/browser smoke was not claimed where unavailable.

Documentation decision: `SPEC.md`, `ARCHITECTURE.md`, and `PLAY_WINDOW_SPEC.md` require no changes for this follow-up because these edits only refine presentation/typography and preserve the existing server-authoritative contracts and UI architecture.

## Google OAuth authentication — 2026-10-06

Implemented OpenSpec change google-oauth-authentication.

- Added backend-mediated Google OIDC Authorization Code flow using google-auth-library, cryptographic state, PKCE S256, server-side ID-token validation, and Redis-backed ephemeral OAuth state.
- Added /auth/google, /auth/google/callback, and one-time /auth/google/redeem handoff exchange. NanoMMO JWT/refresh tokens are never placed in the Google callback URL.
- Google identity is keyed by provider=google + Google OIDC sub; a matching local email is rejected with explicit local-login guidance instead of automatic account merging.
- First-time Google users are created without a password and without a Character; existing Character routing remains authoritative. Google verified email is accepted as verified.
- Added Continue com Google to Login and Register plus /auth/google/callback.
- User.passwordHash is now nullable for OAuth accounts; migration 1793000000000-GoogleOAuth added.
- Added Google OAuth variables to .env.example; no Google secret was added to .env or frontend source.

Verification:
- pnpm exec openspec validate google-oauth-authentication --strict: passed.
- pnpm --filter @nanommo/shared build: passed.
- pnpm --filter @nanommo/api build: passed.
- pnpm --filter frontend build: passed; existing non-blocking CSS-budget/CommonJS warnings remain.
- git diff --check: passed.
- Real Google login smoke test remains pending manual Google Cloud Console configuration and credentials.
- No production deployment performed.

### Latest feature — battle-logs-page (2026-10-07)

Implemented the authenticated Battle Logs page using the existing resolved BattleQueueEntry audit trail. The backend now exposes newest-first resolved battle summaries and an ownership-scoped detail endpoint for the persisted full log; no second history table or combat simulation was introduced.

The frontend adds /play/battle-logs to the existing Play shell, including a one-row-per-battle history with result, enemy, enemy level, map and date/time, plus a near-full-height modal with a scrollable chronological human-readable combat feed. The page follows the existing center-panel geometry and floor alignment with the left/right panels.

Verification passed: strict OpenSpec validation, git diff --check, shared build, API build and frontend build. The frontend reports the existing CSS budget/CommonJS warnings plus a 508-byte CSS-budget warning for the new Battle Logs stylesheet; all are non-fatal. No production deployment was performed.


### Battle Logs production build follow-up — 2026-10-07

The deployment command initially failed because `gambit-editor.component.css` exceeded the production `anyComponentStyle` maximum-error budget by 73 bytes (5.19 kB vs 5.12 kB). This was unrelated to the Battle Logs implementation; the new Battle Logs stylesheet was only a non-fatal warning.

Fixed by removing duplicated responsive CSS rules from the Gambit editor's max-600px media query; the existing max-899px rules already provide the same behavior. The production budget is now met exactly at 5.12 kB.

Final verification:
- Exact deployment command `pnpm --filter @nanommo/shared build && node scripts/set-env.js && pnpm --filter @nanommo/frontend build --configuration production`: passed, exit code 0.
- `pnpm exec openspec validate battle-logs-page --strict`: passed.
- `git diff --check`: passed.
- `pnpm -r build`: passed for shared, frontend, and API.
- Remaining Angular CSS-budget messages are warnings only; no production build error remains.
- No production deployment performed.


### Latest session — `town-canonical-map-unification` (2026-10-08)

Unified the Grind Board around the already-established canonical `map_town` Town location.

#### Implemented
- The backend/frontend canonical catalogs already contained exactly one Town entry; no duplicate catalog object was introduced.
- The dedicated Board Town node now explicitly represents the canonical `map_town` entry.
- Generic `map` rendering now excludes `isTown` entries (and defensively excludes `map_town`), eliminating the second visible Town node and the erroneous `POST /maps/map_town/enter` path.
- Town remains non-grindable and continues to use the authoritative `/maps/leave` transition path.
- `getRecommendedMaps()` also excludes Town, keeping `map_town` out of grind/recommended map targets.
- `leaveMap()` is idempotent for an already-settled `map_town` character and never performs grind queue cleanup or encounter-sequence reset against Town.
- Town NPC/Vendor reads and interactions now require `currentMapId = map_town`, `pendingMapTransition = null`, and the existing `status = town` consistency state. A stale `status = town` alone no longer grants Town access.
- Repository-wide reference search proved `TownCenter` was unused; its declaration and unused template/style files were removed. No `/play/town` route or replacement Town screen was introduced.
- Reusable regression coverage was added for the single Town catalog/node invariant and already-in-Town no-op behavior; existing Vendor/NPC service tests were updated for the canonical location contract.
- Before this change was implemented, the unrelated prior-session commit `808c356` was reverted with `8fe25af` so the working state was restored to its pre-session baseline.

#### Verification
- `pnpm --filter @nanommo/shared build`: passed.
- `pnpm --filter @nanommo/api build`: passed.
- `pnpm --filter @nanommo/frontend build --configuration production`: passed; existing CSS-budget/CommonJS warnings remain non-blocking.
- `node apps/api/test/town-canonical-map-unification.test.js`: passed, 17 assertions.
- `node apps/api/test/map-leave-town-idempotency.test.js`: passed, 3 assertions.
- `node apps/api/test/town-vendor.service.test.js`: passed, 11 assertions.
- `node apps/api/test/npc-town-additions.test.js`: passed, 14 assertions.
- `node apps/frontend/smoke-town-map-ui.js`: passed.
- `node apps/frontend/smoke-vendor-ui.js`: not completed; after reaching the real frontend it became blocked during the pre-existing Vendor drag/drop portion, so no pass is claimed for that full script.
- No live authenticated API/database smoke was possible because the backend stack was not running locally.
- No production deployment performed.

### Latest session — `town-as-map-and-generic-transition` (2026-10-08)

Implemented the OpenSpec change making Town a first-class gameplay map and replacing the battle-specific deferred Town flag with a generic pending map transition.

#### Implemented
- Canonical `TOWN_MAP_ID = 'map_town'`; Character `currentMapId` is non-nullable and Town is persisted as `map_town`.
- Added `pendingMapTransition` JSONB with destination/reason; production code no longer reads/writes `returnToTownAfterBattle`.
- Added `map_town` to the canonical map catalog and frontend mirror with `isTown: true`; Town remains excluded from normal grind entry/recommendations and has no monster pool.
- Added a reversible migration that converts legacy Town NULLs and deferred-return flags before dropping the legacy column.
- Generic map presence now uses `currentMapId` + no pending transition, so Town residents count in Town independently of `status`. Encounter-search population remains explicitly grinder-only.
- Added internal Redis map-membership transition publication; the gateway moves connected sockets between map rooms for REST/battle-driven transitions and emits the existing absolute `map:presence` payload.
- Immediate Town, deferred Town, death and hunger exits now persist `map_town` and synchronize presence.
- Frontend Character location is required and Town detection no longer interprets null/undefined as Town.

#### Verification
- `pnpm --filter @nanommo/shared build`: passed.
- `pnpm --filter @nanommo/api build`: passed.
- `pnpm --filter @nanommo/frontend build`: passed; existing Angular CSS-budget/CommonJS warnings remain non-blocking.
- `node apps/api/test/map-presence.test.js`: passed, 12 assertions.
- `node apps/api/test/map-presence-cleanup.test.js`: passed.
- `node apps/api/test/encounter-search.test.js`: passed, 5 assertions.
- No production deployment performed.

#### Architectural traps / lessons
- `status` is activity state, not physical location. Never use it to decide generic map membership.
- `map_town` is a real map ID even though it is not a grind map; do not reintroduce null/undefined as a Town sentinel.
- `pendingMapTransition` means the character is temporarily not a member of its current map; presence must not inspect the transition reason.
- Encounter-search load and generic map population are intentionally different predicates.
- REST/battle-driven location changes must publish an internal membership transition so connected sockets follow authoritative room membership; frontend polling is not the transport mechanism.


### Follow-up fix — migration ordering

A startup failure exposed that TypeORM had `synchronize: true` in development. TypeORM schema synchronization runs before migrations, so it attempted to enforce `currentMapId NOT NULL` while legacy rows still contained NULL. Schema management is now migration-driven: `synchronize: false` and `migrationsRun: true`. The Town migration itself already normalizes every legacy `currentMapId IS NULL` row to `map_town` before applying NOT NULL.


## Battle duration-limit removal — 2026-10-09

Investigated the battle-duration rule against `SPEC.md`, `openspec/specs/SPEC.md`, and the shared battle engine. The intended specification already said a battle runs until a combatant reaches 0 HP, but `BattleEngine` contained an undocumented `MAX_TICKS = 200` safety valve. `simulateBattle()` stopped at that tick count and its fallback outcome expression classified any result that was not a character-survived monster kill as `loss`; therefore, if both combatants still had HP at tick 200, the character was falsely defeated and routed through the normal death path.

Removed `MAX_TICKS`, the `maxTicks` option, and the tick cutoff from the simulation loop. The engine now continues while both combatants have HP. `durationTicks` still records the actual simulated duration, so the existing queue scheduling continues to derive `endAt` from the real result. Root `SPEC.md` and `openspec/specs/SPEC.md` now explicitly prohibit duration-based defeats; `FLEE` remains a future, unimplemented termination condition. Added OpenSpec change `battle-no-duration-limit` and regression assertions that the battle continues past 200 ticks and resolves as a win only when the monster is defeated.

Likely reason for the original cap (inference, not a documented gameplay decision): the code comment explicitly called it a safety valve to prevent a stalemate from hanging queue generation. That technical safeguard was implemented as a gameplay defeat, which conflicts with the authoritative rule. A genuine invalid/no-action stalemate must not be silently converted into a character death; this change does not introduce a replacement artificial outcome.

Verification: `pnpm --filter @nanommo/shared build` passed; `pnpm --filter @nanommo/api build` passed; `pnpm --filter @nanommo/api exec jest --runInBand --runTestsByPath test/direct-damage-variance.spec.js` passed (4 tests, including the >200-tick battle regression); `pnpm exec openspec validate battle-no-duration-limit --strict` passed; `git diff --check` passed. A first validation attempt correctly flagged the new capability delta as `MODIFIED` against a nonexistent granular spec; changed it to `ADDED` and strict validation then passed. No production deployment.


## Grind food-expiry early-exit regression — 2026-10-10

Investigated the report that Sauro returned to Town roughly two minutes before the active bread buff should have expired. The provided logs show successful battle outcomes, a queue update reaching zero, and later Socket.IO disconnect/reconnect events; they do not include the authoritative `activeFoodBuff.expiresAt` or a transition call stack, so the logs alone do not prove which exact production invocation caused the exit.

### Confirmed code defect and correction

A deterministic service regression proved the suspected `BattleService.queueBattles()` branch. `projectFoodFromQueue()` cleared its projected food buff when an unresolved future battle ended after the expiry timestamp. If no battle was active at the current instant, the method treated that projected null buff as actual hunger and persisted `currentMapId = map_town` / `status = town`, synchronized map presence, discarded the unresolved queue and published an empty queue—even though the persisted active food was still valid now. The new regression failed before the fix with `actual: 'town', expected: 'grinding'`.

The correction separates projected queue food from current persisted food: future projection alone cannot route a character to Town while the authoritative food expiry remains in the future. Queue generation now checks the food boundary against the actual encounter start after the encounter-search delay. If no battle can legally start before a still-future expiry and there is no queued battle whose resolver will revisit the state, the server schedules the existing `queue-battles` worker at the exact food expiry instead of adding an illegal battle or relying on a browser timer. At actual exhaustion, the existing Auto Feed path is attempted before Town fallback; a successful feed invalidates stale future projections and rebuilds the queue.

### Verification

- `pnpm --filter @nanommo/api build`: passed.
- `node apps/api/test/grind-food-expiry-exit-regression.test.js`: passed; covers 2-minute, 1-minute, 5-second and 1-second positive food durations, a future battle crossing expiry, preserving an active battle, encounter-search delay crossing expiry, Auto Feed success/no-eligible-food branches, and Town/presence behavior after actual expiry.
- Pre-fix regression run: failed as expected because queue generation changed the character to Town while food remained valid.
- `node apps/api/test/diet-autofeed-streak-fixes.spec.js`: passed.
- `pnpm --filter @nanommo/api exec jest --runInBand --runTestsByPath test/diet-auto-feed.spec.js`: passed (3 tests).
- `node apps/api/test/map-leave-town-idempotency.test.js`: passed (3 assertions).
- `node apps/api/test/encounter-search.test.js`: passed (5 assertions).
- `git diff --check`: passed.
- `pnpm exec openspec validate grind-food-expiry-exit-regression --strict`: passed.
- `node apps/api/test/map-presence-cleanup.test.js`: still fails in its existing direct `handleCharacterDeath()` test because the harness does not supply the now-required transaction `manager` (`Cannot read properties of undefined (reading 'getRepository')`). This failure is outside the changed food-expiry branch; no unrelated test/harness change was made to hide it.
- No production deployment or live production mutation performed.

### Hand equipment and Mastery implementation — 2026-10-13

Implemented the foundational hand/Mastery slice for `hand-equipment-mastery-skills`:

- Added catalogue-driven hand validation using `slot`, `twoHanded`, and explicit Dagger same-type pairing metadata. Sword + Sword is rejected; Daggers can occupy either hand; every secondary item requires a one-handed primary; two-handed equips clear a conflicting secondary item.
- Secondary weapon ATK now contributes at 50%; other off-hand stats remain full. Bow tiers carry -75/-74/-73 Accuracy modifiers, and the shared formula remains Precision `79 + floor(DEX/3) + modifiers` and Evasion `99 + floor(AGI/3) + modifiers`.
- Renamed active Wand identifiers, labels, data and icon paths to Rod; Rod remains a one-handed primary. Added explicit right/left dominant-hand creation choice and persistence field.
- Added the eight zero-level Mastery categories and a migration that adds handedness/known-item columns, seeds William's item IDs, resets legacy proficiency progress, clears legacy Gambit actions while preserving page rows, and renames persisted Wand item references. Migration code was reviewed and compiled, but was not run against a database.
- Added environment-configured Mastery XP defaults and deterministic reward calculation from the immutable battle equipment/action log, committed under `BattleService.resolveBattle()`'s existing locked transaction. BattleService remains the only owner of queue invalidation; active entries/jobs remain preserved while future entries are discarded after a supported equipment mutation.
- Synchronized `SPEC.md` and `openspec/specs/SPEC.md`; updated `ARCHITECTURE.md` with reward, snapshot, movement ownership and 5v5 roadmap details.

Verification run:

- Shared, API, and production frontend builds passed. Frontend reported existing CSS budget and CommonJS warnings; no build errors.
- `node apps/api/test/hand-equipment-mastery-contract.js` passed hand compatibility, secondary ATK, Rune tiers/slot, Bow Accuracy, baseline Accuracy, XP defaults/overrides/rejection, action XP/miss/self-target behavior, and active queue/job preservation assertions. Its Gateway mock was corrected after this summary was first recorded.
- `node apps/api/test/equipment-hand-swaps.js` passed (12 legacy assertions plus added secondary Dagger equip and Sword+Sword rejection cases).
- `node apps/api/test/known-item-acquisition.test.js` passed (4 assertions) for the new shared grant-knowledge hook and idempotent first acquisition.
- `node apps/api/test/battle-distance-movement.test.js` passed.
- `openspec validate hand-equipment-mastery-skills --strict` passed; `git diff --check` passed.
- The queue-invalidation API integration script could not run because no backend was available at `localhost:3010`. No database was started, migrations were not executed, no browser visual verification was performed, and no production deployment was performed.

Historical note: this paragraph described the first foundational Mastery slice and is superseded by the progression/effect implementation below. The current remaining work is transactional retry/duplicate reward integration, broader per-skill gate and SP/cooldown no-action tests, migration row-preservation integration, visual/browser verification, DEX sign-off, and live-combat pacing review for the intentionally steep provisional threshold table.

**Open blocker:** do not resolve the documented DEX milestone discrepancy by special case. The selected formula gives Precision 79 at total DEX 225 with a T1 Bow and 80 at DEX 228. No authoritative repository decision changes this; tasks requiring a final milestone/balance decision remain unchecked. No live database or deployment was touched.

#### Continued implementation follow-up — 2026-10-13

- Restored the full root `SPEC.md` from its original tracked content and reapplied targeted hand/Mastery edits without deleting unrelated inventory, economy, authentication, gateway, frontend, infra, and test-design sections. Updated the contents list and replaced the obsolete equipment counts/49-skill legacy references. `SPEC.md` and `openspec/specs/SPEC.md` are identical (1,344 lines).
- Fixed server equip slot validation so catalogue entries with `secondaryHand: true` (Dagger) can be equipped in `offHand`; the front-end drop-target/highlight predicate accepts the same catalogue metadata. Added a service regression for Sword + Dagger secondary equip and Sword + Sword rejection.
- Fixed the Wand-to-Rod migration's JSON column names: `inventory_items` / `equipped_items` use `instanceData`, while Mail/Market use `itemInstanceData`. The migration was compiled/reviewed only; it remains unexecuted.
- At this point in the work, battle snapshots already required an allocated Mastery rank and the matching equipped category, and Gambit choices were limited to learned active skills. The later Mastery progression follow-up below adds level promotion and the named active/passive/positional effect execution; exhaustive equipment/SP/cooldown gate coverage remains open.
- Added off-hand effective ATK to the existing central item-tooltip path (original value struck through and half-value shown). Added line-level Gambit warnings and the conditional active-title warning/navigation when a learned active skill's required weapon is unequipped; responsive/browser visual behavior remains unverified.
- Added an idempotent first-acquisition known-item hook to regular `InventoryService.addItem` grants, and handled battle drops in the existing battle transaction without overwriting the loaded Character state. This does not yet prove every conceivable item-grant path has been covered by integration tests.

Additional verification after these follow-ups:
- `node apps/api/test/hand-equipment-mastery-contract.js`: passed without the earlier Gateway mock warning.
- `node apps/api/test/equipment-hand-swaps.js`: passed, including the added off-hand Dagger / Sword + Sword cases.
- `node apps/api/test/known-item-acquisition.test.js`: passed (4 assertions).
- `node apps/api/test/battle-distance-movement.test.js`: passed.
- `pnpm --filter @nanommo/shared build` and `pnpm --filter @nanommo/api build`: passed.
- `pnpm --filter @nanommo/frontend build`: passed after trimming nonessential CSS to stay under the strict Gambit stylesheet budget. Existing CSS budget warnings and the CommonJS warning remain non-blocking.
- `npx openspec validate hand-equipment-mastery-skills --strict`, `git diff --check`, and the SPEC mirror comparison: passed.

Historical snapshot: the following Mastery progression and rank resolution follow-up supersedes the earlier “thresholds/level promotion and positional simulator” items. Remaining gaps are retry/idempotency integration for Mastery XP, comprehensive equipment/SP/cooldown gate tests, migration preservation integration, visual/browser checks, the DEX decision, and live-combat pacing review. No special case was added; no database/migration execution or production deployment was performed.

#### Mastery progression and rank resolution follow-up — 2026-10-13

- Added the shared cumulative Mastery XP thresholds (levels 1–10: 5, 10, 25, 50, 100, 500, 25,000, 35,000, 45,000, 60,000 XP), a shared rank-scaled skill resolver, and level derivation capped at 10. `BattleService.applyMasteryRewards()` now updates XP and derived level in the existing battle-resolution transaction.
- Added a deterministic pacing harness using `char_xp_curve.json` cumulative XP and catalog monster XP/HP. Its transparent equal-level attack-count proxy applies the production per-kill `floor(xpReward × 0.25)` Grind payout and estimates 148 XP at L23 for two-handed, 115 XP per one-handed category at L28, and 61,968 two-handed / 30,984 per one-handed category around L50. It asserts L23 M5, both L28 categories M5, L50 two-handed M10, and both L50 one-handed categories M7 at equal XP. This creates a steep late-game threshold gap; it is provisional proxy calibration, not live-gameplay proof, and needs combat-stat/live-play balance review.
- Documented the thresholds and calibration method in root `SPEC.md`; synchronized `openspec/specs/SPEC.md` byte-for-byte. Marked tasks 5.2, 6.1, 6.2 and 6.5 complete based on direct pacing, allocation-service, catalog, and simulator coverage. DEX milestone discrepancy remains open and has no special-case logic.
- Corrected the migration to preserve existing `dominantHand` and non-empty `knownItemIds`; starter item knowledge is seeded only where the list is empty. Migration remains unexecuted. Entity field audit confirmed JSON column names for inventory/equipment and mail/market.
- Canonical and frontend skill catalogs now match. Rank tests cover Heavy Swing, Fire Ball, Fire Blast, Wisp Flow, Light of Heaven, Violent Shot, Magic Barrier costs and Light of Heaven/Blinkstrike cooldown arrays.
- `node apps/api/test/mastery-allocation-service.test.js`: passed for Mastery 0/1/5/6/10, node prerequisites, rank/point caps, repeated allocation rejection and row locks.

Verification on 2026-10-13:
- `pnpm --filter @nanommo/shared build`: passed.
- `pnpm --filter @nanommo/api build`: passed.
- `pnpm --filter @nanommo/frontend build`: passed; existing CSS budget and CommonJS warnings remain non-blocking.
- `node apps/api/test/hand-equipment-mastery-contract.js`: passed.
- `node apps/api/test/known-item-acquisition.test.js`: passed (4 assertions).
- `node apps/api/test/equipment-hand-swaps.js`: passed (12 assertions).
- `node apps/api/test/battle-distance-movement.test.js`: passed.
- `node apps/api/test/mastery-progression-ranks.test.js`: passed with the production per-kill `floor(xpReward × 0.25)` formula; proxy estimates 148 Mastery XP at L23 two-handed, 115 per one-handed category at L28, and 61,968 two-handed / 30,984 per one-handed category at L50; asserted levels are M5, M5/M5, and M10 or M7/M7 respectively.
- `node apps/api/test/mastery-skill-simulator.test.js`: passed.
- `npx openspec validate hand-equipment-mastery-skills --strict`: passed.
- `git diff --check`: passed; SPEC mirror comparison passed.

Still outstanding: comprehensive transactional retry/duplicate Mastery-award test; expanded per-skill wrong-equipment/rank-gate and cooldown/SP no-action/no-XP boundary tests; broader migration preservation/Rod-reference integration coverage; responsive/browser and live API/database verification; DEX milestone and final pacing balance review. Task 8.3 remains unchecked because the full relevant task suite and unresolved design review are not complete. No database/migration execution or deployment was performed.

### Final continuation checkpoint — 2026-10-13

Implemented and verified after the earlier foundational snapshot:

- Added the shared cumulative Mastery thresholds (levels 1–10: 5, 10, 25, 50, 100, 500, 25,000, 35,000, 45,000, and 60,000 XP), a shared rank resolver, and transactional category-level advancement when BattleService awards Mastery XP. Threshold pacing is based on a transparent catalog/character-XP/action-count proxy; the sharp jump from level 6 to 7/8 remains provisional pending combat-stat simulation and live-play validation.
- Added a direct allocation-service regression covering Mastery levels 0/1/5/6/10, node-one/rank-five prerequisite, point totals/max ranks, and pessimistic row-lock use. The category allocation API remains inside the BattleService-owned mutation boundary.
- Added direct battle-snapshot gate coverage: learned active skills and passives appear only while their required category is equipped; passives appear in snapshot definitions but never in the Gambit active-action list.
- Added/expanded deterministic simulator coverage for all ten active skills, the six passive skills, exact rank/cost/timing payloads, Bleed cap and DoT XP exclusion, Burn duration/refresh, War Cry DEF, Magic Barrier absorption, positional skill movement/push, no active-skill criticals, and same-seed/same-snapshot action and XP replay.
- Extended Mastery reward contracts for a Double Strike event with two damage components still earning one action award, landed magic damage resolving to zero still granting exactly one defensive category award, and misses earning none. Shield and Rune defensive branches are both covered.
- Off-hand ATK/derived stats are verified (primary full contribution, secondary half contribution, no double count); a direct 120 -> 60 helper case is covered in shared contract coverage. Catalog mirrors for the 16 current skill definitions, all six Rod/Rune item templates touched, and all six added Mastery status definitions were checked. Runtime catalog/source search found no remaining active Wand identifier; only legacy-to-Rod migration literals remain.
- Strict OpenSpec validation, SPEC mirror comparison, and diff whitespace checks passed. Root SPEC and OpenSpec SPEC mirror are each 1,348 lines and byte-identical.

Final builds/tests run:
- pnpm --filter @nanommo/shared build
- pnpm --filter @nanommo/api build
- pnpm --filter @nanommo/frontend build (successful; existing CSS budget and CommonJS optimization warnings remain).
- node apps/api/test/mastery-skill-simulator.test.js
- node apps/api/test/mastery-progression-ranks.test.js
- node apps/api/test/mastery-allocation-service.test.js
- node apps/api/test/mastery-snapshot-equipment-gates.test.js
- node apps/api/test/hand-equipment-mastery-contract.js
- node apps/api/test/equipment-hand-swaps.js
- node apps/api/test/known-item-acquisition.test.js
- node apps/api/test/battle-distance-movement.test.js
- npx openspec validate hand-equipment-mastery-skills --strict
- git diff --check, byte-identical SPEC mirror, and targeted server/frontend catalog mirror checks.

Still open and not represented as complete in OpenSpec: actual DB migration/data-preservation integration; transaction/retry-level Mastery reward idempotency integration; passive proc-rate calibration beyond deterministic seeded behavior; full two-handed/staged swap atomicity matrix; visual tooltip viewport and left-handed drag/drop browser verification; Gambit warning-present/absent browser checks; full Character/UI integration of learned passive stats; and live combat pacing/balance. The DEX milestone at total DEX 225/228 remains unresolved; no formula special-case was introduced. The migration was never executed, no database was changed by this task, and no production deployment was performed.

### Apply session — `refining-hand-equipment-mastery-skills` (2026-10-13)

This session did modify implementation (the earlier discovery-only handoff above is historical). Current code/catalogue work includes: staged category-local Mastery drafts and atomic absolute-rank Apply; the `1796000000000-ResetExistingMasterySkillRanks` one-time reset migration; a JWT-protected targeted reset cheat; Light Wisp/War Cry/Arcane Dynamo catalog changes; monster max-SP/regen/cost catalogue values; shared-engine SP initialization/cost/refund events, pure Bleed damage labeling, player-only Disarm basic-attack legality, banked movement gauge, and sequential cooldown bookkeeping.

Build status: shared TypeScript build passed; API Nest build passed; production Angular build passed after moving the added Mastery CSS to component-scoped styles. Angular emitted existing CSS-budget/CommonJS warnings. `git diff --check` still needs a final rerun after documentation changes. No database migration was run, no browser visual verification was performed, and no deployment occurred.

**Not complete:** status timeline projection exists separately in each panel but is not yet a shared reducer; per-stack duration and early-removal edge cases need tests; individual illustrated SVG skill assets now exist and are copied into the built frontend; exporting the requested high-quality PNG versions and browser review remain optional/follow-up visual work; rank-aware tooltip/tree polish remains incomplete; reset and monster-SP integration tests plus browser verification are still required. Mastery refresh after battle resolution, the monster mana bar, and the monster skill row are implemented. Keep `refining-hand-equipment-mastery-skills` open until the remaining work is resolved.

Focused regressions added/updated in this apply session: `mastery-allocation-service.test.js`, `mastery-skill-simulator.test.js`, `battle-distance-movement.test.js`, and new `mastery-reset-service.test.js` all pass. The reset service test checks all eight categories, rank/point clearing, XP/level preservation, and ambiguous-name rejection. `openspec validate --strict`, `git diff --check`, SPEC mirror comparison, and icon file coverage checks pass. Monster-SP insufficiency/cost/regen and full status stack/expiry integration tests are still outstanding.

### Follow-up — diet snapshot, approach timing and tooltip regression fixes (2026-10-14)

- **Multi-food regen formula is correct in the simulator:** base character regen remains separate from food buffs, and every independently digesting food contributes until its own expiry. The canonical values for Cheese + a three-star Bread are `8 base HP + 8 Cheese + 7 Bread = 23 HP` per regeneration boundary, and `3 base SP + 1 Cheese + 4 Bread = 8 SP`. Existing `battle-food-regen.spec.js` covers both totals and the post-Cheese-expiry totals (15 HP / 7 SP). The reported `+16 HP / +4 MP` therefore matched an immutable battle snapshot that contained Cheese but not the subsequently consumed Bread, rather than an HP formula double-count/under-count.
- **Manual item/food use now crosses `BattleService.runFutureCombatMutation()` once.** Previously `POST /inventory/use` changed persisted diet/inventory but left already precomputed unresolved battles stale. The controller now uses the BattleService-owned boundary: it preserves an actually active immutable battle and removes stale entries after it; when no battle is active, it invalidates the stale chain and lets normal map entry/queue generation build a new snapshot from the updated diet. Do not mutate a currently running battle to add newly consumed food.
- **Regen event copy distinguishes resource and amount.** The two entries that both appeared as “Sauro regen” represent independent HP and MP/SP events at the same simulation tick; they are not two HP grants. The live Grind and Battle History labels now include the explicit amount/resource (for example, `Sauro regenerated +23 HP.` and `Sauro regenerated +8 MP.`).
- **Approach intent is refreshed every tick independently from action gauges.** A legal out-of-range attack/skill can establish movement intent without waiting for the next attack/cast gauge fire. Movement still requires a legal target-oriented action and sufficient movement gauge, and no legal target action clears stale intent. A focused simulator regression proves a DEX-80 setup that previously waited for the cast gauge begins moving at T2 with 60 Move Speed, rather than first issuing movement at T4.
- **Tooltip fixes:** Mastery skills use the existing shared floating-tooltip directive, with skill description, type, current/max rank, cast/cooldown details, and a localized prerequisite (`Requires <skill name> rank N`) in the tooltip. The category selector handles pointer-down and click/keyboard activation. Character status icons have restored tooltip markup using the same floating-tooltip path, and the directive now also opens/closes overlays on keyboard focus/blur. The per-skill illustrated SVG assets are included in Angular's built `browser/assets/ui/skill-icons` output; Freeze and the other status SVGs are likewise copied into the build. These are local workspace changes only; no frontend/backend deployment was performed, so the production site remains unchanged until a deployment publishes this build.
- Verification on 2026-10-14: shared/API builds passed; production Angular build passed (existing CSS-budget and CommonJS warnings only); `battle-food-regen.spec.js` passed 3/3; `inventory-manual-use-queue-invalidation.test.js`, `battle-distance-movement.test.js`, `mastery-allocation-service.test.js`, `mastery-skill-simulator.test.js`, and `mastery-reset-service.test.js` passed. Browser-level hover/focus testing and manual production verification remain the user's planned smoke test; no deployment was performed.


### Follow-up — live SP log, monster status icons and status tooltips (2026-10-14)

- The live Grind battle feed now formats `sp_regen` as `{monsterName} regenerates {amount} SP.`. This is deliberately scoped to the in-battle Grind feed; the Battle History formatter is unchanged.
- Monster status icons were invisible because the icon wrapper itself carried the global `item-tooltip` class, whose `display:none!important` rule hides the entire wrapper. Removed that class from the icon wrapper so it remains visible; its status tooltip continues to use the Grind panel's local hover/focus CSS. The existing projection still derives active statuses from the initial monster snapshot plus `target: 'monster'` events up to the current elapsed tick, filtering expired applications as the battle clock advances.
- Character panel status tooltips had two `TooltipPositionDirective` instances bound to the same icon anchor: one on the status icon and another on its nested `.item-tooltip.status-tooltip`, so both instances competed to show/hide floating clones. Excluded `.status-tooltip` from the directive selector so only the status icon owns the overlay lifecycle.
- Verification: `pnpm --filter @nanommo/frontend build --configuration production` passed; `git diff --check` passed; `SPEC.md` and `openspec/specs/SPEC.md` remain byte-identical. Angular emitted the existing CSS-budget warnings and the CommonJS optimization warning for `@nanommo/shared`. No browser-level interaction test or deployment was performed.


### Follow-up — status source, indefinite Bleed and tooltip recovery (2026-10-14)

- **Monster-applied status event ownership corrected:** the monster-skill status branch mutated the player (`self`) but wrote `actor: 'character'`. It now records `actor: 'monster'`, `target: 'character'`; the live formatter consequently reports the Ruins Guardian as the source of Stun on Sauro.
- **Monster status icons / Bleed:** Bleed's canonical duration is `0`, which means it has no timed expiry. The Grind timeline had treated a status event with neither `durationTicks` nor `expiresAtTick` as expiring on its application tick and then filtered the icon out. Durationless status applications and snapshot entries now map to an indefinite expiry (`Infinity`), remaining visible until the explicit status-ended/stack-reduced event or battle end. Their tooltip says “until removed” instead of displaying a fabricated timer.
- **Status tooltips:** status markup must not use `.item-tooltip`, which has `display:none!important`. Both Character and Grind status icons now use the viewport-aware floating overlay on the icon wrapper itself, with the nested `.status-tooltip` acting only as cloned content. This avoids both viewport/panel clipping and duplicate directive handlers.
- **Regression coverage:** the battle simulator test now checks that monster-applied status events retain `actor: 'monster'` and `target: 'character'`; the Bleed test asserts that its applied event has no timed expiry. Shared build, both focused simulator tests, production frontend build, `git diff --check`, and byte-identical SPEC mirror checks passed. Existing Angular CSS-budget/CommonJS warnings remain non-fatal. No browser interaction test or deployment was performed.


### Follow-up — status tooltip viewport placement and monster hover tooltip (2026-10-14)

- Character summary status icons now use `TooltipPositionDirective`'s document-level floating overlay too. The viewport-aware positioning chooses the right side when the cursor/icon is near the left edge, preventing the tooltip from being clipped by the viewport or summary panel. The direct CSS hover display was removed to avoid showing both a local tooltip and the overlay.
- Monster status icon wrappers already use `.status-icon`; that class is now explicitly handled by the floating directive, which clones the child `.status-tooltip` content. The same directive now handles `.status-effect-icon` in the Character summary. Status tooltip clones carry a specialized style class to preserve the smaller, readable status-tooltip typography.
- Validation: `pnpm --filter @nanommo/frontend build --configuration production` passed; `git diff --check` passed; `SPEC.md` and `openspec/specs/SPEC.md` remain byte-identical. The build only reported the existing non-fatal CSS-budget and CommonJS warnings. Browser-level hover/edge placement was not run, and no deployment was performed.


### Follow-up — status tooltip disappears during live refresh (2026-10-14)

- Root cause: both Character and Grind status projections are reevaluated against 250 ms clock signals and return newly allocated arrays/objects. With default `*ngFor` identity tracking, Angular replaced the icon wrappers repeatedly. Destroying a wrapper also destroys its `TooltipPositionDirective` and removes the floating tooltip; the pointer can remain over the replacement wrapper without a new `pointerenter` event. This explains both the Character Summary tooltip disappearing and the Grind monster tooltip never reliably opening.
- Fix: added `trackBy` functions keyed by stable status ID to both loops (`status.id` and `effect.id`). DOM wrappers and hover/focus listeners now persist across ticks while stack counts and tooltip content can still refresh. The existing single viewport-aware overlay and wrapper-owned directive are unchanged; no duplicate local tooltip or MutationObserver was added.
- Verification: `pnpm --filter @nanommo/frontend build --configuration production` passed; `git diff --check` passed; root `SPEC.md` and `openspec/specs/SPEC.md` were checked for byte-identical content. Angular emitted the existing non-fatal CSS-budget warnings and the CommonJS warning for `@nanommo/shared`. Browser hover/focus verification was not available in this pass; no deployment was performed.


### Follow-up — Heavy Swing Disarm and same-tick action priority (2026-10-14)

Implemented the combat correction in the shared simulator and synchronized the player skill catalogue mirror.

- **Brutality is STR-only:** removed its 1% Disarm proc from both basic attacks and active skills; its canonical effect is only `+6 STR per rank`.
- **Heavy Swing now owns Disarm:** physical raw damage is `ATK × 1.1 + 20 × rank`, followed by the existing defense/archetype/variance pipeline. On a surviving target it applies canonical Disarm at 100% chance, with duration 3/6/9/12/15 ticks for ranks 1–5. The status uses the canonical `applyStatus` lifecycle and emits the regular status event.
- **Skill takes priority over basic Attack when both gauges would resolve:** before processing the player's Attack gauge, the simulator evaluates the selected Cast-gauge action. A selected, ready, in-range skill suppresses/reset the Attack gauge for that tick. If the skill is still out of range, the existing approach movement remains active; after arrival, the skill is executed before any basic Attack. Basic Attack timing restarts after the skill becomes unavailable via its normal cast/cooldown lockout.
- Kept the pre-existing local Heavy Swing cost/cooldown rebalance and synchronized it to the frontend catalogue: SP costs 30/35/40/45/50 by rank, cooldown 25 ticks. Both JSON files now match for these entries.
- Added simulator regressions for damage, guaranteed Disarm across all five ranks/durations, no Disarm proc from Brutality, and melee approach against a ranged target with no basic Attack on the same tick as Heavy Swing. Updated the progression test to the preserved SP cost curve.

Verification: `pnpm --filter @nanommo/shared build`, `pnpm --filter @nanommo/api build`, `pnpm --filter @nanommo/frontend build --configuration production`, `node apps/api/test/mastery-skill-simulator.test.js`, `node apps/api/test/mastery-progression-ranks.test.js`, `pnpm exec openspec validate hand-equipment-mastery-skills --strict`, `cmp -s SPEC.md openspec/specs/SPEC.md`, the Heavy Swing/Brutality catalogue mirror assertions, and `git diff --check` passed. Angular emitted existing CSS-budget and CommonJS warnings. No database or migration was run and no production deployment was performed.


### Partial apply — storage-map-and-combat-progression-corrections (2026-10-16)

**Partial implementation only; do not treat the OpenSpec change as complete. No deploy, database migration, or production data mutation was performed.**

Implemented in this pass:
- Added canonical Storage NPC with exact monologue and Town-map npcIds; current Town list references William, Father Marcelus, Blacksmith Loren, Cecilia, and Storage. Town NPC discovery uses the character's canonical map references when present and public NPC payloads include monologue.
- Town access guards resolve the canonical map type === "town" and require status === "town" plus no pending map transition. Warehouse reads are guarded; legacy itemId/quantity transfer methods now run transactionally, lock Character first, require a full source stack, merge only if the full stack fits, otherwise move to a free destination slot, and preserve instanceData. A row-ID transfer service method was added.
- Removed generic Inventory-to-Warehouse fallback from InventoryService.addItem(). Battle reward handling preflights each complete drop against Inventory capacity before mutation; drops that do not fit are logged and skipped while resolution continues.
- Moved canonical map coordinates to Town=(0,0), then map_lv_1 through map_lv_26 at x=1..6/y=0; frontend mirror updated. Map board CSS now uses fixed square tiles in one horizontal row with horizontal overflow.
- Rebuilt monsters.json from baseline HEAD a5fd8b3, scaled only hp for all 17 monsters with level >=15 using max(1, round(hp * 0.60)), and synchronized the frontend public mirror byte-for-byte.

Validation performed: API build passed; shared build passed; frontend production build passed with existing CSS-budget/CommonJS warnings; OpenSpec strict validation passed; git diff --check passed; canonical/public monster JSON contents match.

Known incomplete work / blockers: Storage-specific UI and bidirectional drag/drop/double-click are not implemented; legacy warehouse routes still use itemId/quantity instead of exposing the row-ID operation. Complete transfer concurrency/capacity/instance tests are missing. New item/skill/status SVGs and reusable asset validator are not added. Status timeline remains split across existing reducers. Mastery threshold/UI/migration work is not implemented. Town-reset migration and pre-worker BullMQ/MapPresence reconciliation tooling are not implemented. Browser visual smoke and the full focused/integration test matrix remain outstanding. The Codex CLI attempt could not run because the installed client/account combination rejects the configured models, so remaining work must be continued manually or after fixing that local tooling mismatch.


Verification note (2026-10-16): a focused Jest attempt for apps/api/test/inventory-item-count.spec.ts failed before executing tests because the current Jest invocation parsed the TypeScript test with Babel and rejected the TypeScript type annotation (`Unexpected token`); this is a test-runner/configuration issue, not a gameplay assertion. It remains unverified in this session. A catalogue audit against `git show HEAD:monsters.json` confirmed all 27 IDs remain present, all 17 level-15+ HP values match the exact one-time formula, every other monster field is unchanged, and both root/public map and monster mirrors match.

### Vendor sell modal stack scope — 2026-10-16

Implemented: dragging an Inventory row onto a Vendor now passes that row quantity to VendorStore.openSell(). The sell modal max quantity is capped to the selected stack and current total owned quantity; the existing All button continues to select modal.maxQuantity. Example: 80 potions in four stacks of 20, dragging one stack then All selects 20. Added a focused regression spec covering multiple stacks, stale owned totals, non-stackable items and the no-stack-quantity fallback. The production frontend build passed; strict OpenSpec validation and diff checks passed. Browser visual smoke remains outstanding.

Frontend test-run note (2026-10-16): `ng test --watch=false --browsers=ChromeHeadless` cannot currently compile the suite because existing `auth.guard.spec.ts` and `game.store.spec.ts` fixtures are missing required Character fields (`dominantHand`, `currentMapId`, `attributeBonuses`, `magicAttack`). The new Vendor quantity regression spec did not report a TypeScript error, but runtime test execution is blocked by those pre-existing fixture errors. The first `pnpm ... test -- ...` invocation also exposed an extra-argument CLI syntax issue; direct `ng test` was used for diagnosis.


### Continued apply — Storage UI, catalogue assets, shared status timeline and Mastery Level 7 (2026-10-16)

Implemented in this continuation:
- Added a Storage branch to the Town NPC panel: exact NPC monologue, ten fixed 5×2 slots, item icons/tooltips and no Vendor prices/actions. Inventory ↔ Storage supports drag/drop in both directions and double-click deposit/withdraw while Storage is selected. UI calls a new row-ID transfer endpoint and reloads Inventory, Warehouse and Character from the server after success/failure. Shared NPC types now include the `storage` capability and monologue.
- Added `POST /town/warehouse/transfer` and routed it to the shared row-ID transaction. Transfer validation checks settled Town, exact row ownership/location, full-stack stacking constraints, instanceData compatibility for merges, valid unique destination slot indexes, and full destination capacity. Legacy itemId/quantity endpoints still delegate to the same guarded transfer service and reject ambiguous partial-stack requests.
- Added the 24 requested framed and frameless monster-part SVGs, eight monster-skill SVGs and six status SVGs. Added `apps/frontend/scripts/validate-ui-assets.mjs` and `pnpm --filter @nanommo/frontend validate:ui-assets`, which checks all runtime paths for every catalogued item, player/monster skill and status (288 paths at this checkpoint). Added `scripts/validate-storage-map-catalog.js` for map order/coordinates, map mirrors, Town Storage references, canonical Storage count/capability and exact monologue.
- Mastery level-up requirements now use the shared recursive formula `floor((previous + 50) × 1.5)`, starting at 50 XP; the current cap remains 10. Character Mastery progress uses the current-level-relative XP gap, displays cumulative XP in the title detail, and clamps available points to `max(0, level - spentSkillPoints)`. Added forward-only `1799100000000-ReconcileMasteryLevelsForCumulativeXp`; it changes only stored levels and preserves XP/ranks/points/IDs.
- Added shared `projectStatusTimeline()` and wired both Character Summary and Grind monster status UI to it. It replays snapshot/events in persisted array order, filters by target, handles refresh/explicit end/expiry/untimed status and stack removal, and now has a focused direct-run regression. BattleEngine expiry events carry the expired stack's expiry/application ticks.
- Added forward-only `1799000000000-ResetAllCharactersToCurrentTown`. It moves character map/status to Town, preserves the earliest unresolved started/due battle per character, removes other unresolved rows, sets a pending Town request when a started row is preserved, and increments stateVersion when authoritative location/transition changes. **Migration was not run.**

Verification passed: shared build; API build; production Angular build; `node apps/api/test/mastery-progression-ranks.test.js`; `node apps/api/test/status-timeline-projection.test.js`; `pnpm --filter @nanommo/frontend validate:ui-assets` (123 items × 2 variants, 28 skills, 14 statuses; 288 paths); `node scripts/validate-storage-map-catalog.js`; and `git diff --check`. Angular reports existing CSS budget/CommonJS warnings. No database migration was run, no browser visual smoke was performed, and no deployment occurred.

**Still incomplete / do not mark the OpenSpec change complete:** dedicated Inventory/Warehouse transaction concurrency/controller/service tests; Town endpoint isolation tests; proof that battle drop preflight cannot partially mutate/roll back other payout effects; explicit map-board layout assertions and browser visual verification; icon visual review; broader status reducer edge-case suite (especially varied-duration stack order and explicit stack count); Mastery migration integration/point-preservation tests; and operational BullMQ/MapPresence reconciliation plus a fail-closed worker startup gate for the Town reset. The Town reset migration must not be run until that reconciliation is implemented and verified with API/queue consumers stopped. Vendor modal regression remains compile-checked but browser/runtime frontend tests are still blocked by unrelated stale Character test fixtures documented above.


### Final verification addendum — storage-map-and-combat-progression-corrections (2026-10-16)

After the continued apply, added `scripts/validate-monster-hp-adjustment.js` (checks every monster against baseline commit `a5fd8b3`, including exact 0.60 HP transform and root/public byte identity) and extended the UI asset validator to check the production build output as well as source files. Added `apps/api/test/inventory-warehouse-transfer.test.js` covering row-ID isolation, instanceData preservation, full-stack merge, no-partial-mutation on full Warehouse, free-slot fallback when merge room is insufficient, ambiguous legacy itemId+quantity rejection, and Town authorization. Existing NPC/vendor/map tests were updated for canonical map-type resolution; `npc-town-additions.test.js` now asserts Storage's exact monologue. `TownService.chooseNpcDialogue()` now also uses canonical `type: town` rather than hardcoding only `map_town`.

Final validation passed: shared/API builds, production Angular build, `npc-town-additions.test.js`, `npc-framework.test.js`, `town-vendor.service.test.js`, `town-canonical-map-unification.test.js`, `inventory-warehouse-transfer.test.js`, `battle-distance-movement.test.js`, `mastery-progression-ranks.test.js`, `status-timeline-projection.test.js`, both catalogue validators, frontend UI asset validator including built output, strict OpenSpec validation, SPEC mirror comparison and `git diff --check`. Existing Angular CSS budget and CommonJS warnings remain non-fatal. No migration/deploy/browser smoke occurred. Still open: transaction concurrency and endpoint-isolation integration tests, battle-drop no-rollback matrix, visual icon/map review, full status stack/event edge-case suite, Mastery migration/UI-point tests, and especially BullMQ/Redis MapPresence reconciliation plus a fail-closed worker startup gate. Do not run the Town reset migration before those operational controls are complete.


### Final completion pass — fail-closed queue reconciliation, safe migration tooling and regression coverage (2026-10-16)

Completed implementation and offline validation for all application-code scope in `storage-map-and-combat-progression-corrections`:

- **Storage/Inventory:** row-ID whole-stack transfer is exercised for JWT owner isolation, duplicate-item ambiguity, concurrent attempts, instanceData preservation, full destinations, merge boundaries, invalid slot collisions, Town status/map/pending-transition guards, and Inventory-only generic item creation. Direct tests cover the full drop-capacity matrix, Warehouse-only food exclusion, multi-stack `getItemCount`, inventory-only consumption, and Auto Feed's insufficient-quantity race skip. Vendor stack-scoped All/sell behavior and both Storage drag/double-click directions are covered in the Chrome suite.
- **Catalogue/assets/map:** boot validation enforces unique canonical Storage ID/capability/exact monologue and Storage references in every Town-type map. `validate-storage-map-catalog.js` checks root/public map mirrors and horizontal coordinates. `validate-monster-hp-adjustment.js` compares every monster field to `a5fd8b3` and passes only the 0.60 HP change to level>=15. The UI asset validator verifies 288 catalogue paths in source and production build. A contact sheet of the 38 new item/skill/status icons was inspected; `verify-map-board-layout.mjs` passed in Chromium desktop/mobile and screenshots were reviewed.
- **Status/Mastery:** both live status panels call the shared `projectStatusTimeline()` reducer; direct tests cover event/expiry boundaries, independent stack duration, removal identity, equal-tick ordering, refresh, explicit end, zero-duration, target ownership, unknown status IDs and DoT. Chrome tests compare both component projections at the same controlled ticks. Mastery uses shared XP-relative progress/points; tests cover level threshold boundaries, Level 7 at 20,000, 20,120 => 120/15,000 and one available point when six are spent, row refresh preserving skill ranks, and the forward-only level-only migration contract.
- **Queue/presence/migration:** added a distributed Redis startup lease and gate, global Bull pause/active-job drain, strict read-only migration-history preflight, stale DB/Bull row reconciliation, resolver-job repair, Town/pending/dead/invalid-map guardrails, authoritative MapPresence hash rebuild, top-up filtering, and a processor-free maintenance context. Queue/gate/presence/migration lifecycle tests verify active-row preservation, future cleanup, missing jobs, idempotency, resolved-history preservation, no Town top-up, and fail-closed behaviour on pending migrations or Redis/presence failure. Normal app startup no longer auto-runs migrations or schema synchronization. Added explicit read-only migration audit, guarded migration runner, and an operator-confirmed legacy-baseline tool that only records a manually audited chronological prefix and refuses to baseline either newly added migration.

Final full offline validation passed: shared/API build; production Angular build; the focused direct-run API suites (`npc-town-additions`, `npc-framework`, `town-vendor.service`, `town-canonical-map-unification`, `inventory-warehouse-transfer`, `town-storage.controller`, `inventory-item-count-direct`, `battle-drop-capacity-isolation`, `storage-catalog-validation`, `migration-history-safety`, `migration-baseline-selection`, `data-source-migration-config`, `battle-queue-gate`, `battle-queue-reconciliation`, `battle-queue-recovery-lifecycle`, `map-presence`, `battle-distance-movement`, `mastery-progression-ranks`, `mastery-level-migration`, `town-reset-migration`, `status-timeline-projection`); storage/map/HP and UI asset validators; Playwright map-layout smoke; ChromeHeadless suite (**31/31 tests passed**); strict OpenSpec validation; `git diff --check`; and root/OpenSpec SPEC mirror comparison. Angular's existing CSS-budget and CommonJS warnings remain non-fatal.

**Only live-environment tasks remain, and were deliberately not attempted through an unsafe fallback:** the read-only migration audit command failed at DNS resolution for configured hostname `db` (`getaddrinfo EAI_AGAIN db`) before connecting to PostgreSQL. It performed no migration/schema/data mutation. The live migration history and actual PostgreSQL/Redis/Bull recovery therefore remain unverified; no database migration, baseline write, production deployment or DB-backed integration test was run. Do not mark the OpenSpec change fully complete until the read-only audit succeeds in the configured container/network context, the live schema is manually compared to a chosen legacy migration baseline, and PostgreSQL/Redis/Bull reconciliation plus authenticated status-icon visual smoke pass. Exact guarded procedure is now documented in `SPEC.md` and `ARCHITECTURE.md`.


### Final environment probe and final revalidation — 2026-10-16

Re-ran the full offline validation after the migration-history guard refinements: shared/API builds, all focused direct-run API suites listed above, Storage/map/HP/UI-asset validators, production Angular build, Chromium desktop/mobile map smoke, ChromeHeadless component tests (**31/31 passed**), strict OpenSpec validation, SPEC mirror comparison and `git diff --check` all passed (`FINAL_VALIDATION_PASSED`). The guarded migration preflight now also rejects a nonempty tracked migration history when no recognized application schema tables exist; fresh empty databases remain eligible for an explicit first migration run. Operator-baseline DDL + prefix inserts are committed atomically.

Last environment check: Docker CLI is present, but neither Docker Desktop's configured socket (`~/.docker/desktop/docker.sock`) nor `/var/run/docker.sock` exists, so no Docker containers can be inspected or started from this session. A host PostgreSQL process is listening on its local socket at port 5433, but the configured application credentials (`nanommo` / configured database) fail password authentication there; this is not proof that it is the application's intended database. The configured `.env` hostname `db` also does not resolve. Therefore live migration history, live data state, and PostgreSQL/Redis/Bull reconciliation cannot be verified here. No DB/schema/history writes, migrations, baseline records, or deployment were made. The only open OpenSpec tasks are 12.1 (run read-only migration/queue integration audit in the reachable application container/network after verifying database identity and history) and 12.2 (authenticated live battle/status-icon visual smoke); both remain explicitly open rather than fabricating completion.


### Implementation — map canvas, Session Loot, starter Knife and monster balance (2026-10-16)

Applied the requested Grind map presentation: `map-head` is inside `map-art`, its background is transparent, the heading is 34px, and the canvas is fixed at 761×660 with the map tiles below the header and remaining panel space left empty. Session Loot now renders a bordered wrapping collection of icon-only loot cells with quantity badges and no visible item names. Canonical monster data and the frontend data mirror have every monster HP halved (nearest integer, minimum 1); level 1–6 monsters receive +30% XP reward (nearest integer). Added the dedicated `equip_knife` dagger (+6 ATK) and equipped it in `mainHand` during new-character creation; existing characters are unchanged. SPEC and its OpenSpec mirror updated. Preserve the pre-existing worktree change to `monsters.json` while reviewing this diff. Validation: `pnpm --filter @nanommo/shared build`, `pnpm --filter @nanommo/api build`, `pnpm --filter @nanommo/frontend build --configuration production`, per-monster HP/XP assertions for both root/frontend data files, and `git diff --check` passed. `node scripts/validate-monster-catalog.js` still fails its root/frontend full-catalogue parity assertion because of unrelated pre-existing differences in monster combat stats (the root `monsters.json` was already modified before this task); those unrelated values were deliberately not overwritten. No migration, database mutation or deployment performed.

### World map interaction and presentation refinements (2026-10-19)

Follow-up to `definitive-world-map-viewport`: removed pointer capture from the initial pointer-down path so the browser's click target remains the actual map tile; tile clicks are handled through viewport delegation with stable map IDs, while drags still suppress the synthetic click. The map header now overlays the top of the viewport without a background, preserving the 34px heading and leaving the space below the fixed map viewport empty. Added a body-level, viewport-aware map tooltip with immediate display, natural-language map names, and a smaller Recommended level subtitle. Mouse wheel zoom is cursor-anchored and bounded between 100% and 50%, with panning adjusted for the active zoom. Character's authoritative current map is included in server discovery checks; the map-enter controller now returns the service's actual transition result. Initial Town discovery cleanup handles the known stale `map_green_grounds_4`-only bootstrap without clearing other legitimate discoveries. Validation passed: shared/API/frontend production builds, `node scripts/validate-world-map.js`, strict OpenSpec validation and `git diff --check`. The build re-synced the frontend skill-tree mirror and it was restored to its original HEAD version to preserve the pre-existing root/frontend catalogue mismatch. Browser verification remains pending; no deploy or database operation is part of this session.


### Battle History self-buff log cleanup — 2026-10-19

Fixed redundant/misleading Battle History presentation for self-targeting status buffs: a successful zero-damage `use_skill` event is hidden when the same event carries `statusApplied` and targets the character. The distinct status application event remains visible (for War Cry, e.g. `Sauro applies war cry def to Sauro`), instead of also claiming the skill dealt 0 damage. This is a presentation-only filter; authoritative battle events and combat behavior are unchanged. Frontend production build passed. No database operation or deployment.


### Implementation — `cast-time-reduction-intent` (2026-10-19)

Implemented the shared-engine character skill intent state machine and derived stat rename. CTR is `floor(DEX × 2)` with no +100 baseline; `effectiveSkillCastTicks()` applies `max(0, ceil(baseCastTicks - CTR / 100))`, defaulting absent base duration to 2. Legal character Cast Gambit skills are evaluated at T0 and every tick; targeted out-of-range skills set approach intent only, while self/no-target skills can start immediately. Positive casts retain skill ID/start/resolution ticks and resolve through one shared skill-effect path; zero-duration casts resolve immediately. SP and cooldown are applied at resolution. Basic Attack and non-skill Cast actions are blocked during a pending cast and on its resolution tick; `use_item`, `defend`, and `wait` retain their Cast-gauge path. Monster cast gauge/timing code remains separate. DTO, API serializer, frontend Character model, Character Stats label and DEX tooltip now use Cast Time Reduction. Both SPEC copies and ARCHITECTURE.md were updated.

Verification: `pnpm --filter @nanommo/shared build`, `pnpm --filter @nanommo/api build`, `pnpm --filter @nanommo/frontend build --configuration production`, `node apps/api/test/mastery-skill-simulator.test.js`, `node apps/api/test/cast-time-reduction-intent.test.js`, `pnpm exec openspec validate cast-time-reduction-intent --strict`, the active source old-name search, and `git diff --check` passed. The frontend build reports existing CSS-budget and CommonJS warnings. `node apps/api/test/battle-distance-movement.test.js` is blocked by its pre-existing assertion at line 27: it expects `calculateHitChance(-100, 100) === 5`, but the current implementation returns 0; this mismatch is outside the CTR change, and the test exits before its monster timing assertions. The focused new test confirms CTR 10/100/200 duration boundaries, T0 War Cry resolution at zero effective ticks, T2 resolution at starting DEX, and no basic attack during start/pending/resolution ticks. Broader range/fallback/non-skill timing and direct Wailing Wraith DEX-independence regression coverage remain to be completed. No database operation, migration or deployment.


### Hybrid DEF, monster cast resolution, and passive-combat logs — 2026-10-19

Implemented locally: physical damage mitigation now combines `0.225 × DEF` flat reduction with `rawDamage × DEF / (DEF + 250)` relative reduction and retains a 1% raw damage floor. This replaces the old `DEF/(DEF+300)` formula; magic mitigation is unchanged. Monster `use_skill` now starts a simple deterministic pending cast as soon as a legal Cast Gambit skill is selected in range. Resolution is `startTick + baseCastTicks`, default 6 when no base duration exists; attacks are paused during the cast and SP/cooldown begin at resolution. Zero-cooldown skills can begin the next cast at the same resolution boundary, preserving Wailing Wraith Ice Bolt at T2/T4/T6. Character CTR and equipment/mastery do not affect monster casts. Player-facing Grind and Battle History hide `action_suppressed`, and Shield Bash status events carry passive-proc metadata and are formatted as `<target> is stunned by Shield Bash.` The existing potion/Attack-vs-Cast-gauge behavior was deliberately left unchanged per user direction.

Verification passed: `pnpm --filter @nanommo/shared build`, `pnpm --filter @nanommo/api build`, `pnpm --filter @nanommo/frontend build --configuration production`, `node apps/api/test/battle-distance-movement.test.js`, `node apps/api/test/mastery-skill-simulator.test.js`, `node apps/api/test/defense-monster-casting-passive-logs.test.js`, strict OpenSpec validation for the new change, and `git diff --check`. The existing battle-distance test's 5%/95% hit-clamp expectations were retained per canonical SPEC and the shared implementation was corrected to match them; its outdated pre-CTR cast-tick assertion was updated to the current immediate-intent contract. Frontend build emits the existing CSS-budget and CommonJS warnings. No database, migration or deployment performed.


### Grind-to-Grind transition, encounter concurrency and saved Town waypoint — 2026-10-19

Implemented: `MapService.enterMap()` serializes transition requests and re-reads/locks Character inside a TypeORM transaction. An unresolved queue entry whose `startAt <= now` defers movement even when its `endAt` passed; pending intent stores `destinationMapId`, `requestedAt`, and a Town/Grind reason. Latest click wins, and old future queue rows are deleted in the same transaction as the transition intent or immediate map move; after commit, the corresponding delayed Bull jobs are removed. The origin stays authoritative until resolution. Battle resolution commits the last requested destination before queue rebuild and resets the source Grind map's epoch/counts; immediate Grind exits and Town fallbacks do the same. `BattleService` shares a renewed Redis per-character lock across queue generation, the resolver's DB transaction and map requests. Kill-counter creation is idempotent with `INSERT ... ON CONFLICT DO NOTHING` and a re-read.

Frontend map transitions now share the Town/Grind flow, resume pending intent from the Character DTO, show `waiting for battle to end to move...`, set a destination pin after a successful request, and draw an animated BFS route through cardinally adjacent map nodes. Click timestamps plus a local response sequence prevent older rapid-click requests/responses from overriding the latest destination. Added `Character.savedTownMapId`, the forward-only migration `1799500000000-SavedTownWaypoint`, a `POST /maps/save-town` settled-Town guard, `Save here`/`Saved ✔` UI, and the saved-Town `/project/T_waypoint.png` overlay. Follow-up fixes center the Town waypoint, default existing/new characters to Sierra Village (`map_town`), and clear the destination pin/animated route once authoritative arrival is confirmed, prioritizing `currentMapId === destinationMapId` even if a pending-intent projection lingers while combat continues. The frontend explicitly packages the two source art files under `public/project/`; root art remains ignored.

Initial focused regression `node apps/api/test/map-transition-and-counter-concurrency.test.js` passed: late-but-unresolved battle defer, latest-destination-wins, stale request rejection, future queue trimming, source epoch reset, settled-Town save guard, unique counter creation under raced reads, and per-character Redis lock exclusivity. Shared/API/frontend builds passed after the latest DTO fix; frontend build reports the existing CSS/CommonJS warnings plus the newly expanded map-board CSS budget warning. Final offline verification passed: `pnpm --filter @nanommo/shared build`, `pnpm --filter @nanommo/api build`, `pnpm --filter @nanommo/frontend build --configuration production`, `node apps/api/test/map-transition-and-counter-concurrency.test.js`, `node apps/api/test/map-transition-frontend-contract.test.js`, `node apps/api/test/map-presence-cleanup.test.js`, `node apps/api/test/grind-food-expiry-exit-regression.test.js`, `node apps/api/test/battle-distance-movement.test.js`, `node apps/api/test/mastery-skill-simulator.test.js`, `pnpm exec openspec validate grind-map-transition-and-town-waypoint --strict`, and `git diff --check` passed. The asset contract confirmed both overlays exist in `apps/frontend/dist/frontend/browser/project/` and byte-match root sources. Production build emits existing Angular CSS-budget/CommonJS warnings (the destination route CSS was moved into global CSS so the new map-board component no longer exceeds its own budget). Updated `map-presence-cleanup.test.js` to provide the transactional repository/lock fixtures required by the current service, and it now passes its five presence scenarios. The migration is added but not run; no database changes or deployment.
### World-map destination preview stale-state fix (2026-10-19)

Fixed the frontend-only destination pin/animated route regression on Grind arrival. MapBoard now reconciles authoritative `currentMapId` against both the locally requested destination and `pendingMapTransition.destinationMapId`; it clears the preview when either destination has been reached or when an authoritative Town fallback completes. The just-completed pending destination is suppressed until a newer successful map-intent response is accepted, preventing subsequent Character/battle snapshots containing stale pending metadata from recreating the pin and route. A deferred transition still keeps its preview while the character remains at the origin, regardless of active combat.

Added `apps/frontend/src/app/features/play/destination-route-preview.spec.ts` covering stale Grind intent after arrival, Town fallback, and keeping the preview during a genuinely pending deferred transition. Updated root and canonical SPEC plus ARCHITECTURE to document the stale-intent suppression contract.

Validation: `pnpm --filter @nanommo/frontend build --configuration production` passed. Existing CSS-budget and CommonJS warnings remain. `git diff --check` passed. The focused Angular/Karma spec has been added but browser execution is not yet verified on this workstation (ChromeHeadless was unavailable in previous test runs). No API/gameplay changes, database operation, migration or deployment.
### Atomic map-preview reconciliation and stale HTTP response race (2026-10-19)

Follow-up to the destination-pin regression across Town/Grind combinations. The frontend now uses one type-agnostic reconciliation path for accepted map requests, Character updates, and transition polling. The preview clears when authoritative `currentMapId` reaches the active destination; status values and `type === 'town'` are not arrival signals. Completed pending intents are suppressed by destination + `requestedAt`, so later stale snapshots cannot recreate the preview. Rapid/superseding intents compare their timestamps, and older intents no longer roll the route back.

Fixed the race seen when clicking during `searching for monsters`: the map-enter HTTP response could arrive after a realtime Character update had already moved the character, and its partial `character` patch could overwrite `currentMapId` back to the origin and revive `pendingMapTransition`. Before applying that patch, MapBoard now compares the latest Character location and pending-intent timestamp, skips a response that is behind newer state, then reconciles synchronously before any deferred/waiting UI is re-enabled. Tile clicks now share the same entry handler regardless of current map type, and map tooltips display non-Town/non-Grind type labels generically.

Added frontend regression coverage for Town→Town, Grind→Town, Town→Grind and Grind→Grind stale-response races; Town arrival, stale intent suppression, newer-intent ordering, a future `sanctuary`-type preview, and deferred movement that must remain visible. Updated root/canonical SPEC and ARCHITECTURE with this invariant.

Validation: production frontend build passed; focused ChromeHeadless route suite passed (12/12); `node apps/api/test/map-transition-frontend-contract.test.js`, `node scripts/validate-world-map.js`, and `git diff --check` passed. The full frontend suite completed with 44 passing and one unrelated existing failure in `mastery-progress.component.spec.ts`, whose expected Mastery XP thresholds do not match the current progression curve. No database operation, migration, API/gameplay change, or deployment.

Scope note: the visual route/pin reconciliation is type-agnostic. Server-side map entry still explicitly supports only `town` and `grind`; adding `sanctuary` requires defined backend entry/status/queue semantics before that new type can be entered.


### Town-to-Town NPC panel refresh (2026-10-19)

Fixed the Town NPC panel retaining the previous Town’s NPC list when moving directly between Town maps. `VendorPanel` now reacts to authoritative `currentMapId` changes, resets NPC selection/dialogue/stock/Warehouse/modal/error state, and reloads the Town NPC catalogue. `VendorStore.load()` sequences requests and ignores stale responses from the previous Town. Added a regression test for an old Town catalogue response arriving after the destination Town response. Validation pending. No backend/API contract, database, or deployment changes.


### Implementation — `world-travel-gathering-flee` (2026-10-20)

Implemented locally: all 41 canonical maps declare `mapLength` (36 grind maps = 25, five Towns = 0); deterministic cardinal route/segment helpers, world Move Speed and calibrated travel durations are separate from lane movement. Character now stores the last stationary stance, versioned travel intent/segment progress, Gathering Level/cycle, encounter-cycle identity and FLEE retry deadline. The forward-only `1799600000000-WorldTravelGatheringFlee` migration migrates legacy pending transitions, adds immutable battle starting snapshots and cancellation audit fields, and trims future stale queue projections while preserving started fights. The migration was **not run**.

Implemented the persisted `WorldActivityProcessor` scheduler for travel segments, stationary Gathering, encounter searches, FLEE attempts and activity-job recovery after the battle queue gate opens. Segment arrival is the only point where location/discovery/MapPresence move; adjacent Town↔grind edges commit instantly, saved-Town teleport remains a separate intent, and death respawns at a valid saved Town with `map_town` fallback. Route jobs carry segment progress/rate across destination changes and retain historical completion time through overdue segments. Speed-affecting mutations routed through the shared future-combat mutation boundary rebase old-rate progress and pause the route until the post-mutation speed is stored. Current routes/stance cancel future projections but leave a started battle immutable; Town NPC/Warehouse guards block transactions while `travelIntent` is active. Travel/cancel requests publish the pruned authoritative battle queue immediately, and FLEE intents retain the target battle ID so normal resolution can cancel a stale retry even if the resume job runs after the battle row has been resolved. The FLEE success path invalidates the previous travel scheduleVersion before queuing an immediate resume, retry job IDs include activity generation, and a destination change preserves the persisted 10-second eligibility deadline. Zero world Move Speed is persisted as a paused gauge state (JSON-safe, no Infinity duration), expired speed buffs stop affecting the fill rate, and speed-affecting mutations accrue the old rate before applying the new one. FLEE tick speed uses the original battle equipment snapshot and only temporary speed buffs that remain unexpired at the roll timestamp. Entering travel settles the last stationary collection interval and freezes its timestamp so travel time cannot count as Gathering; cancelling travel resumes from that saved partial progress.

Added explicit per-species `isAggressive`/world `moveSpd`, seeded `randInt(2,6)+playersInMap` encounter deadlines, pre-combat avoidance and independent parallel FLEE rolls. A successful FLEE replays the immutable battle seed to a full checkpoint, applies HP/SP, spent/stolen inventory, Diet/digestion, food buffs and remaining statuses, commits cancellation reason/time without editing the original log/outcome, suppresses all normal rewards and invalidates obsolete future queue rows. Hunting/Gathering are persisted stationary stances; Traveling is derived. All 36 grind maps now own 100%-weighted cooking-material pools using a temporary randomized distribution of all nine gatherable materials; the user will balance it later; ten new `material` items and SVG assets were added, Blueberry Jelly/Honey retain existing IDs/effects, and Meat drops independently at 20% only from Dire Wolf and Needleback Stalker.

Offline checks passed on the latest run: shared/API TypeScript builds; `node apps/api/test/world-travel-gathering-flee.test.js` (route/time curves, all-map reachability, aggression, materials/pools, FLEE odds, deterministic checkpoint including item use, food/digestion and status expiry); `node apps/api/test/world-travel-gathering-flee-migration.test.js` (migration SQL/default/forward-only contract); `node apps/api/test/encounter-search.test.js` (16 assertions); `node apps/api/test/diet-autofeed-streak-fixes.spec.js`; `node scripts/validate-monster-catalog.js` (41 maps, 27 monsters, 54 monster parts, 10 materials, 12 pools); `node scripts/validate-world-map.js`; and `git diff --check`. The final production frontend build passed after the API catch-up refinements. The final strict OpenSpec validation and `git diff --check` also passed after the SPEC/ARCHITECTURE/STATUS/task updates. Angular's existing CSS-budget and CommonJS warnings remain non-fatal.

The repository-wide `pnpm --filter @nanommo/api test --runInBand` command was attempted but cannot currently be used as a regression gate: Jest discovers the repository’s direct-execution `*.test.js` assertion scripts as Jest suites (which contain no Jest `test()` blocks), and the direct map-presence script calls `process.exit(1)` when run under Jest. A single pre-existing TypeScript `.spec.ts` also fails at the parser because this Jest setup does not apply the project TypeScript transform. The focused contract scripts were run directly and passed. Remaining verification boundaries: service-level tests still need to exercise live route-change progress retention, active-Battle/FLEE race and retry cooldown, Town teleport/death cleanup, population-change Gathering rate and chronological catch-up through an overdue aggressive encounter. The last change now carries historical segment completion forward and processes overdue safe searches sequentially, but full offline PostgreSQL/Redis/Bull catch-up remains unverified. No database migration, live DB mutation, migration baseline or deployment was performed. Follow the guarded migration audit/queue reconciliation procedures before rollout.


### Directional Town/Grind travel timing — 2026-10-20

Changed the shared instant-edge rule to be directional: leaving a Town for a cardinally adjacent Grind map remains instant, but returning from a Grind map to an adjacent Town is timed using the source Grind map’s `mapLength`. Renamed the helper to `isInstantTownExitEdge`, updated both canonical SPEC copies and ARCHITECTURE, and added contract assertions for both directions. No deploy or database operation.


### Traveling pre-combat System Journal feedback — 2026-10-22

Fixed the missing System chat rows for Traveling encounters. Unlike Gathering, Traveling's seeded encounter selection and aggressive FLEE roll are handled directly in `MapService.advanceTravel()`, so they never passed through the existing `BattleService.queueBattles()` Journal hook. Traveling now schedules the same delayed `idle-journal-precombat` job for both passive-monster pass-bys and successful aggressive-monster dodges, using the projected encounter boundary and the existing worker's same-map/same-activity guard. Failed aggressive rolls still start combat and do not emit a successful-dodge row. Updated root/canonical SPEC and ARCHITECTURE documentation.

Validation: API build and `node apps/api/test/world-travel-gathering-flee.test.js` passed. `node apps/api/test/grind-monster-expansion-chat-journal.test.js` remains blocked by a pre-existing canonical/public monster catalogue mirror mismatch (including Mutant Bee stats); no catalogue data was changed. No migration, database mutation, or deployment.

### Apply — `cooking-npc-uncle-phillip` (2026-10-22)

Implemented the seven-recipe canonical Cooking catalogue and public mirror; Uncle Phillip's exact greeting/cooking-only capability and Sierra Village-only map placement; the `food_roast` display-name confirmation; Character Cooking level/XP/session columns and forward-only migration `1799800000000-CookingProgression` (not run); catalogue validation for recipe references/order and NPC ownership; authenticated Cooking state/start/Cancel APIs; 10-second persisted sessions with delayed completion and reconciliation; ingredient/output-capacity reservation guards in inventory/Town mutations; atomic ingredient/output/XP completion; and future-combat mutation integration. Added the responsive Town Cooking modal with persistent session progress/Cancel and the query-parameter Professions tab. Reused the existing `apps/frontend/assets/npcs/uncle_phillip.png` through `npcPortrait(id)`; no duplicate portrait loader or sprite was added.

Verified offline: shared TypeScript build, API Nest build, Angular development build, strict OpenSpec validation, recipe mirror equality, portrait file presence, and `git diff --check`. The frontend production build also passes; it emits the existing non-fatal component CSS-budget and CommonJS warnings. No browser interaction test has been run; comprehensive cancellation/concurrency/reservation integration tests and an automated service-level XP formula suite remain follow-up verification. No database migration execution, live DB mutation, or deployment.


### Chat history separation, 40-row defaults and text-size controls — 2026-10-23

Updated chat retention defaults from 20 to 40 when `CHAT_HISTORY_RETENTION_LIMIT` is unset. The frontend requests up to 40 rows from both Global and System, retains up to 40 per channel independently, and applies the visible-window limit only after the System toggle filters the combined timeline: System enabled shows the latest 40 combined rows; System disabled shows the latest 40 Global rows. Added persistent three-level chat text sizing with +/− controls; default row sizing targets about six visible rows, then five and four at the larger levels. Updated the canonical SPEC and ARCHITECTURE wording. API build and frontend development build passed; `git diff --check` passed when run from the repository root. No database inspection, migration, production deployment, or live account verification was performed. Note: previously trimmed/deleted Global rows cannot be restored by changing the retention default; an explicitly configured `CHAT_HISTORY_RETENTION_LIMIT` continues to override the default.


### Character summary food-state counts only active digestion — 2026-10-23

Fixed `CharacterSummary.foodLabel()` in `apps/frontend/src/app/features/play/components.ts`: HUNGRY/FED/SATISFIED/FULL is now derived from Diet entries whose server-provided `digestUntil` timestamp is still in the future, rather than the total number of retained Diet entries. Diet entries remain visible for the streak/history even after digestion expires, but no longer count toward the current food state. If every Diet item is at 0m/not digesting, the label is HUNGRY. Frontend development build and `git diff --check` passed.


### Gambit warning affordance and sound controls in Settings — 2026-10-23

Increased the active-Gambit warning button to 20px (from the 9px title text scale), added a subtle three-second infinite scale pulse between 95% and 105%, and respected `prefers-reduced-motion`. The unavailable-equipment warning in each Gambit line now uses `cursor: help` on hover and has the same size/pulse treatment. Moved the existing music mute toggle and volume slider out of the top bar into the Settings dropdown, alongside the existing Delete account action; the shared music service and saved volume behavior remain unchanged. The account deletion confirmation remains a modal. Frontend development build and `git diff --check` passed. No deployment.

### Vercel CSS budget follow-up — 2026-10-23

Moved the new Gambit warning and Settings dropdown styling from component-scoped stylesheets into the global stylesheet to keep the `play.component.css` and `gambit-editor.component.css` component budgets within the hard 5.12 kB limit without changing Angular budget configuration. Production build (`pnpm --filter @nanommo/shared build && node scripts/set-env.js && pnpm --filter @nanommo/frontend build --configuration production`) and `git diff --check` pass. Existing non-blocking component CSS budget warnings and the `@nanommo/shared` CommonJS/ESM warning remain; no deployment performed.

### Inventory stack merge and source-specific vendor sale — 2026-10-23

Fixed vendor sales to pass the selected `InventoryItem.id` from Inventory drag/drop through the sell modal and request. The Town transaction now validates the selected row and removes only the requested quantity from it, while retaining Town/vendor price checks, Cooking reservation checks, Character locking, and atomic gold credit. Existing callers without a row ID keep aggregate removal for compatibility.

Added Inventory stack merging when dragging a compatible same-item stack onto another: the target fills to catalogue `maxStack`; fully merged source rows are deleted; overflow remains in the source row and original slot. Dropping onto an already-full compatible stack leaves both rows untouched, while different/incompatible items keep their existing swap behavior. Added API regression cases for the 20+18 / sell-15 case, stale overdraw rejection, partial merge, complete merge and full-target behavior. Validation passed: shared build, API build, frontend development and production builds, `node apps/api/test/town-vendor.controller.test.js`, `node apps/api/test/town-vendor.service.test.js`, `node apps/api/test/inventory-warehouse-transfer.test.js`, frontend spec TypeScript check (`tsc -p tsconfig.spec.json --noEmit`), strict OpenSpec validation, and `git diff --check`. The targeted Karma spec could not execute because this environment has no Chrome binary (`CHROME_BIN` unset). An additional pre-existing `town-vendor-progression.js` check still fails its unrelated stale assertion that MapService must not depend on EquipmentService; no changes were made to that behavior. Production Angular build passes with the project’s existing non-fatal CSS-budget and CommonJS warnings. No migration, live database mutation, or deployment.

### Apply — player-market-and-mailbox (2026-10-24)

Implemented the first functional backend/UI slice locally. Added shared MAX_MARKET_ORDER_GOLD = 999,999,999 and additive forward-only migration 1799920000000-PlayerMarketAndMailbox (not executed) for MailMessage sender/recipient snapshots, body, gold attachment, independent read/attachment state, per-side deletion, source idempotency key, and MarketOrder listingFeeGold. No live DB mutation or deployment.

Market is now sell-only in the API: removed buy-order creation route and automatic buy/sell matching logic; sell listing locks the exact InventoryItem stack, takes a one-time non-refundable 1% fee rounded up (minimum 1), and validates the shared gross cap. Added listing search/filter/sort/pagination, competing-offer/latest-deal price suggestions, partial stack purchase / whole equipment instance purchase, transactional MarketDeal plus buyer-item and seller-gold Auction House mails, owner cancellation and persisted-expiry return mails. Active legacy buy orders are reconciled into capped source-keyed gold mail rather than filled or credited directly to wallets. Startup and 60-second bounded reconciliation handles order expiry/legacy escrow.

Implemented authenticated Town-gated Mail inbox/Sent/search/read/delete/send/collect APIs with sender/recipient ownership scoping, exact character-name lookup, self-send rejection, one selected inventory stack plus optional gold, Cooking ingredient and output-slot reservation checks, idempotency key support, all-or-nothing item capacity planning, wallet boundary validation, and bounded 30-day attachment expiry cleanup that preserves source-key tombstones. Added Mailbox NPC capability to the canonical and public NPC catalogues and every canonical/public Town map. Added a generic Town Mailbox panel for Inbox/Sent/Compose, unread count, canonical attachment icons/tooltips, read, collect, and side-specific delete; added /play/market and replaced disabled Trade with Market while keeping the central router outlet and persistent side panels.

Verification: shared build and API Nest build passed; frontend spec TypeScript check and production build passed. The direct Node contract check apps/api/test/player-market-mailbox-contract.test.js passed for shared cap/fee boundaries, overflow validation, map/NPC mirror parity, Mailbox coverage on all five Town maps, sell-only/no-matching contract, idempotency markers, ownership gates, and additive migration fields. node scripts/validate-world-map.js and strict OpenSpec validation passed. The repository-wide Jest invocation is not a usable gate in this checkout: Jest treats many direct-execution *.test.js assertion scripts as empty Jest suites; focused direct scripts need to be run with node. The existing scripts/validate-storage-map-catalog.js fails its stale hard-coded expected map list (expects map_lv_1/map_lv_6/etc., while canonical maps use Green Grounds/other current IDs), and storage-catalog-validation.test.js expects an obsolete items.json materials-array shape. These existing validation fixtures/scripts were not changed to hide their failures. Production build has existing non-fatal component CSS-budget/CommonJS warnings, including the new Market and Mailbox component styling warnings. No migration, DB audit/mutation, or deploy was performed.

Not complete yet: full end-to-end concurrency/rollback tests against disposable PostgreSQL/Redis, migration preservation tests, price-suggestion edge-case tests, complete InventoryGrid drag/drop reuse, richer Mail message-detail/attachment presentation, frontend component/Karma execution, and the full release-readiness/deployed escrow audit. The OpenSpec tasks remain unchecked wherever those requirements/tests are still missing.


### Follow-up fix — Market / Mailbox identity and drag-and-drop (2026-10-24)

Root cause of the reported market_orders.characterId NULL insert: JwtStrategy.validate() returns userId, username, and sessionId, and intentionally omits characterId; the new Market and Mail controllers incorrectly read req.user.characterId. Both controllers now resolve the authenticated account's Character from req.user.userId before every character-scoped operation, and Market listing/purchase service methods reject an empty character ID before starting the transaction. No database schema change was needed for this error.

Replaced the Market's inventory-stack select with a connected Angular CDK drop target. Replaced Mailbox's item-attachment select with a CDK drop target; dropping an inventory stack selects its exact InventoryItem row and defaults the attachment quantity to that stack's quantity, which can then be adjusted. Updated InventoryGrid's connected drop-list IDs so the inventory can actually drag into both new targets. Drop targets use the existing dark fantasy palette and active-drop highlighting. Moved the additional Mailbox drop-target CSS into component-scoped inline styles and the Market drop-zone CSS into component styles to stay within the production hard CSS budget.

Follow-up verification: shared build, API build and frontend TypeScript check passed; production frontend build passed (existing component CSS budget/CommonJS warnings remain, but no hard budget error); direct Market/Mailbox contract checks passed; strict OpenSpec validation passed. No deployment or database mutation was performed.


## Market sell panel inventory follow-up — 2026-10-24
- Embedded the existing `app-inventory-grid` component in the `/market` sell panel above the listing drop slot, reusing its 50-slot inventory, item icons, stack counts, tooltips, sort control, Ctrl+click split modal, and CDK drag data/handlers.
- Added a compact Market-only presentation for the shared inventory grid (5 columns, reduced gaps/title/button, capped scroll height) without changing its default appearance elsewhere.
- Reduced the Market listing drop target to a single 48×48 item slot; dragging a stack onto it selects that inventory row for listing, and the × control clears the selection.
- Validation: frontend TypeScript check and production build passed; `git diff --check` passed. Production build reports the existing component CSS-budget/CommonJS warnings; no deployment or database mutation performed.


## Market inventory slot overlap fix — 2026-10-24
- Corrected the compact-grid CSS selector to target the `app-inventory-grid` host class directly (`:host(.market-inventory-grid)`), so its Market-only layout reliably overrides the shared inventory's default and responsive grid rules.
- Kept the visible grid viewport at 240px and configured five columns with intrinsic-height rows and a vertical-only scrollbar. Each slot reserves its own square row instead of tracks being compressed into the viewport; scrolling reveals the remaining rows.
- Validation: frontend TypeScript check, production build, and `git diff --check` passed. No deployment or database mutation performed.
