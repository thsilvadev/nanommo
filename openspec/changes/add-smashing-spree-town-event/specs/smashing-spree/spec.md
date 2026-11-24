# Smashing Spree town event and item-obtained toast

## ADDED Requirements

### Requirement: Scheduled event with announcements

The server SHALL start a Smashing Spree (pt-BR: Quebra-Quebra) at 03:30, 09:30, 15:30 and 21:30 America/Sao_Paulo every day, and SHALL publish a `server_announce` message exactly 30, 15, 5 and 1 minutes before each start and one at the start. Each phase SHALL run at most once per event even if the scheduler fires more than once.

#### Scenario: Five-minute warning
- WHEN the scheduler tick runs at 09:25 local time
- THEN one announcement with key `event.smashingSpree.soon` and minutes 5 is published
- AND a second tick in the same minute publishes nothing.

### Requirement: Vases per town

At start, every town with a 3D scene SHALL receive 200 vases on reachable ground for 120 seconds, 20 of which hold prizes from `town_events.json`. Prize data SHALL NOT be sent to clients before a vase breaks.

#### Scenario: Public layout
- WHEN the event starts
- THEN each town room receives `town:event:vases` with 200 vases
- AND the payload contains no item ids.

### Requirement: First hit wins

A vase SHALL break with one accepted hit. The server SHALL accept a hit only from a character present in that town, while the event is active, within 1.0 world unit of the vase, and at most once per 1000 ms per character. Exactly one character SHALL win each vase.

#### Scenario: Simultaneous hits
- WHEN two characters hit the same vase at the same time
- THEN one receives success and the other `ALREADY_BROKEN`
- AND the prize is granted once.

#### Scenario: Too far
- WHEN a character 1.01 units away hits a vase
- THEN the hit is rejected with `OUT_OF_RANGE`.

### Requirement: Early end

When all 20 prize vases of a town are broken, that town's remaining vases SHALL disappear and further hits SHALL be rejected.

#### Scenario: Last prize found
- WHEN the 20th prize vase of a town breaks
- THEN `town:event:ended` with reason `all-prizes-found` is broadcast to that town.

### Requirement: Prize delivery

A prize SHALL go into the bag; if that fails it SHALL be sent by system mail with source key `smashing-spree:<eventKey>:<mapId>:<vaseId>`; if mail also fails it SHALL be recorded in a pending list for replay.

#### Scenario: Full bag
- WHEN the winner's bag is full
- THEN the prize arrives by mail.

### Requirement: Item-obtained toast

The server SHALL emit `inventory:obtained` after commit for battle drops, party battle drops, gathering, crafting output, vendor purchases, mail attachment collection, quest rewards and event prizes, and SHALL NOT emit it for storage withdrawal or unequipping. The client SHALL show one box for 4 seconds with only the first item; a newer event SHALL replace it in place with no transition.

#### Scenario: Multi-item drop
- WHEN a battle grants two different items
- THEN the toast shows only the first one.
