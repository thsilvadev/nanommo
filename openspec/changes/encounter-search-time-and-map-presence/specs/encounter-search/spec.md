# Encounter Search

## ADDED Requirements

### Requirement: Authoritative encounter search delay
Every grind encounter SHALL have a server-authoritative search phase before its battle starts. The delay SHALL be 2 seconds plus 0.1 seconds for every other character currently grinding on the same map.

#### Scenario: First encounter
- **WHEN** a character starts grinding on a map with no other grinder
- **THEN** the first battle startAt is at least 2 seconds after queue generation

#### Scenario: Crowded map
- **WHEN** three other characters are currently grinding on the same map
- **THEN** the next encounter search delay is 2.3 seconds

#### Scenario: Sequential encounters
- **WHEN** a queued battle ends and another battle follows
- **THEN** the next battle starts after the previous endAt plus a newly calculated encounter search delay

#### Scenario: Self is excluded
- **WHEN** counting players for encounter search
- **THEN** the character being queued is not counted as an other character
