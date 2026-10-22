# Tasks

## 1. Catalogues and persistence
- [ ] 1.1 Add validated canonical cooking_recipes.json plus frontend public mirror with all seven recipes, ingredients, output IDs, unlock levels, deterministic order, and proposed XP rewards.
- [ ] 1.2 Add Uncle Phillip to root/frontend npc_catalog.json with the exact greeting and cooking capability; add him only to Sierra Village's npcIds in root/frontend maps.json.
- [ ] 1.3 Rename food_roast to Roasted Barbecue in root/frontend items.json, preserving ID, effect, and icon reference; do not rebalance Honey or Hunter's Stew.
- [ ] 1.4 Add Character Cooking level/XP/session persistence and a forward-only migration with default level 1, XP 0, and null active session. Do not run it.
- [ ] 1.5 Extend DataService/catalog validation and parity/recipe validators.

## 2. Authoritative Cooking service
- [ ] 2.1 Implement cumulative XP thresholds, recipe XP awards, derived level, progress DTO, carry-over, and level-up unlock response.
- [ ] 2.2 Add authenticated read/start/Cancel/status operations; starting validates Sierra Village, Town/travel state, recipe level, material totals, and reservable output capacity.
- [ ] 2.3 Persist a 10-second session with server timestamps/generation and ingredient/output-capacity reservations; enforce a single active session per Character.
- [ ] 2.4 Protect reserved ingredients/output capacity from all conflicting inventory mutations and release reservations on Cancel/completion.
- [ ] 2.5 Add durable idempotent completion scheduling and restart reconciliation; serialize completion/Cancel through the character queue lock and row lock.
- [ ] 2.6 Atomically remove ingredients, add one food, award XP/level, clear session, and return authoritative DTOs at completion.
- [ ] 2.7 Route successful output insertion through the future-combat mutation boundary so unstarted battle snapshots refresh but active battle snapshots remain immutable.

## 3. Town UI and modal
- [ ] 3.1 Render Uncle Phillip's exact greeting and [I'd like to cook] in the generic NPC panel.
- [ ] 3.2 Build a centered responsive Cooking modal (about 50vw desktop) with horizontal recipe cards, existing icons, polished names, ingredient counts, required level, and disabled eligibility states.
- [ ] 3.3 Add the modal-local 10-second Cooking progress bar; change COOK to Cancel and keep the session alive if the modal closes or the page reloads.
- [ ] 3.4 Refresh authoritative inventory/XP/level after completion; reveal newly unlocked recipes immediately and render clear error/space states.
- [ ] 3.5 Confirm `apps/frontend/assets/npcs/uncle_phillip.png` is reused through the existing `npcPortrait(id)` convention (`/assets/npcs/<id>.png`); do not add duplicate portrait-loading logic.

## 4. Character Professions tab
- [ ] 4.1 Add the `Professions` tab to the existing `/play/character?tab=` query-parameter allowlist and navigation.
- [ ] 4.2 Display Gathering, Cooking, Blacksmith, and Alchemy with level and current-level XP progress; use existing Gathering progress, Cooking progress from this change, and the documented Level 1 / 0 of 100 baseline for Blacksmith and Alchemy.
- [ ] 4.3 Test direct deep-link loading, tab selection, progress formatting, and unchanged behavior for Character, Gambits, and Mastery tabs.

## 5. Regression tests and handoff
- [ ] 5.1 Test recipe catalogue/mirror validity and all ingredient/output references.
- [ ] 5.2 Test XP curve pacing: 20 level-1 + 30 level-2 preparations reach L5; +50 Honey reaches L6; +100 Hunter's Stew reaches L7.
- [ ] 5.3 Test eligibility, atomic success/failure, reservation conflicts/capacity, Cancel/completion races, duplicate/recovered jobs, and no consumption/reward on Cancel.
- [ ] 5.4 Test active/future battle queue behavior, NPC map ownership, API validation, immediate recipe unlock UI, and the existing portrait URL convention.
- [ ] 5.5 Run shared/API/frontend builds, focused tests, catalogue validators, strict OpenSpec validation, and git diff --check.
- [ ] 5.6 During apply, update root/canonical SPEC, ARCHITECTURE, and STATUS from verified results. No migration execution, live DB mutation, or deployment.
