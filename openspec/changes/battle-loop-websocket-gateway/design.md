# Design

## Context

SPEC.md §3.2 makes the server authoritative: clients send intents and receive facts. SPEC.md §7.4 says the queue is pre-simulated and the resolver applies effects only when a scheduled job fires. SPEC.md §7.5 also allows the same resolver to run during recovery.

The current NanommoGateway contains authentication/presence scaffolding, but its module is commented out and its map handlers directly mutate Character. MapService.enterMap() already owns authoritative map entry: validation, state change, and BattleService.queueBattles(). MapService.leaveMap() owns the town transition.

GatewayService already has Redis publication helpers, but battle resolution does not call them. Redis or Socket.IO must never become a dependency of correctness.

## Decisions

### D1 — Gateway is a transport adapter

NanommoGateway handles authentication, rooms, socket input validation, and event transport. MapService remains responsible for map transitions and BattleService remains responsible for queue creation/resolution.

The socket map:enter handler calls MapService.enterMap() and only after success updates rooms/presence and sends the authoritative queue.

### D2 — Emit from authoritative mutation paths

battle:resolved is emitted only after resolveBattle() successfully claims the row and applies effects.

character:leveledUp is emitted only when that resolve crosses one or more levels. Multiple levels in one resolve produce one event with final level and final points.

character:died is emitted after death state and lastDeathLog are persisted.

battle:queueUpdated is emitted when the live unresolved queue is established or rebuilt/top-up changes it.

### D3 — Publication cannot gate resolution

Event publication must be isolated from gameplay mutation. A Redis or Socket.IO failure is logged and must not abort XP, gold, drops, death, level-up, kill-counter, or queue rebuild logic.

The existing Redis pub/sub bridge may be used for multi-instance delivery; Socket.IO is only the final delivery layer.
## Event ordering

For a normal winning resolve:

1. Claim/apply the battle.
2. Persist character effects.
3. Persist drops and kill counter.
4. If level-up occurred, discard invalid entries and rebuild.
5. Publish battle:resolved.
6. Publish character:leveledUp when applicable.
7. Publish battle:queueUpdated after the final live queue is known.

For death:

1. Claim the battle.
2. Apply consumed items and death state.
3. Persist town/HP/XP/lastDeathLog.
4. Delete remaining unresolved entries/jobs.
5. Publish battle:resolved for the resolved loss.
6. Publish character:died.
7. Do not publish a replacement queue.

### D4 — Character room is the private event boundary

Battle/progression events go to char:<characterId>. Map rooms remain available for presence and future map broadcasts but are not the authority for private battle facts.

### D5 — REST is the resynchronization source of truth

On initial connection/reconnection the client fetches authoritative character state and GET /battles/queue. Missed socket events are not replayed from Redis history.

If a socket event and a REST snapshot disagree, the newer authoritative REST state wins.

### D6 — Payloads use real persisted values

battle:queueUpdated carries the live unresolved BattleQueueEntry[] from the existing queue read path.

battle:resolved carries entryId, outcome, xpGain, goldGain, drops, and persisted characterAfter state.

character:died carries the stored deathLog produced by handleCharacterDeath().

character:leveledUp carries final newLevel and unspentAttributePoints.

## Failure handling

- Invalid/missing JWT or invalid activeSessionId: reject handshake.
- Unknown character: reject/disconnect the connection.
- Invalid map entry: return a socket error without partial state.
- Disconnect: never stop or alter the battle loop.
- Publication failure: log it; never fail the resolver.
- Duplicate resolution: only the successful conditional claim may emit authoritative events.

## Testing strategy

Use the existing committed Node-script style. Verify Socket.IO behavior against the running API and inspect Postgres/Redis where persistence or queue state matters. Include failure injection proving event publication failure does not prevent resolution.
