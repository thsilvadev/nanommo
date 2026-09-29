# Proposal

## Why

The first implementation of the NanoMMO play/character UI established the visual
language and the main screens successfully, but the first real browser pass exposed
a set of issues that cross the frontend, authentication lifecycle, character
creation, equipment rules, map entry, and derived-stat contracts.

This change is the hardening/progression pass for that implementation. It should make
the current game loop reliably testable from a fresh account, keep the session alive
across normal access-token expiry, expose authoritative derived stats, and make the
play window usable from desktop through mobile.

The change is intentionally driven by observed browser behavior rather than a new
visual redesign: the existing dark fantasy / bronze / gold direction is retained.

## What Changes

### 1. Authentication/session lifecycle

- Make an expired access token transparent to the user when a valid refresh token
  exists: refresh the access token and retry the original API request once.
- Implement and verify the backend /auth/refresh contract that the current Angular
  client already expects.
- Prevent refresh loops and concurrent refresh storms; a failed refresh clears the
  session and navigates to /login.
- Treat any final unauthorized API response as an authenticated-session failure and
  navigate to /login, including a useful reason=session_expired query parameter.
- Ensure the Socket.IO connection follows the refreshed access token rather than
  keeping an expired handshake credential.
- Preserve activeSessionId semantics: a genuinely invalidated session must not be
  silently revived by the refresh flow.

### 2. Fresh-character bootstrap

- On account/character creation, create the starter loadout with sword_t1 equipped
  in the appropriate main-hand slot.
- Ensure the starter weapon is represented by the normal inventory/equipment model,
  not by a frontend-only assumption.
- Seed the default Gambit page with exactly these two legal starter lines:
  1. self hp is < 30% -> use potion
  2. always -> attack nearest foe
- Keep the existing three Gambit pages; only the initial content of the default page
  changes.
- Initial HP/SP must be derived from the authoritative character build rather than
  hardcoded to an arbitrary 100/100 value.
### 3. Authoritative derived-stat rules

Replace the current frontend placeholder ("Server value unavailable in current
character contract") with a backend/frontend contract that exposes the authoritative
values needed by the character screen and initial character state.

For the first pass, the authoritative mapping is the following user-defined rule set:

| Derived stat | Source |
|---|---|
| Attack | FOR + equipment contribution |
| Defense | equipment contribution |
| Max HP | VIT + equipment contribution |
| Max SP | INT + equipment contribution |
| Attack speed | AGI |
| Cast speed | DEX |
| Evasion | AGI |
| Accuracy | DEX |
| HP regen | VIT; recovered every 10 ticks |
| SP regen | INT; recovered every 10 ticks |
| Critical chance | SOR |

The implementation must not silently preserve the previous formula set while merely
renaming fields. The mapping above becomes the source of truth for this change.
Where an existing engine value requires a unit, rate, cap, or conversion to fit the
current tick/cast representation, document that conversion in the SPEC before coding
it rather than inventing a second gameplay rule in the UI.

The character contract should expose, at minimum, max HP, max SP, attack, defense,
attack speed, cast speed, evasion, accuracy, HP regen, SP regen, and critical chance.
The current HP/SP values remain character state; max values and other derived values
must come from the same authoritative calculation used by the battle engine.

### 4. Grind entry and equipment invariants

- A character cannot enter a grind map without a valid weapon equipped in the required
  weapon slot(s).
- While status=grinding, unequipping the currently required weapon is rejected.
- Replacing a weapon with another legal weapon remains allowed during grind.
- The invariant must be enforced by the backend, not only by disabling buttons in
  Angular, so direct API calls cannot bypass it.
- If an equipment mutation is rejected because of grind state, the frontend keeps the
  authoritative equipment state and shows the server error.
- Existing equipment-combination and level-requirement validation remains in force.

### 5. Map selection that is actually testable

- Replace the current large/blurred map presentation with explicit clickable map
  tiles/cards for every map returned by the authoritative /maps endpoint.
- Keep the city/town as the visual center of the map board.
- Each map tile shows enough identity to distinguish it without inventing gameplay
  data; map name/id and access state are sufficient.
- Clicking an accessible map calls the real map-entry endpoint and starts grind through
  the existing server flow.
- Locked maps remain visibly distinct and non-enterable; the frontend must use the
  backend's level/access result rather than inventing unlock rules.
- The map board remains usable on touch devices and keyboard navigation.
### 6. Responsive play UI

Rework layout constraints so the game is intentionally responsive at desktop, tablet,
and mobile widths.

- Desktop keeps the three-zone game composition where space permits.
- Tablet collapses/reflows the side panels without horizontal overflow.
- Mobile uses a deliberate single-column/stacked presentation with accessible
  navigation between the major game areas.
- Inventory, equipment slots, map tiles, battle progress, and Gambit rows remain
  usable at narrow widths.
- Avoid fixed pixel widths that force horizontal scrolling.
- Preserve the existing visual language, hover highlights, focus states, and reduced
  motion behavior.
- Validate both portrait and landscape mobile layouts.

### 7. Inventory and asset cleanup

- Main play inventory header becomes simply Inventory.
- Remove numbered slot labels and the "50 slots" subtitle from the main inventory UI.
- Keep exactly 50 cells; the grid itself communicates capacity.
- Ensure the existing semantic SVG assets actually resolve in the deployed Angular
  application. Fix asset paths/build configuration rather than replacing them with
  emoji, Unicode symbols, or a new icon framework.
- Verify the same asset strategy works in nested routes such as /play/character
  and /play/gambits.

### 8. Character screen

- Replace unavailable derived-stat placeholders with authoritative values.
- Show HP max, SP max, and cast speed explicitly in the derived-stat section.
- Keep the existing attribute pending/apply/reset flow server-authoritative.
- Ensure displayed current/max HP and SP are consistent with the same derived-stat
  calculation used by the backend.
- Keep the existing equipment hover/highlight behavior.
## Gambit Scope Boundary

The current Gambit editor still needs richer parameter controls for expressions such
as:

Self HP is [< 30%] -> Use Skill [Heal]

The existing backend already validates condition/action structure, but the UI does not
yet expose all condition/action parameters needed for a complete editor. This is
recorded as a follow-up requirement only and is deliberately not implemented in this
change.

This change must preserve the current valid starter Gambit representation and must not
invent a new parameter schema just to make the editor look complete.

## Non-Goals

- No new Gambit parameter schema or full parameterized Gambit editor in this change.
- No redesign of the established dark-fantasy visual identity.
- No client-side battle simulation or client-authoritative grind state.
- No frontend-only enforcement of gameplay invariants.
- No new map progression rules beyond the backend's existing authoritative map data.
- No Chat/Mail/Town/Market implementation.
- No deletion of Docker volumes or destructive environment reset as part of verification.

## Backend Impact

This is no longer a frontend-only change. Expected backend work includes:

- Auth refresh endpoint/strategy and token validation/rotation behavior.
- Character creation starter equipment and default Gambit contents.
- Authoritative derived-stat calculation and a character/loadout response that exposes
  those values.
- Grind/equipment invariant validation.
- Tests covering fresh character creation, refresh after access expiry, invalid refresh,
  weapon-required map entry, weapon replacement during grind, and forbidden unequip.
No unrelated battle-loop behavior should be changed. Existing battle-engine tests must
remain green after the derived-stat rule update, with affected expectations updated only
where the new explicit rule changes documented game behavior.

## Frontend Impact

Primary areas:

- apps/frontend/src/app/core/auth.store.ts
- apps/frontend/src/app/core/api.service.ts
- apps/frontend/src/app/core/game.store.ts
- apps/frontend/src/app/features/play/*
- apps/frontend/src/app/features/character/*
- apps/frontend/src/styles.css
- Angular asset configuration/static UI assets where required

The frontend should consume authoritative server values rather than reimplementing
battle formulas.

## Acceptance Criteria

1. A user with an expired access token and valid refresh token stays in the game; the
   API request is refreshed/retried once without a visible logout.
2. A user with an expired/invalid refresh token is redirected to /login instead of
   remaining on a broken authenticated screen.
3. A fresh registration creates a character with sword_t1 equipped and the specified
   two-line starter Gambit page.
4. Fresh-character max HP/max SP and all exposed derived stats come from the
   authoritative derived-stat calculation based on the documented rules.
5. /play and character screens display those values; no unavailable-value placeholder
   remains for the covered derived stats.
6. Map selection presents distinct clickable map tiles and entering an accessible map
   starts the real grind flow.
7. Entering grind without the required weapon is rejected server-side.
8. While grinding, required-weapon unequip is rejected; legal weapon replacement is
   accepted.
9. Inventory renders 50 cells with only the Inventory heading in the main play view.
10. Existing SVG icons render correctly from /play, /play/character, and /play/gambits.
11. Desktop, tablet, and mobile layouts avoid unintended horizontal overflow and keep
    all core controls usable by mouse, touch, and keyboard.
12. Existing hover highlights, focus-visible behavior, and reduced-motion support remain
    intact.
13. The existing Gambit editor continues to save/activate valid pages; parameterized
    Gambit editing remains explicitly tracked as future work rather than being faked.
14. Production frontend build and relevant backend/frontend tests pass.

## Verification

- Backend unit/integration tests for auth refresh and session invalidation.
- Backend tests for character bootstrap and starter equipment/Gambits.
- Backend tests for derived-stat rules and tick-based regeneration.
- Backend tests for map-entry/equipment invariants.
- Angular tests for refresh/retry/logout behavior and derived-stat rendering.
- Responsive smoke verification at desktop, tablet, mobile portrait, and mobile
  landscape widths.
- Route smoke verification for /play, /play/grind, /play/character, and /play/gambits.
- Asset smoke verification on all nested play routes.
- pnpm --filter @nanommo/frontend build.
- openspec validate play-character-ui-hardening --strict.
- git diff --check.

## Implementation Notes

The first implementation proved the visual direction is already working, so this
proposal is deliberately a hardening/progression pass rather than another UI rewrite.
The priority is to make a fresh account immediately testable: log in, see a correctly
built character, select a map, start grind, and survive normal access-token expiry
without unexpectedly returning to the login screen.
