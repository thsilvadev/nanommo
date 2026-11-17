## ADDED Requirements

### Requirement: Same-map Party membership is exclusive
The system SHALL maintain Parties of two to five characters on one map, with one leader and stable relative formation order. A character SHALL belong to at most one Party and one started battle, enforced by database claims under ordered locks.

#### Scenario: Two requests compete for the last slot
- **GIVEN** a Party has four members and two accepted eligible candidates
- **WHEN** both joins run concurrently
- **THEN** exactly one candidate joins and the other receives a capacity failure without entering a second Party or battle

### Requirement: Accepted invitations synchronize without delaying combat
Only leaders SHALL invite, remove or reorder members. Offered manual invitations SHALL expire in 60 seconds; accepted invitations SHALL remain pending until all participants are between battles, on the same map and outside teleport. Joining SHALL preserve the Party encounter deadline, or the future leader's deadline when creating a Party.

#### Scenario: Encounter reaches its deadline before join
- **GIVEN** an invitation is accepted while the Party is searching
- **WHEN** database time reaches the encounter deadline before join commits
- **THEN** the encounter starts with its original membership and deadline and the invitation remains pending for a later safe boundary

### Requirement: AutoParty is a persistent opt-in
The system SHALL persist AutoParty preference and encapsulate its future VIP eligibility, initially allowing everyone. Matchmaking SHALL only select eligible ungrouped opted-in characters on the same map using stable ordering and exclusive claims. Leaving without map change SHALL transfer leadership randomly and auditably; the AutoParty leader leaving the map SHALL dissolve it.

#### Scenario: AutoParty leader travels
- **WHEN** the AutoParty leader changes map
- **THEN** the AutoParty dissolves and other members remain on their map

### Requirement: Departures preserve started participation
A leave or removal requested during battle SHALL remain pending and cancellable until the safe boundary, preserving battle participation and eligible rewards. Final death SHALL return the character to their saved Town, remove membership and transfer manual leadership; fewer than two members SHALL dissolve a Party.

#### Scenario: Member leaves during battle
- **WHEN** a member requests departure during started combat
- **THEN** the active snapshot is unchanged and departure applies after result resolution before the next encounter
