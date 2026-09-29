# Tasks

## Specification
- [x] Update SPEC.md with the authoritative derived-stat formulas and initial values.
- [x] Define consumable cooldowns, food duration, hungry state, and grind entry invariants.
- [x] Define town-only unequip and staged equipment replacement semantics.

## Shared engine
- [x] Replace legacy derived-stat formulas.
- [x] Rename regeneration fields and apply them every 10 ticks.
- [x] Convert consumable cooldown seconds to battle ticks.
- [x] Preserve deterministic Gambit-driven target selection.

## Backend
- [x] Seed the starter pack on character creation.
- [x] Ensure current HP/SP start at authoritative maxima.
- [x] Persist/use real-time food buff expiry.
- [x] Enforce potion + food + weapon requirements at grind entry.
- [x] Support food use outside battle without cooldown.
- [ ] Keep equipment mutation authoritative and compatible with staged replacement.

## Frontend
- [x] Add double-click consumable use outside battle.
- [x] Add equipment drag/drop targets and focused compatible slots.
- [x] Drag equipped item to inventory to request unequip.
- [x] Show hungry state and block grind action consistently with server state.

## Validation
- [x] Build shared, API and frontend.
- [x] Run deterministic battle tests.
- [x] Run OpenSpec strict validation.
- [ ] Verify fresh-character HP/SP and starter inventory.
- [ ] Verify grind entry rejection for missing potion/food/weapon.
- [ ] Verify food replacement and one-hour expiry semantics.