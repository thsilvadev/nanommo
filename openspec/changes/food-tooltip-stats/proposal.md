# Food Tooltip Stats

## Why
Food tooltips currently collapse every food buff into the generic `Regenerates HP/SP` text, hiding the actual values configured by each food.

## What Changes
Use the shared item tooltip formatter to expose each food's concrete regeneration stats and duration. This keeps Inventory, Vendor and any future catalog-backed item panel consistent.

## Scope
No gameplay or food-buff formulas change. Only tooltip presentation changes.
