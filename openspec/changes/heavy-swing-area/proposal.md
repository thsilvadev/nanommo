# Heavy Swing hits every foe around the caster

## Why
Heavy Swing is meant to be an area attack: the greatsword sweep reaches every enemy standing next to the character. Today it hits only its target, like any other single-target skill, which wastes it in party and raid battles where several monsters close in.

## What Changes
- Heavy Swing still needs a foe target in melee range to be cast. When it lands, every other living foe in the 8 cells around the caster (Chebyshev distance 1) takes the same full damage (physical defense, archetype and variance applied to each, rolled independently).
- Allies are never hit.
- Disarm still applies only to the main target.
- Each extra hit is a new `splash` battle event (payload `skillId`, `damage`, `damageType`, `hit`). It is not a `use_skill`: it does not start a cooldown, spend SP or count as another executed skill for mastery XP.
- The arena shows the numbers and flinch on every foe hit; the battle log reads "X's Heavy Swing also hits Y for N damage."
- Driven by catalogue data: `effect.areaRadius: 1` on the skill. Battles generated before the change keep their snapshotted definition and replay unchanged.

## Impact
- `packages/shared` V2 simulator (`group-simulator.ts`), skill types.
- `skill_trees.json` (+ frontend mirror).
- Frontend: arena feedback, battle event text.
- Solo battles have a single foe, so they are unaffected in practice.
