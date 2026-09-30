# Tasks

## OpenSpec
- [x] 1. Define encounter-search and realtime presence requirements.
- [x] 2. Define waiting/combat right-panel requirements.

## Backend
- [x] 3. Add encounter search delay to battle queue generation.
- [x] 4. Add authoritative map population broadcasts over Socket.IO.
- [x] 5. Include monster status effects and derived stats in battle log/header data needed by the UI.
- [x] 6. Add focused backend tests for delay calculation and presence changes.

## Shared/frontend
- [x] 7. Add shared map-presence payload types.
- [x] 8. Display live map population in the location header.
- [x] 9. Render encounter-search state with GIF and battle progress component.
- [x] 10. Replace redundant battle character HP/time sections with monster status and derived stats.
- [x] 11. Preserve existing logs and Town/NPC UI.

## Verification
- [x] 12. Update SPEC.md and openspec/specs/SPEC.md with implemented rules.
- [x] 13. Update STATUS.md with actual implementation and verification.
- [x] 14. Run shared/API/frontend builds, focused tests, strict OpenSpec validation, and git diff --check.
- [x] 15. Do not deploy to production.
