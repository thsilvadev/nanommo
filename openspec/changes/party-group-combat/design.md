# Party combat design

The approved implementation plan is `docs/superpowers/plans/2026-11-17-party-group-combat.md`; the approved product design is `docs/superpowers/specs/2026-11-17-party-group-combat-design.md`. Later explicit decisions in the plan take precedence: player rows are `[5]`, `[4,5]`, `[4,5,6]`, `[3,4,5,6]`, `[3,4,5,6,7]`; no graphical arena is delivered; raid rates begin at zero; Fairy preserves level 10 and ten Mystic Dust.

## Authority and persistence

Persist Party, member, invite, action intent, encounter clock, shared battle and participant records. A unique member claim prevents multiple Parties; an active participation claim prevents overlapping battles. PostgreSQL transactions are authoritative. Acquire advisory locks and Character row locks for sorted character IDs, followed by Party, battle, clocks and intents. Reread membership after locking and retry if the roster changed. Redis locks and Bull jobs only optimize/schedule processing.

Invites expire after 60 seconds while offered; accepted requests do not expire. Join only when candidate and all existing members are between battles, on the same map and not teleporting. Keep the Party clock; joining a new Party preserves the future leader's clock. A due encounter wins the boundary, including equality. Pending requests never pause activity.

An intent has a client request ID, per-character sequence, kind, payload and pending/applied/failed/cancelled status; cap pending intents at 32. Execute each mutation and its terminal intent state in one transaction, revalidating eligibility. Reject excess without mutation. A failed intent does not block subsequent work. Preserve absolute cooldown deadlines and gathering accrual. Immutable clocks retain deadline, encounter identity, seed and selected roster through projection rebuilds. Use database time and a reserved cutoff/gate; when completion before the deadline cannot be guaranteed, defer the mutation.

## Simulation and rewards

A version 2 snapshot owns all actor state and seeded PRNG streams, inventories, cooldowns, Diet, statuses and event targets. Grid identity is independent of names; repeated species receive display suffixes in generation order. Replay and simulation are pure. Dead actors do not block cells; resurrection chooses a stable nearest free cell if their old cell became occupied. Movement is cardinal BFS with stable tie breaks; ranged distances use Chebyshev. Gambit candidate predicates apply to the same actor, lowest HP uses HP/maxHP, and KO selection uses seeded randomness.

Each player contributes one principal monster and at most one exclusive raid candidate. Candidate percentages sum to at most 100; the remaining interval yields no additional monster. Initial candidate lists contain the map's species at zero percent, including the principal species to permit duplicate encounters. Hunting fights all. Gathering/Traveling evaluate every living member–aggressive monster evasion pair; any failure includes every selected monster in combat.

One transaction claims a started shared battle, persists every result, consumes individual inventories, gives action-based Mastery, credits living eligible participants and queues next work. Monster XP divides among survivors; integer remainder uses stable participant order. Common drop units choose one eligible recipient and discard on full inventory. Quest drops roll once and copy only to eligible active quest instances. Defeat and successful FLEE give no normal rewards. Publish authorized Socket snapshots only after commit and recover missing work from database state.

## Travel, hunger and compatibility

Manual Party follows the leader's stance/route. AutoParty members remain on the map when the leader travels and the Party dissolves; leaving without a map change transfers leadership through an auditable random choice. Resolve in-battle leaves/deaths at the safe boundary. A hungry member blocks departure from Town with named System feedback to everyone. Outside Town attempt automatic feeding first; unresolved hunger returns that member to their saved Town at the safe boundary.

Manual Fast Travel freezes the leader's savepoint and accrues 10,000 ms of effective casting. Aggressive combat pauses it, victory/FLEE resumes it. An individual departure cancels only that member's teleport unless they are leader; leader departure/death or dissolution cancels all. AutoParty teleport affects only its leader.

Existing V1 entries and their jobs keep the V1 resolver and histories; no active snapshot is rewritten. New V2 output requires rollout gates and appearance validation on every new REST/Socket path. See `docs/party-group-combat-rollout.md` for deployment and rollback gates.

## Alchemy contracts

`super_tonics` maps to shared `item:super_tonic` cooldown of 60 seconds. Fairy keeps `revive_full_cleanse` and self-KO triggering. Tea item `super_tonic_sapupema_tea` uses `revive_ally` with `hpPercent:50, spPercent:50`; the acting player's inventory pays, only KO allies qualify, HP is `max(1,floor(maxHp*0.5))`, SP is `floor(maxSp*0.5)`, and other effects survive. Recipe `sapupema_tea` awards 25 XP, an explicit balancing decision. Leaf `mat_sapupema_leaf` gets weight 10 in Caetê 6; Herbs/Mystic Dust scale from 70/30 to 63/27. Antidote preserves its poison-only cure and uses shared Potion cooldown. Direct self-use rejects ally tea to prevent losing an item without a target.
