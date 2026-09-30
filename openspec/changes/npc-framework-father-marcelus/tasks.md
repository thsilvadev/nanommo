# Tasks

## OpenSpec / framework
- [x] 1. Define the generic NPC capability model and Town composition rules.
- [x] 2. Define quest/dialogue node, choice, condition and effect contracts.
- [x] 3. Add the NPC framework spec and Father Marcelus delta.

## Backend
- [x] 4. Add data-driven NPC catalog loading without breaking npc_vendor.json.
- [x] 5. Generalize Town NPC listing to expose capability metadata.
- [x] 6. Implement authoritative quest dialogue resolution and effects.
- [x] 7. Implement Marcelus hungry/no-food Bread grant + instant consume behavior.
- [x] 8. Add focused tests for dialogue branches, inventory safety and repeated clicks.

## Frontend
- [x] 9. Generalize the Town NPC selector to the shared NPC contract.
- [x] 10. Render quest/dialogue UI from capability data.
- [x] 11. Compose vendor inventory above quest dialogue for multi-capability NPCs.
- [x] 12. Keep the central map/grind view unchanged and the right panel Town context intact.

## Verification / docs
- [x] 13. Update SPEC.md only with implemented NPC framework rules.
- [x] 14. Update STATUS.md with actual implementation and evidence.
- [x] 15. Run shared/API/frontend builds and focused NPC tests.
- [x] 16. Run strict OpenSpec validation and git diff --check.
- [x] 17. Do not deploy to production.
