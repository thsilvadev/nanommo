# Spec Delta

## Purpose

Defines how authoritative precomputed battles are scheduled, delivered, replenished, recovered, and safely discarded when the combat clock changes or queue consumers run concurrently.

## ADDED Requirements

### Requirement: Each battle entry identifies the tick duration used to simulate it

Every newly created battle entry and its immutable log metadata SHALL carry `tickDurationMs` with the exact simulation tick duration used for that battle. The authoritative queue payload SHALL expose the same value. New entries under this change SHALL use 500 milliseconds.

#### Scenario: New battle entry records its time base

- **WHEN** the server persists a battle simulated with 500 ms ticks
- **THEN** the BattleQueueEntry, log/header, and client-facing queue payload identify `tickDurationMs = 500`

#### Scenario: Client projects recorded events using the entry's tick duration

- **WHEN** the frontend projects a log event, status expiry, HP/SP snapshot, hit feedback, or timed battle sound
- **THEN** it calculates the event's wall-clock position from that battle's recorded `tickDurationMs`, never from a hard-coded 1,000 ms assumption

### Requirement: The server owns queue readiness and battle progress

The backend SHALL remain the sole authority for battle simulation, queue readiness, battle outcomes, and scheduled timestamps. The frontend SHALL render only authoritative entries and SHALL NOT manufacture a battle, start timestamp, outcome, event, or progress while waiting for the next queue entry.

#### Scenario: Character enters Grind and initial queue is being prepared

- **WHEN** a Character enters a Grind map but the server has not yet supplied a valid battle entry
- **THEN** the frontend remains in its existing searching/preparing state and does not display a fabricated battle bar or advance a battle timeline

#### Scenario: Initial queue becomes available

- **WHEN** the backend has persisted and published the initial queue
- **THEN** the frontend begins presenting the first battle from its authoritative `startAt`/`endAt` timestamps and uses the entry's tick-duration metadata for timeline projections

#### Scenario: A queue top-up is late

- **WHEN** the current queue is exhausted before another valid entry is available
- **THEN** the frontend shows the existing searching/preparing state until an authoritative `battle:queueUpdated` or equivalent payload supplies the next entry

### Requirement: Queue mutations never expose stale future battle snapshots

Successful changes to battle-relevant Character attributes, equipment, active Gambit, map, or combat buffs SHALL follow the existing BattleService-owned mutation boundary. An in-flight battle SHALL remain immutable and retain its scheduled job; stale future entries SHALL be invalidated and rebuilt from the new authoritative state at the existing safe boundary. An inactive Gambit edit SHALL NOT invalidate the queue.

#### Scenario: Mutation occurs during an active battle

- **WHEN** a Character changes equipment, attributes, or the active Gambit while an unresolved battle is in progress
- **THEN** the active battle snapshot/job remains unchanged, stale future entries are invalidated, and the future queue is rebuilt after the active battle resolves

#### Scenario: Mutation occurs with no active battle

- **WHEN** a valid battle-relevant mutation succeeds while no battle is active
- **THEN** stale queue entries are discarded and the new queue is generated from the updated Character state before being published

#### Scenario: Mutation validation fails

- **WHEN** an attempted mutation fails validation
- **THEN** the existing queue and its scheduled jobs remain unchanged

### Requirement: Queue consumers allow bounded cross-character concurrency while serializing each Character

Battle resolution, queue generation, and world-activity handlers SHALL support explicit bounded concurrency configuration. Jobs for different Characters MAY progress concurrently. Operations that mutate or resolve the same Character SHALL remain serialized through the existing Redis per-character lock and PostgreSQL transaction/row-lock invariants. Duplicate or retried battle-resolution jobs SHALL remain idempotent.

#### Scenario: Different Characters are processed concurrently

- **WHEN** independent battle or queue jobs for different Characters are waiting
- **THEN** configured handler concurrency permits independent jobs to execute concurrently up to the configured limit

#### Scenario: Two jobs target the same Character

- **WHEN** battle resolution, queue generation, or another protected world mutation overlaps for the same Character
- **THEN** the existing per-Character lock and database locking prevent conflicting state transitions and reward duplication

#### Scenario: A battle-resolution job is delivered more than once

- **WHEN** duplicate or retried jobs target the same BattleQueueEntry
- **THEN** exactly one transaction applies authoritative battle effects and later deliveries return an idempotent no-op

### Requirement: Queue scheduling latency is observable and does not masquerade as combat duration

The backend SHALL log enough structured timing data to distinguish scheduled battle end, actual job start, queue generation duration, queue depth, handler duration, retry/failure, and per-Character serialization wait. These measurements SHALL NOT change battle outcomes or scheduled timestamps.

#### Scenario: Resolution job starts after its due time

- **WHEN** a delayed `resolve-battle` job starts later than its scheduled `endAt`
- **THEN** logs identify the processing delay separately from the battle's simulated duration

#### Scenario: Initial queue generation is slow

- **WHEN** initial queue generation takes measurable wall-clock time
- **THEN** logs expose queue-generation duration and resulting depth so the entry wait can be diagnosed independently of the monster-search interval

### Requirement: Tick-rate cutover preserves persistent Characters and resets transient combat state

The 500 ms runtime SHALL be introduced through a planned maintenance cutover rather than mixed-duration execution of existing unresolved BattleQueueEntry rows. The cutover SHALL preserve Character identity, progression, attributes, equipment, inventory, currency, quests, and other persistent game data; it MAY discard all old BattleQueueEntry rows/logs and their obsolete combat jobs. All Characters SHALL be returned to canonical `map_town` with transient Grind/Travel encounter state cleared before the new runtime accepts gameplay.

#### Scenario: Maintenance cutover resets old battles

- **WHEN** the deployment runbook is executed with the old backend and queue consumers stopped
- **THEN** old battle entries/logs and obsolete battle/encounter jobs are removed, and no old-tick battle is resumed under the 500 ms runtime

#### Scenario: Persistent Character data survives the cutover

- **WHEN** a Character is returned to Town during the cutover
- **THEN** its identity, level/XP, attributes, equipment, inventory, Gold/Soul Tokens, quests, Mastery, and other persistent progression remain unchanged

#### Scenario: All Characters restart in Town

- **WHEN** the new backend starts after the cutover
- **THEN** every Character is in canonical `map_town`, with no stale Grind battle, Travel transition, or Gathering encounter state capable of restarting an old encounter

#### Scenario: Startup recovery resumes supported non-combat persisted activities

- **WHEN** a persisted Town activity such as Cooking or Crafting remains valid after restart
- **THEN** existing activity reconciliation may re-arm its job using its persisted real-time deadline, without restoring a discarded combat queue
