# Tasks

- [x] 1.1 Change every `food_buff` item definition from `type: consumable` to `type: food` in server and frontend catalogs.
- [x] 1.2 Make the authoritative manual inventory action accept `food` and route it through `consumeFood()` while keeping ordinary consumables unchanged.
- [x] 1.3 Make shared Gambit `use_item` legality require `type: consumable` and pass catalog definitions into the evaluator.
- [x] 1.4 Make Auto Feed select only `type: food` definitions.
- [x] 1.5 Keep Auto Feed at battle resolution only; do not add a Grind-entry trigger.
- [x] 1.6 Add/adjust regression tests for food-vs-consumable boundaries and battle-resolution Auto Feed continuity.
- [x] 1.7 Run builds, focused tests, strict OpenSpec validation and `git diff --check`.
- [x] 1.8 Extend Auto Feed to consume every currently eligible Diet food in one battle-resolution boundary, up to the three Diet slots, with regression coverage for multi-food refill.
- [x] 1.9 Correct the Auto Feed eligibility boundary: an already-active food buff does not block eligible 0m Diet foods from being consumed at battle resolution, with regression coverage.
