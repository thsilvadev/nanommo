# Spec Delta

## Purpose

Offline characters stay awake, selection replaces the action menu, instant map/town switch with preload, and visual fixes (roofs, Sierra ground, Father Marcelus, NPC props).

## MODIFIED Requirements

### Requirement: Town roster includes offline characters asleep

The Town roster MUST contain every character whose `currentMapId` is that Town and who is neither travelling nor in a pending map transition, online or offline, capped at 200 per snapshot ordered self → party → online → offline by most recent activity. Offline characters MUST keep wandering like online ones; being offline MUST NOT put a character to sleep, and only `/sleep` MAY. A character asleep by `/sleep` MUST stay asleep across disconnect and reconnect until it wakes. Starting a trip MUST remove the character from the scene. The online indicator above the chat MUST keep counting only connected characters. Each entry MUST carry the character's dominant hand and main/off hand item ids, and equipping or unequipping MUST re-broadcast the entry.

#### Scenario: Disconnect keeps wandering
- **WHEN** a character in a Town disconnects
- **THEN** a `town:update` marks it offline, still awake, on the same walk

#### Scenario: Sleep survives a reconnect
- **WHEN** a character used `/sleep`, disconnected and connected again
- **THEN** it is still asleep

### Requirement: Invite from the scene

Hovering another character or an NPC MUST show a pointer cursor. Clicking another character MUST select it (blue ring under it) and show it in the grind panel under the NPC selector: idle avatar wearing its hand gear, name, level and an action list. The NPC selector MUST stay visible and show "Choose NPC to interact" while a character is selected; choosing an NPC MUST select it with the same blue ring and replace the selected character. "Invite to group" MUST be hidden for oneself, for a member of one's own group and when one's group has 5 members, and disabled with an "offline" hint for offline targets. A `CANDIDATE_ALREADY_IN_PARTY` error MUST show "The character is already in a group." as a red chat line. When the candidate declines or does not answer within the invite's lifetime, the inviter MUST receive `party:inviteDeclined` and see "<name> declined the invite." or "<name> did not answer the invite.".

#### Scenario: Selecting a player
- **WHEN** the player clicks another character in the scene
- **THEN** a blue ring appears under it, the NPC selector shows "Choose NPC to interact" and the character's card is shown under it

#### Scenario: Choosing an NPC after a player
- **WHEN** a character is selected and the player chooses an NPC in the selector
- **THEN** the blue ring moves to that NPC and its panel replaces the character's card

## ADDED Requirements

### Requirement: Switching between map and Town is instant

While the character is in a Town, the Town scene MUST stay mounted; the map view MUST only hide it and pause its rendering. After the game connects, the client SHOULD warm the Town scene code and shared models in the background.

#### Scenario: Back to the Town view
- **WHEN** the player switches to the map and back to the Town
- **THEN** the same scene is shown again without being rebuilt

### Requirement: Town set dressing stays tidy

House roofs MUST be rectangular over their walls, overhang them and hide their top corners. No NPC MAY be hidden by an obstacle from the fixed town camera (lamp posts and fences excepted). NPC props MUST stay at least 0.5 × their scale from every obstacle, and costume pieces MUST stay on the NPC's body wherever it stands.

#### Scenario: An NPC behind a pillar
- **WHEN** an NPC spot is behind an obstacle as seen from the town camera (centred on the NPC or panned up to 4 units, default or closest zoom)
- **THEN** the catalogue check fails until the NPC is moved

#### Scenario: A long house
- **WHEN** a house is longer than it is wide
- **THEN** its roof's eave corners are the corners of a rectangle covering the walls
