# Tasks

## Specification
- [x] Define the end-of-battle and resource-exhaustion lifecycle.
- [x] Define staged equipment replacement semantics.
- [x] Define authoritative frontend battle-log animation semantics.

## Backend
- [x] Add persistent pending-equipment state and migration.
- [x] Stage equipment changes during an active battle.
- [x] Apply pending equipment between battles and rebuild the remaining queue.
- [x] Stop the grind and return to town when the chain cannot continue.
- [x] Ensure wins apply XP/gold/drops exactly once at resolve.
- [x] Preserve death behavior and discard the remaining chain.

## Shared engine
- [x] Emit sufficient per-event HP state for visual playback.
- [x] Keep battle outcome deterministic and independent of wall-clock time.

## Frontend
- [x] Animate current monster HP from battle log events.
- [x] Animate character HP from the same authoritative events.
- [x] Show battle outcome/reward transition without an arena.
- [x] Show grind idle/town state when the server stops the chain.
- [x] Refresh character/inventory/equipment after battle resolution.

## Validation
- [x] Build shared, API and frontend.
- [x] Validate the OpenSpec change strictly.
- [x] Run deterministic battle verification.
- [ ] Run the existing Phase 3 regression scripts when stack configuration permits.
- [ ] Verify queue continuity across multiple resolved wins.
- [ ] Verify resource exhaustion returns the character to town.
- [ ] Verify staged equipment applies only after the current battle.
