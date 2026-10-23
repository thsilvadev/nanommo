# Tasks

## 1. Traveling preview resilience
- [x] 1.1 Make active server destination/path override stale local preview state.
- [x] 1.2 Add regressions for restored destination/path after local state loss.
- [x] 1.3 Correct moving-pin vertical alignment by 7px without shifting settled placement.

## 2. Gathering progression
- [x] 2.1 Add persisted cumulative Gathering XP to Character/API/frontend DTOs and an additive forward-only migration.
- [x] 2.2 Award +30 XP only in the transaction that grants a resource; recalculate level at 100 cumulative XP.
- [x] 2.3 Keep the existing gathering-time formula level-aware and show current-level XP in Professions.
- [x] 2.4 Test successful grant, inventory-capacity discard, XP thresholds, and duration reduction from level-up.

## 3. Verification and documentation
- [x] 3.1 Update root and canonical SPEC mirrors, ARCHITECTURE, and STATUS.
- [x] 3.2 Run shared/API builds, frontend development and production builds, focused backend/frontend tests, strict OpenSpec validation, and `git diff --check`.
- [x] 3.3 No migration execution, live database mutation, or deployment.
