# Combat Timers HUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Display active statuses and cooldowns consistently for the character, grind target and Group allies.
**Architecture:** One Angular HUD consumes pure timestamp projections. Server action events expose compact cooldown starts and public snapshots expose opening timer data, without private inventory or Gambits.
**Tech Stack:** Angular 18, TypeScript, NestJS, shared deterministic battle engine, Node assertions and Jasmine.
**Spec:** docs/superpowers/specs/2026-11-22-combat-timers-hud-design.md (approved).

## Global Constraints
- Icons 28 × 28 px; buffs green, debuffs red, skills white, items gray.
- Status duration numeric; cooldown radial; show cooldown icons only while active.
- Three independent shared consumable categories: 10s, 30s, 60s.
- Authoritative timestamps and 500 ms ticks; never project future events.
- No balance changes, migrations, deployment or private inventory disclosure.

## Review Focus
- Carried cooldowns and statuses survive encounter changes and reloads.
- Group actors and target changes never mix identities.
- Cast start and fizzle never begin a cooldown.
- Rank-adjusted and zero-duration skills use effective server values.
- Expired, removed and permanent statuses display correctly without broken assets.

### Task 1: Authoritative timer data and category verification
**Files:** shared battle-engine/combat-timers.ts, group-simulator.ts, types/group-battle.ts, party/shared-battle.service.ts, party/party.service.ts; apps/api/test/combat-timers.test.js.
**Interfaces:** `combatCooldownDurations(snapshot, items): Record<string,number>` and `consumableCooldownKey(item, id): string`; optional action payload cooldown `{key,durationTicks}`; public opening cooldowns/durations.
- [x] Add Node tests for category sharing/independence, action cooldown starts, and public snapshot privacy.
- [x] Run shared build and test; confirm missing timer metadata fails.
- [x] Add compact cooldown metadata and safe public opening timers; include persisted party timers outside combat.
- [x] Build shared/API; rerun timer tests and group regression tests.

### Task 2: Pure timer projection and shared HUD
**Files:** frontend/shared/combat-timers.ts, combat-timers.spec.ts; features/play/combat-timers.component.ts/.css.
**Interfaces:** `projectCombatTimers(input, now): CombatTimer[]`; rows provide stable key, kind, id, remainingSeconds, fraction and stacks. Input supports solo, shared actor and absolute deadlines.
- [x] Write Jasmine tests for opening cooldowns, visible action events, cast/fizzle exclusion, expiration, rank-adjusted duration, independent actor identities, persistent/permanent statuses and stacks.
- [x] Run tests and confirm failure before implementation.
- [x] Implement pure projection, shared rendering, localized tooltips and SVG category assets with status fallback.
- [x] Run focused Jasmine tests and spec typecheck.

### Task 3: Panel integration and delivery verification
**Files:** components.ts, character-summary.html, grind-info.html, party-panel.component.ts/.html, shared-battle-panel.component.ts, party models, STATUS.md, ARCHITECTURE.md.
**Interfaces:** all panels pass actor-specific projected rows to the shared HUD.
- [x] Integrate character, solo target, shared target and Group allies below resources.
- [x] Test panel bindings, shared target switching, persistent state and narrow layout.
- [x] Run production build, focused frontend tests, API/shared regression tests and diff check; inspect rendered HUD.
- [x] Request fresh code review, address substantive findings and record exact validation in STATUS.

## Execution decisions
User explicitly requested implementation after approving the design; proceed inline without another approval round. Preserve concurrent 3D asset work. User subsequently requested isolation: native worktree combat-cooldowns-hud, branch codex/combat-cooldowns-hud based on main. Merge main only on explicit later command.
