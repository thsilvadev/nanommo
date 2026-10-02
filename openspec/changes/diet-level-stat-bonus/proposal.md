# Proposal

## Why

Diet stars are currently cosmetic. `diet-auto-feed` defines the Diet level 0-3 as persistent per-food tracking, and `consumeFood` awards it correctly on a completed-digestion repeat, but nothing consumes that level: the food buff is written from the raw catalog values and the battle engine adds them flat. A player who masters a food to three stars sees three stars and no gameplay difference.

That makes the Diet loop's central trade-off unrewarding. The Diet deliberately imposes a cost — a food cannot be re-eaten until its previous digestion finishes, and only one food buff is active at a time — and mastery is the only thing that pays that cost back. With stars granting nothing, there is no reason to prefer a food worth mastering over any other, and the Auto Feed candidate list has no notion of which food the character actually invested in.

## What Changes

- A food's Diet level becomes a stat modifier. Each point of Diet level adds a flat `+1` to every regeneration stat the food grants. Level 0 grants the catalog values unchanged; level 3 grants catalog + 3 per stat.
- The bonus applies at every point where a food buff is resolved: server-authoritative consumption (manual use and Auto Feed) and the battle engine's in-simulation `use_item` handling.
- The battle engine gains knowledge of Diet level. `CharacterSnapshot` currently carries no Diet state at all, so the level must reach the engine to scale food used mid-simulation.
- The Diet food tooltip reports the effective, level-scaled bonus rather than the raw catalog value, so the number the player reads is the number the engine applies.
- **BREAKING (balance, not API)**: existing food values shift upward for any food already at level > 0. `dietLevels` is persisted on every character, so characters who earned stars before this change immediately gain the bonus. No migration and no cap change; the star cap stays 3.

The tooltip reveal is also corrected here. `diet-auto-feed` already requires Diet hover to reuse the existing item tooltip, but the reveal rule `.diet-slot:hover>.item-tooltip` was never written — only `.equip-drag:hover` and `.item:hover` existed — so the tooltip could never appear on a Diet slot. This change closes that gap rather than adding a parallel tooltip.

## Capabilities

### New Capabilities

None. This extends behavior an existing capability already owns.

### Modified Capabilities

- `diet-auto-feed`: the "Diet stars" requirement changes from stars-as-display-only to stars-as-stat-modifier, and the "Existing tooltip system" requirement changes to require the effective level-scaled bonus and a working Diet hover reveal.

## Impact

**Backend**

- `packages/shared/src/battle-engine/index.ts` — `use_item` food handling reads `def.effect.hpRegenPerTenTicks` / `spRegenPerTenTicks` directly at the food branch. It must scale by Diet level.
- `packages/shared/src/types/index.ts` — `CharacterSnapshot` needs the character's per-food Diet level map. This is a public engine input, so it is a cross-package type change.
- `apps/api/src/modules/inventory/inventory.service.ts` — `consumeFood` writes `activeFoodBuff` from raw effect values; must write the scaled values. The level to apply is the post-consumption `nextLevel`, which is what the Diet entry records.
- `apps/api/src/modules/battle/battle.service.ts` — `buildCharacterSnapshot` populates the engine input and adds food regen to derived stats; both need the scaled value. `applyResolvedFoodState` recomputes `activeFoodBuff` on resolve and must scale identically to `consumeFood` or the two paths will drift.

**Frontend**

- `apps/frontend/src/app/features/play/components.ts` — `dietTooltipLines` currently reports raw effect values.
- `apps/frontend/src/styles.css` — Diet hover reveal rule.

**Persistence and compatibility**

- No schema change. `dietLevels` already stores `{ level, lastDigestUntil }` per food and is already part of the authoritative Character snapshot.
- The balance shift is silent for returning players: a level-2 food that granted 8 HP now grants 10. Accepted deliberately, since capping or grandfathering would decouple the bonus from the star the player sees.
- Determinism risk: the engine must receive the same level the API would compute, or a pre-simulated battle and its resolve will disagree. This is the main correctness constraint on the design.