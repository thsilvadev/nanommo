# Diet & Auto Feed

## Why

NanoMMO already has server-authoritative food buffs, manual consumable use, and a pre-simulated grind queue, but food is currently modeled only as one active buff. The requested Diet adds persistent three-slot food history, digestion restrictions, repeated-food mastery stars, and official Auto Feed without introducing client authority or a parallel consumable system.

## Scope

- Persist a character Diet of up to three currently digesting food entries and per-food permanent diet levels.
- Make food consumption shift the three slots and reject re-eating a food while its previous diet entry is still digesting.
- Increase a food's permanent Diet level only when its previous instance has fully finished digesting; cap at 3 stars.
- Add an authoritative Auto Feed toggle and consume eligible configured food from Inventory when digestion ends.
- Preserve manual food use as a normal consumable action.
- Prevent Auto Feed from allowing the grind chain to fall into Hungry between battles when an eligible food exists.
- Remove the obsolete self_hungry Gambit condition while preserving generic use_item actions.
- Include Diet, Auto Feed, food buff and Inventory in coherent Character/Inventory realtime snapshots.
- Add persistence, integration, engine, frontend and realtime regression coverage.

## Non-goals

- No client-side timers or polling for gameplay authority.
- No new food item category or parallel inventory model.
- No weapon XP/progression.
- No production deployment.
