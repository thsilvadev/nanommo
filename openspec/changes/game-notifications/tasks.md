# Tasks

## 1. Domain and persistence
- [ ] 1.1 Define stable notification/discovery key contracts and DTOs shared by API and frontend.
- [ ] 1.2 Add character-scoped acknowledgement persistence for Gambit option discoveries, NPC discoveries, and quest introductions.
- [ ] 1.3 Add Web Push subscription entity and reversible migration, including locale and ownership.
- [ ] 1.4 Add a single pending browser-push slot per character with delivery claim/acknowledgement semantics; no expiry and no backlog.
- [ ] 1.5 Add authenticated APIs for notification bootstrap, acknowledgement, push subscription registration/removal, and display confirmation.

## 2. Event producers and realtime
- [ ] 2.1 Publish dot-state changes through existing Redis/Socket.IO character event patterns.
- [ ] 2.2 Emit native notification events for inventory-full transition, discarded Bliss Stone/Divine Shard drops, first level-up, and each market sale.
- [ ] 2.3 Implement latest-only replacement, active delivery, Service Worker display confirmation, retry/idempotency, and stale subscription cleanup.
- [ ] 2.4 Keep party invitations out of scope.

## 3. Frontend Service Worker and permission UX
- [ ] 3.1 Add Service Worker with push, notification click, display confirmation, and focus/open-window routing.
- [ ] 3.2 Register/update push subscriptions and persist game locale.
- [ ] 3.3 Add explicit user-initiated browser notification enable flow; let the browser show its native permission prompt.
- [ ] 3.4 Handle unsupported browsers, denied permission, missing VAPID config, logout, and subscription expiration gracefully.

## 4. In-game dots
- [ ] 4.1 Add reusable notification-dot presentation using `assets/ui/notification_dot.png`.
- [ ] 4.2 Add attribute dots to topbar Character, Character tab, and `alloc-head`, derived from unspent attribute points.
- [ ] 4.3 Add mastery dots to topbar Character and Mastery tab; show per-weapon dot only when that weapon has upgrade points.
- [ ] 4.4 Add Gambit dots only to newly discovered skill/item options in Action-block parameter-row selects; clicking an option acknowledges it immediately. Ensure item options are consumables excluding food.
- [ ] 4.5 Add NPC discovery dots to revealed city markers and NPC selector options; selecting the NPC acknowledges it.
- [ ] 4.6 Add quest dots to NPC selector and first available quest dialogue/action; acknowledge on opening that first quest interaction, not on acceptance/start.
- [ ] 4.7 Add per-message Mailbox selector and Inbox dots; clear only after read and all attachments claimed.

## 5. Browser notification behavior
- [ ] 5.1 Implement event-specific title/body and routing in pt-BR/en-US.
- [ ] 5.2 Inventory full notifies on transition to full; discarded rare drops notify individually; level-up notifies once; market sale notifies per item.
- [ ] 5.3 Verify latest-only pending behavior after browser downtime and individual real-time delivery while browser is available.
- [ ] 5.4 Ensure notification clicks focus/open game and navigate to the corresponding feature.

## 6. Verification and documentation
- [ ] 6.1 Add focused API tests for acknowledgement, subscription ownership, pending-slot replacement, idempotency, and event policy.
- [ ] 6.2 Add frontend tests for dot visibility/acknowledgement and Service Worker registration/click routing.
- [ ] 6.3 Run shared/API/frontend builds, focused tests, OpenSpec validation, and `git diff --check`; do not run Docker/integration tests.
- [ ] 6.4 Update STATUS.md, SPEC.md, and architecture documentation with notification contracts and deployment VAPID requirements.
