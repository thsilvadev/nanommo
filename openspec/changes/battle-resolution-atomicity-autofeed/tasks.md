# Tasks

## 1. Auto Feed eligibility

- [x] 1.1 Base repeated-food eligibility on the newest retained Diet occurrence for an `itemId`.
- [x] 1.2 Treat the expected `Food is still digesting` guard as a skipped candidate, while propagating unrelated exceptions.
- [x] 1.3 Add a repeat-food regression where the old occurrence has expired but the latest occurrence has not; verify Auto Feed consumes a different eligible food.

## 2. Transactional battle resolution

- [x] 2.1 Lock Character then BattleQueueEntry and make the authoritative battle writes plus `resolved = true` commit in one transaction.
- [x] 2.2 Route simulated item consumption, food consumption, drops, pending equipment changes, kill-counter writes, and death/Town queue cleanup through the same EntityManager.
- [x] 2.3 Move BullMQ job removal, map-presence synchronization, queue maintenance, and Socket.IO publishing after commit.
- [x] 2.4 Preserve duplicate-job no-op semantics and update the committed integration test's expected idempotency primitive.

## 3. Verification and documentation

- [x] 3.1 Targeted repeat-food Auto Feed regression passed; existing Diet rule Jest suite passed.
- [x] 3.2 API production build passed and `git diff --check` passed.
- [x] 3.3 Update root SPEC, OpenSpec canonical SPEC, ARCHITECTURE, STATUS, and the re-runnable idempotency test contract.
- [ ] 3.4 Run the concurrent BullMQ/recovery integration against a live API + PostgreSQL + Redis stack, including restart-race mode; unavailable in this session because Docker is not running and the API/Redis are not available locally.
