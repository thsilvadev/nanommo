# Grind Food-Expiry Exit Regression

## Why

On 2026-10-10, character Sauro left Grind and returned to Town roughly two minutes before the active bread buff was expected to expire, despite the observed battle outcomes being wins. The supplied logs show the battle queue reaching zero at 17:58:38 and later Socket.IO disconnect/reconnect events, but they do not contain the authoritative food-expiry timestamp or the Character transition that would prove the exact production path. The implementation does, however, contain a suspicious path in `BattleService.queueBattles()`: it projects food across queued battles, may clear the projected buff when it expires by a future battle's end, then can route the character to Town if no battle is active at the current instant.

This change must first consolidate the cause with deterministic, repeatable regression tests across queue generation, battle resolution, Auto Feed, and the actual Town transition. It must then fix the proven cause so projected future food expiry cannot prematurely change the real Character location.

## What Changes

- Add focused regression tests that reproduce the reported early Town transition from controlled Character, food-expiry, and unresolved-queue state.
- Distinguish projected queue eligibility from the authoritative current food state; projection alone must never send a living character to Town.
- Define and enforce the encounter boundary: the character may start the next battle only if food is valid at that battle's start; if the last food reaches 0m before the next battle can start, the character cannot start that battle and is routed to Town.
- Keep the character grinding while the active food remains valid, including the final minutes/seconds of its duration; do not exit two minutes early or at any other positive remaining duration.
- At the actual food-exhaustion boundary, preserve the established Auto Feed behavior: if Auto Feed can consume an eligible configured Diet food, consume it authoritatively and rebuild the queue; otherwise stop before the next battle and route to Town.
- Preserve death handling, explicit player map transitions, the current battle's immutability, server-authoritative queue timing, map presence synchronization, and coherent Character/Inventory realtime snapshots.
- Update the relevant specification and STATUS evidence after the regression is reproduced and the fix verified.

## Non-goals

- No client timer, polling, heartbeat, or frontend-side fix for gameplay authority.
- No change to food duration, Diet digestion, food item definitions, battle tick duration, encounter-search formula, or Auto Feed eligibility rules except where tests prove a contract defect.
- No new database schema, API endpoint, or dependency unless investigation proves one is strictly required.
- No production deployment in this change.

## Capabilities

### New Capabilities

- `grind-food-continuity`: authoritative food-expiry and Grind-continuation boundary, with regression tests for premature Town transitions.

### Modified Capabilities

- `diet-auto-feed`: ensure Auto Feed gets the opportunity to sustain Grind at the real food-exhaustion boundary without prematurely consuming food.

## Impact

Primary code under investigation: `apps/api/src/modules/battle/battle.service.ts`, especially `queueBattles()`, the resolution path and its Auto Feed / Hungry transition. Related code may include map transition/presence synchronization and battle queue recovery, but must be changed only if the tests identify a causal path. Tests should prefer the existing API/service test harness and avoid depending on real-time two-minute waits.
