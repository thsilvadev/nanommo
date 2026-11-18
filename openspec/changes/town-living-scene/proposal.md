# Proposal

## Why

Players never see each other: a Town is a panel, not a place. NanoMMO should feel like an MMO the moment a player opens a Town — other characters standing and walking around with intent, NPCs in the square, and a first social action (inviting someone to a group by clicking them). This must not turn the server into a movement simulator, must not grow socket traffic over time, and must not load three.js outside the Town scene.

## What Changes

- New canonical catalogue `town_scenes.json` (root + frontend mirror) with one 72×72 scene per Town that has one: Caelum, Sierra (`map_town`), Kwaiouá Taba and Aramaia City (Outpost has none). Each scene declares ground, lighting, fog, obstacles, NPC spots, points of interest and a spawn. `validateTownScenes()` in `@nanommo/shared` checks it at API boot and in `scripts/validate-town-scenes.js`.
- Deterministic town movement in `@nanommo/shared` (`TownNav`, `positionAt`): every client derives the same pose from `(seed, server time)`; no position is ever sent. Legs of 24 s walk between weighted POIs (25 % short strolls) on flow fields over the obstacle grid, at 2.2 u/s.
- Server roster per Town (`TownRosterService`, Redis, no migration): every character whose `currentMapId` is a Town scene and who is not travelling, online or offline. Offline means asleep. Logging in wakes the character. Snapshots are capped at 200 (self → party → online → offline by `lastSeenAt`); only deltas (`town:join` / `town:leave` / `town:update`) follow. `/sleep` and NPC clicks send `town:sleep` / `town:wake` intents. `time:sync` gives the client a server-clock offset.
- Party invites now tell the inviter when the candidate declines (`party:inviteDeclined`, reason `declined`) or the offer expires (reason `expired`).
- Frontend: a map | house toggle in the map head swaps the world map for a three.js Town scene (one renderer, fixed 55°/45° camera, zoom and pan clamped to the Town), rendering up to 100 characters with the real 3D models, NPCs that select themselves in the grind-panel NPC selector, and an action menu with "Invite to group". `/sleep` in chat; red local chat lines for command and invite errors.

## Impact

- Shared: new `town/` module (types, nav, wander, validator).
- API: `DataService` loads/validates `town_scenes.json`; `PresenceModule` gains `TownRosterService`; gateway events `town:*` and `time:sync`; post-commit roster hooks in map presence, `MapService.travel` and the party outbox publisher; `party.service` decline/expiry notices.
- Frontend: `ServerClockService`, `TownStore`, `ChatNoticeService`, shared `CharacterAssetCache`, `features/play/town-scene/*`, map-board toggle.
- No migration, no new persistent column. Online indicator above the chat is unchanged.
