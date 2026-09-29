# Design

## Context

See `proposal.md` for motivation and `specs/grind-loop-verification/spec.md` for the guarantees under test. What shapes the approach here is the current state of the verification tooling and the code paths being exercised.

**There is no backend test infrastructure.** `apps/api/package.json` declares `"test": "jest"` with `jest` and `ts-jest` in devDependencies, but there is no `jest.config.js`, no `test/` directory, and `npx jest --listTests` returns zero files. Every existing verification artifact is an ad-hoc Node script that talks to a running stack directly:

- `apps/api/test-s63.js`, `test-s63-final.js`, `test-stability.js`, `debug-killcounter.js` — Node scripts using `fetch` + `pg` + `ioredis`
- `e2e-test.js`, `e2e-test-complete.js` — Playwright against the Angular dev server
- `test-e2e.sh`, `test-character-auto-create.js`

`test-s63.js` is the most complete of these and is the pattern to follow: a `request()` helper over `fetch`, a `pg` `Client` for direct DB inspection, an `ioredis` client for BullMQ job inspection, a `sleep()` helper, and a timestamp-derived unique user per run.

**Two port conventions coexist and the scripts are inconsistent about which they use.** `docker-compose.yml` maps the backend to host port `3010` (the container listens on `3000`, remapped to avoid clashing with host dev servers). STATUS.md §9 documents this, but `test-s63.js` and `test-s63-final.js` both hardcode `BASE_URL = 'http://localhost:3000'`, and `e2e-test.js` hardcodes `4200` for the frontend. The Phase 3 scripts must resolve the backend port from an env var defaulting to `3010`, so they work against docker-compose without editing.

**The system under test exposes no direct battle-resolution endpoint.** `BattleQueueController` only has `GET /battles/queue` and `POST /battles/queue`; there is no `POST /battles/:id/resolve`. `resolveBattle()` is private to the worker path and is reached either by a BullMQ delayed job firing at `endAt` or by the boot recovery pass. This is the single biggest constraint on how the idempotency and crash-recovery scenarios can be written — see Decisions.

**Three implementation details shape the scenario design** (all verified by reading the source during planning):

1. `resolveBattle()` claims a battle with a conditional `UPDATE ... WHERE id = :battleId AND resolved = false` before applying any effect (`battle.service.ts:371-383`). This is the atomicity primitive the idempotency scenario targets.
2. `BattleRecoveryService.onApplicationBootstrap()` runs inside `app.listen()` before the HTTP port binds, and scans `WHERE resolved = false AND endAt < now()` ordered by `endAt ASC, startAt ASC, sequenceIndex ASC` (`battle-recovery.service.ts:61-93`). Ordering is per-row, not per-character, which is a latent correctness detail worth asserting.
3. The per-battle seed built in `queueBattles()` is `${characterId}:${mapId}:${monsterId}:${sequenceIndex}:${epoch}:${killIndex}` (`battle.service.ts:277`). Because `sequenceIndex` participates, a rebuilt queue legitimately yields *different* seeds for the same logical fight. The determinism scenario must therefore target `BattleEngine.simulateBattle()` directly, not round-trip through the queue.

## Goals / Non-Goals

**Goals:**

- Produce committed, re-runnable evidence for all six Phase 3 areas with no new dependencies and no new infrastructure.
- Make each failure mode diagnosable: a failed assertion names the SPEC clause it violates and prints the observed vs. expected values.
- Keep the scripts resilient to a live stack, where the previous session's balance finding (STATUS.md Issue #2: a level-1 character loses every fight and earns 0 XP) means most assertions need deliberate state seeding rather than organic play.

**Non-Goals:**

- No production code changes. The suite asserts code-as-written; the divergences in the "Known divergences" section below are documented, not fixed.
- No Jest, no `test/` directory, no CI wiring, no schema migration, no new npm dependency.
- Not covering Phase 4 concerns: WebSocket events (`battleResolved`, `characterDied` per §16.2), the balance pass (STATUS.md Issue #2 / §19.3), the `maxHp: null` response DTO issue (STATUS.md Issue #1), or the stubbed `ChatService`/`MailService`/`TownService`/`MarketService`.

## Decisions

### D1 — Ad-hoc Node scripts following the `test-s63.js` pattern, not Jest

**Chosen:** one Node script per Phase 3 area plus a shared helper module, run against docker-compose with direct `fetch` + `pg` + `ioredis` access.

**Rationale:** it is the only pattern with working precedent in this repo; the existing scripts already solve the hard parts (unique user generation, email-verification bypass, BullMQ introspection, waiting on delayed jobs). Adding Jest would mean building module-resolution config for NestJS path aliases, deciding how to provision Postgres/Redis for tests, and reconciling with the frontend's Angular Jest setup — a large infrastructure change for a change whose stated purpose is validation.

**Alternative considered:** Jest + a proper `apps/api/test/` suite. Rejected for this change: it is a strictly larger project, and `jest` being declared-but-unconfigured is pre-existing tech debt unrelated to the grind loop. If the suite proves valuable to keep, promoting the pure/deterministic cases (determinism, gambit validation, PRNG) into Jest unit tests afterwards is a natural follow-up, since those need no stack at all.

### D2 — A shared `test/helpers/phase3.js` bootstrap, duplicated from `test-s63.js` rather than refactored out of it

**Chosen:** copy the proven bootstrap (register unique user → `UPDATE users SET email_verified = true` → allocate attributes → `POST /maps/:mapId/enter`) into a new helper, and have all six scripts import it.

**Rationale:** the existing scripts each carry their own copy; extracting a shared module would mean editing files that currently pass and that the user has not asked to change. Duplication is acceptable for a bounded six-script suite, and each script stays independently runnable and readable.

**Alternative considered:** refactoring `test-s63.js` to import the shared helper. Rejected — it risks breaking a known-good script for no gain in this change.

### D3 — Edge cases are reached by seeding state directly in Postgres, not by playing the loop until they occur

**Chosen:** use the `pg` client to set up the precondition for each scenario — set `characters.level`/`xp` so the very next resolve crosses a level threshold; force a specific `outcome` by constructing a `BattleQueueEntry` row with `outcome = 'loss'`; set `characters.map_kill_count`/`epoch` to pin the encounter stream.

**Rationale:** STATUS.md Issue #2 records that a level-1 character loses every fight in Green Grounds, so an organically-earned level-up or death would take hours and is not reproducible. The queue is pre-simulated, so the win/loss of each entry is decided at queue-build time and can be written directly.

**Trade-off:** the scripts assert resolver behaviour against hand-built state, not exclusively against organically-produced state. Each scenario still creates its character and queue through the real API path where practical; only the specific precondition is seeded. This is recorded as a limitation, not hidden.

### D4 — Idempotency is tested at the BullMQ layer, since `resolveBattle()` is not reachable over HTTP

**Chosen:** verify idempotency by driving two concurrent resolutions of the same battle through the mechanisms that genuinely can race — (a) letting the BullMQ delayed job fire while simultaneously restarting the container so the boot recovery pass scans the same row, and (b) asserting directly at the database level that a second conditional `UPDATE ... WHERE resolved = false` matches zero rows, which is the exact predicate the claim depends on.

**Rationale:** there is no `POST /battles/:id/resolve` route, so the resolver cannot be called twice from a test process alone. Options considered and rejected: adding a resolve endpoint (changes the API surface and the attack surface, out of scope); instantiating `BattleService` in-process (requires standing up the full Nest DI graph, the Bull queue, and a real DB connection — effectively rebuilding the app in a test); driving BullMQ directly by manually adding a second `resolve-battle` job with the same `battleId` (works, and is the primary approach).

**Chosen concretely:** the primary concurrency test adds a second `resolve-battle` job for the same `battleId` *while the first is still delayed*, so both fire in the same window; plus a restart-race test that kills the backend container mid-queue and asserts recovery does not double-apply. The claim-predicate check is a supporting assertion, not the whole test.

### D5 — Crash recovery is tested by writing past-dated rows and restarting the container

**Chosen:** insert `BattleQueueEntry` rows with `endAt` in the past (`resolved = false`) and `docker compose restart backend`, then assert the effects were applied exactly once and that a still-alive character on a map was topped back up to 5.

**Rationale:** this mirrors SPEC §19.4's prescribed approach almost verbatim ("manually insert `BattleQueueEntry` rows with `endAt` in the past, restart the resolving service") and requires no new code path. The script asserts against Postgres directly, since the recovery pass completes before the HTTP port binds and cannot be observed via the API.

**Note:** the recovery log line `SPEC §7.5 crash recovery complete in Nms: resolved X stale battle(s), topped up Y character queue(s)` is the primary positive signal; the script greps `docker compose logs backend` for it and then verifies the resulting DB state.

### D6 — Determinism is tested by calling the engine directly, not through the queue

**Chosen:** `require('@nanommo/shared')`, call `BattleEngine.simulateBattle()` twice with a fixed snapshot/monster/gambit/seed, deep-compare the results with `JSON.stringify`; then re-simulate a *stored* battle's `seedUsed` + `characterSnapshot` from the log header and compare against the persisted log.

**Rationale:** the queue's seed includes `sequenceIndex` (`battle.service.ts:277`), so two queue builds of the same logical fight do not share a seed. Testing determinism through the queue would be testing the wrong thing. The engine is a pure function exported from the shared package, so this is a genuinely pure, fast, stack-free check — and it is the one scenario that needs neither docker-compose nor a database.

### D7 — Gambit validation is split into save-time (HTTP) and runtime (engine) halves

**Chosen:** save-time rules (§8.4) go through `PUT /gambits/:pageId` and assert `400` + `fieldErrors` + an unchanged stored page; runtime legality (potion stock, the shared 5-tick potion cooldown category, condition-true-but-illegal skipping) is tested against `GambitEvaluator` and the engine directly, with a crafted gambit page and inventory.

**Rationale:** the two halves live in different places — `GambitService.validateGambitPage()` is HTTP-reachable and rejects before any repository write, whereas cooldown and illegal-line-skip are engine-internal runtime concerns (§7.2, §7.3 step 4) with no endpoint at all. The engine half needs a crafted page: e.g. a priority-1 `use_item` line for a potion the character does not hold, with a priority-2 `attack` line, then assert the log's first event is the attack.

### D8 — Assertions are structured so each names its SPEC clause

**Chosen:** a small `assert(name, condition, detail)` helper in the shared module that prints `[PASS]`/`[FAIL] name — expected X, got Y`, counts failures, and sets a non-zero exit code.

**Rationale:** makes a red run self-diagnosing, which is the entire point of replacing prose "Tested" claims with evidence. Kept deliberately minimal — no assertion library, no diffing framework, no new dependency.

## Known divergences (documented, not fixed — per the user's decision to test code-as-written)

These were found while reading the source during planning. The Phase 3 suite asserts the **current** behaviour, and the findings are written into STATUS.md. They are follow-up work, not Phase 3 defects.

| # | SPEC clause | Code | Impact |
|---|---|---|---|
| 1 | §6.4: `xp = max(0, xp - round(xpToNextLevel(L) * 0.05))`, with a clamp at `cumulativeXp[L-1]` so death can never de-level | `battle.service.ts:533-534` uses `Math.floor(...)` and floors the result at `0` | Two things: the spec says `round`, the code says `floor` (a 1-XP difference at low levels). More substantively, §6.4's `cumulativeXp` clamp is written for an *absolute* XP model, but §4.2 defines `Character.xp` as "current XP toward next level" and the level-up loop subtracts `xpToNextLevel` — under which `max(0, …)` is the correct and sufficient floor and the `cumulativeXp` clamp is undefined. **This is a spec-internal inconsistency, not only a code bug**; it needs a decision on which XP model is canonical before either is "fixed". |
| 2 | §4.7 / §7.4.3: "on resolve, the row is deleted" | `resolveBattle()` sets `resolved = true` and re-saves the row (`battle.service.ts:502`); rows are never deleted | Read paths are correct (`getBattleQueue` filters `resolved = false`), so behaviour is unaffected — but `battle_queue_entries` grows without bound and holds full JSON logs forever. |
| 3 | §6.3: the HP/SP ratio must reflect the character's real maximums | `battle.service.ts:462-463` calls `BattleEngine.calculateDerivedStats(preLevel, attributes, {})` with an **empty equipment argument**, while `buildCharacterSnapshot()` (`battle.service.ts:144-160`) passes real `equipmentStats` | The ratio is computed on unequipped base stats. If equipment contributes to `maxHp`/`maxSp`, the scaled current HP is off by the equipment contribution. Masked today because the level-1 test characters are effectively unequipped. |
| 4 | §6.3 states the scaling formula per level-up | `battle.service.ts:465-472` applies **one** ratio step across the whole batch, pre-first-level to post-last-level | For a single level-up this is exact. For a multi-level batch it differs from compounding the ratio per level. The spec does not state which is intended for multi-level gains. |

## Risks / Trade-offs

**[The stack is a hard prerequisite]** → Every script except the determinism scenario requires `docker compose up --build` (~70s from clean) and a backend reachable on the configured port. Scripts fail fast with a clear message if the health endpoint is unreachable, rather than hanging on a fetch timeout.

**[Direct DB seeding can construct states the loop would never produce]** (D3) → Every seeded precondition is commented in the script with the SPEC clause it approximates, and the resulting scenario is labelled as seeded in the script's header output. A scenario that finds a real bug in a seeded-but-unreachable state is reported as "suspicious, needs review" rather than an automatic failure.

**[Time-dependent waits make the suite slow and potentially flaky]** — BullMQ delayed jobs fire at `endAt`, and a battle is 15–60s of in-game time → Prefer polling on observable state (a `resolved = true` row, a changed `characters.xp`) over `sleep()` with a fixed duration, with a generous timeout and an explicit failure message naming what never became true. Where a battle's duration makes the test impractical, the script shortens the wait by rewriting `endAt` to the past — which is legitimate, because the resolver's contract is "fired after `endAt`", not "fired exactly at `endAt`".

**[D4's concurrency test depends on BullMQ delivery timing]** → Firing two jobs for the same `battleId` in the same window is a real race but not a guaranteed one; if the second job happens to fire after the first completed cleanly, the test passes without having exercised concurrency. Mitigation: assert that the *outcome* (effects applied exactly once) holds regardless, and log the observed claim order from the backend logs so a non-race run is visible rather than silently passing.

**[Container restarts inside a script are disruptive]** — the crash-recovery and restart-race scenarios restart the `backend` service → Those two scripts are the last in the suite and are skipped by the aggregate runner unless `PHASE3_RESTART=1` is set, so a routine full run does not bounce the stack. They still run individually on demand.

**[Scripts hardcode Postgres credentials]** (already the case in `test-s63.js`) → Read connection settings from `.env`/env vars with the current values as defaults, so the same pattern holds but the credentials are not additionally buried in six more files.

**[STATUS.md claims will be rewritten]** → A test that passes once and is never re-run decays into exactly the unreproducible claim it replaces. Mitigation: the STATUS.md rewrite points at a named script per row and the aggregate script's exit code is the only thing that counts as evidence.

## Migration Plan

Not applicable — no production code, schema, API, or deployment change. Rollback is `git revert` of the test scripts and the STATUS.md edit.

## Open Questions

- **Should the multi-level level-up scaling be one step or compounded per level?** (D-Known-divergences #4) This is a spec question, not a test question. The suite asserts current behaviour (one step) either way, so it does not block this change; it should be settled before any future fix. Recorded in STATUS.md as an open question.
- **Which XP model is canonical — absolute-with-cumulative-floors (§6.4) or toward-next-level (§4.2)?** (divergence #1) This one is more pressing: it decides whether the code's `max(0, …)` floor is correct or a bug. The suite asserts current behaviour, so it does not block, but it should be decided before the XP-loss code is touched again.
