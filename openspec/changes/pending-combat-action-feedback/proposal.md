# Subtle pending combat action feedback

## Why
Combat mutations can wait across immutable battles and miss a finite commit cutoff. Users need truthful, local feedback without a stalled-game impression or premature success.

## What Changes
- Readonly consumable preflight before queue insertion, with execution validation retained.
- Own-action target metadata and recovery of every pending command, alongside bounded terminal history.
- Shared idempotent request tracking and small accessible markers for equipment, food/items, attributes and Gambit save/activation.
- Post-terminal fresh snapshot confirmation and preservation of newer Gambit drafts across navigation/reload.

## Capabilities
### New Capabilities
- `pending-action-feedback`: contextual lifecycle indicators for durable combat commands.
### Modified Capabilities
None.

## Impact
Existing durable action endpoints and Angular presentation/stores. No schema migration, dependencies, balancing, encounter delay extension or deployment.
