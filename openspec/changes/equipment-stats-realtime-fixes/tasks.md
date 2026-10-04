## OpenSpec
- [x] 1. Define authoritative equipment/Character response contract and accessory compatibility.

## Backend
- [x] 2. Centralize Character DTO derived-stat and Attribute-bonus projection on EquipmentService aggregation.
- [x] 3. Include rolled equipment attributes in Character DTO Attributes.
- [x] 4. Preserve weapon ATK and add weapon MATK to authoritative Stats.
- [x] 5. Accept generic accessory item definitions in either persisted accessory slot.
- [x] 6. Return authoritative Character/Inventory/Equipment snapshots from equipment mutations.
- [x] 7. Extend consumable success response/state convergence where required.
- [x] 8. Add focused backend regression tests.

## Frontend
- [x] 9. Add Character attributeBonuses and magicAttack contract fields.
- [x] 10. Apply equipment mutation responses directly to Character/Inventory stores.
- [x] 11. Allow accessory catalog items in both accessory slots.
- [x] 12. Replace equipment metadata tooltips with actual granted-stat tooltips, including rolls.
- [x] 13. Add Attribute explanatory tooltips and green (+N) contribution rendering.
- [x] 14. Rename Derived Stats to Stats and render Magic ATK.

## Verification
- [x] 15. Update SPEC.md, openspec/specs/SPEC.md and STATUS.md.
- [x] 16. Run shared/API/frontend builds and focused regressions.
- [x] 17. Run strict OpenSpec validation and git diff --check.
- [x] 18. No production deployment.
