# Defense, bows, GM world teleport and map control

Approved by user: implement autonomously through completion. GM /teleport applies only to world-map destinations, not town ground positions.

- [x] Multiply effective physical DEF by 1.10 inside the canonical defense formula; retain magic/pure behavior and damage floor. Verify solo/group consumers and update formula documentation.
- [x] Diagnose arena bow refinement shader loss; preserve +10/+11/+12 glint. Scale bows by 1.35 around their attachment grip across portrait/town/arena.
- [x] Register /teleport in the existing GM command registry/help. Store toggle server-side and recheck GM access for status and every teleport. Provide GET /maps/gm-teleport-mode and POST /maps/:mapId/gm-teleport. Preserve ordinary travel when disabled.
- [x] Share authoritative toggle state between chat and map. Allow valid undiscovered destinations and non-leader GM clicks; handle normal arrival/store refresh and rejected requests. No localStorage privilege flag.
- [x] Move arena toggle outside map-head to bottom/right of viewport with 18px margins. Increase 40px button to 80px and double icon sizes; slightly lighten background.
- [x] Verify targeted tests and builds; review complete changes and record limitations in STATUS.md.

Decisions: teleport relocates the GM only. When a shared battle is active, end it at its canonical elapsed checkpoint before removing the GM; other members stay in their map/group and resume encounters. Do not alter town walking. Existing user arena scenery/atmosphere/props edits are outside this task and must be preserved.

Verification: 121/121 combined Chromium tests passed (bow placement, portrait/town/arena drawing and shader hooks, chat toggles, server-confirmed mode, real MapBoard layout/access, existing destination reconciliation). Frontend production build passed with bundle/CSS size-budget warnings. Shared defense tests 3/3 and API direct-damage variance 4/4 passed. API build and GM teleport/commands, party lifecycle/destination, invitation notifications, travel-preserves-started-battle and world-travel/gathering/flee tests passed. No real PostgreSQL/Redis integration or production deploy performed.

Review findings fixed: reuse ctx.manager for role checks inside teleport transaction to avoid borrowing another pooled connection; notify all affected invitation counterparts after teleport cancellation.

Independent existing failures reproduced with the original physical formula: defense-monster-casting-passive-logs expects Dire Wolf Enraged Strike; mastery-skill-simulator line115 expects10 but gets20. Neither was repaired as part of this task.
