# Proposal

## Why

Third pass on the living Town scene after play-testing: offline characters lying asleep everywhere made towns look dead, the map/town button rebuilt the whole 3D scene on every click, the floating action menu over a clicked player was awkward, roofs were visibly skewed (worst on long houses), Sierra's ground was flat clay, Father Marcelus stood in a corner, William's giant backpack floated outside the map and the Storage chest sank into houses.

## What Changes

- **Offline characters keep wandering.** Only `/sleep` lies a character down (it stays asleep across disconnect/reconnect until it wakes by interacting). Legacy Redis states that slept just for being offline are read as awake where they lay.
- **Selection instead of an action menu.** Hovering another player or an NPC shows a pointer cursor. Clicking another player selects it: blue ring under it and a card in the grind panel under the NPC selector (idle 3D avatar wearing its hand gear, name, level, "Invite to group" with the existing rules). The NPC selector stays visible and goes back to "Choose NPC to interact" while a player is selected; choosing an NPC (selector or scene) selects it with the same blue ring. The action menu is removed.
- **Roster entries carry `dominantHand`, `mainHandItemId`, `offHandItemId`**; equipping/unequipping re-broadcasts the entry (`town:update`).
- **Instant map/town switch.** The Town scene stays mounted while the character is in a Town; the map view only hides it and pauses its render loop.
- **Preload on connect.** When the game socket first connects, the browser warms (while idle) the lazy three.js chunk, `town_scenes.json`, the appearance catalogue, both bodies and clips, NPC outfits and props. `vercel.json` adds long-lived cache headers for hashed bundles and character/NPC assets, so a later visit rarely downloads them again.
- **Roofs** are built directly on the house rectangle (hip or gable), overhang every wall and start just below its top; each house gets small deterministic variations (wall/roof height, overhang, colours). Huts and tents vary too.
- **Sierra ground** mixes grass patches over the clay (`ground.mix`, one non-tiling texture over the whole town).
- **Father Marcelus** stands on the ground next to each town's centrepiece: fountain (Caelum), campfire (Taba), the altar in the sunshaft (Aramaia), below the tower (Outpost), the well (Sierra).
- **No NPC hidden by the town** from the fixed camera; the Outpost Storage (tower), Aramaia's Storage/William/Mailbox/Oracle (pillars) and Sierra's Cecilia (house) moved.
- **NPC props keep their distance** from every obstacle (≥ 0.5 × scale); Storage spots moved off the houses. Costume pieces pinned to bones are placed in the model frame, so they stay on the body wherever the NPC stands.

## Impact

- API: `TownRosterService` (sleep rules, hand gear, `refresh`), `EquipmentController` (+ `PresenceModule` import). No migration; Redis state stays backward compatible.
- Shared: `TownRosterEntry` optional hand fields; `ground.mix` type and validator rule.
- Data: `town_scenes.json` (+ mirror).
- Frontend: `TownStore` selection, `VendorStore.selectNpc`, `MapBoard`, `VendorPanel`, new `town-player-card`, removed `town-action-menu`, `town-scene` (`active`, `selection`, hover), `town-runtime` (`setActive`, `setSelection`, `warmTownAssets`), `town-character` (selection ring), `town-world` (roofs, ground mix), `npc-visuals` (`pin` fix), `PlayComponent` (preload). `vercel.json` headers.
- Archive order: after `town-living-scene` and `town-living-scene-2`.
