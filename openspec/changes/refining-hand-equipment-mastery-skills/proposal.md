# Proposal

## Why

The current hand-equipment/Mastery implementation has reached a working foundation, but the player-facing experience and some combat feedback are incomplete or misleading. Status-effect presentation confuses source and target, the Freeze badge still has text in place of the snowflake, the Mastery screen renders text cards rather than a skill tree, rank-dependent skill values need the approved formulas, Mastery XP/points become stale while the screen is open, and monster mana/skill visibility are not implemented as real timeline state.

This refinement completes those contracts without reopening the already-defined Mastery threshold curve, equipment rules, lane/range model, or future PvE/PvP scope; it explicitly corrects movement-gauge charging and Ice Bolt cooldown timing under the user's approved rules.

## What Changes

- Render the complete active status set as icons in the Character summary and below the monster on the Grind panel. Update the existing Freeze badge by replacing only “Fre” with a centered snowflake; preserve its blue palette, frame, footprint, placement, and real-time behavior. Create matching status SVGs for Bleed, Slow, Burn, Stun, Disarm, War Cry, and Magic Barrier, using the supplied atlas as reference or cleanly extracted sprites when possible.
- Make both live Grind logs and Battle History distinguish the event source from its affected target. Status application, stack/expiry events, and damage-over-time output must name the target and state the actual status/damage.
- Correct and formalize Swordsmanship Bleed: proc chance is 1% per rank; each stack deals 5 × Swordsmanship rank as pure damage every 5 ticks (rank 5 = 25 damage per stack), up to five stacks. Pure damage ignores DEF/MDEF. DoT ticks grant no additional Mastery XP.
- Replace Mastery text cards with a connected, extensible, icon-only tree. Generate original high-quality PNG icons for all 16 current player Mastery skills and four current monster-only skills, inspired by project/skill_icons.png. Display each skill at 64×64 and use the supplied tree screenshot as the composition reference.
- Add keyboard-accessible hover/focus tooltips with full skill details. Rank-aware numeric values are bold. Pending rank increments appear green (for example, Damage 64 (+15)); after Apply they become the normal authoritative value. Tooltips contain no controls.
- Stage skill ranks locally on icon click. The UI Reset discards only pending allocations and never refunds committed ranks. Apply validates and persists the pending allocation atomically and uses the existing BattleService-owned future-combat mutation boundary. Each category retains an independent local draft; Apply and UI Reset affect only the selected category. As part of introducing the new tree, perform a one-time transactional data reset for every existing character: clear every category's allocated `skillRanks` and set `spentSkillPoints` to zero while preserving each category's `level` and `xp`, returning the category's earned points for redistribution. Add the targeted cheat endpoint `POST /reset-skilltree/:characterName` to do the same reset for one named character, without changing Mastery levels or XP.
- Refresh authoritative Mastery rows after every battle:resolved event so category XP, level, XP-to-next, available points, and rank display update without closing/reopening the Character screen.
- Give every catalogued monster a real SP pool: max SP 60, except Venom Viper and Wailing Wraith at 80; all start each encounter full and regenerate 2 SP per 10 battle ticks. Set monster skill costs: Enraged Strike 30, Regenerate 15, Ice Bolt 10, and Ground Slam 30. Consume SP in the simulator, skip illegal actions when SP is insufficient, and include monster SP in recorded resource snapshots.
- Display a blue monster mana bar immediately below its HP bar, in the same visual style. Render one row of icons for the monster abilities referenced by that monster's Gambit, below its logs and above DROPS THIS SESSION; hovering/focusing an icon exposes the ability tooltip.
- Rename the displayed name Wisp Flow to Light Wisp while retaining stable skill ID `wisp_flow`, with base damage MATK + 25 × skill rank plus current SP/5 sampled **before paying Light Wisp's own cost**; set War Cry to +10 DEF × rank for 15 seconds; replace the Rune tree passive with Arcane Dynamo, refunding 2/4/6/8/10 SP per successful basic attack/active skill by rank. Stored Essence remains hidden legacy data, but all currently allocated ranks are cleared by the one-time reset so all earned points are available to redistribute.
- Specify no-action behavior explicitly: when no Gambit line is legal, the combatant does nothing and does not invent movement. Disarm makes the player character's basic attack unavailable and does not initiate/continue movement solely to reach melee range.
- Make cooldown lockout sequential and authoritative from the tick an action resolves: with Ice Bolt resolving at T2 and `cooldownTicks = 1`, the next activation is forbidden at T3. The cast gauge can activate the next Ice Bolt at T4, casting continues through T5, and it resolves at T6; subsequent resolutions are T10, T14, etc. (T2/T6/T10...). Do not decrement cooldown concurrently with an in-progress cast. The T4 damage event followed by a T4 Freeze application in the supplied old log is a normal damage-plus-proc pair, not duplicate damage; validate fresh queue generation against the new timing. Preserve Wailing Wraith's Gambit semantics: `silence → attack` when silenced, otherwise Ice Bolt, with normal legality checks for cooldown, range and SP. Keep the canonical root ordering and synchronize only this Wraith Gambit row/order in the frontend mirror, preserving unrelated catalog differences. For movement, accrue the gauge from battle start/T0 every tick regardless of `movementIntent`; movement itself still requires an active legal out-of-range approach intent. At Move Speed 98, the gauge is 98 at T1 and crosses 100 at T2, so a character that needs and is legally approaching the target can move at T2. Disarm's no-approach rule applies to the player character only; preserve monster-specific behavior.
- Keep all outcomes server-authoritative and deterministic. Reuse the existing combat snapshot and queue mutation boundaries; do not mutate the active battle when rank allocations are applied.
- Update SPEC.md, openspec/specs/SPEC.md, ARCHITECTURE.md, and STATUS.md with the finalized contracts, one-time rank reset, targeted cheat, and actual test results. Keep `SPEC.md` and its OpenSpec mirror byte-identical.

## Non-goals

- Rebalancing Mastery XP thresholds, changing the unresolved DEX/Precision milestone, adding a player-facing respec UI, or changing item/equipment compatibility. The one-time existing-rank reset and the explicit development/administrative cheat are in scope.
- Adding multi-target AoE, party combat, PvP, or executable 5v5 behavior.
- Changing skill formulas not explicitly approved during refinement decisions.

## Capabilities

### Modified Capabilities
- hand-equipment-mastery-skills

## Impact

Expected areas: shared BattleEngine/status-event logic and combatant snapshots; monster and skill catalog JSON; API Mastery allocation transaction and battle queue boundary; Angular Character summary, Mastery workspace, Grind panel, and Battle History; local status/skill icon assets; deterministic simulator, API, frontend, and queue regression tests. No schema migration is expected, but a one-time transactional data migration/reset is required to clear existing skill allocations while preserving all category XP and levels. The targeted cheat must be safe against ambiguous character names and unauthorized use. No production deployment is part of this change.
