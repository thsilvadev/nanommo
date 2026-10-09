# Tasks

## 1. Specification
- [x] 1.1 Reconcile root SPEC and canonical OpenSpec SPEC with the intended no-duration-limit rule.
- [x] 1.2 Record that FLEE remains a future, unimplemented termination condition.

## 2. Battle engine
- [x] 2.1 Remove the 200-tick safety cap and the maxTicks simulation option.
- [x] 2.2 Let the simulation loop terminate only when one combatant reaches 0 HP.
- [x] 2.3 Preserve durationTicks and timestamp-based queue scheduling based on actual simulated duration.

## 3. Regression and verification
- [x] 3.1 Add an assertion that a battle completes beyond 200 ticks with a real win outcome.
- [x] 3.2 Run shared build and focused direct-damage/battle-engine tests.
- [x] 3.3 Run API build and relevant regression tests.
- [x] 3.4 Run strict OpenSpec validation and git diff --check.
- [x] 3.5 Do not deploy to production.
