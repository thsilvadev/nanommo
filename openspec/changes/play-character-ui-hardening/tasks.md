# Tasks

Reference: specs/play-character-ui-hardening/spec.md.

## 1. Authentication and session lifecycle

- [x] 1.1 Implement backend /auth/refresh using the existing access/refresh token model.
- [x] 1.2 Add safe refresh-token validation and session preservation/rotation rules.
- [x] 1.3 Add Angular 401 refresh-and-retry with a single-flight refresh.
- [x] 1.4 Navigate to /login after unrecoverable 401/session invalidation.
- [x] 1.5 Reconnect Socket.IO with the current access token after refresh.

## 2. Character bootstrap

- [x] 2.1 Equip sword_t1 during authoritative character creation.
- [x] 2.2 Seed the default Gambit page with the two starter lines.
- [ ] 2.3 Add backend tests for fresh-character starter state.
## 3. Derived stats and gameplay rules

- [x] 3.1 Update the SPEC with the new attribute-to-derived-stat mapping and units.
- [x] 3.2 Implement the authoritative derived-stat calculation in the shared/game engine.
- [x] 3.3 Expose derived stats through the character/loadout API contract.
- [x] 3.4 Initialize current HP/SP from the authoritative maxima.
- [x] 3.5 Implement/document HP and SP regeneration every 10 ticks.
- [ ] 3.6 Add regression tests for all covered derived-stat mappings.
- [x] 3.7 Render authoritative derived stats in Angular, including HP max, SP max,
  and cast speed.

## 4. Grind and equipment invariants

- [x] 4.1 Reject map entry when the character has no valid required weapon.
- [x] 4.2 Reject required-weapon unequip while status=grinding.
- [x] 4.3 Allow legal weapon replacement while status=grinding.
- [ ] 4.4 Add backend tests for all three equipment/grind cases.
- [x] 4.5 Surface server rejection cleanly in the Angular equipment UI.
## 5. Map, inventory, assets, and responsive UI

- [x] 5.1 Replace the blurred map board with explicit authoritative map tiles.
- [x] 5.2 Wire accessible map tiles to the real map-entry endpoint.
- [x] 5.3 Preserve the town/city as the map board center.
- [x] 5.4 Remove inventory slot numbering and the 50 slots subtitle while retaining
  exactly 50 cells.
- [x] 5.5 Fix semantic SVG asset paths/build configuration and verify nested routes.
- [x] 5.6 Rework desktop/tablet/mobile breakpoints with no unintended horizontal scroll.
- [x] 5.7 Verify touch and keyboard access to map tiles and core game controls.

## 6. Verification

- [ ] 6.1 Add frontend tests for refresh/retry/logout behavior.
- [ ] 6.2 Add frontend tests for authoritative derived-stat rendering.
- [ ] 6.3 Run backend auth, character, derived-stat, and equipment invariant tests.
- [ ] 6.4 Verify /play, /play/grind, /play/character, and /play/gambits manually.
- [ ] 6.5 Verify desktop, tablet, mobile portrait, and mobile landscape layouts.
- [ ] 6.6 Verify SVG assets load on all nested play routes.
- [ ] 6.7 Run the production frontend build.
- [ ] 6.8 Run openspec strict validation and git diff --check.

## 7. Explicitly deferred

- [ ] 7.1 Do not implement parameterized Gambit editing in this change.
- [ ] 7.2 Preserve the follow-up note for condition/action parameters such as
  Self HP is [< 30%] -> Use Skill [Heal].
