# Tasks

## 1. Shared

- [x] 1.1 `move` and emote segments in `positionAt`, immediate wander resume, `townMoveArrival`, `TownNav.nearestReachable` (`town-wander.test.js`).

## 2. API

- [x] 2.1 `TownRosterService.move` (snap, NPC approach, 200 ms throttle, wakes and ends emotes) and `emote` (toggle, anchor); `/sleep` after an emote; `rev`; `joinedAt` (`town-roster.test.js`).
- [x] 2.2 Gateway `town:move` and `town:emote` (`town-roster.test.js` source contract).

## 3. Frontend

- [x] 3.1 Ground and NPC clicks call `TownStore.moveTo`, with a ground marker (`town-scene.component.spec.ts`).
- [x] 3.2 `/dance` and `/sit` chat commands (`idle-chat.component.spec.ts`).
- [x] 3.3 Dance, SitDown → Sit clips and the stool (`town-runtime.spec.ts`); `animations.glb` regenerated; the battle rig keeps its 9 clips (`character-viewer.component.spec.ts`).
- [x] 3.4 Spawn/vanish aura (`town-runtime.spec.ts`).
- [x] 3.5 Map tile tooltip removed when the map view closes.
