# Gambit item targets

## ADDED Requirements

### Requirement: Item target follows the condition scope

A `use_item` gambit action SHALL carry `target` `self`, `ally` or `foe`. A Self condition SHALL allow only `self`; an Ally condition `ally` or `self`; a Foe condition `foe` or `self`. An `ally` or `foe` item SHALL be used on the Ally or Foe that met the line's condition.

#### Scenario: Tonic thrown at a foe
- WHEN the line is Foe: Status = Magic Prowess → Use item (Foe): Haste Shot and the foe has Magic Prowess
- THEN Haste Shot is applied to that foe.

#### Scenario: Foe condition as a trigger
- WHEN the line is Foe: Status = Magic Prowess → Use item (Self): Haste Shot
- THEN Haste Shot is applied to the character.

#### Scenario: Wrong target for the scope
- WHEN a page saves Self: HP < 30% → Use item (Foe)
- THEN the server rejects the line.

### Requirement: Revive items keep their KO lines

Fairy in a Bottle SHALL only be used as Self: Status = KO → Use item (Self). An ally revive item SHALL only be used as Ally: Status = KO → Use item (Ally), and a KO ally SHALL take only revive items. Revive items and food SHALL NOT target a foe.

#### Scenario: Sapupema on oneself
- WHEN a page saves Ally: Status = KO → Use item (Self): Sapupema Leaf Tea
- THEN the server rejects the line.

### Requirement: Legacy lines

A `use_item` line without `target` SHALL keep the previous choice (revive items by kind, an Ally condition uses it on the ally, otherwise on the character), so already simulated battles replay identically.

#### Scenario: Old page
- WHEN an old line Foe: Status = Magic Prowess → Use item: Haste Shot runs
- THEN Haste Shot is applied to the character.
