# Proposal

## Why

Fresh characters currently enter the game with inconsistent current HP, the shared engine still contains the previous derived-stat formulas, consumable data uses an obsolete regeneration field name, and grind entry does not enforce the full survival contract.

The next implementation pass must establish one authoritative stat model before fixing the visual grind loop.

## Scope

This change covers the first half of the gameplay correction:
- authoritative attribute-to-derived-stat formulas;
- initial HP/SP derived from the real equipped build;
- starter consumables: 10 Small HP Potions and 5 Bread;
- real-time one-hour food buff and hungry state;
- consumable cooldowns expressed in battle ticks;
- grind entry requirements;
- town-only unequip, with legal equipment replacement while grinding and deferred application between battles;
- inventory/equipment drag-and-drop contract in the frontend;
- rename regeneration fields from per-tick to per-ten-ticks semantics.

Battle resolution, XP/drop application and the simulated real-time battle presentation are deliberately handled in the next OpenSpec change.

## Derived-stat model

The six attributes remain STR, AGI, VIT, INT, DEX and SOR. The formulas are intentionally original, using Ragnarok Online only as a design reference for the relationships between attributes and combat stats.

For NanoMMO, the formulas are:
- attack = floor(STR * 2) + weaponAttack
- defense = equipmentDefense
- maxHp = 50 + floor(VIT * 18) + equipmentMaxHp
- maxSp = 20 + floor(INT * 8) + equipmentMaxSp
- attackSpeed = 100 + floor(AGI * 2)
- castSpeed = 100 + floor(DEX * 2)
- evasion = floor(AGI * 1.5)
- accuracy = 50 + floor(DEX * 2)
- hpRegenPerTenTicks = 1 + floor(VIT / 2)
- spRegenPerTenTicks = 1 + floor(INT / 2)
- critChance = 1 + floor(SOR * 0.3 * 10) / 10 percent

At level 1 with all attributes at 5 and the 8-ATK starter sword:
- ATK 18
- DEF 0
- Max HP 140
- Max SP 60
- Attack Speed 110
- Cast Speed 110
- Evasion 7
- Accuracy 60
- HP regen 3 / 10 ticks
- SP regen 3 / 10 ticks
- Critical 2.5%

The character starts with currentHp = maxHp and currentSp = maxSp.

## Consumables and hunger

- Character creation grants exactly 10 pot_hp_small and 5 food_bread as a one-time starter pack.
- food_bread grants +4 hpRegenPerTenTicks and +1 spRegenPerTenTicks for exactly one real-world hour from use.
- Food buffs do not stack. Eating another food replaces the previous food buff and starts a new one-hour expiry.
- hungry means activeFoodBuff is absent or expired. A hungry character cannot start or continue a grind session.
- Consumables can be used outside battle by double-clicking them. Outside battle they have no cooldown.
- During battle, the item's cooldownInSeconds value is converted to ticks at 1 second per tick and enforced by the deterministic battle engine.
- A consumable can target any legal target allowed by its Gambit action; the engine must not hardcode self-only targeting.

## Equipment

- equip_sword_t1 grants 8 ATK.
- Unequipping is allowed only while in town.
- During grind, replacing an equipped item with another legal item is allowed, but the replacement is staged and only becomes authoritative between battles; the current battle is never mutated retroactively.
- Frontend drag-and-drop must expose equipment slots as drop targets. When a compatible equipment drag starts, its compatible slot receives a focused state. Dragging an equipped item into an inventory slot means unequip and return it to inventory.
- Backend validation remains authoritative regardless of frontend state.

## Grind entry

To start or resume grind the character must:
1. be level-eligible for the map;
2. have a valid required weapon equipped/staged;
3. have at least one HP potion available;
4. have an active, non-expired food buff.

The character is allowed to continue across battles while resources remain. After a battle, if there is no potion or the food buff has expired, the chain returns the character to town instead of silently starting another battle.

## Compatibility

The existing 1-second tick contract remains authoritative. Regeneration fields are renamed to hpRegenPerTenTicks and spRegenPerTenTicks; they are applied once every 10 ticks, never every tick. Existing API consumers must be updated together with the shared engine.