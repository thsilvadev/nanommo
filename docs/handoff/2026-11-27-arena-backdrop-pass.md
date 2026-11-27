# Handoff: arena painted backdrop in its own render pass (2026-11-27)

> **Outcome (2026-11-27):** implemented and rejected by the user after before/after shots (distant props drawn over the painted hedge in orbit). Replaced by the whole-prop shrink (`nearLayerScale`); next step is dropping the `near` layer for 3D bushes. See STATUS.md.

## Problem

In the battle arena the painted backdrop (`sky`, `far`, `near` layers in
`apps/frontend/src/app/features/play/arena/arena-scenery.ts`, group `arena:backdrop`) is made of transparent
planes that turn with the camera yaw (the player's click-and-drag orbit, up to ±70°). The `near` plane is always
22 m from the look point. three.js draws transparent meshes **after** all opaque meshes (renderOrder only sorts
inside each list), and the layers depth-test without writing depth. So any 3D prop (rocks, bushes, logs in
`arena-props.ts`, laid out ±90 m along X and −24…26 m in Z) that ends up behind the `near` plane gets the painting
drawn over it and looks see-through. From the front almost nothing is behind the plane; turned to ±70° the camera
looks along the prop strip and many props are behind it.

## Current state (commit `1cd7511`, merged on `main`, maybe not pushed yet)

Interim fix: the props material discards fragments behind the `near` plane along the view direction
(`ArenaProps.setYaw`, `behindNearLayer`, `ARENA_NEAR_LAYER_DISTANCE_M` in `arena-props.ts`; called from
`ArenaScenery.update`). Side effect the user does not want: while dragging, props that were visible from the front
get sliced and disappear.

## Decision (user, 2026-11-27): option 1

Draw the painted backdrop in a **separate pass before the 3D world**, so every 3D object is always drawn over the
painting: nothing turns see-through and nothing disappears while orbiting. Accepted trade-off: very distant props
may read as standing in front of the painted near layer.

## Plan

1. **Revert the interim cull**: remove `setYaw`/`behindNearLayer`/the `onBeforeCompile` discard from
   `arena-props.ts`, the `set.props.setYaw(yawRad)` call in `arena-scenery.ts`, and `arena-props.spec.ts` (or
   rewrite it for the new behaviour). Keep `ARENA_NEAR_LAYER_DISTANCE_M` only if still useful.
2. **Backdrop pass**: move the backdrop meshes (both the current and the cross-fading `leaving` region set) into a
   separate `THREE.Scene` (or a dedicated layer) rendered first with the same camera, then
   `renderer.clearDepth()` and render the main scene with `autoClear = false` (clear colour once per frame). Find
   where `arena-runtime.ts` calls `renderer.render` (also `renderOnce`, used by tests and the harness).
   - The backdrop group currently lives inside each region's `set.group` (it follows `cameraX` and turns by
     `yawRad`); keep that transform when moving it (for example a parallel group per region in the backdrop
     scene, positioned the same way in `update`).
   - The region crossfade (`CROSSFADE_MS`, opacity on `set.materials`) must keep working in both passes.
   - The ground (`renderOrder -5`), the bridge river (`renderOrder -9.5`, transparent, depthWrite false), wall and
     rails (`gods_bridge`) stay in the main scene; check that the river still draws between sky and far layer the
     way it does now (it may need to move to the backdrop pass with the right order).
   - Fog: backdrop materials use `fog: false`; keep it.
3. **Check the front view did not change**: the painted near layer's bottom (`bottom: -1.2`) used to be hidden
   by the ground where the ground is in front of it. With the backdrop drawn first and depth cleared, the ground
   (opaque, reaching z = −80) will now cover the whole lower part of every painted layer. Compare front shots
   before/after; if the horizon line or the painted hedge changes, adjust (for example draw the ground only up
   to the near layer's depth, or give the near layer's bottom a ground-coloured fade).
4. **Tests**: a runtime spec (real WebGL, `arena-runtime.spec.ts` patterns) that a prop behind the near plane at
   yaw 70° is drawn opaque over the backdrop (for example read a pixel, or assert render order/pass membership);
   keep `arena-scenery.spec.ts` green.

## How to verify

- `pnpm --filter @nanommo/shared build` first.
- Karma (Chrome: `CHROME_BIN=/snap/bin/chromium`), from `apps/frontend`:
  `npx ng test --watch=false --browsers=ChromeHeadless --include='src/app/features/play/arena/**/*.spec.ts'`
  (172 specs before this change), then the full suite (695).
- Real WebGL screenshots with the harness (shots `orbit_<region>_l/_r` for all 8 regions, plus the existing
  front shots such as `walk_green_grounds`, `battle`, `orbit_bridge`):
  `node tools/arena-assets/preview/shoot-arena.mjs debug-logs/<dir> orbit_green_grounds_l orbit_forest_ruins_l walk_green_grounds`
  It is slow (software WebGL, ~1 min per shot; run in background, ≤ 600 s per call). Shoot one region per run
  when comparing: the harness reuses the runtime and a region change crossfades. Before-shots of the original
  bug are in `debug-logs/orbit-shots/`, after the interim cull in `debug-logs/orbit-after2/` (not versioned).
- `pnpm --filter @nanommo/frontend build --configuration production`.

## Conventions (CLAUDE.md)

Work on a branch, merge into local `main`, do **not** push (the user pushes from their own terminal; a push to
`main` deploys). Add a dated entry at the top of `STATUS.md` with exactly what was validated, a trap in
`ENGINEERING_NOTES.md` (transparent meshes always draw after opaque ones, whatever `renderOrder`). Reply to the
user in Portuguese.

## Other open items (not part of this task)

- Reconnect loop during the Smashing Spree (sockets dropping every 1–3 s while vases are in town): waiting for a
  player's browser Console during the next event.
- "The battle went very wrong" report from 2026-11-27 ~00:47 UTC: waiting for details.
- Migration `1800800000000-UserRole` must be run on the server for GM commands / `/start-event smashing-spree <min>`.
