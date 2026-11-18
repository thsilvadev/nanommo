# Gameplay fixes — 2026-11-17

Branch: `codex/gameplay-fixes`. User requested autonomous implementation while away.

Plan: preserve structured battle event data and add readable colored logs with conditional scroll following; announce completed craft units in an optional global channel with an editable allowlist; make Cooking Max clickable; replace Flaming Treant art with real transparency; show monster drop probabilities; process profession batches one unit per 10 seconds with XP per unit; verify alchemy category cooldowns; add map length to tile tooltips; trace gathering-to-hunting transitions.

Validation: focused runtime regression scripts, shared/API/frontend builds, frontend browser tests when available. No production database changes or deployment.

## Result

1. Solo/shared/history event text now names targets, skills and statuses. Damage/healing/status/skills have distinct colors; zero regen is hidden. Solo projection keeps cast skill/deadline and status snapshots; status UI understands V2 apply/expire events. Live feeds follow while at bottom, pause when scrolled up and resume at bottom.
2. Optional Crafts channel, persisted visibility preference, bounded Redis history and completion deduplication. `craft_announcements.json` enables all 33 distinct recipe outputs; `craft-announcements.md` lists them. Announcements are best-effort after commit, so a Redis outage can lose an announcement without losing the crafted item.
3. Cooking Max is a keyboard-accessible button left of quantity; existing setter clamps to allowed maximum.
4. Flaming Treant PNG regenerated, angrier and crying. Actual RGBA alpha checked (0–255); SVG compatibility URL uses the same image.
5. Base monster-specific drop rates appear in solo and shared panels. They do not include global drop pools or player-specific reward modifiers.
6. Alchemy/Blacksmith batches deliver one unit per 10 seconds, consume ingredients and grant XP per unit, reserve remaining materials and roll equipment independently. Each unit has a fresh id to reject stale completions; stable batch identity makes cancellation at a deadline award the completed unit and release the remainder.
7. Existing catalogue already has Antidote at Alchemy 1 for 2 herbs in Potions, Fairy in Super Tonics with 60-second cooldown. Existing manual/engine paths use category cooldown keys. No balance/catalogue changes needed.
8. Map tiles show Map Size from mapLength.
9. Stationary scheduling now holds the character queue lock and updates only gatheringCycle; it cannot overwrite a newly committed hunting stance from a stale whole-character snapshot. Regression test covers serialization and restricted fields. The original intermittent live symptom was not reproduced against production, so confirm this transition when testing the branch.

## Verification

- Shared, API and production frontend builds passed. Frontend reports bundle/CSS budget warnings.
- Frontend suite: all 203 assertions passed, including the new real-browser scroll follow/pause/resume regression. Karma/Chromium crashes during teardown (`Cannot read properties of null (reading 'kill')`), so the command exits nonzero despite no failed assertions. Repeated with dynamic debugging port; same teardown issue.
- Focused API sweep: 19 scripts passed after rerunning tickrate outside the sandbox (initial `spawnSync git EPERM`). New tests: profession-batch-progress (including cancellation at deadline), craft-announcements, solo-readable-projection, readable-battle-events, stationary-scheduling-stance.
- Also passed: profession-crafting-rolls, party-alchemy-crafting, party-alchemy-manual-consumables, party-alchemy-catalog, group-battle-engine/parity/rewards, party-intent-clock and cooking/chat retention-related scripts in the recorded sweep.
- Existing failures observed: battle-distance-movement (Ice Bolt catalogue assertion); gathering-cycle-regression (fixture lacks manager.query; reproduced with HEAD MapService); grind-monster-expansion-chat-journal (expects 8 but catalogue has 16); alchemy-tonics-battle (retired self_hp_below_percent condition, then old cooldown timing assumptions). These files/catalogue assumptions were not changed.
- Broad `pnpm test`/Jest is not a valid API gate here per CLAUDE.md; direct-execution assertion scripts were used.
- Code review found the cancellation-at-deadline regression; fixed, retested and reviewed without further findings.

## On return

Review the visual result and decide when to merge/deploy. Optionally prune announcement IDs. No production deployment, database changes or migrations were run. The preexisting untracked cidade-viva design was left untouched. The stale skill_trees frontend mirror was rewritten by the build sync script and restored to its original tracked contents to avoid unrelated changes.

Worktree isolation: another task switched the original checkout to feat/cidade-viva during this session. All 35 files belonging to this change were copied to /tmp/nanommo-gameplay-fixes on codex/gameplay-fixes; only the exact copied changes were removed from the original checkout, which was left clean on its external branch.
