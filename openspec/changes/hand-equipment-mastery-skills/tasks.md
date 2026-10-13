# Tasks

## 1. Resolve the prerequisite and close the contract

- [x] 1.1 Review the user's battle distance/movement model, create and strictly validate battle-distance-movement, and revise this proposal/spec/design/tasks to reference its position/range contract; verified by the two completed OpenSpec changes. Implementation of battle-distance-movement remains a prerequisite.
- [ ] 1.2 Implement the approved hit formula, recalibrate monster Accuracy/Evasion to the shared scale, and add regression tests; preserve the total-DEX formula and surface the one-point discrepancy (DEX 225 gives 79 Precision with T1 Bow; DEX 228 gives 80) for a final design choice rather than adding a special-case discontinuity.
- [x] 1.3 Validate the provisional Rune JSON values (T1 DEF 2/MDEF 10%, T2 DEF 5/MDEF 20%, T3 DEF 10/MDEF 35%), adjust if needed, and add item-data acceptance tests confirming monotonic progression and off-hand-only classification.
- [x] 1.4 Restore the full canonical root SPEC.md, apply targeted hand/Mastery updates without removing unrelated technical sections, synchronize openspec/specs/SPEC.md, preserve the PvE/PvP up-to-5v5 roadmap and future City respec ladder, and verify both specs are identical.

## 2. Catalogue and icon assets

- [ ] 2.1 Define the eight categories and canonical item metadata (primary slot, secondary slot, two-handed, weapon/non-weapon, ATK/MATK, equipment modifiers) in one shared catalog source; verify a catalogue contract test covers all eight categories and no duplicated hard-coded hand lists remain.
- [x] 2.2 Rename all Wand definitions/IDs/type values/player-facing text to Rod in shared types, data files, API payloads, frontend labels and skill IDs; verify a case-sensitive search shows no active domain identifier or player-facing Wand string except migration/history references.
- [ ] 2.3 Verify the three provisional Rune entries already added to items.json and apps/frontend/public/data/items.json (DEF/MDEF T1 2/10%, T2 5/20%, T3 10/35%); ensure their tooltips render through CatalogService and add contract tests confirming all tiers load as off-hand equipment.
- [ ] 2.4 Review the Rune SVG icons in assets/rune_t1.svg, assets/rune_t2.svg and assets/rune_t3.svg, already copied to both runtime framed/unframed equipment icon paths; visually verify game-scale rendering against existing item icons and ensure dark/light panels remain legible.

## 3. Persistence and safe migration

- [ ] 3.1 Add dominantHand and known-item persistence with migrations; backfill existing characters to right-handed and seed every character with canonical William stock; verify existing inventory count/currency/character identity are unchanged and rerunning the known-item hook is idempotent.
- [ ] 3.2 Replace legacy WeaponProficiency semantics with eight independent Mastery categories at level 0 / 0 XP and zero spent ranks; verify no legacy level or XP accidentally unlocks a new skill and characters can still be loaded after migration.
- [ ] 3.3 Migrate every persisted Wand identifier to Rod across inventory/equipment/pending changes/market/mail/Gambit JSON and other discovered references; verify pre/post row counts, item quantities, equipped state and transactional rollback on an invalid legacy reference.
- [ ] 3.4 Reset existing Gambit lines without deleting unrelated character state; preserve three page records, set page one active, install `<30% HP -> pot_hp_small; always -> attack` because William sells that known item, and leave other pages empty; verify no other legacy action survives and inventory/equipment/Diet/quests are preserved.

## 4. Equipment, stats and handedness

- [x] 4.1 Implement server-authoritative valid hand combinations, reject Sword + Sword and require a valid one-handed primary before any secondary item; add table-driven tests for every allowed/forbidden pairing, including Dagger in either hand.
- [ ] 4.2 Preserve the two-handed swap contract with the stricter rule: two-handed equips return off-hand items, secondary equip never persists an invalid loadout, and staged Grind changes are atomic; verify immediate and staged cases with no item loss/duplication.
- [x] 4.3 Implement 100% primary ATK / 50% secondary weapon ATK while retaining every other secondary property; verify example 120 -> 60 and test derived ATK does not count any weapon contribution twice.
- [ ] 4.4 Add secondary weapon tooltip struck-through ATK plus effective ATK through CatalogService.itemTooltipLines(); verify the tooltip shows the real value and 50% value and remains viewport-safe without MutationObserver.
- [ ] 4.5 Add the dominant-hand creation choice and mirrored primary/secondary UI highlights while preserving semantic server slots; verify right/left drag/drop and API slot meanings.
- [ ] 4.6 Implement Precision = 79 + floor(total DEX / 3) and Evasion = 99 + floor(total AGI / 3), plus equipment/passive modifiers; verify starting baseline 80/100, T1 Bow gives Precision 5, Bow modifiers -75/-74/-73 and unchanged skill no-miss policy. Resolve the documented one-point DEX milestone discrepancy before final balance sign-off.

## 5. Mastery progression and XP awards

- [x] 5.1 Add validated API .env configuration for the four mastery XP values with defaults 2/1/1/1 and document it in .env.example; verify defaults, valid overrides and rejection/fallback behavior for invalid values.
- [x] 5.2 Generate one shared Mastery level-threshold table and deterministic pacing harness using the actual character XP curve; verify level-5 and level-10/dual-level-7 targets near character levels 23/28/50.
- [x] 5.3 Award one-handed/two-handed action XP only when an action is executed successfully, including a no-XP regression for basic-attack misses and skipped Gambit skills; verify two Daggers award 1 XP per hand, but Double Strike remains one action.
- [x] 5.4 Award Shield/Rune defensive XP once per landed incoming action even when final damage is zero, and none on a physical miss; verify landed magic/resistance/immunity cases and prevent per-component double awards.
- [ ] 5.5 Apply Mastery XP with the BattleService.resolveBattle transaction using immutable recorded equipment/actions; verify battle retry/duplicate resolution cannot duplicate rewards and active battle mutation never changes its existing snapshot.

## 6. Skill tree and deterministic battle effects

- [x] 6.1 Define exactly two current skills per category with validated active/passive kind, rank limit, prerequisites, SP cost, cast/cooldown and effect payload; verify all eight categories have exactly two entries and Staff/Rod contain two actives instead of invented passives.
- [x] 6.2 Implement server-side skill point allocation, rank prerequisites, total-spent invariant and max rank; verify allocation at Mastery 0/1/5/6/10 and reject invalid/duplicate requests.
- [ ] 6.3 Implement Swordsmanship, Brutality, Double Strike, Shield Bash, Stored Essence and Fearless Focus passives with equipment gates and deterministic logs; verify passive unequip, proc rates, status caps/durations and no extra Mastery action XP.
- [x] 6.4 Implement Power Strike, Heavy Swing, War Cry, Fire Ball, Fire Blast, Blinkstrike, Wisp Flow, Light of Heaven, Violent Shot and Magic Barrier with exact approved cost/damage/heal/cast/cooldown contracts; verify SP-before/after semantics, buffs, Burn refresh/no stacking, guaranteed hit and no critical rolls.
- [x] 6.5 After battle-distance-movement is implemented, integrate Blinkstrike relocation to the space in front of its target, Shield Bash at distance 0, Fearless Focus distance scaling and Violent Shot push to distance 6; verify each using the prerequisite's regression tests. Keep Heavy Swing and Fire Blast single-target; their AoE is future scope.
- [ ] 6.6 Send learned rank, required equipment, passives, Accuracy/Evasion, status state and skill costs into authoritative immutable battle snapshots; verify all combat mutations use the BattleService-owned future-combat invalidation boundary, preserve the active battle and rebuild only after it resolves.

## 7. Gambit, Mastery UI and documentation

- [x] 7.1 Limit Gambit item choices to known items seeded from William and skill choices to learned active skills; verify unknown items/passives are absent while known items with zero quantity remain selectable but fail runtime stock validation.
- [ ] 7.2 Add line-level ⚠️ and exact equipment-missing tooltip; add conditional Grind active-title warning with generic tooltip and click navigation to the relevant Gambit page; verify both warning-present and no-warning cases.
- [ ] 7.3 Replace the Mastery placeholder with category selection, XP/level/points, two nodes, ranks, prerequisite locks and detail/effect descriptions; verify point allocation updates authoritative state and responsive/desktop layout follows existing panel baseline.
- [x] 7.4 Update ARCHITECTURE.md with Mastery reward ownership, immutable snapshots, the distance prerequisite contract and future PvE/PvP scope; verify docs distinguish single-target current scope from planned 5v5.
- [x] 7.5 Update STATUS.md at the end of implementation with changed files, migration effects, tests actually run, blockers and no-deploy note; verify the status does not claim tests/builds or runtime checks that were not executed.

## 8. Integration verification

- [ ] 8.1 Add focused tests for item combination matrix, secondary ATK/tooltip, handedness, migration preservation/Rod rename, known items, every Mastery XP event and all skill allocations; verify the focused suites pass independently.
- [x] 8.2 Add deterministic simulator regression scenarios for every non-positional skill/status and every positional skill using the approved prerequisite model; verify identical seed/snapshot gives identical events and XP.
- [ ] 8.3 Run shared/API/frontend builds, focused test suites, strict OpenSpec validation and git diff --check; verify no unresolved distance prerequisite or review decision remains before implementation is declared complete.
- [x] 8.4 Do not deploy as part of implementation; verify final status explicitly says no production deployment was performed.
