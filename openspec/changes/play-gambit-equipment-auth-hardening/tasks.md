# Tasks

Reference: specs/play-gambit-equipment-auth-hardening/spec.md.

## Implementation

- [x] 1. Character navbar defaults to the Character sub-tab.
- [x] 2. Add authoritative Town HP/SP regeneration.
- [x] 3. Add reliable Character-side equipment drag/drop and double-click fallback.
- [x] 4. Make the main play Inventory inventory-only.
- [x] 5. Connect inventory equipment drags to compatible Character slots and focus them.
- [x] 6. Render Gambit condition/action parameters from catalog metadata.
- [x] 7. Add `self_hp_below_percent` to both authoritative Gambit catalogs.
- [x] 8. Expose `xpToNext` and use it for progress/hover text.
- [x] 9. Render live consumable counts from active battle log events.
- [x] 10. Stop auto-login after registration and add the confirmation page.
- [x] 11. Reject unverified login.
- [x] 12. Keep successful email verification on the login flow.
- [x] 13. Build shared/API/frontend and run diff checks.

## Manual Verification

- [ ] 14. Browser smoke test Character sub-tab navigation.
- [ ] 15. Browser smoke test Town regeneration.
- [ ] 16. Browser smoke test equipment drag/drop and double-click.
- [ ] 17. Browser smoke test Gambit parameter editing/save.
- [ ] 18. Browser smoke test live consumable decrement.
- [ ] 19. Browser smoke test registration -> email pending -> login.
- [ ] 20. Verify nested-route SVG asset rendering after this change.

## Deferred

- [x] 21. Weapon XP/proficiency progression remains out of scope.
