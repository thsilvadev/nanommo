# Tasks

## 1. Repository baseline and reference audit

- [x] 1.1 Read root `STATUS.md`, root `SPEC.md`, `openspec/specs/SPEC.md`, `ARCHITECTURE.md`, `PLAY_WINDOW_SPEC.md`.
- [x] 1.2 Read the completed `town-as-map-and-generic-transition` change and the latest relevant presence/NPC changes before editing.
- [x] 1.3 Search repository-wide for all Town identities, `map_town`, Town UI components, Town routes and Town endpoint calls.
- [x] 1.4 Prove whether `TownCenter` is dead before removing anything.
- [x] 1.5 Record the exact current frontend/backend ownership paths before changing them.

## 2. Canonical map data

- [x] 2.1 Verify exactly one canonical `map_town` entry exists in the backend catalog.
- [x] 2.2 Verify frontend map data (if mirrored) has exactly one matching Town entry.
- [x] 2.3 Preserve `isTown: true`, non-grind semantics and existing map metadata.
- [x] 2.4 Add a regression assertion that duplicate Town catalog entries are rejected by the verification suite.

## 3. MapBoard unification

- [x] 3.1 Keep exactly one dedicated Town visual node.
- [x] 3.2 Make that node explicitly represent the canonical `TOWN_MAP_ID` / Town map definition.
- [x] 3.3 Exclude `isTown` maps from the generic map `*ngFor`.
- [x] 3.4 Ensure `map_town` can never be rendered by both paths.
- [x] 3.5 Preserve current Town node placement, dimensions, icon, text, borders, colors and scaling.
- [x] 3.6 Rename the CSS class to a semantic name such as `town-map-node` only if useful; if renamed, preserve all styling exactly.

## 4. Town interaction

- [x] 4.1 Route Town clicks through the existing `/maps/leave` semantics.
- [x] 4.2 Keep grind-map clicks on `/maps/:mapId/enter`.
- [x] 4.3 Ensure no production frontend path intentionally posts `map_town` to grind entry.
- [x] 4.4 Make an already-in-Town click a gameplay no-op.
- [x] 4.5 Harden backend `leaveMap()` to be idempotent for characters already in `map_town`.
- [x] 4.6 Ensure no Town click starts or queues a battle.
- [x] 4.7 Ensure no Town click runs a grind-map encounter-sequence reset against Town.

## 5. Deferred/immediate Town correctness

- [x] 5.1 Preserve immediate Grind -> Town state:
      `currentMapId=map_town`,
      `status=town`,
      `pendingMapTransition=null`.
- [x] 5.2 Preserve deferred active-battle Town request with exactly one pending transition.
- [x] 5.3 Preserve immediate old-map presence removal on deferred request.
- [x] 5.4 Preserve future queue cancellation.
- [x] 5.5 Preserve final Town presence addition after battle resolution.
- [x] 5.6 Preserve death and hunger routing to canonical Town.
- [x] 5.7 Ensure Town finalization never reintroduces a duplicate Town abstraction.

## 6. Presence and Socket.IO

- [x] 6.1 Preserve generic Town presence on `map_town`.
- [x] 6.2 Preserve Town exclusion from encounter-search population.
- [x] 6.3 Preserve existing `map:presence { mapId, playersOnMap }` payload.
- [x] 6.4 Verify connected Town characters join `map:map_town`.
- [x] 6.5 Verify grind -> Town moves connected sockets between map rooms.
- [x] 6.6 Do not add frontend polling or socket-room logic.
- [x] 6.7 Preserve Redis reconciliation for Town membership.

## 7. NPC access

- [x] 7.1 Audit existing Town NPC guards.
- [x] 7.2 Ensure canonical physical Town identity is part of the Town access boundary.
- [x] 7.3 Ensure a character outside `map_town` cannot access Town NPCs solely because `status='town'`.
- [x] 7.4 Ensure a character with a pending Town transition cannot use NPCs before transition finalization.
- [x] 7.5 Preserve all existing NPC behavior, dialogue and vendor/quest contracts.

## 8. Legacy cleanup

- [x] 8.1 If exact reference search proves `TownCenter` unused, remove `town-center.html`, `town-center.css` and the unused component declaration.
- [x] 8.2 Verify no `/play/town` route exists.
- [x] 8.3 Verify no replacement second Town component/route was introduced.

## 9. Committed regression coverage

- [x] 9.1 Add or extend a committed re-runnable frontend/static verification.
- [x] 9.2 Assert exactly one visible Town node in MapBoard.
- [x] 9.3 Assert generic map rendering excludes Town.
- [x] 9.4 Assert no production call to `/maps/map_town/enter`.
- [x] 9.5 Assert exactly one Town entry in canonical data.
- [x] 9.6 Assert Town click uses `/maps/leave`.
- [x] 9.7 Assert already-in-Town click has no gameplay side effect.
- [x] 9.8 Assert immediate Grind -> Town state.
- [x] 9.9 Assert deferred Grind -> Town state and single transition finalization.
- [x] 9.10 Assert Town presence increments/decrements correctly.
- [x] 9.11 Assert Town population does not affect encounter-search timing.
- [x] 9.12 Assert Town NPC access uses canonical location.
- [x] 9.13 Assert stale Town Redis members are pruned/repaired using existing presence tests.
- [x] 9.14 Preserve all relevant existing map-presence, cleanup, encounter-search and NPC regressions.

## 10. Verification

- [x] 10.1 `pnpm --filter @nanommo/shared build`
- [x] 10.2 `pnpm --filter @nanommo/api build`
- [x] 10.3 `pnpm --filter @nanommo/frontend build`
- [x] 10.4 Run relevant committed regression scripts.
- [x] 10.5 `pnpm exec openspec validate town-canonical-map-unification --strict`
- [x] 10.6 `git diff --check`
- [ ] 10.7 Perform live authenticated smoke only if a usable live/local stack is available.

## 11. Documentation

- [x] 11.1 Update `SPEC.md` and `openspec/specs/SPEC.md` with the one-Town invariant.
- [x] 11.2 Update `ARCHITECTURE.md` with the one-Town ownership model.
- [x] 11.3 Update `PLAY_WINDOW_SPEC.md` with the single Town-node representation.
- [x] 11.4 Update `STATUS.md` with root cause, traps and verification.
- [x] 11.5 Do not claim live verification unless it actually ran.

## 12. Deployment boundary

- [x] 12.1 Do not deploy to production.
