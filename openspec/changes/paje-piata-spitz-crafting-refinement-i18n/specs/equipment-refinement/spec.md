## ADDED Requirements

### Requirement: Equipment refinement is a server-authoritative item-instance mutation
Refinement SHALL be available through Whitesmith Spitz for an unequipped equipment item in Character inventory. A valid attempt SHALL consume one Bliss Stone and resolve success on the server. A supplied Divine Shard SHALL be consumed for valid attempts whose current refinement is +6, +7, +8, +9, +10 or +11. The server SHALL preserve all unrelated instanceData fields, return surviving equipment to Inventory, and reject duplicate/concurrent attempts or attempts above +12.

#### Scenario: Inputs are incomplete or invalid
- **WHEN** required input slots are empty, equipment is invalid/not owned/not in inventory, or required materials are unavailable
- **THEN** the UI disables Refine and the server rejects equivalent invalid requests without consuming materials

#### Scenario: Guaranteed refinement
- **WHEN** a valid item is at +0, +1 or +2
- **THEN** the attempt succeeds at 100%, consumes one Bliss Stone, advances one level, and applies the normal refinement stats

#### Scenario: Success chance table
- **WHEN** the current item level is +3, +4, +5, +6, +7, +8, +9, +10 or +11
- **THEN** the corresponding success probability is 90%, 80%, 70%, 60%, 50%, 40%, 30%, 20% or 10%

#### Scenario: Failure at levels +3 through +5
- **WHEN** an item at +3, +4 or +5 fails to refine
- **THEN** the Bliss Stone is consumed and the item remains at its current refinement level

#### Scenario: Failure at levels +6 through +8 without a Divine Shard
- **WHEN** an item at +6, +7 or +8 fails to refine without a Divine Shard
- **THEN** the item remains intact but its refinement level resets to +0

#### Scenario: Failure at +9 or above without a Divine Shard
- **WHEN** an item at +9, +10 or +11 fails to refine without Divine Shard protection
- **THEN** the equipment item is destroyed

#### Scenario: Divine Shard protects an attempt starting from +6 through +8
- **WHEN** an eligible attempt starts with an item at +6, +7 or +8 and includes a Divine Shard
- **THEN** the shard is consumed on the attempt
- **AND** on failure the equipment survives at its current refinement level, avoiding the normal reset to +0
- **AND** the rolled attribute/stat and all other item metadata are preserved

#### Scenario: Divine Shard protects an attempt starting from +9 through +11
- **WHEN** an eligible attempt starts with an item at +9, +10 or +11 and includes a Divine Shard
- **THEN** the shard is consumed on the attempt
- **AND** on failure the equipment survives and loses exactly one refinement level (respectively +9→+8, +10→+9 or +11→+10) instead of being destroyed
- **AND** the rolled attribute/stat and all other item metadata are preserved

#### Scenario: Refinement increases base stats
- **WHEN** an item gains a refinement level
- **THEN** it gains +3 for each supported direct stat field it already provides (ATK, MATK, DEF, MDEF)
- **AND** an item whose magic-defense field is mdefPercent gains three percentage points per successful level
- **AND** the system does not add unsupported stat categories to items that do not provide them

#### Scenario: Higher refinements improve the existing random roll
- **WHEN** an item succeeds at a refinement level from +7 to +12
- **THEN** it receives one additional roll bonus for that level above +6
- **AND** crafted rolled attributes receive +2 to the stored attribute per level above +6
- **AND** dropped rolled stats receive per-level bonus: ATK +5, MATK +5, DEF +4, HP +10, SP +10, Attack Speed +10, Cast Time Reduction +5, Evasion +3, Accuracy +3, Critical +1 percentage point
- **AND** the bonus is applied only if the item has the corresponding valid roll and is never applied twice during re-equip/reload

#### Scenario: Confirmation describes the actual attempt
- **WHEN** a Character opens a non-guaranteed refinement confirmation
- **THEN** the modal shows chance, materials, current and successful-result stats with gains in green, random-roll changes, and the actual failure outcome after considering Divine Shard
- **AND** the modal clearly shows when the item will be destroyed or when it will survive but reset to +0

#### Scenario: Item identity and stat paths remain consistent
- **WHEN** refinement succeeds and the item is stored, equipped later, viewed in inventory or included in combat/world snapshots
- **THEN** its display name includes the current “+N”, all bonuses come from the same server-authoritative item-instance state, and unrelated quest provenance/random-roll metadata remains intact
