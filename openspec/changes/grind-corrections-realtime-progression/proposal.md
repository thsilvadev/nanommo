# Grind Corrections — Realtime State and Progression

## Why

The current Grind loop has several synchronization and progression inconsistencies: item tooltips are incomplete, Town return depends on fragile local queue state, inventory/HP changes can lag behind authoritative server state, session drops are not represented separately, and progression/reward values are currently too fast or violate the intended rules.

## Scope

- Make item tooltips consistently expose all relevant catalog/item data already available.
- Make Town return reliable across searching and active battle without cancelling the current battle.
- Replace redundant Grind inventory presentation with a session-only drop summary.
- Synchronize Character and Inventory immediately from authoritative battle/consumable state.
- Add authoritative realtime HP/MP/regen and battle-log synchronization where the existing event architecture supports it.
- Log existing critical hits and regeneration events without inventing new combat mechanics.
- Allow Bread to use the existing William Vendor sell path.
- Review drop-rate interpretation and configuration, then adjust configured rates deliberately.
- Reduce XP pacing, enforce at most one level gained per XP resolution, remove monster gold rewards, and start new characters with 50 HP potions.
- Make regeneration continuous on the character timeline across battle, encounter search, and non-battle Grind time.

## Non-goals

- No new combat mechanics or alternative progression system.
- No frontend source of truth for HP, XP, drops, inventory, gold, or battle outcomes.
- No parallel navigation or inventory synchronization system when existing REST/Socket.IO paths can be corrected.
- No production deployment.

## Compatibility

Preserve the existing deterministic BattleEngine, BullMQ resolution flow, Character/Inventory persistence, /game Socket.IO gateway, encounter-search timing, William Vendor transaction model, and existing item/monster catalog semantics except for the explicitly requested configuration/rule corrections.

## Acceptance

All requested UI, synchronization, reward, XP, starter-inventory, Town-return, and continuous-regen scenarios are covered by focused tests and the relevant shared/API/frontend builds. Strict OpenSpec validation and git diff --check pass; no production deployment is performed.
