# Spec Delta

## Purpose

Player-driven movement and emotes in the Town scene without a movement server, arrival and departure effects, and the map tooltip cleanup.

## ADDED Requirements

### Requirement: Click to move in a Town

Clicking the ground in the Town scene MUST walk the player's character to that point along the walk grid. A point that is blocked or unreachable MUST be replaced by the nearest reachable cell. Clicking an NPC MUST walk the character up to the NPC and face it, and MUST still open that NPC. TOWN_MOVE_RESUME_MS (10 s) after arriving, the character MUST go back to wandering by itself, starting from where it stopped. A click MUST wake a character from `/sleep` and end any emote. Every client MUST derive the walk from one stored record and the server clock. The server MUST NOT run anything per tick for it, and MUST ignore clicks closer than 200 ms apart.

#### Scenario: Walk and resume
- **WHEN** the player clicks a free point on the ground
- **THEN** every client shows the character walking there, standing for 10 s, then wandering again from that point

#### Scenario: Walk to an NPC
- **WHEN** the player clicks an NPC
- **THEN** the NPC opens and the character walks up to it and faces it

### Requirement: Dance and sit emotes

`/dance` and `/sit` in the chat MUST hold the emote where the character is, with no time limit, online or offline. The same command again MUST stop it. A click-to-move or `/sleep` MUST end it. Outside a Town, both MUST be refused with "You can only do that in town.". `/sit` MUST show the character seated on a stool. A character seen after it sat down long ago MUST already be seated.

#### Scenario: Dance until told otherwise
- **WHEN** the player types `/dance` and goes offline
- **THEN** other players keep seeing the character dancing on the same spot

### Requirement: Arrival and departure aura

A character that appears in, or leaves, the Town scene while it is open MUST be wrapped in an aura effect lasting 0.5 s. Characters already present when the scene opens MUST NOT get one, except one that joined the Town less than 1.5 s earlier.

#### Scenario: Someone arrives
- **WHEN** another character arrives in the Town the player is looking at
- **THEN** a short aura plays where it appears

### Requirement: No stale map tooltip in the Town view

Leaving the map view MUST remove the map tile tooltip.

#### Scenario: Arriving with the pointer on a tile
- **WHEN** the player travels to a Town with the pointer resting on a map tile and the view switches to the Town scene
- **THEN** no map tooltip remains on screen
