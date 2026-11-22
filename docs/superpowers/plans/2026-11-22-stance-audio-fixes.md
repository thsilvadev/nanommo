# Stance and music bug fixes

User authorized both fixes on codex/combat-cooldowns-hud with separate commits; main merge awaits later command.

## Diagnosis and execution
- [x] Trace stance acknowledgements and delayed snapshots; reproduce without changing maps; preserve committed timestamp/revision and test the actual stance/queue boundary.
- [x] Commit stance fix independently, with focused frontend/backend regressions.
- [x] Reproduce music transition races: stale play completion, settings during fades, cancellation/stop, autoplay retry and teardown.
- [x] Enforce one owned transition and controlled volume for every retained track; cancel stale asynchronous work and gesture handlers.
- [x] Run audio/browser regressions and production build; commit music fix separately.
- [x] Independent final review, complete tests and keep branch/worktree without merge/push.

Validation: 56 browser tests passed, API/frontend builds and spec typecheck passed, four stance/timing Node scripts passed. Independent review found no substantive issues. A pre-existing gathering-cycle regression fixture lacks manager.query (documented in STATUS). No main merge or push.
