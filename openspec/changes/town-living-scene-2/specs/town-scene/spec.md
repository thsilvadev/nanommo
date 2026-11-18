# Spec Delta

## Purpose

Finish the living Town scene: entering a Town shows it, sleepers lie down at once, balconies/tower/campfire/altar/well, the Outpost scene, and NPCs with their own look.

## MODIFIED Requirements

### Requirement: Town scenes are canonical catalogue data

Each Town with a scene MUST be described in root `town_scenes.json` (mirrored to the frontend) with a 72×72 walk grid, at least 2500 free cells, at least 16 points of interest, a spawn, and an NPC spot for every NPC of that Town in `maps.json`. A ground NPC spot MUST be free, reachable from the spawn and within 3 units of a point of interest. An elevated NPC spot (`y > 0`) MUST stand on a `balcony`, whose stairs foot MUST be free, reachable and within 3 units of a point of interest. The API MUST refuse to boot when the catalogue is invalid. The Towns with a scene are Caelum, Sierra, Kwaiouá Taba, Aramaia City and Outpost.

#### Scenario: Missing NPC spot
- **WHEN** a Town NPC listed in `maps.json` has no `npcSpots` entry
- **THEN** `validateTownScenes()` reports it and API boot fails

#### Scenario: Elevated NPC off a balcony
- **WHEN** an NPC spot has `y > 0` outside every balcony, or no POI within 3 units of its balcony's stairs foot
- **THEN** `validateTownScenes()` reports that NPC

#### Scenario: Outpost has a scene
- **WHEN** a character stands in Outpost
- **THEN** it is in the Outpost Town roster and the Town scene is offered

## ADDED Requirements

### Requirement: Balconies and other obstacles block a 2D walk grid

The walk grid MUST stay two-dimensional: a `balcony` MUST block its platform and its stairs strip, `tower`, `campfire`, `altar` and `well` MUST block their circles, and no character pose MAY fall on a blocked cell.

#### Scenario: Stairs block walking
- **WHEN** poses are sampled for any Town with balconies, a campfire, a tower, an altar or a well
- **THEN** none lies on a platform, stairs, fire, tower, altar or well cell

### Requirement: Entering a Town shows the Town scene

The map head MUST show one button with the other view's illustration. A manual choice of view MUST be forgotten whenever the character's `currentMapId` changes, so arriving in a Town always opens the Town scene.

#### Scenario: Coming back to a Town after choosing the map
- **WHEN** the player chose the map in a Town, left it and came back
- **THEN** the Town scene is shown

### Requirement: Sleepers lie down from the first frame

The Dead pose MUST follow the age of the sleep (`now − sleeping.at`) so every client shows the same pose; a long sleeper MUST be lying on the first frame and a character who falls asleep on screen MUST still fall.

#### Scenario: Sleeping for a minute
- **WHEN** a character asleep for 60 s enters the scene
- **THEN** its Dead clip is complete on the first frame

### Requirement: NPCs have their own look

Every Town NPC MUST have an entry in the NPC visual registry; the mailbox MUST be only a mailbox; props MUST stay clear of every point of interest; every NPC MUST remain pickable. Set-piece and costume animations MUST be driven only by the server clock.

#### Scenario: Picking a dressed NPC
- **WHEN** the player clicks a dressed NPC (including one up on a balcony)
- **THEN** that NPC is selected
