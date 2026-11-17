# Spec Delta

## Purpose

Defines how characters created before the 3D creator are brought in: blocked from playing until they choose an appearance, after an offline cutover.

## ADDED Requirements

### Requirement: Characters without appearance cannot perform game actions

While a character's appearance is NULL, every mutating HTTP route and socket action SHALL be refused with 403 and code `APPEARANCE_REQUIRED`, except authentication, notifications, character creation and the appearance save. Reads SHALL remain available. The client SHALL send the player to the creator when it receives this code.

#### Scenario: Equipping without appearance

- **WHEN** a character without appearance tries to equip an item
- **THEN** the request is refused with 403 `APPEARANCE_REQUIRED` and the client opens the creator

### Requirement: Rollout parks every character in Town

An offline cutover SHALL move every character to Town, clear transient travel/gathering/encounter/flee state, delete all battle queue rows and remove combat/encounter jobs, preserving progression, inventory, equipment, currencies, quests, Mastery, saved Town, HP/SP, Diet and Cooking/Crafting. It SHALL be a read-only dry run unless explicitly confirmed.

#### Scenario: Dry run

- **WHEN** the cutover runs without `--execute`
- **THEN** it reports what it would change and writes nothing

### Requirement: Startup fails closed until the cutover is complete

The API SHALL refuse to start unless `CHARACTER_3D_CUTOVER_COMPLETE` is exactly `true` and no character without appearance is outside Town or has unresolved battles.

#### Scenario: Flag set but a stray character remains

- **WHEN** the flag is `true` and a character without appearance is still grinding
- **THEN** startup is refused and the queue stays paused
