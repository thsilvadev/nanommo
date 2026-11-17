# Proposal

## Why

Status application rules are currently split across the status catalogue, skill/item definitions, and multiple BattleEngine branches. This has already produced a duplicate status (`violent_shot_slow`) that differs from the reusable `slow` only by application duration and intensity, while monster-skill and tonic paths duplicate status-instance construction and effect resolution. A single application contract will reduce catalogue growth and make each source own the parameters it actually chooses.

## What Changes

- Introduce one typed, data-driven `statusApplication` contract for character skills/passives, monster skills/passives, and consumables. It will describe the status ID, optional trigger/target, chance, duration (including rank-scaled duration), modifier overrides, and optional damage-over-time payload.
- Keep `status_effects.json` responsible for status identity and intrinsic rules: name/polarity, stackability, stack cap, and reapplication policy. Retain optional default application values as fallbacks for sources that intentionally omit them; explicit application values take precedence, including explicit zero values and untimed duration.
- Resolve all combat status instances through one shared application path so character skills, monster skills/passives, item use in battle, and conditional effects follow the same stack-cap, refresh, chance, duration, modifier, DoT, and event semantics.
- Use the same application definition when a consumable is used outside battle, persisting the resolved status modifiers and wall-clock expiry so existing cross-battle continuity is preserved.
- Migrate current data: reuse canonical `slow` for Violent Shot (12 ticks, Move Speed multiplier 0.2, and no additional flat penalty); move source-specific Burn, Poison, and Bleed timing/damage/chance values into their skills; keep Freeze/Slow and other intentional catalogue defaults as fallbacks; remove duplicated tonic modifier values from status definitions where the item already owns them.
- Remove the redundant `violent_shot_slow` status and legacy per-effect status configuration fields after all current application sources are migrated.
- Preserve gameplay values, seeded RNG determinism, event actor/target semantics, status expiry and stack logs, absolute expiry persistence, and frontend status presentation. No database migration or player-data reset is expected.

## Capabilities

### New Capabilities
- `combat/status-application`: A common declarative contract for applying statuses from character and monster skills/passives and items, including source-specific overrides and canonical status stacking/reapplication rules.

### Modified Capabilities
- None. This change consolidates the existing combat/status behavior without intentionally changing player-visible gameplay values.

## Impact

- Shared types and BattleEngine status application, damage-over-time resolution, and persistent-status helpers.
- Canonical and frontend mirrors of `skill_trees.json`, `status_effects.json`, and `items.json`.
- API consumable-use persistence in `InventoryService`, BattleService snapshots/checkpoints, and status tooltip/projection fallbacks where they read catalogue defaults.
- Focused deterministic tests for character/monster skills and passives, Violent Shot push success/failure, consumables in/out of battle, stack/reapply rules, DoT timing, and cross-battle expiry.
- Root `SPEC.md` and `ARCHITECTURE.md` documentation. No HTTP endpoint or database schema change is intended.
