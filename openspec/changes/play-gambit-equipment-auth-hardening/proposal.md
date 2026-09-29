# Proposal

## Why

A fresh browser pass exposed several integration gaps around Character navigation, Town regeneration, equipment manipulation, Gambit editing, XP visibility, live consumable presentation, and registration flow.

This change hardens those existing screens and contracts without redesigning the visual language or expanding the combat system.

## What Changes

- Character navbar navigation explicitly opens the Character sub-tab.
- Town characters regenerate HP/SP from the authoritative derived stats.
- Equipment can be equipped and unequipped through reliable drag/drop and double-click interactions.
- The main play Inventory contains inventory cells only; equipment remains in Character.
- Character equipment slots focus when a compatible equipment item is dragged over them.
- Gambit rows expose condition/action selectors plus their catalog-defined parameters.
- The `self_hp_below_percent` starter condition is part of the authoritative Gambit catalog.
- XP progress uses the current level's `xpToNext` value and exposes current/required XP on hover.
- Consumable quantities reflect already-fired `use_item` events while the active battle is running.
- Registration no longer establishes a browser session; it lands on an email-confirmation instruction page.
- Unverified users cannot log into the game.
- Successful email verification returns the user to login instead of attempting an unauthenticated game redirect.

## Non-Goals

- No weapon proficiency/weapon XP progression in this change.
- No new battle mechanics or item effects.
- No replacement of the existing icon pack.
- No client-authoritative gameplay state.

## Acceptance

1. Character navigation opens `?tab=character`.
2. Town HP/SP increases in ten-tick regeneration periods and remains capped.
3. Equipment can move inventory -> compatible Character slot and equipped item -> inventory.
4. Double-click provides the corresponding equip/unequip fallback.
5. Main play view contains only the Inventory panel and 50 inventory cells.
6. Dragging equipment highlights only its compatible Character slot.
7. Gambit condition/action params are visible and editable from the catalog.
8. Existing `self_hp_below_percent` pages save without unknown-condition validation errors.
9. XP hover displays current XP and XP required for the current level.
10. Active-battle item counts decrease when logged use events become due.
11. Registration leaves the browser unauthenticated and shows email-confirmation instructions.
12. Unverified login is rejected with a clear verification message.
13. Shared, API, and frontend builds pass.

## Verification

- `pnpm --filter @nanommo/shared build`
- `pnpm --filter @nanommo/api build`
- `pnpm --filter @nanommo/frontend build`
- `git diff --check`
- `openspec validate play-gambit-equipment-auth-hardening --strict`
- Browser smoke verification remains a manual follow-up for drag/drop and full registration/email flow.
