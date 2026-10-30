# Proposal

## Why

Players currently have no consistent way to notice newly available character progression, discoveries, quests, or mailbox rewards without manually checking each screen. Important events can also happen while the game is in another tab or the browser is closed.

## What Changes

- Add persistent, character-scoped discovery/read acknowledgements and in-game notification dots using the supplied `apps/frontend/assets/ui/notification_dot.png` asset.
- Add browser push notifications for inventory-full transitions, discarded Bliss Stone/Divine Shard drops, the first level-up notification, and each sold market item.
- Support delivery while the game tab is closed through a Service Worker and Web Push subscriptions.
- Keep at most one undelivered browser notification per character: each new event replaces the previous pending one; the newest pending event has no expiry and is shown once the browser becomes available. A confirmed display clears it. While a subscribed browser is available, each new event is delivered individually in real time.
- Add notification click routing to the relevant game destination and localize notification content using the game locale.
- Exclude party invitations for this iteration; preserve an extensible event contract for future support.

## Capabilities

### New Capabilities
- `game-notifications`: in-game discovery dots, mailbox unread indicators, and browser push notifications.

### Modified Capabilities
- None.

## Impact

Touches API persistence, event producers, Redis/Socket.IO gateway integration, Web Push subscription lifecycle, frontend Service Worker registration, notification settings/permission UX, and multiple game UI surfaces. Requires VAPID public/private keys and a deployment-safe configuration path. No credentials are generated or committed as part of this change.
