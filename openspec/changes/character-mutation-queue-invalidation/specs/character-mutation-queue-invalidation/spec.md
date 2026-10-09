# Character Mutation Battle-Queue Invalidation

## ADDED Requirements

### Requirement: Attribute allocation invalidates stale future battles
When a character successfully spends unspent attribute points, the system SHALL persist the mutation and invalidate every stale future battle. If no battle is currently in progress, the queue SHALL be rebuilt immediately from the post-spend authoritative Character state. If a battle is currently in progress, that battle SHALL remain untouched and the future queue SHALL be rebuilt after the active battle resolves.

#### Scenario: Attribute spend replaces stale future entries
- GIVEN a grinding character has unresolved future BattleQueueEntry rows
- AND no battle is currently in progress
- WHEN the character successfully spends attribute points
- THEN the character's authoritative attributes are updated
- AND every previously unresolved queue entry is deleted
- AND the scheduled BullMQ jobs for those entries are removed
- AND the queue is rebuilt using the new character state

#### Scenario: Rebuilt attribute queue reaches normal depth
- GIVEN the character remains eligible to grind after spending attributes
- WHEN the mutation-triggered rebuild completes
- THEN the character has the normal target queue depth of 5, subject to the existing queue eligibility rules
- AND the first rebuilt entry's character snapshot reflects the new attributes and derived statistics

### Requirement: Active Gambit edits invalidate stale future battles
When the currently active Gambit page is successfully edited, the system SHALL persist the edit and invalidate stale future combat simulation. If no battle is currently in progress, the queue SHALL be rebuilt immediately from the edited active page. If a battle is currently in progress, that battle SHALL remain untouched and the future queue SHALL be rebuilt after the active battle resolves.

#### Scenario: Active page edit replaces stale future entries
- GIVEN the edited page is the character's active Gambit page
- AND no battle is currently in progress
- WHEN the page passes existing validation and is saved
- THEN every previous unresolved queue entry is deleted
- AND their scheduled BullMQ jobs are removed
- AND the replacement queue is simulated using the edited active page

#### Scenario: Invalid active-page edit does not touch the queue
- GIVEN an active Gambit page edit fails existing server validation
- WHEN the request is rejected
- THEN the stored Gambit page remains unchanged
- AND the existing unresolved queue remains unchanged

### Requirement: Inactive Gambit edits do not rebuild
Editing a Gambit page that is not currently active SHALL not invalidate or rebuild the battle queue.

#### Scenario: Prepare another page during grinding
- GIVEN page B is inactive and page A is active
- WHEN page B is edited successfully
- THEN page B is updated
- AND the active page remains A
- AND all existing unresolved queue entry ids remain unchanged

### Requirement: Activating another Gambit invalidates stale future battles
Activating a Gambit page different from the current active page SHALL persist the new active page and invalidate stale future combat simulation. If no battle is currently in progress, the queue SHALL be rebuilt immediately. If a battle is currently in progress, that battle SHALL remain untouched and the future queue SHALL be rebuilt after the active battle resolves.

#### Scenario: Switch active page between battles
- GIVEN page B is different from the current active page A
- AND no battle is currently in progress
- WHEN page B is activated
- THEN Character.activeGambitPageId becomes B
- AND the old unresolved queue entries are deleted
- AND their scheduled BullMQ jobs are removed
- AND the replacement queue is simulated from page B

#### Scenario: Re-activate the current page is a no-op
- GIVEN page A is already active
- WHEN the client requests activation of page A
- THEN the active page remains A
- AND the existing unresolved queue is unchanged

### Requirement: Combat-state mutations preserve an active battle
Attribute allocation, active Gambit activation and edits to the active Gambit page SHALL be accepted while a battle is in progress, but SHALL NOT alter the battle already in progress.

#### Scenario: Attribute spend during battle preserves the active snapshot
- GIVEN an unresolved battle satisfies startAt <= now < endAt
- WHEN the character successfully spends attribute points
- THEN the Character attributes and unspent points are updated
- AND the active battle entry id and its immutable snapshot remain unchanged
- AND every future unresolved queue entry after the active battle is deleted
- AND their scheduled BullMQ jobs are removed
- AND no replacement future battle starts before the active battle resolves

#### Scenario: Gambit activation during battle preserves the active snapshot
- GIVEN an unresolved battle satisfies startAt <= now < endAt
- WHEN the character successfully activates another Gambit page
- THEN activeGambitPageId is updated
- AND the active battle entry id and its immutable snapshot remain unchanged
- AND every future unresolved queue entry after the active battle is deleted
- AND their scheduled BullMQ jobs are removed
- AND no replacement future battle starts before the active battle resolves

#### Scenario: Active Gambit edit during battle preserves the active snapshot
- GIVEN an unresolved battle satisfies startAt <= now < endAt
- WHEN the character successfully edits the active Gambit page
- THEN the stored page is updated
- AND the active battle entry id and its immutable snapshot remain unchanged
- AND every future unresolved queue entry after the active battle is deleted
- AND their scheduled BullMQ jobs are removed
- AND no replacement future battle starts before the active battle resolves

#### Scenario: The next queue is rebuilt after the active battle resolves
- GIVEN a combat-state mutation was accepted while a battle was in progress
- WHEN that active battle resolves
- THEN the resolved battle remains the only battle from the old queue
- AND the future queue is rebuilt from the post-mutation authoritative Character + Equipment + Inventory + active Gambit state
- AND the rebuilt queue uses the updated mutation state
- AND the normal queue depth target is restored when the character remains eligible to grind

### Requirement: Mutation-triggered rebuild publishes the normal queue update
After a successful attribute spend, active Gambit edit or active Gambit activation that affects a grinding character, the server SHALL publish the existing battle:queueUpdated event for the replacement queue.

#### Scenario: Rebuilt queue is pushed to the client
- WHEN one of the protected mutations succeeds between battles and the character remains grinding
- THEN the replacement queue is published through the existing battle:queueUpdated contract
- AND no new socket event type is introduced
- AND the event represents the post-mutation queue rather than the discarded entries

### Requirement: Town and pending-transition states do not fabricate a grind queue
The mutation boundary SHALL preserve existing non-grinding semantics.

#### Scenario: Attribute spend in Town does not queue battles
- GIVEN the character is settled in canonical Town
- WHEN attribute points are spent successfully
- THEN the Character mutation is persisted
- AND no grind battle queue is created

#### Scenario: Mutation during pending Town transition remains protected by current transition semantics
- GIVEN the character has a pending Town transition
- WHEN a combat-state mutation is requested
- THEN it does not create or replace a grind queue while the transition remains pending

### Requirement: Queue invalidation has one authoritative implementation
All mutation paths that explicitly invalidate future combat state SHALL use the same BattleService-owned discard/cancel/rebuild mechanism already used by the established level-up/equipment/food flows.

#### Scenario: No second invalidation implementation
- WHEN the implementation is reviewed
- THEN CharacterService and GambitService do not directly delete BattleQueueEntry rows or BullMQ jobs
- AND queue reconstruction is delegated to the existing BattleService queue builder

### Requirement: Verification covers stale-entry replacement and active-battle safety
The new guarantees SHALL be covered by a committed re-runnable verification script.

#### Scenario: End-to-end mutation verification
- WHEN the verification script runs against the local stack
- THEN it proves attribute spend, active Gambit activation, active Gambit edit, inactive Gambit edit and active-battle preservation
- AND it reports the observed stale row/job ids versus the preserved active entry and subsequent replacement queue
- AND it exits non-zero on any failed assertion
