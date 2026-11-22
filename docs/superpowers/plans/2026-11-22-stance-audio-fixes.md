# Stance and music bug fixes

User authorized both fixes on codex/combat-cooldowns-hud with separate commits; main merge awaits later command.

## Diagnosis and execution
- [x] Trace stance acknowledgements and delayed snapshots; reproduce without changing maps; preserve committed timestamp/revision and test the actual stance/queue boundary.
- [x] Commit stance fix independently, with focused frontend/backend regressions.
- [ ] Reproduce music transition races: stale play completion, settings during fades, cancellation/stop, autoplay retry and teardown.
- [ ] Enforce one owned transition and controlled volume for every retained track; cancel stale asynchronous work and gesture handlers.
- [ ] Run audio/browser regressions and production build; commit music fix separately.
- [ ] Independent final review, complete tests and keep branch/worktree without merge/push.
