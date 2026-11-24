# Smashing Spree town event and item-obtained toast

## ADDED Requirements

### Requirement: Scheduled event with announcements

The server SHALL start a Smashing Spree (pt-BR: Quebra-Quebra) at 03:30, 09:30, 15:30 and 21:30 America/Sao_Paulo every day, and SHALL publish a `server_announce` message exactly 30, 15, 5 and 1 minutes before each start and one at the start. Each phase SHALL run at most once per event even if the scheduler fires more than once.

Announcements SHALL name the event town (params `mapId`), so players know to go to Sierra Village.

#### Scenario: Five-minute warning
- WHEN the scheduler tick runs at 09:25 local time
- THEN one announcement with key `event.smashingSpree.soon`, minutes 5 and mapId `map_town` is published ("Head to Sierra Village." / "Vá para Sierra Village.")
- AND a second tick in the same minute publishes nothing.

### Requirement: Vases in Sierra Village

At start, only the event town `townMapId` of `town_events.json` (Sierra Village, `map_town`) SHALL receive 500 vases on reachable ground for 300 seconds, 40 of which hold prizes from `town_events.json`. Other towns SHALL get no vases. Prize data SHALL NOT be sent to clients before a vase breaks. The public payload and the roster snapshot SHALL carry `startsAt` and `endsAt`.

#### Scenario: Public layout
- WHEN the event starts
- THEN the Sierra Village room receives `town:event:vases` with 500 vases, `startsAt` and `endsAt` 300 s later
- AND no other town receives vases
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

When all prize vases of a town (40) are broken, that town's remaining vases SHALL disappear and further hits SHALL be rejected.

#### Scenario: Last prize found
- WHEN the last (40th) prize vase of a town breaks
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

### Requirement: Event music in Sierra Village

While the event runs, a client whose character is in the event town SHALL play `new_packs/7/eventMusic.mp3` instead of the town's music, starting at the event's elapsed time (server clock), and SHALL return to the town's music when the event ends (timeout or all prizes found). The music follows the client's live state, so arriving mid-event, leaving before the end, and leaving and coming back each resolve to the right track and position.

#### Scenario: Arrives mid-event
- WHEN a character arrives in Sierra Village 90 s after the start
- THEN the event music starts 90 s into the track.

#### Scenario: Leaves and comes back
- WHEN the character leaves town during the event
- THEN the destination's music plays
- AND on return during the same event the event music resumes at the current elapsed time.

#### Scenario: Event ends
- WHEN the event ends while the character is in Sierra Village
- THEN Sierra Village's own music plays again.
