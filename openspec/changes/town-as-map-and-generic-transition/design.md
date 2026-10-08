# Design

## 1. Domain model

### Canonical location

Introduce one shared constant:

```text
TOWN_MAP_ID = "map_town"
```

Town is a real map/location value, not a null sentinel.

The Character invariant becomes:

- `currentMapId` is always set.
- `currentMapId = map_town` means the character is in Town.
- `status` describes activity/state (for example `town` or `grinding`); it does not describe physical location.
- `currentMapId` is therefore the field future movement systems will mutate.

The static map catalog should include Town as a map entry with an explicit Town marker (for example `isTown: true`). Town remains non-grindable and has no monster pool. Existing grind maps keep their current IDs/rules.

The Grind map selector must continue to render Town through its existing dedicated Town node rather than duplicating Town as an ordinary grind tile.

## 2. Generic deferred transition state

Do not rename `returnToTownAfterBattle` to `isMoving`. "Moving" is too broad: a future movement system may represent pathing/animation without meaning that map membership has already ended.

Use a single atomic nullable `pendingMapTransition` field instead, conceptually:

```json
{
  "destinationMapId": "map_town",
  "reason": "town_request"
}
```

The field means: "the character has a deferred map transition and must no longer count as a member of its current map until the transition is finalized."

The presence service must not inspect `reason`. It only needs to know whether a transition is pending.

Using one transition value instead of separate booleans avoids drift such as:
- `isMoving = false` while a destination is still pending;
- `returnToTownAfterBattle = true` while another subsystem believes the character is available;
- a future movement reason requiring yet another boolean.

The first supported pending transition is the existing active-battle -> Town request. Future movement transitions may extend the transition reason/destination semantics without changing map presence.

## 3. New authoritative presence rule

The generic map-membership rule becomes:

```text
character.currentMapId IS SET
AND character.pendingMapTransition IS NULL
```

This rule deliberately does not inspect `status`.

Consequences:

- a Town character counts on `map_town`;
- a grinding character counts on its grind map;
- a disconnected grinding character still counts;
- a deferred Town-return character is temporarily counted on no map while the active battle finishes;
- death/food exhaustion that completes the move to Town makes the character count on `map_town` immediately after persistence;
- Battle start/end alone never changes map presence.

## 4. Keep encounter population separate

Do not reuse total `playersOnMap` for encounter-search delay.

The search-delay population remains specifically:

```text
status = grinding
AND currentMapId = target grind map
AND pendingMapTransition IS NULL
```

Therefore Town residents can contribute to Town's map population without affecting monster encounter search time anywhere.

This distinction should be represented by separate service methods with explicit names, for example:
- `getActiveMapId()` / `syncCharacter()` for map presence;
- `countActiveGrinders(mapId)` for encounter timing.

## 5. Transition ownership

### Immediate transition

For a normal map change:

1. capture `previousMapId`;
2. mutate authoritative Character state, including the new `currentMapId`;
3. clear `pendingMapTransition`;
4. save PostgreSQL;
5. call `MapPresenceService.syncCharacter(characterId, previousMapId)`.

Examples:
- Town -> Green Grounds;
- Green Grounds -> Menace;
- Green Grounds -> Town.

### Deferred Town request during battle

When the player requests Town during an active battle:

1. keep `currentMapId` on the current map until the battle finishes;
2. set `pendingMapTransition.destinationMapId = map_town` and reason `town_request`;
3. persist the Character;
4. immediately synchronize map presence, removing the character from the old map;
5. cancel future queued battles as today;
6. let the active battle resolve;
7. after resolution, finalize the pending transition by setting:
   - `currentMapId = map_town`;
   - `status = town`;
   - `pendingMapTransition = null`;
8. persist and synchronize presence from old map -> Town.

This preserves the existing gameplay behavior while making the map-membership state generic.

### Death / hunger

Death and no-food routing remain immediate authoritative transitions to Town:

```text
currentMapId = map_town
status = town
pendingMapTransition = null
```

Then the old map is synchronized out and Town is synchronized in.

## 6. Battle boundaries

BattleService may inspect the pending transition when it needs to decide whether Grind continuation is legal, but it must not make that flag the map-presence definition.

Replace current `returnToTownAfterBattle` guards with an explicit pending-transition check. For the current feature, the battle lifecycle only needs to recognize the supported destination `map_town`.

The semantic boundary is:

- MapService owns requesting/finalizing map transitions.
- BattleService owns the rule that an active battle must finish before a deferred Town transition is finalized.
- MapPresenceService owns only map membership.
- Gateway owns socket-room transport.

## 7. Socket.IO room synchronization

Town becoming a real map exposes one existing transport gap: REST and battle resolution can change authoritative `currentMapId` without directly executing a socket room join/leave.

Do not move this responsibility into frontend polling.

Extend the internal Redis event flow with a small server-side membership-transition message, conceptually:

```json
{
  "characterId": "...",
  "previousMapId": "map_green_grounds",
  "nextMapId": "map_town"
}
```

This is an internal gateway message, not a new client gameplay event.

When the gateway receives it for a connected character it:
- leaves the previous `map:{id}` room when applicable;
- joins the next `map:{id}` room when applicable;
- emits a fresh absolute `map:presence` snapshot to that socket after the room change.

`MapPresenceService` remains the owner of membership truth and publishes the transition because it already knows previous/next membership. The gateway remains the transport boundary.

This makes map-room membership work for:
- REST map changes;
- deferred Town completion after battle resolution;
- death;
- hunger/food exhaustion;
- future authoritative movement.

The public `map:presence` contract remains exactly `{ mapId, playersOnMap }`.

## 8. Redis and PostgreSQL

PostgreSQL remains the authoritative Character location/state.

Redis continues to be:
- the ephemeral per-map membership cache;
- the pub/sub bridge for realtime gateway delivery;
- a self-healing optimization repaired by reconciliation.

Reconciliation must use the same generic map-membership rule as `syncCharacter`, so Town residents are also repairable Redis members.

The reconciliation query must no longer filter only `status = grinding` for map presence. The encounter-search query remains status-filtered.

## 9. Static data and API behavior

Add Town to the canonical map catalog with `isTown: true`.

The map-enter endpoint must reject using the generic grind-entry path to "enter Town"; Town is reached by the existing leave/transition-to-Town path.

Recommended maps / grind selection must exclude `isTown`.

`getMonstersInMap(map_town)` must remain empty.

No new NPC system, movement system, pathing, combat rule, or Town gameplay rule is introduced by this change.

## 10. Migration strategy

One migration should:

1. add nullable `pendingMapTransition` JSONB;
2. translate any legacy `returnToTownAfterBattle = true` rows into a Town pending transition before dropping the legacy column;
3. backfill every NULL `currentMapId` to `map_town`;
4. make `currentMapId` NOT NULL with default `map_town`;
5. drop `returnToTownAfterBattle`.

The down migration should restore the old nullable `currentMapId` representation and translate any supported Town pending transition back to the legacy boolean before removing the new field.

The migration must be safe for existing data, including a live deferred Town-return row.

## 11. Frontend contract

Change the frontend Character model so `currentMapId` is required, not optional.

Remove frontend fallbacks that interpret missing `currentMapId` as Town.

Examples of intended replacements:
- `isTown() => currentMapId === TOWN_MAP_ID`;
- `mapName()` resolves Town through the canonical map ID;
- Town's `playersInMap` is rendered because Town now has a real map ID;
- the map header can show `Players in map: N` while in Town;
- no local patch should write `currentMapId: undefined`.

Keep all existing layout, panel geometry, borders, colors, and desktop/mobile composition unchanged.

## 12. Failure handling

- A socket disconnect never removes gameplay map membership.
- A Redis membership loss is repaired by reconciliation.
- A missed realtime event is corrected by the next absolute snapshot or reconnect snapshot.
- A transition-room event for a disconnected character has no socket action; authoritative state remains correct and reconnect reconciliation places the socket in the right room.
- The gateway must never infer gameplay location from socket connection state.

## 13. Non-goals

- No actual walking/pathing/movement gameplay implementation.
- No map graph/pathfinding.
- No friend/online-list heartbeat implementation.
- No change to battle duration, search delay formula, monster selection, or rewards.
- No change to `map:presence` payload shape.
- No new Town NPC/gameplay feature.
- No frontend polling for map population.
