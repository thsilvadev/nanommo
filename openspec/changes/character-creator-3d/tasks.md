# Tasks

Reference: `docs/superpowers/plans/2026-11-16-criador-personagem-3d.md` (Tasks 0–8).

## 1. Assets and rules

- [x] 1.1 Inspect the CC0 packs and record the asset report.
- [x] 1.2 Shared appearance rules and `appearance_catalog.json`, validated at boot and mirrored.

## 2. API

- [x] 2.1 Nullable appearance columns, migration (written, not executed) and DTO fields.
- [x] 2.2 Creation with appearance and one-time save with the height adjustment.
- [x] 2.3 Action block, offline cutover script, startup guard, env flag, deploy check and runbook.

## 3. Client

- [x] 3.1 Asset pipeline and three.js character viewer.
- [x] 3.2 Creator screen, routing and `APPEARANCE_REQUIRED` handling.
- [x] 3.3 3D Idle portrait in the Character Summary.

## 4. Verification

- [x] 4.1 Unit/contract scripts, Karma specs, builds and screenshots.
- [ ] 4.2 End-to-end against a real PostgreSQL/Redis (creation, one-time save, cutover, startup guard) — not verified, at the user's request.
