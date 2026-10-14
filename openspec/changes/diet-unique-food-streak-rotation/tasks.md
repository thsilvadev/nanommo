# Tasks

## 1. Contract and shared transition rules

- [x] 1.1 Add the OpenSpec capability delta and update root SPEC.md and openspec/specs/SPEC.md to make unique food IDs, full-window eviction, streak reset and digestion-after-eviction authoritative.
- [x] 1.2 Replace the append-without-deduplication transition with one pure/testable helper that accepts Diet plus digestion/level state and returns the canonical next state.
- [x] 1.3 Ensure the level for a selected food is computed before full-window eviction; level increments only if it was retained at transition start, otherwise starts at 0.

## 2. Legacy-state normalization

- [x] 2.1 Add deterministic normalization for duplicate legacy entries: one entry per item, stable oldest-to-newest recency, maximum retained star level preserved, newest digestion boundary respected.
- [x] 2.2 Add an idempotent data migration or equivalent transactional repair for existing Character Diet JSON; reset evicted/absent streak levels without clearing future digestion lockouts.
- [x] 2.3 Ensure Character DTOs cannot continue presenting duplicate food icons after normalization; do not mutate gameplay state in the frontend.

## 3. Wire every food path to the same behavior

- [x] 3.1 Manual food use uses the canonical transition, rejects food still digesting even if its Diet slot was evicted, and mutates Inventory/Diet atomically.
- [x] 3.2 Auto Feed applies the same transition after each consumption and re-reads the state before selecting the next candidate.
- [ ] 3.3 Father Marcelus/NPC-granted Bread and battle-resolution food events apply identical uniqueness, level and ordering rules.
- [x] 3.4 Queue projection/shared BattleEngine snapshots and battle-resolution reconciliation agree on Diet levels and digestion boundaries; preserve the existing mutation boundary and active battle/job immutability.

## 4. Regression coverage

- [x] 4.1 Cover all six user-provided Bread/Cheese/Meat examples, including `[Bread ★★★, Cheese ★, Meat] + Cheese → [Meat, Cheese ★★]`.
- [x] 4.2 Cover repeat levels 0→1→2→3 and cap-at-3, with repeat consumption allowed only after digestion ends.
- [x] 4.3 Cover both Diet lengths <3 and ==3, consuming a new item, the oldest item, a middle item and the newest item.
- [x] 4.4 Cover eviction resetting stars while retaining future digestion lockout; once digestion expires, reintroduction starts at 0.
- [x] 4.5 Cover legacy duplicate repair preserving the highest retained level without inventing extra entries or consuming Inventory.
- [x] 4.6 Cover manual, Auto Feed, NPC and battle-resolution parity plus expected digestion skips (not ERROR logs).

## 5. Verification and documentation

- [x] 5.1 Update `ARCHITECTURE.md` with the unique-window transition and `dietLevels` split between streak versus digestion lockout.
- [x] 5.2 Update `STATUS.md` with the diagnosis, change ID, implementation pending and validation/test evidence.
- [x] 5.3 Run focused Diet regressions, shared/API/frontend builds, `pnpm exec openspec validate diet-unique-food-streak-rotation --strict`, and `git diff --check`.
- [ ] 5.4 No production deploy as part of implementation unless separately requested.
