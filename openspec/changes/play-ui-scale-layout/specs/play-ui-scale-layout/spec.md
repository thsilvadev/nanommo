# Spec Delta

## Purpose

Defines a readable, consistently scaled desktop game-shell presentation in which the play panels are balanced, aligned, and dense enough to use the available viewport without relying on browser zoom.

## ADDED Requirements

### Requirement: Desktop application UI scale

The desktop play UI SHALL present readable typography, controls, spacing and item icons at 100% browser zoom, matching the intended visual density represented by the supplied enlarged reference.

#### Scenario: Normal browser zoom

- **WHEN** the user opens the play shell at 100% browser zoom on the intended desktop viewport
- **THEN** text and controls are rendered at the application's enlarged target scale
- **AND** the user does not need to change browser zoom to obtain the intended readability
- **AND** the UI remains a real DOM interface rather than a screenshot.

### Requirement: Balanced fixed-height shell panels

The desktop play shell SHALL use three aligned panels with a reduced center width and wider lateral zones, and the three panels SHALL share one fixed content height that extends close to the viewport bottom.

#### Scenario: Desktop shell alignment

- **WHEN** any play screen is rendered at the intended desktop breakpoint
- **THEN** the left, center and right zones have the same outer height
- **AND** their bottom edges are aligned
- **AND** the outer panel height does not change because one screen contains more or less internal content
- **AND** the center is narrower than the previous wide-center composition while remaining large enough for the Grind workspace.

### Requirement: Grind map and vertical inventory composition

The Grind central workspace SHALL contain a 4:3 map area and a vertical 50-slot inventory arranged as five columns by ten rows beside the map.

#### Scenario: Grind workspace

- **WHEN** the user opens the Grind screen at the intended desktop breakpoint
- **THEN** the map presentation preserves a 4:3 aspect ratio
- **AND** the 50 inventory slots are displayed as 5 columns and 10 rows beside the map
- **AND** there is no separate horizontal inventory panel below the map
- **AND** all 50 inventory slots remain visible in the intended desktop viewport without requiring page scrolling.

### Requirement: Shared item slot occupancy

All item-bearing slot surfaces SHALL use a consistent visual proportion in which the item icon occupies most of the usable slot interior while leaving sufficient inset for the frame and any count overlay.

#### Scenario: Inventory item

- **WHEN** an item is rendered in an inventory slot
- **THEN** its icon visibly occupies most of the slot
- **AND** the icon is not reduced to a small centered glyph with excessive empty space.

#### Scenario: Equipment or vendor item

- **WHEN** an item is rendered in a Character equipment slot or NPC/vendor stock slot
- **THEN** its icon follows the same slot-to-icon proportion as the inventory
- **AND** the item remains upright and uses its normal source orientation.

### Requirement: Character equipment columns and status reserve

The Character summary SHALL arrange equipment slots in columns around the character portrait and SHALL reserve space below the HP/SP area for future status-effect icons.

#### Scenario: Character summary layout

- **WHEN** the Character summary is rendered on desktop
- **THEN** equipment slots form left and right columns around the portrait
- **AND** the portrait remains visually central to the equipment arrangement
- **AND** a dedicated empty status region remains available for future buff/debuff icons
- **AND** no status-effect gameplay is introduced by this layout change.

### Requirement: Responsive preservation

The new desktop scale and composition SHALL NOT require mobile routes or responsive behavior to use the desktop five-column inventory or fixed desktop shell proportions.

#### Scenario: Narrow viewport

- **WHEN** the viewport is below the desktop breakpoint
- **THEN** the existing responsive composition remains in control of layout
- **AND** desktop-only fixed three-zone dimensions do not cause horizontal overflow
- **AND** the mobile inventory/layout continues to use its existing responsive column rules.
