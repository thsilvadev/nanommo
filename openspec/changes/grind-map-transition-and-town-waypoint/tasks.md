# Tasks

- [x] 1.1 Add a shared per-character distributed lock for queue generation and the authoritative battle transaction.
- [x] 1.2 Make kill-counter creation conflict-safe and idempotent for concurrent first access.
- [x] 1.3 Refactor map entry to transact/lock Character, detect started unresolved battles past `endAt`, replace the pending destination on newer requests and reject stale delayed requests.
- [x] 1.4 Reset source Grind `epoch` on every actual departure, including Grind-to-Grind and Town fallback, and sync presence for transition requests/commits.
- [x] 1.5 Unify frontend transition waiting/polling, newest-request response handling, destination marker and BFS dashed route.
- [x] 1.6 Add saved Town model/DTO/endpoint, forward-only migration, `Save here`/`Saved ✔` UI, and saved-Town waypoint art.
- [x] 1.7 Update canonical SPEC, SPEC mirror, ARCHITECTURE.md and STATUS.md.
- [x] 1.8 Add direct-run backend concurrency/transition tests, map-presence regressions, and frontend asset/route contract checks.
- [x] 1.9 Run shared/API/frontend production builds, focused regressions, asset-output check, strict OpenSpec validation and diff hygiene.
