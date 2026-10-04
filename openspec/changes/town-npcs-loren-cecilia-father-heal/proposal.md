# Town NPCs — Blacksmith Loren, Cecilia, Father Marcelus Heal

## Why
Expand the existing Town NPC framework with two new NPCs and one small behavior adjustment, without creating a second NPC architecture.

## Scope
1. Add Blacksmith Loren as a vendor with all T1 weapons plus the two T1 body armors.
2. Add Cecilia as a quest NPC exchanging 3 Slime Gel, 1 Golem Core Shard and 1 Viper Fang for one Worn Lucky Ring.
3. Make the Cecilia exchange server-authoritative and atomic, including the conditional first-conversation flow.
4. Make Father Marcelus fully restore HP and SP whenever the player speaks with him.

## Non-goals
- No new item definitions.
- No weapon XP/progression.
- No changes to the central map/grind presentation.
- No production deployment.
