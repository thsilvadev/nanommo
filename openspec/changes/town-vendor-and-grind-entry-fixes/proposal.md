# Proposal: Town vendor tooltips and progression corrections

## Changes
- Centralize item tooltip-line generation in CatalogService and reuse it across item surfaces.
- Add the shared tooltip UI to Vendor stock items.
- Set Blacksmith Loren's T1 weapon prices to 2,000 gold each.
- Remove the main-hand weapon requirement from map entry; hunger remains the only character-state gate besides existing email/level requirements.
- Stop granting/equipping equip_sword_t1 during character creation. New characters start unarmed.
- Update specs/status and add focused regressions.
