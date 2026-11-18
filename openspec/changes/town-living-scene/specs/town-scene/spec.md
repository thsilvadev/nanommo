# Spec Delta

## Purpose

Define the living Town scene: who stands in a Town, how they move without a movement server, sleep/wake, the scene view and the first social action.

## ADDED Requirements

### Requirement: Town scenes are canonical catalogue data

Each Town with a scene MUST be described in root `town_scenes.json` (mirrored to the frontend) with a 72×72 walk grid, at least 2500 free cells, at least 16 points of interest, a spawn, and an NPC spot for every NPC of that Town in `maps.json`, each free, reachable from the spawn and within 3 units of a point of interest. The API MUST refuse to boot when the catalogue is invalid.

#### Scenario: Missing NPC spot
- **WHEN** a Town NPC listed in `maps.json` has no `npcSpots` entry
- **THEN** `validateTownScenes()` reports it and API boot fails

#### Scenario: Outpost has no scene
- **WHEN** a character stands in Outpost
- **THEN** no Town scene, roster or toggle is offered

### Requirement: Movement is deterministic and never transmitted

Every client MUST derive a character's Town pose only from its roster seed, sleep/wake state and the server clock with the shared `positionAt`. Positions MUST NOT be sent by clients or servers, and no Town event may be sent per tick. Poses MUST never fall on a blocked cell and MUST be continuous (no teleport) except when waking.

#### Scenario: Two clients agree
- **WHEN** two clients evaluate the same entry at the same server time
- **THEN** they compute the same position, facing and state

### Requirement: Town roster includes offline characters asleep

The Town roster MUST contain every character whose `currentMapId` is that Town and who is neither travelling nor in a pending map transition, online or offline, capped at 200 per snapshot ordered self → party → online → offline by most recent activity. Offline characters MUST appear asleep. Starting a trip MUST remove the character from the scene. The online indicator above the chat MUST keep counting only connected characters.

#### Scenario: Disconnect sleeps, login wakes
- **WHEN** a character in a Town disconnects
- **THEN** it is marked asleep where it stands and a `town:update` is emitted
- **AND WHEN** it connects again, even within a second of a page refresh
- **THEN** it is awake with a new seed, starting from where it slept

#### Scenario: Travel removes the character
- **WHEN** a character in a Town starts travelling (solo or with a party)
- **THEN** `town:leave` is emitted for that Town

### Requirement: Sleep and wake are server intents

`/sleep` typed in chat inside a Town MUST send `town:sleep` and never reach the Global channel; outside a Town, or for an unknown command, a red local System line MUST be shown. Clicking an NPC while asleep MUST send `town:wake`. Offline characters cannot be woken by others.

#### Scenario: Sleep outside a Town
- **WHEN** the player types `/sleep` on a grind map
- **THEN** the chat shows "You can only sleep in town." in red and nothing is sent

### Requirement: Town scene view

In a Town with a scene, the map head MUST show a map | house toggle defaulting to the house on arrival; the house view MUST render the Town with one WebGL renderer, a fixed-angle camera that never shows the sky, zoom and pan clamped to the Town, and at most 100 characters. three.js MUST NOT be loaded outside the Town scene and the existing character viewer. A drag MUST never count as a click.

#### Scenario: Clicking an NPC
- **WHEN** the player clicks an NPC in the scene
- **THEN** that NPC becomes the selected NPC of the grind-panel selector

#### Scenario: Drag over a character
- **WHEN** a pointer drag longer than 5 px ends over a character
- **THEN** the camera pans and no menu opens

### Requirement: Invite from the scene

Clicking another character MUST open an action menu. "Invite to group" MUST be hidden for oneself, for a member of one's own group and when one's group has 5 members, and disabled with an "offline" hint for offline targets. A `CANDIDATE_ALREADY_IN_PARTY` error MUST show "The character is already in a group." as a red chat line. When the candidate declines or does not answer within the invite's lifetime, the inviter MUST receive `party:inviteDeclined` and see "<name> declined the invite." or "<name> did not answer the invite.".

#### Scenario: Candidate declines
- **WHEN** the candidate cancels an offered invite
- **THEN** the inviter receives `party:inviteDeclined` with reason `declined`
- **AND WHEN** the inviter withdraws their own invite
- **THEN** no decline notice is sent
