# Encounter Search Time and Map Presence

## Why
Grind currently chains battles directly together. The game needs a short encounter-search phase so monster encounters feel spatial and shared with other players on the same map.

## Scope
- Add a server-authoritative encounter search delay before every queued battle: 2 seconds plus 0.1 seconds for each other character currently grinding on that map.
- Preserve the existing 1-second battle tick and deterministic battle simulation.
- Expose realtime map population over the existing Socket.IO /game connection.
- Show "Players in map: X" in the central location header.
- During encounter search, replace the right-panel idle state with the existing battle progress component, animated swords GIF, and search countdown.
- During battle, keep monster HP at the top, remove character HP and battle-duration progress, then show monster status effects and derived stats, followed by existing logs.
- Do not alter the existing central map/grind view or server-authoritative battle outcomes.

## Non-goals
- No change to battle duration formulas.
- No new combat mechanics, status effects, or stat formulas.
- No production deployment.

## Acceptance
- First encounter starts no earlier than now + 2s + 100ms * otherPlayers.
- Every subsequent encounter starts after the previous battle ends plus the current encounter-search delay.
- Other players are counted by authoritative map presence, excluding the searching character.
- Map population updates reach connected players in realtime when a player enters, leaves, or disconnects.
- The location header shows Players in map: X.
- Search state displays project/swords_clash(loading).gif and the same progress-bar component used by battle timing.
- Battle right panel contains monster HP, monster buffs/debuffs, monster derived stats, and existing logs; character HP and battle progress are absent.
- Existing William/Father Marcelus/Town UI is unaffected.
