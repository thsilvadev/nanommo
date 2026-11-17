# Design

The full design, decisions and asset report are in:

- `docs/superpowers/specs/2026-11-16-criador-personagem-3d-design.md`
- `docs/superpowers/specs/2026-11-16-criador-personagem-3d-assets.md`
- `docs/superpowers/plans/2026-11-16-criador-personagem-3d.md`

Key decisions:

- Rules shared by API and client live in `packages/shared/src/appearance.ts`; the server is authoritative.
- The one-time save is a single conditional UPDATE (`WHERE "appearance" IS NULL`) inside `runFutureCombatMutation`.
- The action block is a global deny-by-default interceptor (it must run after each route's JWT guard), with an explicit opt-out decorator.
- Rollout is an offline cutover (all characters to Town), not an on-connect freeze; startup checks both the flag and the data.
- three.js is loaded only by the viewer; skin overlays are decals baked through the mesh UVs; face/body variation is vertex deformation; hand items go through the closed fist measured in the Idle pose.
