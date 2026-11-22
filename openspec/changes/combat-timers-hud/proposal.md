# Combat timers HUD

## Why
Players need visible skill/item recovery and status duration for themselves, targets and allies.

## What Changes
- Shared 28px HUD in Character Status, Grind target Status and Group member resources.
- Numeric durations on green buffs/red debuffs; clockwise cooldown masks on white skills/gray consumables, only while unavailable.
- Dedicated potion, tonic and super tonic category icons and authoritative public timer metadata.

## Capabilities
### New Capabilities
- `combat-timers-hud`: public combat timer projection and consistent actor HUD.
### Modified Capabilities
None.

## Impact
Angular presentation, public character/party DTOs and additive battle action metadata. No database migration or balance changes.
