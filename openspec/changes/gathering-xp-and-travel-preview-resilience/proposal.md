# Proposal

## Why

The map destination pin/route can disappear from the frontend after a battle resolution while the server-authoritative `travelIntent` and location-pin movement continue. Separately, Gathering has a persisted level used by its duration formula, but no cumulative XP progression despite the Professions UI showing an XP placeholder.

## What Changes

- Derive the visible destination marker and remaining route from an active server `travelIntent`, including after local preview state is lost during realtime battle updates.
- Offset the location pin 7 CSS pixels upward only during a valid cardinal travel leg to correct the visual marker's artwork-to-anchor alignment; settled positioning remains unchanged.
- Add cumulative persisted Gathering XP. Every successful material grant awards +30 XP in the grant transaction, and every 100 cumulative XP grants one level (Level 2 at 100 XP).
- Keep the existing Gathering duration formula; the authoritative derived `gatheringLevel` continues to reduce base duration by one second per level above 1.
- Add a forward-only migration and focused regression tests; do not execute the migration or deploy.

## Non-goals

No map topology, travel timing, gathering pool/weights, inventory capacity, or battle behavior changes. No migration execution, live database mutation, or deployment.
