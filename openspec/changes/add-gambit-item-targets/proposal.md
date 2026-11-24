# Use item (Self / Ally / Foe)

## Why

A gambit `use_item` line always used its item on the character (or on an ally under an Ally condition), even under a Foe condition, which only acted as a trigger. Players need to aim an item at the exact Ally or Foe that met the condition, and future "aggressive" items (or funny interactions such as a potion that hurts the undead) need a foe target.

## Scope

1. `use_item` gains `params.target`: `self` | `ally` | `foe`. The condition scope decides the options: Self → Self; Ally → Ally, Self; Foe → Foe, Self. The Ally/Foe target is the one that met the condition.
2. Fairy in a Bottle: only Self: Status = KO → Use item (Self). Sapupema Leaf Tea (revive ally): only Ally: Status = KO → Use item (Ally); a KO ally takes only revive items.
3. Every other consumable may be used on a foe and applies its normal effect there (a potion heals the foe, a tonic buffs it). Food never targets a foe.
4. Rules live in `@nanommo/shared` (`item-target.ts`) and are used by the V2 engine, the server gambit validator and the editor.
5. Lines saved without `target` keep the previous behaviour, so replays of already simulated battles do not change.

## Non-goals

- No new item effects (`onFoe`, undead interactions); no throw range; no migration.
