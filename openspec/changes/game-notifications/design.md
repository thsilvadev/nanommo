# Design

## Context

The game already uses Redis pub/sub and authenticated Socket.IO events scoped to a character. Browser Notification API usage and Web Push infrastructure are absent. The supplied dot asset is a 32×32 RGBA PNG at `apps/frontend/assets/ui/notification_dot.png`.

## Goals

- Make acknowledgement state durable per character and synchronized across sessions/devices.
- Keep dynamic progression indicators derived from authoritative state where possible (unspent attribute/mastery points).
- Track acknowledgement for newly discovered Gambit parameter options, NPCs, quest introductions, and individual mailbox messages.
- Display native notifications while the game tab is backgrounded or closed, without replaying a backlog.
- Avoid polling and use existing event-driven infrastructure.

## Non-goals

- Party invitations.
- Notification history center or a replayable queue.
- Notification sounds or custom in-game toast stack unless required by an existing event surface.
- Changes to gameplay unlock rules or quest acceptance semantics.
- Docker/integration tests; focused unit/build validation only.

## Decisions

1. **Separate dots from browser push.** In-game dots use authenticated REST bootstrap/mutations plus Socket.IO updates. Native notifications use Web Push + Service Worker and a separate subscription record.
2. **Character-scoped acknowledgements.** Persist seen keys for Gambit option discoveries, NPC unlocks, and quest introductions. Attribute/mastery dots are derived from current unspent points. Mail unread state uses the existing mail read/claim state and remains per message.
3. **Discovery identity.** Use stable keys tied to the source entity and option identity, not translated labels. Gambit dots exist only on newly learned skill/item choices in the Action block's parameter-row select. Condition and Action-type selectors never receive dots. The item option list must contain consumables excluding food; correct the existing item-filter defect as part of integration.
4. **NPC/city visibility.** NPC discovery is acknowledged when selected. A city dot aggregates unacknowledged NPCs but is suppressed while the city tile is fogged. Once revealed, it appears only if an NPC is both currently available and not yet acknowledged. Newly unlocked NPCs in a previously known city create a dot at unlock time.
5. **Quest acknowledgement.** The quest dot is cleared when the player opens the first quest-specific dialogue/action offered by that NPC, regardless of whether that button starts or accepts the quest. Selecting the NPC alone clears only the NPC-discovery acknowledgement.
6. **Mailbox acknowledgement.** Each message has its own dot. Reading alone is insufficient when attachments exist: the dot remains until the message is read and all attached items/currency are claimed.
7. **Browser push event policy.**
   - Inventory full: notify on transition into full, and again only after space is freed and inventory becomes full again.
   - Bliss Stone / Divine Shard discarded because inventory is full: one notification per discarded drop, no aggregation.
   - Level up: one notification only (not one per level).
   - Market sale: one notification per sold item.
   - Party invite: out of scope.
8. **Single pending push slot.** Persist at most one pending event per character. A newly created event replaces the previous pending event while no push delivery is confirmed. The pending event has no TTL. On browser availability, deliver only that latest event; after Service Worker display confirmation, clear it. Do not replay older events. When the push endpoint is reachable, subsequent events are delivered in real time and individually. Use a delivery lease/claim to prevent duplicate concurrent sends, and recover safely from transient push failures without creating a queue.
9. **Display acknowledgement semantics.** A push send response is not proof that the user saw the notification. The Service Worker confirms after invoking the display operation. If display confirmation is lost, delivery must be idempotent by notification ID/tag so a retry replaces rather than duplicates the same notification.
10. **Web Push configuration.** Use VAPID keys from environment/configuration; persist endpoint, public key, auth secret, character ownership, locale, and timestamps. Support multiple subscriptions per character and subscription refresh/unsubscribe. Never store private VAPID key in frontend.
11. **Click behavior.** Include a stable route/action target in payload. Notification click focuses an existing game client or opens the game URL, then routes to the relevant destination (Character progression, Gambits, NPC/quest, or Inbox). If the game is not authenticated, preserve the target until login completes.
12. **Localization.** Store locale with the subscription and use the player's active locale for title/body. Do not infer locale from browser OS if game locale is known.
13. **Security.** Authenticate subscription registration/removal and push confirmation using short-lived scoped tokens or signed identifiers. Validate all user-controlled route targets server-side or use an allowlisted route enum. Protect subscription endpoints with existing auth/rate limiting.
14. **Delivery limitation.** Browser/OS push delivery is best-effort and depends on browser support, notification permission, network, and push service availability. The server can confirm that the Service Worker invoked display, not that the user physically noticed/read it.

## Risks / Trade-offs

- Web Push requires production VAPID configuration, HTTPS, and browser support. Without configured keys, in-game dots still work; browser push setup should report unavailable rather than fail gameplay.
- A single pending slot intentionally loses all but the latest event while no browser is available.
- Multiple devices can each have an active subscription; the pending event is logically one per character and should be delivered to active subscriptions without producing a historical backlog.
- Some browser push services can expire subscriptions; handle 404/410 by deleting invalid subscriptions.
- Quest/NPC unlock conditions are data-driven and must be evaluated from authoritative availability, not just static catalog membership.

## Migration Plan

Add notification acknowledgement and push-subscription persistence through reversible TypeORM migrations. Existing characters start with no acknowledgements; existing unread mail derives its dot from current mail state. No VAPID secret or subscription is seeded. Register the Service Worker only on supported secure origins.
