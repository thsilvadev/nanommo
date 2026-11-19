# Tasks

## 1. Sleep

- [x] 1.1 Offline keeps wandering; `/sleep` survives disconnect/reconnect; legacy offline sleep read as awake (`town-roster.test.js`).

## 2. Selection

- [x] 2.1 Pointer cursor over other players and NPCs (`town-scene.component.spec.ts`).
- [x] 2.2 Blue selection ring for one player or NPC (`town-runtime.spec.ts`, `town-scene.component.spec.ts`).
- [x] 2.3 Player card under the NPC selector: idle avatar with hand gear, name, level, invite rules (`town-player-card.component.spec.ts`); action menu removed.
- [x] 2.4 Roster hand gear + `town:update` after equip/unequip (`town-roster.test.js`).

## 3. Switching and preload

- [x] 3.1 Scene stays mounted; map view pauses it (`town-scene.component.spec.ts`, `town-runtime.spec.ts`).
- [x] 3.2 Preload on first connect; `warmTownAssets` (`town-runtime.spec.ts`); cache headers in `vercel.json`.

## 4. Look

- [x] 4.1 Rectangular hip/gable roofs covering the walls, per-house variations (`town-runtime.spec.ts`).
- [x] 4.2 Sierra grass over clay (`town-runtime.spec.ts`, `town-scenes-catalog.test.js`).
- [x] 4.3 Father Marcelus next to each centrepiece, on the ground (`town-scenes-catalog.test.js`).
- [x] 4.4 Props ≥ 0.5 × scale from obstacles; Storage moved; costume pieces stay on the body (`npc-visuals.spec.ts`).
- [x] 4.5 No NPC hidden from the camera (perspective, panned targets, both zooms); Outpost/Aramaia/Sierra NPCs moved (`npc-occlusion.spec.ts`).
