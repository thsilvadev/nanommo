# Tasks

- [x] Fix Town return ordering server-side so future queued battles cannot start after a Town request during an active battle.
- [x] Replace delayed native item titles with instant custom item hintboxes.
- [x] Stop tooltip details at tier; do not display Tier or fields after it.
- [x] Color Tier 2/3/4/5 item names green/blue/purple/gold.
- [x] Refresh inventory after authoritative queue-resolution websocket updates.
- [x] Restore multi-level XP threshold consumption using the existing reduced Grind XP rate.
- [ ] Add/execute live browser smoke for Town return, session drops, inventory timing, and tooltips.
- [ ] Run the complete backend integration suite against the local stack if available.
- [x] Make deferred Town return server-authoritative with a persistent character flag and migration.
- [x] Prevent stale Character/Inventory/Battle HTTP loads from overwriting newer realtime state.
- [x] Humanize consumable effects and filter tooltip metadata by item type.
- [x] Fix equipped Character tooltip line layout.

- [x] Remove equipment names and empty-slot labels from the Character quick equipment panel; keep item names only in tooltips with tier colors.
- [x] Publish the authoritative Town status in `battle:resolved` after the deferred Town transition, preventing the right panel from entering a nonexistent no-queue state.

- [x] Make Town requests idempotent even if future-queue cleanup races with battle resolution.
- [x] Self-heal a transient empty battle queue while a character remains on a grinding map.
