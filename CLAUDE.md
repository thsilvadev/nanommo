# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

NanoMMO is a browser idle MMORPG: server-authoritative deterministic battles, FFXII-style Gambit automation, world travel/gathering, crafting, and a player market. pnpm monorepo (Node ≥ 20):

- `apps/api` — NestJS 10 + TypeORM (PostgreSQL 16) + Bull (Redis 7) + Socket.IO
- `apps/frontend` — Angular 18 (standalone components, Signals, Tailwind)
- `packages/shared` (`@nanommo/shared`) — battle engine, DTOs, enums, types used by both apps
- Root `*.json` — canonical game data catalogues (items, monsters, maps, skills, quests, recipes, …)

Code and most docs are in English; some commits/docs are in Portuguese. UI text is localized (en / pt).

## Commands

```bash
pnpm install
docker-compose up -d db redis          # Postgres + Redis (backend container maps to :3010)

pnpm --filter @nanommo/shared build    # MUST be built first; api, frontend and tests consume its dist/
pnpm --filter @nanommo/api build
pnpm --filter @nanommo/api dev         # nest start --watch, :3000 — cwd must be apps/api (see below)
pnpm --filter @nanommo/frontend start  # ng serve, :4200
pnpm --filter @nanommo/frontend build --configuration production

pnpm --filter @nanommo/api lint        # eslint --fix
pnpm --filter @nanommo/api db:migrate  # builds, then runs the guarded migration runner
pnpm --filter @nanommo/api db:migration:show
node scripts/sync-frontend-data.js     # mirror root catalogues into apps/frontend/public/data
pnpm exec openspec validate <change-name> --strict
```

### Tests

`pnpm --filter @nanommo/api test` (Jest) is **not a usable gate**: most files in `apps/api/test/*.test.js` / `*.spec.js` are direct-execution Node assertion scripts with no Jest `test()` blocks, and there is no ts-jest transform for the `.spec.ts` file. Run them individually with Node, after building what they import:

```bash
pnpm --filter @nanommo/shared build && pnpm --filter @nanommo/api build
node apps/api/test/battle-tickrate-500ms.test.js
```

They `require` from `packages/shared/dist` and `apps/api/dist/apps/api/src/...`, so stale `dist/` means stale tests. Many are source-contract tests that regex-match source files, migrations, and catalogue mirrors.

Catalogue validators: `node scripts/validate-monster-catalog.js`, `validate-world-map.js`, `validate-cooking-catalog.js`, etc.

Frontend: `pnpm --filter @nanommo/frontend test` (Karma/Jasmine, needs Chrome / `CHROME_BIN`); single spec: `ng test --include='**/game.store.spec.ts'` from `apps/frontend`. Type-check specs without a browser: `tsc -p tsconfig.spec.json --noEmit`.

Some scripts/tests are known-stale and fail for unrelated reasons (e.g. `scripts/validate-storage-map-catalog.js`, `storage-catalog-validation.test.js`, `town-vendor-progression.js`); don't "fix" fixtures just to make them pass. Angular production builds emit known non-fatal CSS-budget/CommonJS warnings.

## Architecture

### Core principles

- **Server authority.** The client sends intents and animates from server timestamps (`startAt`/`endAt`); it never simulates game logic.
- **Determinism.** Battles are pure functions of a snapshot + seed, using the Mulberry32 PRNG in `packages/shared/src/battle-engine/prng.ts` — never `Math.random()` in game logic. The simulator lives in `packages/shared/src/battle-engine/index.ts` (`BattleEngine`), with rewards, mastery rewards, status timeline and persistent-status helpers alongside.
- **Fixed 500 ms combat tick.** `BATTLE_TICK_DURATION_MS` must be `500`; other values fail API startup. Convert with the helpers in `battle-engine/time.ts` (`secondsToBattleTicks`, etc.) rather than hard-coding tick counts. In-battle state uses ticks; anything persisted on the Character (status effects, cooldowns) uses absolute ISO timestamps.
- **Pre-computed battle queue.** `BattleQueueEntry` rows are generated ahead of time and resolved by Bull jobs at `endAt`, so the game progresses while the client is offline.

### Backend (`apps/api/src`)

- `modules/battle` — `BattleService` (queue generation, `resolveBattle`, `runFutureCombatMutation`), `battle-queue.processor.ts` (Bull consumer), `battle-queue-gate.service.ts`, `battle-recovery.service.ts`.
- `modules/map` — `MapService` (map transitions, travel, gathering, flee) and `world-activity.processor.ts`. The single `battle-queue` Bull queue is shared by battle resolution, Travel, Gathering and FLEE jobs.
- `modules/data/data.service.ts` — loads and validates all root JSON catalogues at boot.
- `modules/gateway` — Socket.IO gateway pushing authoritative Character/Inventory/queue snapshots (e.g. `battle:resolved`). `modules/presence` — Redis-backed map and online presence.
- Other feature modules: auth (JWT + Google OAuth), character, gambit, inventory, equipment, town (vendors, storage, NPCs), market, mail, quests, chat, notifications (web-push), mailer.
- `config/battle-runtime.config.ts` reads tick/concurrency env keys directly from `.env` because Bull `@Process` concurrency is decorator metadata evaluated before `ConfigModule` loads.
- `database/` — entities, migrations, and migration safety/baseline tooling; `maintenance/` — standalone scripts run from `dist/` (migrations, queue reconciliation, tickrate cutover). `synchronize` is always `false`.

Rules that keep recurring (details in `ENGINEERING_NOTES.md`):

- **cwd must be `apps/api`** when running the backend: `DataService` resolves catalogues via `process.cwd() + '../../'`. From the repo root, getters silently return `null`.
- The JWT carries `userId`, never `characterId`; resolve the character with `characterService.getCharacterByUserId(req.user.userId)`.
- Enforce ownership in the query predicate (`{ id, characterId }`) and return 404, not 403.
- TypeORM drops `undefined` on save — use `null` to clear a column. DB columns are camelCase (`"characterId"`), quoted in raw SQL.
- `resolveBattle()` and other job handlers must be idempotent (conditional claim before mutating); Bull retries and recovery passes redeliver. Don't `job.remove()` the active job.
- Any change that alters a character's future combat (equipment, stats, gambits, mastery, consumables) must go through `BattleService.runFutureCombatMutation()` so queued, unstarted battles are invalidated and regenerated.
- DTOs without class-validator decorators bypass the global `ValidationPipe`; throw Nest HTTP exceptions, not bare `Error` (which is a 500).
- A character with no active gambit page never attacks and loses by stalemate — tests/E2E must activate an `always → attack` page.
- Gambit params exist in multiple shapes (`{id, band}` inline vs `{id, params:{band}}`; monsters use a third). Test new data consumers against the real files.
- Auto-feeding belongs to the Diet/Auto Feed system, not Gambits.

### Game data

Root JSON files are the single source of truth. `maps.json` owns topology and weighted monster presence; `monsters.json` holds species and their specific drops; `items.json`, `skill_trees.json`, `status_effects.json`, `gambit_catalog.json`, `quests.json`, `*_recipes.json`, `npc_*.json`, `appearance_catalog.json` (3D creator options), XP curves. The attribute key is `LUK`/`luk` (not `SOR`). Town is `map_town` (`TOWN_MAP_ID`).

The frontend reads mirrors in `apps/frontend/public/data/`. Edit only the root files, then run `node scripts/sync-frontend-data.js` (also runs automatically in the frontend `build` script and on Vercel). Several contract tests assert root/mirror parity.

### Frontend (`apps/frontend/src/app`)

- `core/` — `ApiService`, `GameSocketService`, signal stores (`game.store.ts`, `auth.store.ts`, `vendor.store.ts`), `CatalogService` (catalogue mirrors), `LocaleService`, guards.
- `features/` — `auth` (includes the 3D character creator), `play` (main game shell: grind, map, town, market, mailbox), `character`, `gambit`, `error`.
- `shared/character-viewer/` — three.js character model (creator and Character Summary portrait). three.js is only loaded on demand. Its GLB/PNG assets in `public/assets/character/` are generated by `tools/character-assets/` from CC0 packs that are not versioned; regenerate them there, never edit by hand.
- A Character with `appearance = null` is refused game actions with `403 APPEARANCE_REQUIRED` (global `AppearanceRequiredInterceptor`; opt out with `@AllowWithoutAppearance()`), and API startup requires `CHARACTER_3D_CUTOVER_COMPLETE=true` (see `docs/deployment/character-3d-cutover.md`).
- Stores reconcile HTTP responses and realtime snapshots by `stateVersion`; stale HTTP responses must not overwrite newer socket snapshots. `CharacterStore.load()` resolves with `state = 'error'` instead of throwing — guards must inspect state.
- UI state such as grind stance must initialize from an authoritative `/characters` read, never a hard-coded default.

## Debugging production

See `DEBUGGING.md`. The API writes one log file per UTC minute (`~/nanommo/logs/api/api_YYYY-MM-DD_HH-MMZ.log` on the server, last 30+ minutes kept). When the user reports a production bug, **remind them of it** and ask for the screenshots plus `scripts/fetch-server-logs.sh` output (user's local time is UTC−4). `[queue-delete]` lines record every battle-queue deletion by travel/stance.

## Workflow conventions

- **OpenSpec**: features are specified as changes under `openspec/changes/<name>/` (proposal, design, tasks, spec deltas); the consolidated spec is `openspec/specs/`. Validate with `openspec validate <name> --strict`.
- **Docs kept in step with code**: `STATUS.md` is a dated session log (newest entries at top) recording what changed and exactly what validation ran; `ARCHITECTURE.md` gets dated decision entries; `ENGINEERING_NOTES.md` is the append-only list of traps; `SPEC.md` is the game design spec. `technical_debts/` tracks known debts.
- **Migrations are forward-only and are written but not executed** as part of a code change. Never run migrations, mutate a live database, or deploy unless explicitly asked; STATUS entries state this explicitly.
- **Deploys**: pushing to `main` triggers `.github/workflows/deploy-backend.yml` (SSH → `git reset --hard` → `docker compose up -d --build` on the production server, gated on required `.env` values). The frontend deploys on Vercel via `vercel.json`. Treat pushes to `main` as production releases.
- The README's setup section is partly outdated (references `apps/web` and Caddy); the frontend is `apps/frontend`.
