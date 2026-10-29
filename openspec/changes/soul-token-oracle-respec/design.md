# Design: Soul Tokens and Oracle Respec

## Data and migration
Add `characters.soul_tokens` as an integer column with default 1000. The forward-only TypeORM migration adds it with `NOT NULL DEFAULT 1000`, which initializes existing rows and all future characters. Character DTOs expose the authoritative balance. No account-level currency table is needed because each account owns one Character.

## Respec transaction
The Town API accepts a respec request scoped to `oracle`. Under the character queue lock and a database transaction, the backend locks the Character row, verifies that the character is settled in a Town map and that the map explicitly lists `oracle`, checks a balance of at least 600, calculates the refund as the sum of each base attribute minus its baseline 5 (clamped at zero per attribute), resets all six base attributes to 5, adds the refund to unspent attribute points, deducts 600 Soul Tokens, and saves the Character atomically. It recalculates derived HP/SP after the reset and refreshes the authoritative Character DTO. No client-supplied balance or refund is trusted.

## NPC and presentation
The canonical root `maps.json` and synchronized frontend mirror list `oracle` on all `type: town` maps except `map_outpost`. The NPC catalogue includes localized names/greeting and the `respec` capability. The Town panel shows a dedicated confirmation action only for that capability; successful response reloads the Character and plays `/assets/sounds/respec.mp3`. The UI uses a transparent PNG portrait at `apps/frontend/assets/npcs/oracle.png`, matching the existing NPC sprite convention, and a separate SVG currency icon.

## Safety
Insufficient balance, wrong map, unsettled travel/transition state, and missing NPC presence reject before mutation. A failed transaction charges nothing and changes no attributes. The feature does not add any earning or transfer pathway for Soul Tokens.
