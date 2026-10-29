# Game Audio Specification

## ADDED Requirements

### Requirement: Regional music playlists

The frontend MUST play the playlist associated with the character's current region, regardless of the numbered map suffix. It MUST fade out the old region's music and fade in the new region's music. Regional playlists MUST play in filename sequence and repeat while the character remains in that region.

#### Scenario: Moving between maps in one region
- **WHEN** the character moves between maps sharing a region prefix
- **THEN** the current track continues without restarting the playlist.

#### Scenario: Moving between regions
- **WHEN** the character's authoritative current map changes to another region
- **THEN** the previous music fades out and the new region's first track fades in.

### Requirement: Event-driven sound effects

Gameplay effects MUST be triggered by the corresponding authoritative event or successful server response, not by an unconfirmed UI click. Monster damage audio MUST be tied to actor === monster and target === character, not to a generic opponent concept.

#### Scenario: Battle timeline advances
- **WHEN** a battle event's tick becomes current
- **THEN** the matching sound plays once for that event.

#### Scenario: Quest acceptance or completion
- **WHEN** the server confirms quest acceptance or turn-in completion
- **THEN** the corresponding quest sound plays.

#### Scenario: NPC quest dialogue
- **WHEN** the player activates a quest dialogue/action button and the resulting quest text is shown
- **THEN** the NPC dialogue sound may play; ordinary greetings and vendor text MUST remain silent.

#### Scenario: Login-to-game transition
- **WHEN** the user enters gameplay
- **THEN** login music stops and a deferred autoplay retry MUST NOT restart it.
