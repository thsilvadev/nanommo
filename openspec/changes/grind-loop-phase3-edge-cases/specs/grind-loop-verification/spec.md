# Spec Delta

## Purpose

Defines the guarantees the grind loop must uphold at its edges — level-up mid-queue, death, determinism, idempotent resolution, crash recovery, and gambit validation — and requires that each guarantee be proven by a re-runnable verification script rather than asserted from memory.

## ADDED Requirements

### Requirement: Level-up during queue resolution awards attribute points and preserves health ratio

When resolving a battle raises a character's level, the system SHALL award exactly 5 unspent attribute points per level gained, SHALL recompute the character's maximum HP and maximum SP immediately as derived values, and SHALL NOT restore current HP or current SP to their new maximums. Instead, current HP and current SP SHALL be scaled by the ratio of the new maximum to the old maximum, so a mid-grind level-up neither heals for free nor leaves current health nonsensibly low against a raised cap. A single resolve that crosses more than one level threshold SHALL apply the scaling once across the whole batch.

#### Scenario: Level-up awards five points per level

- **WHEN** a battle resolve raises a character from level 1 to level 2
- **THEN** the character's level is 2 and their unspent attribute points increased by exactly 5

#### Scenario: Level-up does not top up current health

- **WHEN** a character at 40% of their maximum HP levels up to a higher maximum HP
- **THEN** the character's current HP is the rounded product of the previous current HP and the ratio of new maximum HP to old maximum HP, and is strictly less than the new maximum HP

#### Scenario: Multi-level gain scales health once across the batch

- **WHEN** a single battle resolve raises a character across two level thresholds at once
- **THEN** current HP is scaled by the ratio of the maximum HP at the final level to the maximum HP at the pre-gain level, computed as one step rather than compounded per level

### Requirement: Level-up invalidates and rebuilds the pending battle queue

Because pending queue entries were simulated against pre-level-up statistics, the system SHALL discard every unresolved entry remaining after a level-up, SHALL cancel their scheduled resolution jobs, and SHALL rebuild the queue from the character's post-level-up state back to the target depth of 5, with each rebuilt entry re-simulated against the new derived statistics. The rebuild SHALL occur after the kill counter is advanced, so the rebuilt chain does not re-encounter the monster index that was just killed.

#### Scenario: Stale entries are discarded after a level-up

- **WHEN** a level-up occurs with 4 unresolved queue entries remaining
- **THEN** those 4 entries are deleted and no further scheduled job will resolve them

#### Scenario: Queue is rebuilt to full depth with new statistics

- **WHEN** a level-up occurs and the queue is rebuilt
- **THEN** the character has 5 unresolved queue entries again, and the first rebuilt entry's starting character statistics reflect the new level's derived maximums

### Requirement: Death returns the character to town and discards the rest of the chain

On the queue entry whose outcome is a loss, the system SHALL set the character's status to town, SHALL clear the character's current map, SHALL set current HP to 1 rather than 0, SHALL apply the XP loss defined for death, SHALL overwrite the character's stored last-death log with that battle's full log, and SHALL delete every remaining unresolved queue entry along with its scheduled job. No new battles SHALL be queued for that character until the player returns to a map.

#### Scenario: Loss routes the character out of the grind

- **WHEN** a battle with outcome `loss` is resolved
- **THEN** the character's status is `town`, their current map is null, and their current HP is 1

#### Scenario: Death applies the XP loss without going negative

- **WHEN** a character holding less XP than the death penalty is killed
- **THEN** their XP is 0 and never a negative value

#### Scenario: Death penalty is a percentage of the current level requirement

- **WHEN** a character with XP is killed at level L
- **THEN** their XP is reduced by the death penalty derived from the XP required to advance from level L, floored at zero

#### Scenario: Last death log is overwritten with the killing battle

- **WHEN** a character dies a second time
- **THEN** the stored last-death log contains the second battle's log and no trace of the first

#### Scenario: Remaining chain is discarded

- **WHEN** a character dies with 4 unresolved entries remaining
- **THEN** zero unresolved entries remain for that character and no scheduled job will resolve them

### Requirement: Battle simulation is a pure function of its inputs

Given an identical character snapshot, monster definition, gambit page, and seed, the battle engine SHALL produce a byte-identical result — identical event stream, identical outcome, identical duration, identical resulting health and mana, and identical items consumed. The system SHALL NOT use an unseeded random source anywhere in the simulation path, and the seed actually used SHALL be stored alongside the battle so a run can be replayed.

#### Scenario: Same inputs produce the same log

- **WHEN** the battle engine simulates the same character snapshot, monster, gambit page, and seed twice
- **THEN** both simulations produce byte-identical logs, outcomes, durations, and resulting stats

#### Scenario: A different seed produces a different run

- **WHEN** the same inputs are simulated with a different seed
- **THEN** at least one event, the outcome, or the duration differs

#### Scenario: Replay is possible from the stored seed

- **WHEN** a resolved battle's stored seed and its character starting snapshot are re-fed to the battle engine
- **THEN** the replayed log matches the stored log

### Requirement: Battle resolution is idempotent under concurrent callers

A battle's effects — experience, gold, drops, consumed item removal, kill-counter increment, level-up, and death handling — SHALL be applied at most once per battle, even when the same battle is handed to the resolver concurrently by the scheduled job and the crash-recovery pass, or repeatedly by a scheduled-job retry after a partial failure. The system SHALL claim a battle atomically before applying any effect, and a second claim of an already-claimed battle SHALL be a no-op that grants nothing.

#### Scenario: Concurrent resolve applies effects once

- **WHEN** two resolution attempts for the same battle id run at the same time
- **THEN** exactly one applies the battle's experience, gold, and drops, the other grants nothing, and the character's totals equal a single application

#### Scenario: Repeated resolve of a resolved battle is a no-op

- **WHEN** a battle that has already been resolved is resolved again
- **THEN** the character's experience, gold, inventory, and kill counter are unchanged

#### Scenario: Consumed items are removed exactly once

- **WHEN** a battle that consumed potions is resolved concurrently
- **THEN** the inventory quantity is decremented by the simulated consumption exactly once, and never below zero

### Requirement: Crash recovery resolves stale entries in order before serving traffic

On backend boot, the system SHALL treat unresolved battle queue rows — not scheduled job state — as the source of truth. It SHALL resolve every unresolved entry whose end time is in the past, in order from oldest to newest, applying effects, deaths, drops, and level-ups exactly as the scheduled job would have, before the API accepts its first request. It SHALL then re-derive live queue depth and restore it to 5 for any character still alive and still on a map. A failure resolving one entry SHALL NOT abort recovery of the remaining entries, and a failure in the recovery pass SHALL NOT prevent the API from starting.

#### Scenario: Stale entries resolve on restart

- **WHEN** the backend restarts with unresolved queue entries whose end times are in the past
- **THEN** each of those entries has its effects applied exactly once, before any new request is served

#### Scenario: Entries resolve oldest first

- **WHEN** the backend restarts with several stale entries forming one chain
- **THEN** the character's resulting health and experience reflect the entries applied in sequence order, not in arbitrary order

#### Scenario: Queue is topped up after recovery

- **WHEN** the backend restarts and a still-alive character on a map has fewer than 5 unresolved entries
- **THEN** that character has 5 unresolved entries once recovery completes

#### Scenario: Dead characters are not topped up

- **WHEN** the backend restarts and a character was routed to town by a death resolved during recovery
- **THEN** that character is left with no unresolved queue entries

#### Scenario: One bad row does not abort the pass

- **WHEN** one stale entry fails to resolve during the recovery pass
- **THEN** the remaining stale entries are still resolved and the API still starts

### Requirement: Invalid gambit pages are rejected before any write

On every gambit page write, the system SHALL reject the entire write with a 400 and field-level errors — never silently dropping or repairing individual lines — when any of the following holds: the page has more than 20 lines; a line has other than 1 or 2 conditions; a line's combinator is not null exactly when it has a single condition; a condition or action identifier is not in the published catalog; a parameter value is outside the shape or enum the catalog declares for it; a skill reference does not exist; or an item reference does not exist. No repository write SHALL occur when validation fails.

#### Scenario: Unknown item reference is rejected

- **WHEN** a page is saved with a line whose action consumes an item that does not exist
- **THEN** the response is 400 with a field-level error and the stored page is unchanged

#### Scenario: Invalid band value is rejected

- **WHEN** a page is saved with a health-band condition whose band is not one of the five defined bands
- **THEN** the response is 400 with a field-level error and the stored page is unchanged

#### Scenario: Condition arity and combinator mismatch is rejected

- **WHEN** a page is saved with a line having 3 conditions, or with 2 conditions and no combinator, or with 1 condition and a combinator
- **THEN** the response is 400 with a field-level error and the stored page is unchanged

#### Scenario: Over-long page is rejected wholesale

- **WHEN** a page is saved with 21 lines, one of which is also invalid
- **THEN** the response is 400 listing the offending fields and no line from the rejected page is persisted

#### Scenario: A valid page is accepted

- **WHEN** a page is saved whose lines all reference real catalog ids, real skills, and real items with well-formed parameters
- **THEN** the write succeeds and the stored lines are retrievable

### Requirement: Condition-true but illegal gambit lines are skipped

At runtime, when a gauge fires, the system SHALL evaluate the active page's lines in priority order and execute the first line that is both condition-true and currently legal. A line that is condition-true but not legal SHALL be skipped entirely and SHALL NOT block evaluation of lower-priority lines. Legality includes: the referenced item is present in inventory with a quantity above zero; the potion cooldown category is free; the referenced skill is unlocked for the equipped weapon, is off cooldown, and the character has enough mana; and a line is only ever evaluated for the gauge type its action type can fire on.

#### Scenario: Potion line with an empty inventory is skipped

- **WHEN** a page's highest-priority line calls for a potion the character does not hold and a lower-priority line performs a basic attack
- **THEN** the basic attack executes and the potion line has no effect

#### Scenario: Potions share one cooldown category

- **WHEN** a character uses a healing potion and a mana potion becomes legal within the shared cooldown window
- **THEN** the mana potion does not fire until the shared potion cooldown has elapsed

#### Scenario: First legal line wins

- **WHEN** two lines are condition-true and both legal at the same gauge fire
- **THEN** only the higher-priority line executes

#### Scenario: No legal line wastes the fire

- **WHEN** no line is both condition-true and legal at a gauge fire
- **THEN** no action is taken, the gauge still resets, and the battle continues

### Requirement: Edge-case guarantees are covered by re-runnable verification scripts

Each guarantee in this capability SHALL be covered by a committed verification script that can be run against a locally running stack without manual setup steps, SHALL report a pass or fail per assertion, and SHALL exit non-zero when any assertion fails. The scripts SHALL cover the six Phase 3 areas — level-up mid-queue, death, determinism, idempotency, crash recovery, and gambit validation — and SHALL be runnable individually and as a suite. A verification result SHALL NOT be recorded as evidence in project status documentation unless the script that produced it is committed and re-runnable.

#### Scenario: A guarantee is provable on demand

- **WHEN** a developer runs the verification script for any one of the six areas
- **THEN** the script exercises that guarantee end to end and reports pass or fail per assertion

#### Scenario: A regression fails loudly

- **WHEN** any covered guarantee is broken in the implementation
- **THEN** the corresponding script reports a failed assertion and exits non-zero

#### Scenario: The suite runs end to end

- **WHEN** a developer runs the aggregate suite script against a freshly started stack
- **THEN** all six areas are exercised in sequence and the script exits zero only if every assertion in every area passed
