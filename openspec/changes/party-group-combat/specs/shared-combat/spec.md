## ADDED Requirements

### Requirement: A battle has one deterministic immutable team result
The system SHALL simulate versioned PvE teams at 500 ms per tick with at most five characters and ten monsters, allowing an extensible representation of ten actors per team. One snapshot, log and result SHALL serve all participants. Stable actor IDs, seeded domain-specific randomness and deterministic replay SHALL preserve HP, SP, inventory, cooldowns, Diet and statuses.

#### Scenario: Replay a shared encounter
- **GIVEN** identical frozen input and seed
- **WHEN** the battle is simulated twice and replayed through any tick
- **THEN** repeated output is identical and replay state matches the corresponding battle checkpoint

### Requirement: Internal formation and movement are deterministic
The internal grid SHALL have ten rows and columns, unique living actor positions, cardinal movement and stable BFS tie breaking. Party rows for one through five players SHALL be `[5]`, `[4,5]`, `[4,5,6]`, `[3,4,5,6]`, `[3,4,5,6,7]`. Principal monsters SHALL align with players; both first hostile usable acts being melee SHALL place actors in columns 4/5, otherwise 0/9, with ranged fallback when no such act exists. Extra monsters SHALL use free rows in column 9 with nearest-row and alternating above-first ties.

#### Scenario: A revived actor's previous cell is occupied
- **WHEN** a KO actor revives after its cell became occupied
- **THEN** it occupies the nearest free cell using stable tie breaks and other living actors keep unique cells

### Requirement: Gambits select actual actor candidates
The system SHALL support self, ally and foe conditions/actions over the same candidate per chained condition. Lowest ally HP SHALL compare HP/maxHP; KO selection SHALL use seeded randomness. Melee targets SHALL use shortest valid path distance and ranged targets Chebyshev distance; actions SHALL revalidate targets at execution.

#### Scenario: Two allies are KO
- **WHEN** a legal ally-KO revival Gambit executes with a fixed seed
- **THEN** it selects the same qualifying ally deterministically and consumes the acting character's item

### Requirement: Raid candidates are exclusive percentages
Each map monster entry SHALL define `raid.candidates` with unique valid monster references and finite numeric chances from zero to 100 whose sum is at most 100. The remainder SHALL mean no additional monster. New catalogue chances SHALL begin at zero. Each member SHALL contribute one principal monster and at most one seeded additional monster without consuming discarded projection counters.

#### Scenario: Raid chances exceed total probability
- **WHEN** a catalogue contains candidate chances summing above 100
- **THEN** boot-time validation rejects it without changing presence rates

#### Scenario: Gathering fails one aggressive evasion pair
- **GIVEN** multiple monsters were selected for the group
- **WHEN** any living member fails evasion against an aggressive monster
- **THEN** combat includes all selected monsters, including non-aggressive ones

### Requirement: Shared rewards commit once for all participants
The system SHALL resolve and claim battle results in one database transaction for all participants. Living survivors, including revived actors, SHALL split total monster XP with stable integer remainder, receive individual action Mastery and applicable kill credit. Common drop units SHALL choose one eligible recipient without reroll on full inventory; quest drops SHALL roll once and copy to eligible active quest instances. Total defeat or FLEE SHALL grant no normal rewards and monsters SHALL grant no direct gold.

#### Scenario: A resolver job is redelivered
- **WHEN** a resolved battle's job runs again after success or a worker restart
- **THEN** no participant receives XP, drops or inventory consumption twice

### Requirement: Legacy battles remain executable and readable
Started V1 snapshots/jobs SHALL retain their original resolver and history. New combat SHALL identify its version, and recovery SHALL dispatch according to stored version without rewriting active or historical data.

#### Scenario: Restart with an overdue V1 job
- **WHEN** recovery starts with legacy combat still active
- **THEN** the legacy resolver completes it and its original history remains readable
