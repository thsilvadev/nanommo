# Tasks

## 1. Boundary calculation

- [x] 1.1 Isolate the authoritative next-encounter boundary calculation used by Auto Feed, including the encounter-search delay.
- [x] 1.2 Preserve the existing future-queue startAt path when an unresolved next battle already exists.
- [x] 1.3 Replace the empty-future-queue Date.now() fallback with the calculated next encounter boundary derived from the current authoritative battle timing.

## 2. Auto Feed / Grind continuity

- [x] 2.1 Verify Auto Feed consumes exactly one eligible retained Diet food when the current food expires before the calculated next encounter boundary.
- [x] 2.2 Rebuild unresolved Grind encounters after successful Auto Feed using the new Character and Inventory state.
- [x] 2.3 Verify the normal Hungry/Town transition still occurs when Auto Feed is disabled or no eligible food exists.
- [x] 2.4 Verify no duplicate consumption occurs when battle resolution and queue advancement execute around the same boundary.

## 3. Regression coverage

- [x] 3.1 Add a focused regression where the active food expires shortly after the current battle ends and the unresolved future queue is empty; assert one Inventory unit is consumed and the active buff is replaced.
- [x] 3.2 Add the same boundary case with the encounter-search delay included in the expected decision.
- [x] 3.3 Preserve coverage for a valid future queued encounter, unavailable food, and Auto Feed disabled.

## 4. Verification and documentation

- [x] 4.1 Run the focused Diet/Auto Feed regression suite.
- [x] 4.2 Run shared/API/frontend builds and git diff --check.
- [x] 4.3 Run openspec validate diet-autofeed-boundary-reliability --strict.
- [x] 4.4 Update STATUS.md with the root cause, boundary rule and regression result; update SPEC.md/ARCHITECTURE.md only if the implementation reveals a durable contract clarification.
- [x] 4.5 No production deployment.
