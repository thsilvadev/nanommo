# Proposal

## Why

Players could only watch their character wander around a Town. They want to walk it themselves, dance and sit, and see others arrive and leave. The Town has to stay cheap for the server, and especially free for offline and AFK characters. A visual bug also left the map tile tooltip floating over the Town scene after arriving.

## What Changes

- **Click to move.** Clicking the ground walks the character there along the walk grid. Clicking an NPC walks up to it, faces it and opens it as before. 10 s after arriving, the character goes back to wandering on its own. The server snaps the point to the nearest reachable cell, stores one `move` record and broadcasts it once. Every client derives the walk, the pause and the return to wandering from the shared `positionAt`. Clicks closer than 200 ms are ignored.
- **`/dance` and `/sit`** hold the emote where the character is, with no time limit, online or offline. The same command again stops it, and so does a click-to-move. `/sit` sits on a small stool, because the library's sitting clip is a chair pose.
- **Spawn/vanish aura.** A 0.5 s glowing column and ring play where a character appears in or leaves the Town. They are not played for characters already there when the scene opens.
- **Tooltip cleanup.** Leaving the map view (for example, arriving in a Town) removes the map tile tooltip.

## Impact

- Shared: `TownMove`, `TownEmote`, `TOWN_EMOTES`, entry fields `move`/`emote`/`joinedAt`/`rev`, pose states `dance`/`sit`; `positionAt` move and emote segments, `townMoveArrival`, `TOWN_MOVE_SPEED`, `TOWN_MOVE_RESUME_MS`; `TownNav.nearestReachable`.
- API: `TownRosterService.move` and `emote`; `sleep` anchors after an emote; `rev` on every write; `joinedAt` on arrival. Gateway: `town:move` and `town:emote`. No migration; old Redis states stay valid because the new fields are optional.
- Frontend: `TownStore.moveTo`/`emote` (older deltas dropped by `rev`), `/dance` and `/sit` in chat, scene ground and NPC clicks, a move marker, auras, the Dance/SitDown/Sit clips and a stool in `town-character`, and the `MapBoard` tooltip cleanup.
- Assets: `animations.glb` regenerated with `Dance`, `SitDown` and `Sit` from the same CC0 library. The battle rig ignores them.
