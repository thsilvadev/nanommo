# Design

## Movement stays a pure function of time

A click does not start a server-side simulation. The server computes where the character is now (`positionAt` on the stored state), resolves the destination and stores:

```
move = { fromX, fromZ, toX, toZ, at, lookAt }
```

`positionAt` then reads it like this:

1. Before `at`: hold at `from`. This covers a client clock slightly behind the server.
2. Walk the cached grid path at `TOWN_MOVE_SPEED` (3 u/s).
3. Stand at `to` for `TOWN_MOVE_RESUME_MS` (10 s), facing `lookAt` when an NPC was clicked.
4. Resume wandering right away from `to`. The first walk heads to the current leg's destination, or, when less than half of that leg is left, to the next leg's (a longer first leg instead of a wait). After that the legs are the plain seed legs.

Nothing has to clear `move` later; it stays inert in the past. Offline and AFK characters cost nothing, exactly as before.

## Emotes and sleep are frozen poses

`emote = { kind, at }` and `sleeping = { at }` both mean "the pose at `at`, held". To keep the held point stable when the old wander state would put the character elsewhere, starting, switching or stopping an emote (and sleeping out of an emote) also writes an anchor `move` from the current point to itself.

## Ordering

The ack and the pub/sub broadcast of the same change race. Two fast clicks could also be delivered out of order. `TownState.rev` grows on every write, and `TownStore` drops a delta older than the entry it already has.

## Effects are local

Auras and the destination marker are client-only visuals. Joins after the scene is populated get an aura. A first roster entry also gets one when its `joinedAt` is under 1.5 s old, which covers the player's own arrival. A removal gets one unless the whole roster emptied (the player left).
