# Town NPC additions and Father Marcelus healing

## ADDED Requirements

### Requirement: Blacksmith Loren vendor
The Town NPC catalog SHALL contain Blacksmith Loren with id `blacksmith_loren`, name `Blacksmith Loren`, location `town`, and capability `vendor`.

#### Scenario: Loren stock
- WHEN Loren is selected
- THEN the vendor SHALL expose exactly the T1 item definitions for sword, greatsword, dagger, bow, staff, wand, shield, body_phys_t1 and body_magic_t1
- AND all listed stock SHALL be infinite
- AND prices SHALL be read from the NPC vendor definition.

#### Scenario: Loren dialogue
- WHEN Loren is selected
- THEN the greeting SHALL be exactly: "Haha! I know why you come here. Take a look at these fine crafts of mine. If you feel like selling stuff, I buy too!"

### Requirement: Cecilia quest exchange
The Town NPC catalog SHALL contain Cecilia with id `cecilia`, name `Cecilia`, location `town`, and capability `quest`.

#### Scenario: Cecilia opening
- WHEN Cecilia is opened
- THEN her NPC text SHALL be: "Fate is a strange thing, isn’t it? It brought you to me and I have exactly what you came for. But isn’t it luck, though? Maybe…"
- AND the player can choose "Do you? What can you do?"

#### Scenario: Cecilia offer
- WHEN the player reaches the offer node
- THEN Cecilia SHALL say: "Oh yes, darling! You’re talking to the princess jeweler of this world. Just bring me 3x slime gel, 1x golem core shard and 1x viper fang and I’ll give you something that’ll bring luck to your journey."
- AND the server SHALL expose the hand-over choice only when the authoritative inventory contains at least 3 `part_slime_common`, 1 `part_cindergolem_common`, and 1 `part_venomviper_common`
- AND otherwise it SHALL expose the return-later choice.

#### Scenario: Cecilia first talk with materials
- WHEN the player already owns all required materials on first reaching the offer node
- THEN the hand-over flow SHALL be immediately available without requiring another conversation.

#### Scenario: Cecilia successful exchange
- WHEN the player chooses the hand-over action
- THEN the backend SHALL lock and revalidate Town status and the required inventory quantities
- AND atomically remove the required materials and add exactly one `equip_accessory_sor_t1`
- AND the resulting dialogue SHALL be "ahn.. let me see..  *clink!* this… **ting!** I gues… **fwoosh**! it’s done! Here, have it! May fate bless your journey with luck, my dear."

#### Scenario: Cecilia without materials
- WHEN the player lacks any required material
- THEN no inventory mutation SHALL occur
- AND the dialogue SHALL tell the player to return with the exact required quantities.

### Requirement: Father Marcelus full heal
Father Marcelus SHALL fully restore the character's authoritative HP and SP whenever his NPC dialogue is opened in Town.

#### Scenario: Speak to Marcelus
- WHEN a character in Town opens Father Marcelus
- THEN HP SHALL become the authoritative maximum HP
- AND SP SHALL become the authoritative maximum SP
- AND the existing Marcelus dialogue SHALL remain otherwise unchanged.
