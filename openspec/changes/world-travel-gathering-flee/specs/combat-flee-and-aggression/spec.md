# Spec Delta

## Purpose

Define monster aggression and speed for world encounters, FLEE as a parallel combat roll, and deterministic reward-free battle cancellation that preserves the character at the successful escape tick.

## ADDED Requirements

### Requirement: Monster aggression and world Move Speed are explicit catalogue values

Every canonical monster MUST declare isAggressive and hard-coded moveSpd. World moveSpd MUST NOT be derived from monster level. The initial non-aggressive set is exactly mon_slime, mon_thornsprout, mon_saltfangcrab and mon_moonleafarcanist; every other current monster is aggressive. Existing moveSpeedBase and lane-combat scaling MUST remain unchanged.

#### Scenario: Validate monster movement properties
- **WHEN** the monster catalogue validator runs
- **THEN** every monster has isAggressive and moveSpd in canonical/frontend mirrors
- **AND** only the four approved IDs are non-aggressive

### Requirement: Encounter search uses a deterministic randomized interval

Each search interval MUST be an inclusive deterministic integer from 2 through 6 seconds plus playersInMap seconds. playersInMap includes the current character, persisted residents and disconnected residents. Use seeded randomness, not Math.random. Searching countdown is not displayed.

#### Scenario: Search on a populated map
- **WHEN** the map has P persisted residents including the character
- **THEN** the next interval is randInt(2,6) + P seconds
- **AND** online/socket count is not substituted for gameplay map presence

### Requirement: Hunting fights all monsters; Gathering and Traveling avoid non-aggressive monsters

Hunting MUST engage every selected monster. Gathering/Traveling MUST skip a non-aggressive monster without battle or delay to the travel segment. Against an aggressive monster, Gathering/Traveling MUST use the same speed/LUK FLEE chance before battle starts.

#### Scenario: Traveling encounters a non-aggressive monster
- **WHEN** a non-aggressive monster is selected during Traveling
- **THEN** battle is skipped and route progress continues without an extra pause

#### Scenario: Gathering fails a pre-combat escape roll
- **WHEN** an aggressive monster is selected during Gathering and the pre-combat roll fails
- **THEN** normal battle starts while the saved stance remains Gathering

#### Scenario: Traveling fails a pre-combat escape roll
- **WHEN** an aggressive monster is selected during Traveling and the pre-combat roll fails
- **THEN** battle starts and pauses the route
- **AND** that failure counts as the first failed in-battle FLEE roll, with next attempt due after 10 seconds

### Requirement: FLEE is parallel, never a Gambit/action

FLEE MUST NOT be a Gambit action, cast, action-gauge consumer or replacement for normal combat intent. Manual FLEE from selecting Traveling during battle attempts on the next eligible combat tick. Failure leaves combat unchanged and schedules another roll after 10 seconds while Traveling remains active. Destination changes MUST NOT bypass/reset the cooldown. Choosing Hunting/Gathering stops retries but does not cancel/rewrite the active battle.

#### Scenario: FLEE fails
- **WHEN** a scheduled FLEE attempt fails
- **THEN** normal combat actions continue on their canonical schedule
- **AND** the next attempt is due 10 seconds later if Traveling remains active

#### Scenario: Destination changes during cooldown
- **WHEN** a player changes destination while still Traveling in battle
- **THEN** the latest destination is saved
- **AND** the current FLEE cooldown deadline is preserved

### Requirement: FLEE uses relative speed and 10% LUK influence

Let r = clamp(characterMoveSpd / max(monsterMoveSpd, 1) − 1, −0.5, +0.5). Speed chance MUST be 1 + (r + 0.5) × 98 percentage points, producing 1% at 50% slower, 50% at equal speed and 99% at 50% faster. LUK MUST have 10% weighted influence tapered to zero at the 1%/99% speed endpoints. Centralize and test the helper/constants.

#### Scenario: FLEE endpoint odds
- **WHEN** the character is 50% slower or 50% faster than the monster
- **THEN** final chance is exactly 1% or 99% regardless of LUK
- **AND** equal speed at baseline LUK gives 50%

### Requirement: Successful FLEE cancels battle with exact partial state and no rewards

Successful FLEE MUST capture state after that tick’s ordinary combat effects if the character is still alive. It MUST atomically mark the entry cancelled/resolved, preserve the immutable original log/outcome, apply only state that occurred up through the successful tick, cancel obsolete future encounter jobs and resume the route. It MUST NOT award XP, Mastery XP, drops, gold, kill-counter changes, victory payout or death routing. Use the existing per-character lock and Character→BattleQueueEntry row-lock order.

#### Scenario: FLEE succeeds after resources/statuses changed
- **WHEN** FLEE succeeds after item use, HP/SP changes, and status/buff changes during battle
- **THEN** Character/Inventory matches the deterministic checkpoint including food/digestion and remaining effect durations
- **AND** original battle snapshot/log is unchanged and no reward payout occurs

#### Scenario: FLEE races normal resolution
- **WHEN** FLEE and ordinary resolution run concurrently
- **THEN** exactly one path commits
- **AND** a cancelled battle cannot later award its precomputed payout

#### Scenario: Character dies before the roll
- **WHEN** the normal combat tick brings HP to zero before the parallel FLEE roll
- **THEN** normal death wins

### Requirement: Cancelled battles are excluded from normal wins/losses

Cancelled battles MUST remain auditable with their immutable snapshot and cancellation reason/time, but MUST not appear in active queues or normal user-visible completed win/loss history and reward projections.

#### Scenario: Read queue/history after escape
- **WHEN** the client refreshes after successful FLEE
- **THEN** the cancelled encounter is absent from live queue and normal completed history
- **AND** Character/Inventory reflect the checkpoint
