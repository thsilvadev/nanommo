# Proposal

## Why

The first Town scene (`town-living-scene`) worked but felt unfinished: a two-icon toggle that stuck on "map" when coming back to a Town, characters asleep for hours falling over in front of the player, a night-time Caelum, no Outpost, and NPCs that were random bodies in underwear. This change finishes the scene's look and behaviour without touching the server's role.

## What Changes

- **One illustrated button** replaces the map | house toggle: it shows the other view (map in the Town, house on the map). The manual choice lasts only while the character stays on that map; any `currentMapId` change forgets it, so arriving in a Town always opens the Town scene.
- **Sleepers lie down from the first frame.** The Dead clip time follows the age of the sleep (`now − sleeping.at`): long sleepers are already lying, fresh ones are caught mid-fall, and someone falling asleep on screen still falls.
- **New obstacle kinds** in the shared catalogue: `balcony` (platform with stairs on one side; platform and stairs block the 2D walk grid), `tower` (default r 4), `campfire` (r 1.2), `altar` (r 4.5), `well` (r 1.4). NPC spots may be elevated (`y > 0`) only on a balcony, with their POI by the stairs foot.
- **Catalogue:** Caelum at noon with 20 houses and two balconies (Father Marcelus and the Oracle up on them); a campfire in the middle of Kwaiouá-Taba; an altar in the middle of Aramaia; a well with a bell in the middle of Sierra; a new **Outpost** scene with a tower too tall for the camera to ever show its top.
- **Animated set pieces**, all driven by the shared clock: fountain water, flickering campfire with embers, orbiting pebbles on the altar, the well's swinging bell, the shaman's pipe smoke.
- **NPC visuals:** a registry (`npc-visuals.ts`) dresses each NPC: CC0 outfits (Quaternius Modular Character Outfits – Fantasy, Peasant/Ranger) bound to our body's skeleton by bone name, costume pieces pinned to bones, and props (Quaternius Fantasy Props MegaKit, KayKit RPG Tools Bits, or primitives). The mailbox is only a mailbox. New offline pipeline `tools/npc-assets`.

## Impact

- Shared: `town-scene.types.ts`, `town-nav.ts` (footprints, `balconyStairsFoot`, `balconyContains`), `town-scene-validate.ts`.
- Data: `town_scenes.json` (+ mirror): Caelum, Taba, Aramaia, Sierra edited; Outpost added. The Outpost now has a Town roster and scene (it is a Town scene in the catalogue).
- Frontend: `town-view-toggle`, `MapBoard`, `town-character`, `town-runtime`, `town-world`, new `npc-visuals`; assets `public/assets/ui/town-view-*.svg`, `public/assets/npcs/*` (≈3.6 MB, loaded only in the Town scene).
- No API code change beyond tests; no migration; nothing run against a database.
- Archive order: `town-living-scene` first (it creates `specs/town-scene`), then this change (its MODIFIED requirement needs that spec).
