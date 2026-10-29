# Proposal

## Why

Battle audio has made combat feel more alive and helps players understand events, but the visual feedback still relies on static sprites and a small event feed. Floating damage numbers and brief hit flashes will make each hit, critical, and damage-over-time tick immediately legible without changing the deterministic battle outcome.

## What Changes

- Render floating damage numbers at the character portrait and monster sprite for each positive HP damage event as its authoritative battle-log tick becomes current.
- Animate numbers in a rising outward parabola: character feedback moves up-left, monster feedback up-right, then fades away.
- Use red for damage received by the character and white for ordinary damage received by the monster. Critical damage to the monster uses yellow, a stronger black outline, and 60% larger type.
- Tint damage-over-time numbers by effect: orange for burn/general DoT, dark green for poison, and a distinct brighter red for bleed.
- Flash the character portrait red briefly when it takes damage. Flash the monster sprite white while preserving the transparent silhouette instead of covering its rectangular canvas.
- Keep overlapping hits readable, including multiple damage events on one tick, and do not replay old damage when a battle component mounts mid-fight.
- Keep all feedback presentation-only and derive it from immutable battle-log events and their tick timestamps.

## Capabilities

### New Capabilities
- `battle-hit-feedback`: Floating damage numbers, target-specific hit flashes, and effect-specific damage styling for live battles.

### Modified Capabilities

None.

## Impact

- Frontend battle presentation in `apps/frontend/src/app/features/play/character-summary.html` and its styles, `apps/frontend/src/app/features/play/grind-info.html` and its styles, plus the battle presentation logic in `apps/frontend/src/app/features/play/components.ts` or a focused shared presentation helper.
- Existing immutable battle queue logs in `BattleStore` and the shared engine event fields (`tick`, `actor`, `target`, `action`, `damage`, `crit`, `status`, `damageType`) are the source of truth; no backend API, simulation, database, or audio changes are intended.
- Root `SPEC.md`, `ARCHITECTURE.md`, and `STATUS.md` will document the resulting contract and verification.
