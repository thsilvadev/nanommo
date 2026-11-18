# Tasks

## 1. Shared movement

- [x] 1.1 Town scene types, `TownNav` (walk grid, distance fields, smoothed paths, reachability) and deterministic `positionAt` in `@nanommo/shared` (`apps/api/test/town-wander.test.js`).

## 2. Catalogue

- [x] 2.1 `town_scenes.json` for Caelum, Sierra, Kwaiouá Taba and Aramaia City + frontend mirror; `validateTownScenes()`; `scripts/validate-town-scenes.js`; `DataService.getTownScene/getTownSceneMapIds` with boot validation (`apps/api/test/town-scenes-catalog.test.js`).

## 3. Server roster and clock

- [x] 3.1 `TownRosterService` (snapshot ≤ 200, lazy offline entries, sleep/wake, join/leave deltas) and post-commit hooks (map presence, travel start, party outbox) (`apps/api/test/town-roster.test.js`).
- [x] 3.2 Gateway `town:syncRoster`, `town:sleep`, `town:wake`, `time:sync`; connect wakes, disconnect sleeps, stale-socket disconnects ignored.

## 4. Party notices

- [x] 4.1 `party:inviteDeclined` for candidate declines and expirations, forwarded to the inviter socket (`apps/api/test/party-invite-declined.test.js`).

## 5. Client state

- [x] 5.1 `ServerClockService`, `TownStore`, `ChatNoticeService`; `/sleep` and unknown commands in the idle chat; decline/timeout chat lines.

## 6. Shared assets

- [x] 6.1 `CharacterAssetCache` (raw files shared, body instances per use); `CharacterRig` refactored onto it without behaviour change.

## 7. Scene

- [x] 7.1 World builder, fixed-angle camera, light Town characters, runtime with picking and LOD, `TownSceneComponent` (render cap 100).

## 8. Integration

- [x] 8.1 Map | house toggle in the map head, NPC click → NPC selector (and wake), action menu with "Invite to group".

## 9. Documentation and verification

- [x] 9.1 STATUS, ARCHITECTURE, ENGINEERING_NOTES; strict OpenSpec validation; full verification run.
