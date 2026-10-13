# Tasks

The design decisions are finalized in design.md. This file defines the implementation and verification work for the approved refinement; do not deploy as part of this change.

## Status-effect visuals and logs

- [x] 1. Update assets/ui/freeze.svg by replacing “Fre” with a centered snowflake, preserving its frame/blue palette/footprint; create or extract the seven other status icons using project/status_icons.png, and validate transparency/legibility at UI size.
- [ ] 2. Add a shared target-aware status timeline reducer/projection for the Character summary and Grind monster panel, including applications, stacks, refreshes, expiry, and early removal.
- [ ] 3. Render status icons, stack counters, and hover/focus detail tooltips for both combatants; make icon visibility follow the current battle tick in real time.
- [ ] 4. Update every relevant status lifecycle event to include explicit target (and sourceActor where applicable) without changing combat authority.
- [x] 5. Make Bleed use catalogued base damage × Swordsmanship rank as pure damage (5 × rank) every five ticks; keep proc chance at 1% per rank, bypass DEF/MDEF, and never award extra Mastery XP for DoT ticks.
- [x] 6. Fix status application, stack, expiry and status_damage copy in Grind and Battle History to name the target and actual damage amount.
- [ ] 7. Add deterministic simulator tests for Bleed target, ranks 1–5 proc chance and 5×rank pure damage per stack every 5 ticks, defense bypass, five-stack cap, no sixth stack, no DoT Mastery XP, and correct end/stack-expiry events.

## Mastery skill tree

- [ ] 8. Generate individual high-quality PNG icons for all 16 player Mastery skills and the four current monster skills; create an explicit skill-ID-to-asset mapping and validate every catalogue skill has a local icon.
- [ ] 9. Replace rectangular Mastery nodes with an extensible vertical icon tree; show 64×64 icons, prerequisite connections, node locks, rank counters, pending green state, and all eight category selectors including Rune.
- [ ] 10. Implement detailed hover/focus tooltips with rank-aware mechanics, bold numeric values, green pending delta previews, no buttons, and viewport/keyboard accessibility.
- [x] 11. Stage rank clicks locally; implement Reset for uncommitted additions and Apply for atomic server confirmation. Do not issue API calls or invalidate queues on click/Reset.
- [x] 12. Implement a batch Apply API/service transaction for the selected category only, with row locks, whole-draft validation, rank caps/prerequisites/point totals, and an idempotent absolute-target-rank contract. Preserve independent client-side drafts per category.
- [x] 13. Integrate successful batch Apply with BattleService.runFutureCombatMutation() exactly once; prove the active battle/job is preserved and eligible future queue entries are rebuilt.
- [x] 14. Refresh authoritative mastery rows following every battle:resolved event and when opening/reopening the Mastery tab; no client-side XP or level simulation.
- [ ] 15. Add frontend/API/queue tests for staging, cap/prerequisite locks, available point exhaustion, Reset, Apply success/failure/duplicate retry, active-battle immutability, and after-battle realtime progress.

## Rank-scaled skill mechanics and legacy Rune compatibility

- [x] 16. Rename Wisp Flow to Light Wisp in the display name/descriptions, frontend mirror, UI tooltip/icon label, and related tests while preserving stable ID `wisp_flow` and existing rank/Gambit references. Implement base damage `MATK + 25 × skill rank + floor(current SP before paying Light Wisp's own cost / 5)` and test the pre-cost sampling boundary.
- [x] 17. Change War Cry to +10 DEF × active skill rank for 15 ticks/seconds and update all rank-aware descriptions/tooltips/tests.
- [x] 18. Replace the visible/active Rune node-1 passive with Arcane Dynamo: after each successful basic attack or resolved active skill, refund 2 × passive rank SP, capped at max SP. Misses, illegal actions and status ticks do not refund. Keep Stored Essence catalog/source entry hidden/deprecated; the one-time global rank reset clears all old Stored Essence allocations and refunds their spent points for redistribution rather than migrating ranks.

## Monster mana and skills

- [x] 19. Add current-monster max SP and regen values to canonical and frontend monster catalogues: 60 max SP baseline, 80 for Venom Viper/Wailing Wraith, 2 SP per 10 battle ticks.
- [x] 20. Add costs to the canonical monster skill definitions: Enraged Strike 30 SP, Regenerate 15 SP, Ice Bolt 10 SP, and Ground Slam 30 SP.
- [x] 21. Update BattleEngine monster snapshots, deterministic SP cost/regen, Gambit legality when SP is insufficient, and spRemaining events for both monster and character.
- [ ] 22. Add regression tests for initialization, per-skill costs, per-10-tick regeneration, max cap, insufficient SP fallback, no cost/cooldown on an unexecuted skill, and same-seed determinism.
- [x] 23. Add the blue monster mana bar below HP and an icon-only monster SKILLS row after the event logs and before DROPS THIS SESSION, with detail tooltips.
- [ ] 24. Derive the monster skill row from distinct use_skill IDs in the selected monster's Gambit and test both skill-bearing and basic-attack-only monsters.

## Gambit legality, cooldown, and movement

- [ ] 25. Make the player basic Attack action illegal while Disarmed; prevent stale approach intent when no legal Gambit action remains, and prove cooldown/insufficient-SP/no-line cases do not synthesize an action or movement. Preserve current monster Disarm movement behavior.
- [x] 26. Implement cooldown as sequential tick lockout after action resolution. Add a deterministic Ice Bolt regression for T2 resolve, T3 blocked, T4 next cast activation, T5 casting, T6 resolve, then T7 blocked/T8 activation/T9 casting/T10 resolve. Ensure cast progress does not advance during cooldown; sync only the Wailing Wraith Gambit row/order from root into the frontend mirror, preserving all unrelated catalog differences, and assert line/action/gauge semantics rather than a hard-coded array index.
- [x] 27. Make movement gauge start at zero at T0 and accrue effective Move Speed every battle tick even with no `movementIntent`. Move only under an active legal approach intent, at most one space per tick when gauge >= 100, retaining overflow. Test mSpd 98 => 98 at T1 and first step T2, mSpd >=100 => first step T1 when approach is valid, status speed penalties, no-legal-action idling, and the player-only Disarm rule.

## Reset existing allocations and cheat

- [x] 28. Add a one-time transactional data migration/reset that clears `skillRanks` and sets `spentSkillPoints = 0` for every existing character/category while preserving category `level` and `xp`; do not delete proficiency rows or migrate Stored Essence ranks. Verify every earned Mastery point is available after reset, and the operation runs once rather than on app startup.
- [x] 29. Add `POST /reset-skilltree/:characterName` cheat for one exact character name, with dev/admin protection, ambiguous/not-found handling, transaction/row locks, idempotent reset, logging and authoritative output. Preserve all category XP and levels; clear every category's allocated ranks and restore all earned points for redistribution.

## Documentation and verification

- [x] 30. Update SPEC.md and openspec/specs/SPEC.md identically, ARCHITECTURE.md, and STATUS.md with the finalized contracts, actual implementation/test results and the global data-reset behavior.
- [ ] 31. Run shared/API/frontend builds, focused status/Mastery/monster-mana/reset/cooldown/movement tests, strict OpenSpec validation, `git diff --check`, SPEC mirror comparison, and catalogue/asset mirror checks.
- [ ] 32. Perform browser-level desktop and mobile verification for status/skill tooltips, Mastery node states, rank previews, monster mana, and the skills row. Do not deploy as part of this change.
