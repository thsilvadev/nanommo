# Alpha cutover: 500 ms battle clock

This is a planned maintenance operation, not part of a normal application deploy. It deliberately discards pre-cutover battle queue/history rows rather than trying to replay one-second simulations under the new clock. **Do not run it from a normal API process or while any API/Bull consumer is alive.** The repository implementation defaults to a read-only dry run.

## What the cutover changes

The command returns all Characters to canonical `map_town`, deletes every `battle_queue_entries` row, and removes only these obsolete `battle-queue` job names: `resolve-battle`, `queue-battles`, `idle-journal-precombat`, `advance-travel`, `advance-stationary-activity`, `attempt-flee`, and `resume-world-activities`.

It clears transient map transition, Travel, Gathering-cycle, encounter-cycle, and flee state. It preserves Character identity, level/XP, attributes, points, equipment, inventory, Gold, Soul Tokens, quests, Mastery, saved Town, HP/SP, Diet, absolute wall-clock food buffs/cooldowns, and all persisted Cooking/Crafting sessions. Bull jobs `complete-cooking` and `complete-crafting` are intentionally preserved. The shared Bull queue remains globally paused when the command exits; the new API startup gate performs authoritative reconciliation before resuming it.

## Production `.env` prerequisites

Set these exact values in the server `.env` before the new API starts:

```dotenv
BATTLE_TICK_DURATION_MS=500
BATTLE_RESOLVE_CONCURRENCY=4
BATTLE_QUEUE_CONCURRENCY=2
WORLD_ACTIVITY_CONCURRENCY=1
BATTLE_TICKRATE_500MS_CUTOVER_COMPLETE=false
```

Compose already forwards `.env` to the backend through `env_file`; no new container or port is introduced. The GitHub deploy workflow refuses to start the new application image until the first four values match and `BATTLE_TICKRATE_500MS_CUTOVER_COMPLETE=true` is set after the guarded maintenance cutover.

## Ordered maintenance procedure

1. Push/prepare the code so the server checkout contains the new migration and maintenance utility. The deployment workflow will stop at its `.env` guard while `BATTLE_TICKRATE_500MS_CUTOVER_COMPLETE=false`; do not manually start the new backend yet.
2. On the server, update the code checkout as appropriate, build the backend image, then stop every backend/API/Bull consumer:

   ```bash
   docker compose build backend
   docker compose stop backend
   docker compose ps
   ```

   Verify there is no separate worker process/container still consuming `battle-queue`. Keep PostgreSQL and Redis running. Do not run `docker compose down -v`.
3. Inspect the migration history using the read-only command and apply the new migration with the existing guarded migration runner:

   ```bash
   docker compose run --rm --no-deps --entrypoint node backend src/maintenance/show-migrations.js
   docker compose run --rm --no-deps \
     -e BATTLE_QUEUE_MAINTENANCE_ONLY=true \
     -e CONFIRM_QUEUE_CONSUMERS_STOPPED=1 \
     --entrypoint node backend src/maintenance/run-migrations.js
   ```

   The migration is additive and gives existing rows a schema-compatible default. That default does **not** make old logs valid: the startup guard still rejects any retained row whose immutable log header lacks `tickDurationMs: 500`.
4. Run the cutover utility in its default read-only mode. Review the database name, Character count, battle-row count, active Bull count, obsolete job count/by-name, and preserved Cooking/Crafting job counts. Do not proceed if any active job remains or the database identity is not the intended production database:

   ```bash
   docker compose run --rm --no-deps --entrypoint node backend src/maintenance/cutover-battle-tickrate.js
   ```
5. Only after every consumer is stopped and the dry-run report is reviewed, run the explicitly destructive operation:

   ```bash
   docker compose run --rm --no-deps \
     -e BATTLE_QUEUE_MAINTENANCE_ONLY=true \
     -e CONFIRM_QUEUE_CONSUMERS_STOPPED=1 \
     -e CONFIRM_BATTLE_TICKRATE_CUTOVER=500MS \
     --entrypoint node backend src/maintenance/cutover-battle-tickrate.js --execute
   ```

   This command refuses unless the migration is recorded, no Bull job is active, and all three confirmations are present. It pauses the Bull queue before writing. It does not flush Redis or delete other job types. If PostgreSQL or Redis cleanup fails, the queue remains paused; investigate and rerun the utility rather than starting consumers.
6. Review the successful report: zero battle rows, zero obsolete combat/encounter jobs, all Characters in `map_town`, and Cooking/Crafting jobs/sessions preserved. Then set `BATTLE_TICKRATE_500MS_CUTOVER_COMPLETE=true` in the server `.env`.
7. Start the new backend and verify its startup logs show current migration history, no legacy battle rows, successful map-presence reconciliation, queue readiness, and persisted world-activity recovery:

   ```bash
   docker compose up -d backend
   docker compose logs --tail=200 backend
   docker compose ps
   ```

   The startup guard independently refuses to replay or project any row without both row-level and log-header `tickDurationMs=500`; it keeps Bull paused and the readiness gate closed. Do not bypass that guard.

## Rollback

If the new runtime must be rolled back after cutover, stop the new backend first. Keep the extra `tickDurationMs` database column and migration history; the old application does not need that additive column removed. Deploy the previous code and allow its startup/reconciliation path to rebuild fresh queues from Town. Do not restore a database backup containing old queue rows into the new runtime, do not replay 500 ms rows under old code, and do not run a destructive TypeORM `down` against the tick metadata migration. Persistent Character data is not reset by this rollback.

## Explicit safety prohibitions

- Never use `FLUSHDB`, `FLUSHALL`, truncate all Redis keys, or delete the Redis volume.
- Never delete Character, Inventory, Equipment, Quest, Proficiency/Mastery, Currency, or Cooking/Crafting session rows.
- Never remove `complete-cooking` or `complete-crafting` jobs as part of this cutover.
- Never run the destructive command while a backend/worker consumer is active.
- Never claim load-tested support for 200 or 250–300 concurrent battlers. The separate benchmark debt remains open.

No migration, cutover, production command, or deployment has been executed by the code implementation task.
