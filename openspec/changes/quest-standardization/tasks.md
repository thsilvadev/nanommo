# Tasks

## Contract and catalogues
- [x] 1. Confirm any remaining quest lifecycle/reacceptance details and finalize typed shared quest definitions, objective types, status values, and reward DTOs.
- [x] 2. Add canonical `quests.json`, quest-only physical item definitions and synchronized frontend-facing quest data. Keep `containerItem` as a validated/implemented reference for approved Gathering objectives; do not invent an active Gathering quest or its content before those values are approved.
- [x] 3. Add boot-time validation for quest IDs, offer dialogue steps, objective IDs, NPC/map/monster/item/prerequisite references, probabilities, quantity, deadlines, reward types and Cecilia's item reference.
- [x] 4. Read and validate `QUEST_ACTIVE_LIMIT` from environment, default 5; fail fast on invalid values.

## Backend persistence and service
- [x] 5. Add per-character quest-instance persistence and a forward-only migration for state, objective progress, accepted/expiry/completed timestamps. Do not execute the migration.
- [x] 6. Implement eligible quest discovery, single-button offer dialogue, final-step acceptance, active-limit enforcement, quest status, abandonment/reacceptance policy, expiry and NPC-specific turn-in.
- [x] 7. Make turn-in atomic: validate required ordinary/quest items and full inventory capacity before consuming requirements; grant gold, Character XP, items and profession XP and mark completed in one transaction.
- [x] 8. Ensure expiry/abandonment removes only physical quest items owned by that quest instance; prevent concurrent acceptance/turn-in and duplicate rewards.

## Progress integrations and restrictions
- [x] 9. Integrate kill progress and independent deterministic quest-drop rolls with authoritative successful battle resolution, without changing immutable battle outcomes or duplicating grants on retry.
- [x] 10. Integrate separate Gathering bonus rolls with authoritative Gathering cycles; grant the configured quest `containerItem` only on success and preserve ordinary Gathering output.
- [x] 11. Enforce quest-only physical item restrictions in vendor sale, Market, Mail attachments, Warehouse transfers and all player-to-player item transfers, in backend services and relevant UI.
- [x] 12. Tag quest-reward equipment instances with validated provenance; reject only those instances from Market listings. Remove `dropPool` from `equip_accessory_sor_t1`; verify legacy instances remain tradable and newly quest-granted instances are blocked by provenance.

## NPC integration and content migration
- [x] 13. Rename the dialogue-only NPC capability/graph from `quest` to `dialogue`, preserving Father Marcelus's behavior and keeping dialogue state separate from quest instances.
- [x] 14. Convert Cecilia's current 20 Slime Gel + 20 Bat Wings + 10 Thorn Barks exchange into a non-repeatable quest with her current reward, a single-button offer sequence, and explicit turn-in.
- [x] 15. Expose every quest as its own NPC action according to level/prerequisites/state; support multiple quests from one NPC and a separate turn-in NPC. V1 interactions remain Town-only.

## Character UI
- [x] 16. Add a Quests tab to the existing Character page query-param tabs and focus the active section by default.
- [x] 17. Render active quest objective progress, optional deadline, reward preview and turn-in NPC; render completed entries with name + giver only. Omit abandoned/expired quests and filters.
- [x] 18. Render quest offer/action/turn-in buttons inside the existing NPC dialogue/service panel. Each dialogue step has exactly one button, and only the final decisive offer button accepts the quest.

## Verification and documentation
- [x] 19. Add focused tests for eligibility, level unlocks, active limit, single-button acceptance, multi-objective progress, victory/loss, talk action, Gathering chance/normal-drop preservation, monster-drop idempotence, deadlines/offline expiration, abandonment cleanup, repeatability, turn-in rollback and item capacity.
- [x] 20. Test that quest-only physical items are rejected by vendor, Market, Mail, Warehouse, and player-to-player transfer APIs, and that all quest-reward equipment plus Cecilia's accessory are blocked from Market listing.
- [x] 21. Run shared/API builds, frontend type-check and production build, focused tests, canonical/public catalogue parity checks, strict OpenSpec validation and `git diff --check`.
- [x] 22. During apply, update root `SPEC.md`, `openspec/specs/SPEC.md`, `ARCHITECTURE.md`, and append verified evidence to `STATUS.md`; leave the migration unexecuted and do not deploy.
