# Design

Source documents: `docs/superpowers/specs/2026-11-18-cidade-viva-parte-2-design.md` (spec), `docs/superpowers/plans/2026-11-18-cidade-viva-parte-2.md` (plan), `docs/superpowers/specs/2026-11-18-npc-visuals-decision.md` (NPC look decision).

## The walk grid stays 2D

Nobody climbs. A `balcony` blocks its `w×d` platform **and** a 2 u × 2.5 u stairs strip on its `stairs` side (local frame before `rot`: e = +x, w = −x, s = +z, n = −z), inflated by the usual 0.4 clearance. `balconyStairsFoot()` is 1 u past the end of the stairs; an elevated NPC (`npcSpots.*.y > 0`) must stand inside a balcony and have a POI within 3 u of that foot, which must be free and reachable. Tower, campfire, altar and well are circles. The renderer draws the NPC (model and click box) at `y`.

## Sleep pose from the sleep's age

`TownCharacter.update(pose, dt, lod, nowMs)`: entering `Dead` sets the clip time to `min((now − sleeping.at)/1000, duration)`. When the character had no clip yet, or the sleep began before its first update, the pose is applied at once (no crossfade, `mixer.update(0)` so a 10 Hz far character is posed too) and frozen if complete; otherwise the normal crossfade runs from that time.

## Animated set pieces

`TownWorld.update(nowMs)` runs every tick with the server clock: campfire light `base·(0.85 + 0.15·sin(t·0.011)·sin(t·0.0047+1.3))`, flames and embers, fountain texture scroll and ripples, altar pebble orbits, well bell swing. Costume animators (pipe smoke) run in `TownCharacter.update`. Everything is a pure function of the clock.

## NPC visuals: registry, outfit binding, costume, props

- `NPC_VISUALS[npcId] = { figure: body | none, props[] }`. A `body` figure fixes sex, height and appearance overrides, an optional outfit, `tint` / `recolor` (re-hue green cloth) / `paint` (shirt, pants: per outfit part, lightness relative to the part's mean), `underwear` (painted on the grey underwear texels of the composed skin), `belly` and costume pieces.
- **Outfit:** the pack's 65 bones carry the same names as our body's; the outfit's skinned meshes are rebound with `new Skeleton(ourBones by name, outfit.boneInverses)`. The body keeps only head/neck triangles (`headOnly`, cached per sex), as the pack requires.
- **Costume pieces** are pinned in the bone's bind space (`boneInverses`) so the Idle pose (which tilts the head and torso) does not shift them; the head pieces are placed from the eyes' centre. The backpack and the staff are fitted on the Idle pose.
- **Belly:** axis-aware bone scaling across the spine (pelvis/spine widened, chest, neck and thighs compensated) — no new body needed; `belly` scales how far past 1 each factor goes.
- **Props:** a group at the npcSpot (and its `y`), turned to its facing, each prop centred and set on the ground; pack props are cloned with `SkeletonUtils.clone` (the chest is skinned). Props are visual only (not in the walk grid); a spec keeps them clear of every POI.
- Recolouring runs on the main thread when a Town opens, so it is byte math on a 512 px canvas, cached per factory.

## Assets

`tools/npc-assets` (not part of the workspace, like `tools/character-assets`) turns the CC0 packs (not versioned, `source/`) into `outfit-{male,female}-{peasant,ranger}.glb` and `props.glb` (base colour only, quantized). The output is reproducible (same packs → same bytes).
