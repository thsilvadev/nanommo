## ADDED Requirements

### Requirement: Settings provides runtime language selection for NPCs and quests
The Settings menu SHALL allow a Character to select pt-BR or en-US at runtime and persist the preference locally. pt-BR SHALL be the initial default unless the user approves another default. Locale changes SHALL update visible NPC and quest content without a full page reload. Localization scope is limited to NPC-facing labels, NPC content, service action buttons, dialogue choices, and quest UI/content; unrelated game UI remains in its existing language.

#### Scenario: Default locale
- **WHEN** a player has no saved locale preference
- **THEN** NPC and quest UI is shown in pt-BR

#### Scenario: Player changes locale
- **WHEN** a player switches between pt-BR and en-US in Settings
- **THEN** visible NPC and quest labels/dialogue/content switch to the selected locale
- **AND** the choice persists after reload
- **AND** API/catalogue-provided text follows the same locale

#### Scenario: Missing translation
- **WHEN** a localized NPC or quest field is unexpectedly missing
- **THEN** the app uses a deterministic documented fallback rather than showing an empty control
- **AND** translation-coverage validation identifies the missing locale entry
