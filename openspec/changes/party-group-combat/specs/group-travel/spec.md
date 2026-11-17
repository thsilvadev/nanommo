## ADDED Requirements

### Requirement: Only a living leader can request shared FLEE
A living leader SHALL request group FLEE using independent seeded rolls for each living member–currently targeting enemy pair. Success SHALL require every roll; no targeting enemies SHALL add no roll. Success SHALL checkpoint all participants and grant no normal rewards; failure SHALL leave combat running.

#### Scenario: Leader is KO
- **WHEN** a KO leader requests FLEE
- **THEN** the server rejects the request until revival and preserves combat

### Requirement: Manual Party follows leader stance and route
Only the leader SHALL control Hunting, Gathering, Traveling and shared departure. Town departure SHALL validate all members' hunger and publish blocked names to every member through System feedback. Outside Town unresolved hunger after automatic feeding SHALL remove and return only that member at the safe battle boundary.

#### Scenario: One member cannot eat outside Town
- **WHEN** automatic feeding fails for a hungry member during battle
- **THEN** the started battle completes before their departure and remaining members continue

### Requirement: Fast Travel accrues ten effective seconds
Manual Party Fast Travel SHALL freeze the leader's saved Town at start, persist generation and effective elapsed progress, and teleport remaining eligible members together after 10,000 ms. Aggressive battle SHALL pause progress and victory or successful FLEE SHALL resume it. Individual departure SHALL cancel only that member; leader death/departure or dissolution SHALL cancel the shared teleport. AutoParty SHALL teleport only its leader.

#### Scenario: Teleport interrupted after four effective seconds
- **WHEN** aggressive combat starts, ends in victory and the worker restarts
- **THEN** teleport resumes from persisted progress and needs six further effective seconds
