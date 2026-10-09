# NanoMMO — Implementation Status

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
- Food consumption is centralized on a transactional backend path with Character/Inventory row locks. It shifts the three Diet slots, prevents repeating a food while its prior digestion is active, and increases permanent Diet stars only after completed digestion, capped at ★★★.
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
