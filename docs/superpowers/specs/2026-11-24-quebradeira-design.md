# Quebradeira town event + "item obtained" toast — design

> **Name (user, 2026-11-24):** the event is **Quebra-Quebra** in pt-BR and **Smashing Spree** in en-US. Code identifiers use `smashingSpree` / `smashing-spree`; "Quebradeira" below is the old working name.

Date: 2026-11-24. Status: approved by the user 2026-11-24.

> **Amendment (user, 2026-11-24, after the first release):** the event runs **only in Sierra Village** (`map_town`, `townMapId` in `town_events.json`), with **500 vases** for **5 minutes**; announcements name the town. While it runs, players in Sierra hear `new_packs/7/eventMusic.mp3` instead of the town music, joined at the event's elapsed time; at the end the Sierra music returns. 
>
> **Prize table (user, 2026-11-24):** 40 prize vases: 20× Mega Elixir ×20; 2 each of Fontoura, Kombucha, Haste Shot, Çapó ×10; 1 Fairy in a Bottle *or* Sapupema Leaf Tea ×1; 1 Sapupema Leaf Tea ×1 (the only super tonic); 8 Bliss Stone; 2 Divine Shard. Where this conflicts with the text below ("every town", 200 vases, 2 minutes), the amendment wins.

Two independent pieces, built in this order:

1. **Quebradeira** — a twice-daily town event where ceramic vases appear in every town and players break them for prizes.
2. **Item-obtained toast** — a Ragnarok-style single-line notice whenever an item lands in the player's inventory.

Marked *(builder's call)* = decided during brainstorming by Claude, not by the user; correct freely.

---

## 1. Quebradeira

### Intent

A recurring social moment that pulls idle players into the 3D towns at fixed times. It rewards being present, quick and lucky, and gives away a measured amount of consumables and upgrade gems. Late arrivals may still join; they just find fewer vases.

### Goals

- Fires **four times a day: 03:30, 09:30, 15:30 and 21:30**, timezone **America/Sao_Paulo** (user-confirmed).
- Pre-announcements at exactly **30, 15, 5 and 1 minute(s)** before each start (e.g. 09:00, 09:15, 09:25, 09:29, and the equivalents for 03:30, 15:30 and 21:30), plus a "started" announcement at :30.
- Announcements are `server_announce` messages: shown **in yellow** in the chat **System** channel and in the central on-screen notification band.
- At start, **every town** gets **200 vases** (5 towns with 3D scenes: `map_town`, `map_outpost`, `map_kwaioua_taba`, `map_aramaia_city`, `map_emperial_capital_caelum`). Vases live **2 minutes**.
- A vase breaks with **one hit**. **The first hit the server accepts wins** the vase.
- **No per-character prize cap** (user-decided): one fast player may take any number of prizes, gems included. Speed and luck are the point.
- Only characters **present in that town** (`TownRosterService.isTownPresent`) can participate. Nothing stops a grinding player from travelling to town and joining late.
- **Early end per town:** when all 20 prize vases in a town have been broken, that town's remaining vases disappear immediately.
- Attack speed in town is a **general rule of the town environment: at most 1 attack per second** per character. It is unrelated to the battle engine. Only the event enables attacking, and only vases are valid targets.
- The vase looks nice; the breaking animation and sound are satisfying.

### Non-goals

- No combat engine involvement (no `BattleEngine`, no ticks, no gambits, no stats, no damage numbers).
- Attacking players, NPCs or anything except event vases.
- Persisting vases or event state in Postgres; no migration.
- Auto-travel to town / pausing the grind queue for the event.
- Events in maps without a 3D town scene.

### Anti-goals (would make it a failure even if it "works")

- The client can learn which vases hold prizes (prize data must never leave the server until a vase breaks).
- Two players both receive the same vase's prize (double-claim), or a prize is lost/duplicated on retries.
- Hitting from across the map (server must enforce range) or faster than 1/s (server must enforce cooldown).
- Frame-rate collapse from 200 vases plus effects.

### Prize table (per town, per event)

180 empty vases + 20 prize vases:

| Vases | Prize | Item id |
|---|---|---|
| 10 | 20× Mega Elixir | `mega_elixir` |
| 1 | 10× Fontoura | `tonic_fontoura` |
| 1 | 10× Kombucha | `tonic_kombucha` |
| 1 | 10× Haste Shot | `tonic_haste_shot` |
| 1 | 10× Çapó | `tonic_capo` |
| 1 | 1× Fairy in a Bottle **or** 1× Sapupema Leaf Tea (50/50 per town per event) | `fairy_in_a_bottle` / `super_tonic_sapupema_tea` |
| 4 | 1× Bliss Stone | `mat_bliss_stone` |
| 1 | 1× Divine Shard | `mat_divine_shard` |

All of these exist in `items.json` and stack to 20, so each prize fits one inventory slot. The table lives in a root JSON catalogue `town_events.json` (user-confirmed), validated by `DataService` at boot, together with the schedule, vase count, duration and interaction range. It is not mirrored to the frontend: the client does not need it, and the prize layout must stay server-only.

### Approach (chosen: Redis + Bull repeatable scheduler)

Considered:

- **A — Redis state + Bull repeatable jobs (chosen).** Bull and Redis are already in place; Bull repeatable jobs support cron + timezone and run once across API instances. Vases are ephemeral, live 2 minutes, and need an atomic "first hit wins" — Redis `HSETNX` / a Lua script fits exactly. Prize delivery goes into Postgres in a transaction with an idempotency key, like the Market does.
- **B — Postgres tables for events and vases.** Auditable, but needs a migration and heavy write traffic in a 2-minute burst for throwaway data. Rejected.

### Server design

**Scheduling.** A Bull repeatable job (own queue or the existing `battle-queue`, builder decides; a dedicated `town-event` queue is cleaner *(builder's call)*) with cron entries in `America/Sao_Paulo`:
`0,15,25,29 3,9,15,21 * * *` → pre-announce (minutes-left computed from the scheduled time, not wall-clock drift); `30 3,9,15,21 * * *` → start. Start schedules a delayed job at +2 min → end. Handlers are idempotent (Redis `SET NX` on `event:quebradeira:<eventKey>:<phase>`, `eventKey` = scheduled start ISO time), since Bull can redeliver.

**Announcements.** Reuse `ChatService.announceServerMessage` (already emits `channel:'journal', type:'server_announce'` through `gateway:chat:global`). Send a localization key + params alongside the English `message` (e.g. `{ key:'event.quebradeira.soon', params:{ minutes:5 } }`) so the client renders pt/en; the English text is the fallback *(builder's call)*. Optional chat line when someone finds a Bliss Stone or Divine Shard: "X found a Divine Shard in Caelum!" *(builder's call; proposed in conversation, not objected to)*.

**Spawning.** At start, per town: seed = hash(eventKey + mapId) into Mulberry32 (no `Math.random`). Place 200 vases on walkable ground using the town's `TownNav`/`obstacles`, away from NPC spots, POIs and spawn, with a minimum spacing between vases *(builder's call)*. Shuffle the 20 prizes onto 20 vase indices. Store in Redis:

- `event:quebradeira:<eventKey>:<mapId>:vases` — public data (id, x, z, rotation, variant), returned to clients.
- `...:prizes` — hash vaseId → prize (server-only).
- `...:broken` — hash vaseId → characterId, written with `HSETNX` (the "first hit wins" claim).
- `...:prizesLeft` — counter starting at 20.
- All keys expire shortly after the event ends.

Broadcast `town:event:vases { eventKey, mapId, endsAt, vases[] }` to the town room. The roster snapshot / `town:syncRoster` also includes the active vase set (unbroken only), so late joiners and reconnects see the current state.

**Hitting.** New socket message `town:hitVase { vaseId }`. The server checks, in order:

1. Character is town-present in the map that owns the vase; the event is active (`now < endsAt`, not ended early).
2. **Cooldown:** `SET town:attackCd:<characterId> 1 PX 1000 NX` — reject if set. This is the general town attack rule.
3. **Range:** character position from the shared `positionAt(def, nav, entry, now)` is within the interaction range of the vase. "A palm away": the character does **not** need to touch the vase, just be almost there (user). Use ~1.0 world unit from the vase centre (vase radius ~0.3, so the character stands ~0.5–0.7 short of it), tuned to how it looks.
4. **Claim:** `HSETNX broken vaseId characterId` — if 0, reply "already broken".

On success:

- Broadcast `town:event:vaseBroken { vaseId, byCharacterId, at }` to the room (everyone plays the break; the hitter also plays the attack clip).
- If the vase has a prize: decrement `prizesLeft` and grant it *(builder's call, resolving the builder check)*. `InventoryService.addItem` has no idempotency key and there is no grant ledger, so the Redis `HSETNX` claim is the once-only guard: the socket handler is not a Bull job and is not redelivered, so exactly one request ever reaches the grant for a given vase. The grant tries `addItem` into the bag inside a Postgres transaction. If that fails for **any** reason (bag full, DB error), it falls back to `MailService.sendSystemMail` with `sourceKey = quebradeira:<eventKey>:<mapId>:<vaseId>`, which is idempotent. If the mail also fails, write the pending prize to a Redis list `event:quebradeira:pendingGrants` and log an error, so an operator can replay it. No migration. On a bag grant, emit `inventory:obtained` (see part 2) and push the inventory snapshot. On a mail grant, tell the player that the prize went to the mailbox; the toast fires later, when they collect it.
- When `prizesLeft` hits 0: broadcast `town:event:ended { mapId, reason:'all-prizes-found' }`; further hits are rejected.

The prize grant changes inventory, not future combat, so `runFutureCombatMutation` is not required. Consumables affect combat only when used, and the existing paths handle that.

**End.** At +2 min, broadcast `town:event:ended { reason:'timeout' }` for each town still active; Redis keys expire.

### Client design

**Approach and attack.** Clicking a vase in `TownRuntime.pick` (new pick kind `'vase'`) sends `town:move` to a point just short of the vase *(builder's call: a `{ vaseId }` target, like `{ npcId }`, so the server picks the stand point)*. On arrival, the client sends `town:hitVase`. If the player clicks while already in range, it hits immediately. The character faces the vase and plays a **melee attack clip regardless of the equipped weapon** (bows included); the town character currently only has Idle/Walk/Sit/Dead clips, so the attack clip must be added from the character rig's existing attack animations. Hit attempts during the 1 s cooldown are ignored client-side as well (UX only; the server is the authority).

**Vase visual** *(builder's call)*. Procedural three.js `LatheGeometry` terracotta vase (a few shape/colour variants, painted band, soft rim highlight) — no licensing questions. If a sourced free model looks clearly better, follow the asset policy (free only; non-CC0 listed in `UNLICENSED_ASSETS_README.txt`, CC-BY in `CREDITS.md`). Render with `InstancedMesh` per variant so 200 vases cost a few draw calls. Hover highlight + pointer cursor.

**Break effect** *(builder's call)*. Hide the instance; spawn ~10–16 pre-made shard pieces with simple ballistic physics (gravity, spin, bounce once, fade) and a small dust puff; a brief golden sparkle when the vase held a prize (visible to everyone; the prize only becomes known after the break). Short and snappy (≈0.6–1 s).

**Sound** (user-chosen). `project/sons/new_packs/7/potShatter.wav` (16-bit mono 22 kHz; `project/` is gitignored). Copy it to `apps/frontend/public/assets/sounds/pot_shatter.wav`, or convert it to the format the other SFX use. Its license is not recorded next to the file, so add it to `UNLICENSED_ASSETS_README.txt` per the asset policy unless the user supplies the license. Play it through the existing audio service with a slight random pitch per break, and lower the volume with distance from the local character.

**Event lifecycle.** On `town:event:vases` render the set; on `vaseBroken` play the break; on `ended` fade out remaining vases. Disposal on scene teardown.

**Announcements on screen.** `NotificationMessagesComponent` already queues `server_announce` (one at a time, 10 s). Change its colour to **yellow** for `server_announce`, and style `server_announce` rows **yellow** in the chat System channel (today they render as plain journal rows). Verify that the message reaches the System channel filter, and that the on-screen notice still shows when the System checkbox is off *(builder's call: yes, the screen notice is independent of the chat filter)*.

---

## 2. Item-obtained toast

### Intent

Make loot feel good: every time something actually lands in the bag, a short Ragnarok-style line says so.

### Behaviour (user-decided)

- **One box at a time.** It lasts **4 s**. If another item is obtained meanwhile, the new box **replaces** the old one **in the same position with no transition/effect**.
- Look, from the Ragnarok reference: light translucent box, thin border, item icon at left, text "‹Item name› – N obtido(s)." (en: "‹Item name› – N obtained."). Item name coloured by rarity *(builder's call)*.
- Position: centred, around 14vh from the top, **above** the existing notification band (which sits at 27vh), never overlapping it. `pointer-events:none`.

### Sources that show the toast

| Source | Shows? | Server path |
|---|---|---|
| Grind drops (solo) | yes | `BattleService` drop grant (`battle.service.ts` ~1800) |
| Party battle drops | yes *(builder's call: same as grind)* | `shared-battle.service.ts` ~120 |
| Quest rewards | yes *(builder's call: the user's rule is "everything that really lands in the bag" except storage/unequip)* | `quest.service.ts` (writes rows directly, so it needs its own emit after commit) |
| Gathering | yes | `MapService` gather (`map.service.ts` ~872) |
| Quebradeira vase prize | yes | new vase handler |
| Mail attachment collect (includes Market purchases, which arrive by mail) | yes | `MailService.collectAttachments` |
| Crafting / cooking output | yes | `TownService` (`town.service.ts` ~560, ~754) |
| Vendor purchase | yes | `TownService.buyFromVendor` |
| Storage withdraw | **no** | — |
| Unequip | **no** | — |

### Approach (chosen: server emits `inventory:obtained`)

Considered:

- **A — server-side event (chosen).** Each listed path emits `inventory:obtained { items: [{ itemId, quantity }], source }` to the owning character via the gateway, after the transaction commits. The allow-list is explicit on the server, so storage/unequip are excluded naturally, and gains made by background jobs (grind, gathering, crafting completion) show up in any open tab.
- **B — client infers from each response/event.** Less backend work, but gathering only sends an `inventoryAfter` snapshot, which would force diffing. Fragile. Rejected.
- Generic inventory diffing — rejected; it cannot tell storage/unequip from real gains.

### Details

- Multiple items in one event (e.g. a battle with 3 drops, mail with several attachments): they arrive at the same instant, so show **only the first item of the list** (user-decided). The server may still send the whole list.
- Emit only after commit, so a rolled-back transaction never toasts.
- Bull retries of battle resolution must not double-toast (emit only from the first successful claim; `resolveBattle` is already idempotent).
- Offline resolution: no replay of missed toasts on reconnect.
- Toast assets: item icons from the existing catalogue/icon pipeline used by the inventory grid.

---

## Constraints

- Server authority and no `Math.random()` in game logic; Mulberry32 for spawn/prize placement.
- Job handlers idempotent; Bull redelivers.
- Ownership enforced in predicates; JWT carries `userId` only.
- Root JSON is the source of truth; `node scripts/sync-frontend-data.js` if a mirror is added.
- No migrations needed. Never deploy/push to `main` without being asked.
- Project process: OpenSpec change under `openspec/changes/` + `STATUS.md` / `ARCHITECTURE.md` entries.
- UI text localized en/pt.

## Left to the builder

- Exact cron/queue wiring; Redis key layout details; Lua vs `MULTI`.
- Exact interaction range, vase spacing and placement rules.
- Vase shape/variants, shard count, sparkle, sound samples and mix.
- How multi-item events are presented under the one-box rule.
- Localization keys and text.
