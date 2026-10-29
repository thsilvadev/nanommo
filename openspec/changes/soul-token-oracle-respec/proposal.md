# Soul Tokens and Oracle Respec

## Why
Players need a dedicated premium-style currency and a reliable in-world way to reallocate character attributes without manual support.

## What Changes
- Add persistent Soul Token balances, granting 1,000 to every existing character and defaulting new characters to 1,000.
- Show Soul Tokens beside Gold in the game topbar with a bright blue-violet square-holed coin icon.
- Add the Oracle NPC to every map whose type is `town`, except Outpost.
- Let the Oracle reset STR/AGI/DEX/VIT/INT/LUK to 5, refund all points invested above those base values, and charge 600 Soul Tokens atomically.
- Add a hooded, faceless Oracle portrait in the game's dark, textured fantasy-pixel-art visual language and play the existing `respec.mp3` after a successful reset.

## Capabilities
- `soul-token-wallet`: persistent initial balance and topbar display.
- `oracle-respec`: town availability, server-authoritative transactional respec, refund, charge and presentation.

## Compatibility and Boundaries
Soul Tokens cannot be acquired from drops, quests, vendors, mail, market or other systems in this change. Gold remains unchanged. The respec is available only while settled in a Town map where the Oracle is listed; Outpost is excluded. No migration execution or deployment is included.
