# Tasks

## 1. Centralize gameplay map presence
- [x] 1.1 Create PresenceModule as the dedicated presence boundary.
- [x] 1.2 Create MapPresenceService as the single map-membership integration point.
- [x] 1.3 Centralize the active-map predicate (grinding + currentMapId + not deferred Town).
- [x] 1.4 Route map entry/exit through MapPresenceService.
- [x] 1.5 Route death, battle-resolution Town return and queue-generation food-exhaustion exits through MapPresenceService.
- [x] 1.6 Make future encounter-search population use the same active-grinder definition.

## 2. Realtime event flow
- [x] 2.1 Publish map:presence from actual map-membership count changes.
- [x] 2.2 Keep the existing { mapId, playersOnMap } absolute payload.
- [x] 2.3 Keep Socket.IO room delivery unchanged.
- [x] 2.4 Remove the battle-start refresh-map-presence BullMQ job and processor.
- [x] 2.5 Keep reconciliation as a safety/repair mechanism only.

## 3. Redis runtime cache
- [x] 3.1 Keep Redis map hashes with refresh timestamps.
- [x] 3.2 Prune stale members before counting/publishing.
- [x] 3.3 Keep concurrent-refresh protection during stale deletion.
- [x] 3.4 Preserve Redis pub/sub as the cross-process event bridge.

## 4. Online presence boundary
- [x] 4.1 Move online/set-online/set-offline/location state to OnlinePresenceService.
- [x] 4.2 Keep a reusable touch() hook for the future heartbeat.
- [x] 4.3 Do not couple heartbeat/socket-online state to gameplay map presence.

## 5. Regression coverage
- [x] 5.1 Verify entry publishes the new absolute count.
- [x] 5.2 Verify movement A -> B decrements A and increments B.
- [x] 5.3 Verify death/food/Town exits use the centralized sync hook.
- [x] 5.4 Verify deferred Town request removes map presence immediately.
- [x] 5.5 Verify disconnected grinders remain present.
- [x] 5.6 Verify reconciliation repairs missing Redis membership.
- [x] 5.7 Verify stale members are excluded/pruned.
- [x] 5.8 Verify no battle-start presence processor remains.

## 6. Verification
- [x] 6.1 API build.
- [x] 6.2 Map presence regression tests.
- [x] 6.3 Map cleanup regression tests.
- [x] 6.4 Encounter-search regression tests.
- [x] 6.5 git diff --check.
- [ ] 6.6 Live authenticated smoke when the local stack is available.