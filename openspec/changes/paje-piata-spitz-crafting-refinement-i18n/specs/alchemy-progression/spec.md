## ADDED Requirements

### Requirement: Alchemy uses server-authoritative profession crafting
Alchemy SHALL have persisted profession level and cumulative XP, show authoritative progress in Character → Professions, and use the established Cooking craft semantics for recipe eligibility, ingredient/output reservations, timed completion, cancellation, recovery, and atomic inventory/XP updates. A Character SHALL NOT hold overlapping craft sessions across professions.

#### Scenario: Level 1 Alchemy recipe
- **WHEN** a Character has Alchemy Level 1 and at least five Herbs with reservable output capacity
- **AND** starts the Greater Elixir recipe through Pajé's Alchemy service
- **THEN** the server reserves five Herbs and output capacity for one `elixir_greater`
- **AND** the successful craft consumes the Herbs, grants one Greater Elixir, awards 5 Alchemy XP and updates authoritative profession progress

#### Scenario: Recipe eligibility or inventory capacity fails
- **WHEN** the Character lacks the required Herbs, profession level, or output capacity
- **THEN** the server rejects the start without consuming items or granting XP

#### Scenario: Active craft is cancelled or recovered
- **WHEN** a craft is cancelled before its authoritative completion deadline
- **THEN** reservations are released without consuming ingredients or granting output/XP
- **AND** an overdue or restarted session follows the same idempotent recovery contract as Cooking
