# Tasks

## 1. View toggle

- [x] 1.1 One illustrated button (`town-view-map.svg` / `town-view-house.svg`); manual choice forgotten on any map change (`town-view-toggle.spec.ts`).

## 2. Sleep

- [x] 2.1 Dead pose from the sleep's age; long sleepers lying on the first frame (`town-runtime.spec.ts`).

## 3. Shared obstacles

- [x] 3.1 `balcony` / `tower` / `campfire` (+ `altar`, `well`), stairs footprint, `balconyStairsFoot`, elevated NPC rule in the validator (`town-wander.test.js`, `town-scenes-catalog.test.js`).

## 4. Catalogue

- [x] 4.1 Caelum at noon (20 houses, two balconies), Taba campfire, Outpost scene with tower, Aramaia altar, Sierra well (`town-scenes-catalog.test.js`, `town-wander.test.js`, `town-roster.test.js`).

## 5. Rendering

- [x] 5.1 Balcony, tower, campfire, fountain water, altar, well builders and `TownWorld.update(nowMs)`; elevated NPCs pickable (`town-runtime.spec.ts`).

## 6. NPC visuals

- [x] 6.1 Research and decision with the user (`docs/superpowers/specs/2026-11-18-npc-visuals-decision.md`).
- [x] 6.2 `tools/npc-assets` pipeline; `npc-visuals.ts` registry, outfit binding, costume, props; user review adjustments (`npc-visuals.spec.ts`).

## 7. Docs

- [x] 7.1 STATUS, ARCHITECTURE, ENGINEERING_NOTES, this change validated with `--strict`.
