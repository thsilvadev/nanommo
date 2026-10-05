# Tasks

## 1. Diet streak state

- [x] 1.1 Replace permanent per-food mastery semantics with retained three-slot streak semantics in the authoritative food-consumption path; verified with targeted tests for 0->1->2->3 and eviction reset.
- [x] 1.2 Keep expired Diet entries persisted and exposed in Character DTOs; expired slots remain visible while evicted slots disappear.
- [x] 1.3 Rebuild dietLevels from the retained Diet window after every authoritative food mutation; no level survives after its food is evicted.

## 2. Auto Feed

- [x] 2.1 Fix authoritative Auto Feed boundary selection and consumption so it fires before Hungry when an eligible retained food exists; verified Inventory consumption and activeFoodBuff replacement.
- [x] 2.2 Preserve the existing transactional consumeFood() path for Auto Feed and manual consumption; no negative Inventory or duplicate consumption path was introduced.
- [x] 2.3 Add regression coverage for unavailable candidates and the normal fallback behavior.

## 3. Frontend presentation

- [x] 3.1 Render retained expired Diet entries as transparent/marked slots without locally deleting them; stars remain visible until server eviction.
- [x] 3.2 Keep Auto Feed toggle and realtime Character synchronization authoritative.

## 4. Verification and documentation

- [x] 4.1 Focused Diet/Auto Feed regressions: 6 assertions passed.
- [x] 4.2 Shared/API builds passed; frontend production build passed with the existing non-blocking Angular CSS/CommonJS warnings; OpenSpec strict validation passed; git diff --check passed.
- [x] 4.3 STATUS.md updated; no production deployment performed.
