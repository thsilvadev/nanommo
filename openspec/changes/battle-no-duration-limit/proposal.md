# Battle Has No Duration Limit

## Why

The authoritative Battle Engine specification says simulation continues until a combatant reaches 0 HP, but the implementation added an undocumented 200-tick safety cap. When the cap was reached, the loop stopped and the fallback outcome classified the battle as a character loss even if both combatants still had HP. This creates a false defeat based only on elapsed duration.

## What Changes

- Remove `BattleEngine.MAX_TICKS`, the `maxTicks` simulation option, and the loop condition that stops at a tick count.
- Continue deterministic simulation until a combatant reaches 0 HP. A battle's duration is the number of ticks actually simulated, not a limit or defeat condition.
- Preserve the existing queue architecture: the engine still computes `durationTicks`, and BattleService still derives `startAt`/`endAt` and schedules resolution from that actual duration.
- Add regression coverage proving a battle continues beyond the former 200-tick threshold and ends with the actual combat outcome.
- Explicitly document that `FLEE` is a future termination mechanism and is not implemented by this change.

## Non-Goals

- No changes to attack, defense, hit chance, regeneration, gambits, battle queue depth, or queue scheduling.
- No artificial draw, timeout, or forced-loss fallback.
- No production deployment.

## Acceptance

1. The battle loop has no max-tick/duration cutoff.
2. A character is never defeated solely because a battle lasted a particular number of ticks.
3. `durationTicks` continues to drive the queue's actual `endAt` timestamp.
4. A deterministic regression battle runs past 200 ticks and wins only when the monster reaches 0 HP.
5. Shared/API builds, focused tests, strict OpenSpec validation, and `git diff --check` pass.
