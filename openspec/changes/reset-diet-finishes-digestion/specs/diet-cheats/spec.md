# Reset Diet Finishes Digestion

## ADDED Requirements

### Requirement: Reset Diet cheat preserves the Diet configuration
The `/inventory/__dev_7f3a91c2/reset-diet` cheat SHALL finish digestion for all foods currently retained in the Diet slots without removing or changing their slot membership or diet levels.

#### Scenario: Reset a populated Diet
- GIVEN the Diet contains retained food entries with `dietLevel` values and matching `dietLevels`
- WHEN `/reset-diet` is used
- THEN all retained Diet entries remain in their same slots
- AND each retained entry's digestion is finished
- AND each retained entry's `dietLevel` is unchanged
- AND `dietLevels` is unchanged
- AND the active food buff is cleared

#### Scenario: Reset does not disarm Auto Feed
- GIVEN Auto Feed is enabled
- WHEN `/reset-diet` is used
- THEN Auto Feed remains enabled

### Requirement: Reset prevents queued food state from returning immediately
The reset cheat SHALL remove pending queued food-use events that could otherwise reapply the just-finished food digestion/buff state.

#### Scenario: Pending food event is stripped
- GIVEN an unresolved battle contains a queued food `use_item` event
- WHEN `/reset-diet` is used
- THEN that food event is removed from the pending battle log
- AND non-food events in the battle log remain intact
