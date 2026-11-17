# Party combat rollout and operational rollback

This is a deployment runbook, not authorization to run migrations, restart consumers, delete queues or alter production. The implementation must report which gates have actually passed. Do not treat source-level tests as evidence of database concurrency correctness.

## Before deployment

1. Record application revision, engine versions and feature/cutover settings. Take consistent PostgreSQL backup and preserve Redis queue/job metadata with a recovery plan. Record active legacy battles and traveling characters through read-only queries.
2. Audit schema constraints and compare all active participation/member claims with Characters, Party leadership, map placement, pending intents and clocks. Identify orphaned legacy jobs and shared jobs without changing them. Resolve findings explicitly; no broad queue or table cleanup.
3. In disposable PostgreSQL and Redis, run the forward-only migration, seed active V1 and V2 fixtures, exercise a restart with overdue clocks and duplicate jobs, and inject failure before/after commit. Verify one active battle per character and exactly-once inventory/XP/drop application. Prove unique claims and lock order with concurrent processes. Keep the output as rollout evidence.
4. Run builds, catalogue/mirror validators, focused appearance guard and battle-recovery lifecycle regressions, deterministic engine tests and strict OpenSpec. Verify existing appearance-required HTTP and Socket protections also cover new Party paths. Verify desktop and short viewport, reconnect and reduced motion.

## Deployment sequence

1. Stop encounter-producing consumers and schedulers in a controlled way. Drain or pause workers without deleting jobs, and keep read APIs available where supported. Record the last observed legacy/shared states.
2. Back up again at the maintenance boundary, run the reviewed forward-only migration once, and confirm constraints and indexes. Never rewrite an already-started snapshot, legacy history or consumed encounter.
3. Start recovery with the branch's established appearance/3D cutover initialization gate. Dispatch V1 rows/jobs only to the V1 resolver; dispatch V2 rows/jobs only to V2. Reconstruct missing due work from persisted clock/battle/intent states. Reconciliation must be idempotent.
4. Enable new encounter production only after recovery and read-only audits pass. Observe shared battle claims, duplicate deliveries, stalled intents, overdue clocks, participant associations, cooldowns and reward consistency before expanding availability.
5. Retain V1 readers/resolvers until every legacy active entry/job has completed and historical readers have been exercised. Keep old/new histories distinguishable by engineVersion.

## Rollback

Stop new V2 encounter production and pause its consumers first. Preserve all Party/V2 tables, active snapshots, intent statuses, results, queue metadata and logs. Keep a compatible V2 resolver/recovery worker to finish already-started battles or checkpoint them with a reviewed recovery procedure; do not hand them to V1 or recompute results with different rules. Continue V1 processing through its original resolver. Keep state readable and display clear pending status while consumers are paused.

Do not automatically down-migrate, delete Party/V2 rows, restore an old application that cannot read the schema, clear Bull/Redis, or restore a database backup over post-deployment progress. A destructive restore requires a separate explicit operational decision and reconciliation plan. Fix forward when practical. Re-enable production only after the same audit, migration/recovery and concurrency gates pass.

## Initial content balance

All raid probabilities are zero. Each map roster entry lists its map's candidate species (self included); configured probabilities are exclusive and total at most 100. Sapupema Leaf gathering in Caetê 6 is 10%, preserving positive Herbs/Mystic Dust weights at 63%/27%. Tea crafting awards 25 Alchemy XP. Fairy retains the user's level 10 and ten Mystic Dust requirements. These decisions do not authorize other content rebalancing.
