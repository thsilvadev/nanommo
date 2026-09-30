# NPC Framework

## ADDED Requirements

### Requirement: Composable Town NPC capabilities
Town NPCs SHALL be data-driven actors composed from reusable capabilities. Every NPC SHALL expose id, name, location and one or more capability types. The supported capabilities are vendor and quest. An NPC MAY expose both capabilities.

#### Scenario: Vendor-only NPC
- **WHEN** the Town catalog contains William with capability vendor
- **THEN** the existing vendor inventory and BUY/SELL UI remain available

#### Scenario: Quest-only NPC
- **WHEN** the Town catalog contains Father Marcelus with capability quest
- **THEN** the NPC has dialogue interaction and no NPC inventory

#### Scenario: Multi-capability NPC
- **WHEN** an NPC exposes vendor and quest
- **THEN** the right Town panel renders vendor/inventory first and quest/dialogue below it
### Requirement: Server-authoritative quest dialogue
A quest capability SHALL be a data-driven dialogue graph containing an entry node, NPC text, player choices, optional character/inventory conditions and optional effects. Choices SHALL be client intents only. The backend SHALL re-evaluate conditions and apply effects atomically.

#### Scenario: Conditional dialogue
- **WHEN** the player opens a quest NPC dialogue
- **THEN** the server returns only choices whose conditions match authoritative character state

#### Scenario: Invalid choice
- **WHEN** the client submits a choice that is not available for the authoritative node/state
- **THEN** the server rejects it without changing character or inventory state

#### Scenario: Quest effect transaction
- **WHEN** a valid choice changes character or inventory state
- **THEN** all related changes occur in one database transaction with row locking
### Requirement: Quest UI composition
The persistent Town Info Panel SHALL own one generic NPC selector populated from the Town NPC catalog. Capability renderers SHALL be stacked in deterministic order. Quest-only NPCs SHALL render dialogue after the shared NPC header; multi-capability NPCs SHALL render dialogue below vendor inventory.

#### Scenario: Generic selector
- **WHEN** the player is in Town
- **THEN** the selector lists NPCs from the generic catalog without hardcoded NPC names

#### Scenario: Dialogue choices
- **WHEN** a quest NPC dialogue node contains choices
- **THEN** the UI renders those choices as clickable intents and refreshes from the authoritative response
### Requirement: Father Marcelus quest dialogue
Father Marcelus SHALL have id father_marcelus, name Father Marcelus, location town and capability quest. His opening text SHALL be "May the light be with us, friend. How are you, fellow adventurer?"

#### Scenario: Hungry branch
- **WHEN** the character is hungry
- **THEN** Marcelus offers "I'm hungry..." and the next NPC text is "Eat and rest, for the love of god is forever, but you are not."

#### Scenario: Hungry with no food
- **WHEN** the character is hungry and has no food item in inventory and chooses the eat action
- **THEN** the server grants Bread only as a transient effect and consumes it in the same transaction, leaving no Bread row in inventory

#### Scenario: Hungry with existing food
- **WHEN** the character is hungry and has food in inventory and chooses the eat action
- **THEN** one food item is consumed and the corresponding food buff becomes active without creating a duplicate reward

#### Scenario: Non-hungry branch
- **WHEN** the character is not hungry
- **THEN** Marcelus offers "I'm fine, prayer. Came to get blessed for battle." and the next NPC text is "The Lord doesn't want blood to be spilled. But I pray you'll return in peace 🙏."

#### Scenario: Non-hungry has no mutation
- **WHEN** the non-hungry branch is completed
- **THEN** no inventory or character mutation is performed
