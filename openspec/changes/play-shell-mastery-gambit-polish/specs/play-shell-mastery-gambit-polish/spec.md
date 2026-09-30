# Play Shell, Mastery and Gambit Polish

## ADDED Requirements

### Requirement: Single central map presentation
The grind screen SHALL present map selection only in the central map area.

#### Scenario: Grind screen map
- **WHEN** the user opens Grind
- **THEN** the central illustrated map contains the selectable map/grind tiles
- **AND** there is no duplicate map selector/list below the map.

## Requirement: Compact 50-slot inventory
The grind inventory SHALL fit all 50 slots in the intended desktop layout without vertical scrolling.

#### Scenario: Inventory sizing
- **WHEN** the inventory is rendered at the intended desktop width
- **THEN** all 50 cells are visible
- **AND** cells are only slightly larger than their item icons
- **AND** stack counts remain readable.

## Requirement: White equipment icons
Equipment icons in the Character UI SHALL render white/light against dark panels.

#### Scenario: Character equipment icon
- **WHEN** an equipment item is displayed in a Character equipment slot
- **THEN** its icon is white/light and clearly visible.

## Requirement: Contextual Info Panel
The right side of the main play shell SHALL contain one large Info Panel instead of a separate Weapon Proficiency panel.

#### Scenario: Town info
- **WHEN** the character is in Town
- **THEN** the Info Panel shows information about the currently selected object/item/map/character context.

#### Scenario: Grind info
- **WHEN** the character is grinding
- **THEN** the Info Panel shows grind state, current monster, monster HP/status, consumables, XP and battle timing.

## Requirement: Mastery tab
`/play/character?tab=mastery` SHALL replace the old Equipment tab.

#### Scenario: Open Mastery
- **WHEN** the user opens the Mastery tab
- **THEN** Equipment and Inventory panels are absent
- **AND** the left side contains a Mastery skill-tree workspace
- **AND** the right side contains Weapons.

## Requirement: Weapons list
The Weapons area SHALL show the level for Sword, Greatsword, Dagger, Bow, Staff, Wand and Shield.

#### Scenario: Select weapon type
- **WHEN** the user selects a weapon type
- **THEN** that weapon type is highlighted
- **AND** its mastery is the one displayed in the left Mastery workspace.

## Requirement: Active Gambit title
The active Gambit page title SHALL appear immediately above the XP bar.

#### Scenario: Grind HUD
- **WHEN** the active Gambit page has a title
- **THEN** the title is visible above the XP bar
- **AND** the XP bar continues to show the current/required XP progress.

## Requirement: Minimal Character tab
The Character sub-tab SHALL contain only Attributes and Derived Stats.

#### Scenario: Character tab
- **WHEN** `/play/character?tab=character` is open
- **THEN** Attributes and Derived Stats are shown
- **AND** Paper Doll, Build Summary, Equipment and Inventory are not rendered in this tab.

## Requirement: Gambit row layout
Gambit rows SHALL use a compact two-level layout with conditions above action, following `project/image.png` as the composition reference.

#### Scenario: Gambit row
- **WHEN** a Gambit line is rendered
- **THEN** condition controls are grouped on top
- **AND** action controls are grouped below
- **AND** condition/action parameters are inline and aligned
- **AND** the Enabled control is a minimal switch.

## Requirement: Gambit value styling
Numeric/value parameter inputs SHALL use the same intentional game UI styling as neighboring Gambit controls.

#### Scenario: Value parameter
- **WHEN** a Gambit parameter is numeric or otherwise value-like
- **THEN** it does not render with an unstyled browser-default control appearance.

## Requirement: Navbar logo
The main navbar SHALL use `assets/lords.png` instead of the `NANOMMO online` wordmark.

#### Scenario: Navbar branding
- **WHEN** the play shell is rendered
- **THEN** the Lords logo is visible in the navbar
- **AND** the old `NANOMMO online` text branding is absent.

## Requirement: Existing behavior remains authoritative
This change SHALL remain presentation-only except where needed to expose existing weapon/mastery data.

#### Scenario: No gameplay regression
- **WHEN** the UI is changed
- **THEN** battle resolution, queue authority, inventory authority, equipment rules and derived-stat formulas remain server-authoritative.