## ADDED Requirements

### Requirement: Encounter clocks survive every projection rebuild
The system SHALL persist absolute search deadline, encounter identity, seed, cycle and selected roster. Equipment, attributes, consumables or Gambit changes SHALL not reset or extend them. Only consuming the encounter or resolving evasion SHALL advance its sequence. Database time SHALL determine boundaries, including encounter-first ordering at equality.

#### Scenario: Continuous equipment editing during search
- **GIVEN** an encounter is due at T+5 seconds
- **WHEN** one hundred valid edits complete before its boundary
- **THEN** the same encounter begins at T+5 and gathering accrual does not include the ensuing battle interval

### Requirement: Mutations execute as durable ordered intents
The system SHALL persist per-character ordered intents with client request deduplication and pending/applied/failed/cancelled state. Each execution SHALL atomically persist mutation and outcome, revalidate current eligibility and preserve absolute consumable cooldowns and inventories. A character SHALL have at most 32 pending intents; excess requests SHALL fail without mutation. If completion before encounter start cannot be guaranteed, the mutation SHALL remain pending until the safe boundary.

#### Scenario: Retry and one invalid intent
- **GIVEN** an intent is retried with the same request ID and a later intent is valid
- **WHEN** the earlier intent fails current validation
- **THEN** its retry returns the same terminal outcome and the later intent may still execute once in sequence

### Requirement: Recovery uses database authority
Bull jobs and Redis locks SHALL not replace transactional claims or uniqueness constraints. Recovery SHALL reconstruct missing jobs from persisted state, respect branch appearance/cutover initialization and publish authorized revisioned events only after commit.

#### Scenario: Process dies after database commit before publication
- **WHEN** recovery observes committed state lacking scheduled or published work
- **THEN** it reconstructs the work idempotently without replaying committed rewards or mutations
