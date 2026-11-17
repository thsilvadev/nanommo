# Spec Delta

## Purpose

Defines the 3D appearance of a Character: what is stored, how it is validated and saved, its effect on attributes, and how the client shows it.

## ADDED Requirements

### Requirement: Appearance is stored once per character

A Character SHALL store `sex`, `heightCm`, the derived height band and an `appearance` object of catalogue indices. These fields SHALL be NULL until the character goes through the creator, and SHALL NOT change after they are saved.

#### Scenario: A new character is created with an appearance

- **WHEN** a verified user creates a character with a name, dominant hand, sex, height and a valid appearance
- **THEN** the character is stored with those values and the derived height band

#### Scenario: An existing character saves its appearance once

- **WHEN** a character with NULL appearance saves a valid appearance
- **THEN** the appearance is stored and every later save attempt is refused with 409 without changing any field

#### Scenario: Concurrent saves

- **WHEN** two appearance saves for the same character arrive at the same time
- **THEN** exactly one succeeds, the other receives 409, and the height adjustment is applied once

### Requirement: Appearance is validated against the catalogue for the chosen sex

The server SHALL reject (400) any appearance whose sex is not male/female, whose `heightCm` is not an integer from 145 to 205, whose object contains unknown keys or a version other than 1, or whose trait index is not an available option for that sex. The client SHALL NOT be able to choose the height band.

#### Scenario: Index outside the options of the chosen sex

- **WHEN** an appearance uses an index that exists for one sex but not for the chosen one
- **THEN** the request is refused with 400 and nothing is stored

### Requirement: Height grants a one-time attribute adjustment

The server SHALL derive the height band (145 → 1, 146–175 → 2, 176–204 → 3, 205 → 4) and apply, once, STR −2/LUK +2, STR −1/LUK +1, STR +1/LUK −1 or STR +2/LUK −2 respectively to base attributes, through the future-combat mutation path.

#### Scenario: Tallest band on a new character

- **WHEN** a character is created at 205 cm
- **THEN** it starts with STR 7 and LUK 3

### Requirement: The client shows the character in 3D

The client SHALL show the character's model in Idle in the creator and in the Character Summary portrait, holding one placeholder model per equipped hand weapon type, with the main-hand item in the dominant hand. If the model cannot be shown, the portrait SHALL fall back to the name's initial.

#### Scenario: WebGL is unavailable

- **WHEN** the browser cannot create a WebGL context
- **THEN** the portrait shows the name's initial and the creator remains usable with a retry option
