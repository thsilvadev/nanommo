# Tasks

## 1. OpenSpec contract
- [x] 1.1 Define the ±1% seeded direct-damage rule and its placement in the final-damage pipeline.
- [x] 1.2 Define the DOT exclusion and application-time snapshot invariant.

## 2. Battle engine
- [x] 2.1 Add one shared direct-damage variance helper using the battle PRNG.
- [x] 2.2 Apply it to character basic attacks.
- [x] 2.3 Apply it to character damaging skills.
- [x] 2.4 Apply it to monster basic attacks and damaging skills.
- [x] 2.5 Keep misses at zero without consuming a variance roll.
- [x] 2.6 Preserve seeded replay determinism.

## 3. Regression coverage
- [x] 3.1 Test the helper stays within the ±1% range.
- [x] 3.2 Test same-seed simulations remain identical.
- [x] 3.3 Test a different seed can change direct damage output.
- [x] 3.4 Record the DOT boundary: the current engine has no active DOT damage tick path; future DOT implementation must use application snapshots and never call direct variance per tick.

## 4. Verification and documentation
- [x] 4.1 Run focused regression tests.
- [x] 4.2 Run shared/API/frontend builds.
- [x] 4.3 Run strict OpenSpec validation and git diff --check.
- [x] 4.4 Update STATUS.md with the implementation and the DOT boundary.
- [x] 4.5 No production deployment.
