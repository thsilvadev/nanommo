# Reset Diet Finishes Digestion

## Why
The temporary `/reset-diet` QA cheat currently wipes the Diet slots, `dietLevels`, and Auto Feed state. That prevents testing the intended retained-slot streak behavior with `/upgrade-diet`.

## What Changes
Change `/reset-diet` so it only finishes digestion for the foods currently retained in the three Diet slots and clears the active food buff. The Diet entries, their individual levels, `dietLevels`, and Auto Feed setting remain intact.

Pending queued food-use events are still removed so an already queued battle cannot immediately resurrect the digestion/buff state that the cheat just finished.

## Scope
This is a temporary QA cheat behavior only. No gameplay rules or normal food-consumption behavior change.
