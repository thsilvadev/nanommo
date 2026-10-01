# Spec Delta

## Purpose

Provides a single authoritative realtime synchronization contract for Character resources and Inventory quantities across battle, encounter search, and asynchronous transport delivery.

## ADDED Requirements

### Requirement: Authoritative resource snapshot
After an authoritative battle resolution, the server SHALL publish the current Character HP/SP and complete inventory state together with a monotonic revision. The client SHALL render those values independently of battle/search/Town presentation state.

#### Scenario: Battle resolves into search
- **WHEN** a battle resolves and the next encounter has not started
- **THEN** Character HP/SP and Inventory immediately show the resolved server state and remain unchanged until a newer authoritative update arrives

#### Scenario: Next battle starts
- **WHEN** the next battle begins after the search gap
- **THEN** Character HP/SP and Inventory continue from the latest authoritative state rather than reverting to the previous battle snapshot

### Requirement: No battle-derived resource display
The Character Panel and Inventory SHALL NOT derive current Character HP/SP or item quantities from battle queue timestamps, battle logs, active battle state, or encounter-search presentation state.

#### Scenario: Searching for monster
- **WHEN** the client is displaying Searching for monster
- **THEN** the Character Panel and Inventory continue rendering their latest authoritative snapshots

### Requirement: Causal HTTP convergence
A Character or Inventory HTTP response that was initiated before a newer realtime snapshot was accepted SHALL NOT overwrite that realtime snapshot.

#### Scenario: Old Character HTTP response
- **WHEN** an older /characters response arrives after a newer websocket Character snapshot
- **THEN** the older response is discarded and the newer HP/SP remain visible

#### Scenario: Old Inventory HTTP response
- **WHEN** an older /inventory response arrives after a newer websocket Inventory snapshot
- **THEN** the older quantities are discarded and the newer inventory remains visible

### Requirement: Realtime revision ordering
A realtime Character/Inventory snapshot SHALL be accepted only when its revision is newer than the last accepted realtime revision.

#### Scenario: Realtime payloads arrive out of order
- **WHEN** a newer snapshot is accepted before an older snapshot arrives
- **THEN** the older snapshot is ignored and cannot regress Character or Inventory state

#### Scenario: Newer realtime payload
- **WHEN** a snapshot has a revision newer than the accepted revision
- **THEN** the newer Character and Inventory state replaces the previous snapshot
