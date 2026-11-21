# Elemental Combat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify elemental damage, boot affinities, Burn and Flaming Pound, with accurate tooltips, comparisons and Character stats.
**Architecture:** A shared elements module defines canonical elements, the affinity matrix and equipment affinity resolution. Both combat executors, API snapshots/DTOs and frontend presentations consume the same functions; resistance percentages are derived from affinity, not applied twice.
**Tech Stack:** TypeScript, shared battle executors, NestJS, Angular, JSON catalogues, SVG icons.
**Spec:** docs/superpowers/specs/2026-11-21-elemental-combat-design.md, approved with same-element 0.5 and boots granting defensive affinity instead of independent resistance.

## Global Constraints

- Preserve current equipment DEF, Move Speed, rolls and other unrelated values.
- Same-element damage = 0.5; inverse advantage = 0.75; advantage = 1.5; neutral = 1.
- Boots set one defensive affinity. Display resistance = (1 − incoming affinity multiplier) × 100. Do not apply both the displayed percentages and affinity.
- Weapon enchantment changes basic damage element only; skills own their element. Both hands must be accounted for consistently with the current attack model.
- Burn is magical/fire, source MATK / 5, duration 50 ticks, interval 10 ticks; Flaming Pound procs on landed basic attacks at 20%.
- Existing branch and workspace are authorized; execute inline following user's “manda ver”, without another plan approval gate.

## Review Focus

- Existing owned boots and old status snapshots must keep working after the catalogue changes.
- Switching affinity can improve one resistance and worsen another; comparisons must retain negative deltas and percentage points.
- Basic, skill and periodic damage must use the same matrix in solo and group play, without counting mitigation twice.
- Dual wield and missing weapon-element data must resolve predictably without changing the existing ATK model.
- Pure damage, healing, status proc chances and unrelated monster multipliers must remain unaffected.

### Task 1: Shared elemental contract and catalogues
Files: packages/shared/src/elements.ts (new), shared exports/types, items.json, monsters.json, skill_trees.json, status_effects.json, gambit_catalog.json and public mirrors.
- [x] Add failing Node regression tests for matrix (all 49 cells), earth affinity resistance (50/-50/25), legacy light normalization, weapon enchantment, catalogues and Burn.
- [x] Run tests RED; implement shared helpers: normalizeElement, elementalMultiplier, elementalResistances, equipmentAffinity, weaponElement.
- [x] Update catalogue data and mirrors; keep approved monster assignments; migrate light aliases and elemental immunity to affinity.
- [x] Build shared and run tests GREEN.

### Task 2: Combat executors and API projection
Files: shared battle-engine/index.ts, group-simulator.ts, types/group-battle.ts, persistent-status.ts, API character/battle/shared-battle snapshots and DTOs.
- [x] Add failing simulation tests for basic/skill/status elements, affinity, Burn mitigation/refresh, Flaming Pound and pure damage.
- [x] Implement matrix use for all incoming damage paths, canonical Burn application, deterministic Flaming Pound, equipped affinity and weapon elements in snapshots.
- [x] Make legacy Burn rehydration use canonical fire/magical semantics; make Gambit weakness consult matrix.
- [x] Build API/shared and run combat regressions GREEN.

### Task 3: Interface and icon
Files: frontend catalog.service.ts/spec.ts, game.models.ts, Character component/template, locale.service.ts, status tooltip, public skill icon.
- [x] Add failing Angular tests for six resistance rows, boot affinity lines, signed tooltips and comparisons (earth → water, elemental → neutral).
- [x] Use shared matrix in tooltip/comparison formatting; display all six resistances in Character Stats from authoritative DTO; add Flaming Pound SVG and tooltip description; expose canonical Burn properties.
- [x] Run focused tests GREEN; run full Angular suite and production build.

### Task 4: Documentation and final verification
Files: SPEC.md, openspec/specs/SPEC.md and this plan/spec.
- [x] Update canonical specs with approved matrix, affinity semantics, monster list and Burn/passive rules.
- [x] Run catalogue validation, combat regressions, API/shared/frontend builds, Angular suite and diff checks. Record environment failures separately.
- [x] Request one fresh whole-change review using requesting-code-review; fix important findings with regressions.
- [x] Report results and branch, without publishing or merging.

## Execution ledger

- Setup: branch codex/elemental-combat-resistances; workspace initially clean except the new proposal document. User approved proposal with same-element 0.5 and boot affinity. No additional worktree or user approval required.

- Task 1: shared helpers and catalogues complete; elemental-affinity and elemental-catalog tests passed after RED→GREEN, shared CJS/ESM builds passed.
- Task 2: both executors, canonical Burn, Flaming Pound, API DTO/loadout projections and carried-status cadence verified by elemental-combat, elemental-character-projection, persistent-status-effects and replay compatibility tests. Existing group/parity tests passed.
- Task 3: five new UI tests were observed RED, then all nine focused catalog/Character tests passed. Full Angular suite running.
- Ruling: preserve immutable encounter behavior with elementalRulesVersion=1 and stored V2 inputs; replays without the marker retain pre-change rules. This prevents catalog changes from altering a FLEE checkpoint in an existing encounter.
- Ruling: preserve the existing combined dual-hand strike and weight the secondary ATK fraction by its own element; independent weapon hit rolls would change combat cadence beyond the approved scope.
- Validation note: validate-monster-catalog.js currently stops at an unrelated map_green_grounds_0 length assertion (20 versus expected 25), before reaching elemental assertions. Its obsolete elemental assertions were updated to the approved rules; unrelated map data was preserved.

- Final review: fresh read-only review by elemental_code_review (gpt-6.2-astra), scoped to the elemental changes; concurrent unrelated UI/quest/map work excluded.
- Final: fixed simulation/replay version disagreement — elemental-replay-compatibility includes identical-state simulation/replay and frozen-input FLEE cases, RED→GREEN.
- Final: fixed legacy FLEE reading current elemental modifiers — merge the saved monster snapshot over current catalogue data, preserving stored rules and stats.
- Final: fixed FLEE DOT deadline anchoring — persistent-status-effects pins next tick to battle start +5 s and expiry +25 s despite fleeing inside a tick; RED→GREEN, solo and party call sites pass the immutable start.
- Final: fixed carried Burn source attribution — elemental-carried-status retains the absent original source ID and infers monster kind for older statuses; RED→GREEN.
- Final: fixed retired Gambit elements — elemental-affinity/elemental-catalog were RED, then GREEN; normalize light→holy, ice→water and lightning→wind in evaluation, server validation/canonicalization and editor load. elemental-gambit verifies saved shapes remain writable without mutating input.
- Final: fixed unrelated Poison barrier change — elemental-carried-status was RED, then GREEN; only Burn gains barrier absorption, while Poison preserves its MDEF-only mitigation.
- Final: off-hand odd fixed+rolled rounding was corrected with RED→GREEN elemental-affinity coverage during implementation, before the final review completed.
- Final: minor (deferred): extend the compact Burn status tooltip with damage type, potency and interval. Canonical catalogue fields and the complete Flaming Pound passive description are present; existing status tooltips retain their compact format.
- Ruling: retired lightning/ice Gambit choices map to wind/water, respectively, rather than being silently neutral or invalidating already saved pages. The current UI offers only the approved six elements.
- Validation: full Angular suite passed 336 tests before the final alias migration test; final full suite passed 337/337 tests. Production frontend build passed with existing size-budget warnings. API/shared builds and all eight elemental/persistent regression scripts passed.
- Baseline validation: standalone mastery-skill-simulator, defense-monster-casting-passive-logs and alchemy-tonics-battle fail identically in a temporary clean HEAD archive compiled separately; battle-distance-movement also reaches the same obsolete Ice Bolt range assertion in both versions. These existing failures were preserved, not repaired as part of elemental balancing.

- Final verification: all eight elemental/persistent regression scripts GREEN; shared/API/production frontend builds GREEN; Angular full suite 337/337 GREEN; four additional group/parity/slow/log scripts GREEN and the Jest variance suite 4/4 GREEN. Scoped diff check GREEN. General API Jest command fails with baseline assertions, ESM loader/configuration and standalone-script/HTTP integration issues; details in elemental-combat-validation.txt.
