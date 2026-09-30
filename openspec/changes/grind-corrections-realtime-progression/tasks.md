# Tasks

## OpenSpec / contracts

- [x] 1. Define complete item-tooltip data requirements using only existing catalog/item fields.
- [x] 2. Define Town-return semantics for searching, active battle, and resolution boundary.
- [x] 3. Define session-only Grind drop presentation and reset boundary.
- [x] 4. Define authoritative realtime Character/Inventory synchronization facts and reconnect fallback.
- [x] 5. Define continuous character regen timeline and 10-tick invariant.
- [x] 6. Define corrected XP, monster-gold, starter-potion, Bread-vendor, and drop-rate rules.

## Backend / shared

- [x] 7. Fix XP resolution to allow at most +1 level and preserve XP correctly.
- [x] 8. Remove direct monster gold rewards while preserving other gold sources.
- [x] 9. Change new-character starter HP potions to 50 without frontend workaround.
- [x] 10. Implement continuous authoritative regen across battle/search/non-battle Grind states.
- [x] 11. Emit/reuse authoritative events for HP/MP, inventory consumption, drops, and relevant battle-log facts.
- [x] 12. Verify and correct critical/regen log events using the existing combat event model.
- [x] 13. Verify drop RNG interpretation and adjust configured monster drop rates deliberately.
- [x] 14. Verify Bread in the existing William Vendor sell configuration and transaction path.
- [x] 15. Add focused backend/shared tests for XP, gold, starter inventory, regen, drops, and reward interpretation.

## Frontend

- [x] 16. Build one reusable complete item tooltip and use it for inventory/equipment/item displays.
- [x] 17. Fix Town click feedback and pending-return behavior across encounter search and active battle.
- [x] 18. Add transient Drops this session presentation and stack display without duplicating inventory.
- [x] 19. Apply realtime authoritative inventory and Character HP/MP updates; remove stale derived consumable-count logic.
- [x] 20. Render authoritative regen/critical events in the existing log format.
- [ ] 21. Add frontend tests/smoke coverage for tooltip, Town return, drops session, HP, and inventory synchronization.

## Documentation / verification

- [x] 22. Update SPEC.md only for definitive gameplay/authority rules changed by this implementation.
- [x] 23. Update openspec/specs/SPEC.md with the same definitive contract deltas.
- [x] 24. Update STATUS.md with implementation state and re-runnable verification evidence.
- [x] 25. Run shared/API/frontend builds and focused tests.
- [x] 26. Run openspec validate grind-corrections-realtime-progression --strict and git diff --check.
- [ ] 27. Perform the complete Grind smoke flow, including searching → Town request, battle → Town request, potion use, drops, HP/regen, critical logs, and William Bread sale.
- [x] 28. Confirm no production deployment was performed.
