# Pending Action UX Implementation Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans; execute inline with regression tests and one independent final review.

Goal: subtle server-confirmed feedback for equipment, consumables, attributes and Gambit changes.
Architecture: existing durable action queue + safe target metadata and preflight; one frontend tracker with idempotent requests, reconnect recovery and authoritative refresh; one small shared indicator across relevant controls.
Spec: docs/superpowers/specs/2026-11-22-pending-actions-ux-design.md.

## Constraints
Preserve immutable encounter cutoff, only change applied UI from server snapshots, no local expiry assumptions, all pending rows recoverable, only affected control blocked, no migration/deploy/merge.

## Review focus
Late HTTP vs socket confirmation; reload with pending saves and newer drafts; lost HTTP response/idempotent recovery; invalid food/digestion; same item instances and implicit offhand changes.

### Task 1: Server contract and prevalidation
- [x] RED tests: safe action targets/all pending retrieval, food rejected before insertion, no mutation in preflight.
- [x] Add own-action target metadata, keep all pending rows plus bounded terminal history; validate usable items before enqueue, preserve execution validation.
- [x] Build shared/API and run targeted queue/consumable tests. Commit backend changes separately.

### Task 2: Unified frontend lifecycle
- [ ] RED tests: send/queue/confirm/fail, duplicate prevention, terminal-before-HTTP, reconnect/idempotency and restoration.
- [ ] Implement tracker without CharacterStore/PartyStore dependency cycles; integrate mutation requests and authoritative refresh.
- [ ] Preserve draft edits and restore queued Gambit saves/activation. Test local failures and disconnection.

### Task 3: Subtle UI and verification
- [ ] Add accessible motion-aware marker and contextual integration in Inventory, equipment, attribute controls and Gambit tabs/buttons.
- [ ] Browser rendering/layout tests and full-app local synthetic smoke; inspect narrow layout and failed/queued/disconnected states.
- [ ] Production/spec builds, relevant Node/Karma regressions, independent code review, documentation and separate frontend commit. Keep branch without merge/push.
