# Tasks

## OpenSpec / contracts

- [x] 1. Define William NPC and vendor quote/stock contracts.
- [x] 2. Document atomic Town vendor transaction invariants.

## Backend

- [x] 3. Implement Town NPC catalog and William stock from npc_vendor.json.
- [x] 4. Implement authoritative vendor quote calculation.
- [x] 5. Implement atomic BUY transaction with row locks.
- [x] 6. Implement atomic SELL transaction with row locks.
- [x] 7. Validate Town status, NPC membership, item membership, quantity, gold, ownership and capacity.
- [x] 8. Return authoritative character/inventory/vendor state after transactions.
- [x] 9. Add backend Vendor integration/edge-case tests.

## Frontend

- [x] 10. Render Town instead of Grind in the central region while in Town.
- [x] 11. Add extensible NPC selector and William vendor renderer.
- [x] 12. Reuse Inventory CDK drag/drop with stable drag previews/placeholders.
- [x] 13. Implement BUY/SELL confirmation modal and quantity controls.
- [x] 14. Handle insufficient-gold UX and transaction errors.
- [x] 15. Resync Character/Inventory/Vendor state after transactions.
- [x] 16. Verify desktop and ~390px responsive layout.

## Documentation / verification

- [x] 17. Update SPEC.md only for the implemented contract.
- [x] 18. Update STATUS.md with actual implementation and test evidence.
- [x] 19. Run shared/API/frontend builds.
- [x] 20. Run relevant existing tests and new Vendor tests. Vendor service test passed; existing Phase 3 Gambit HTTP suite was attempted but could not start because the local backend at localhost:3010 was unavailable.
- [x] 21. Run strict OpenSpec validation and git diff --check.
- [x] 22. Perform Town → William → buy/sell modal smoke test without production deployment.
