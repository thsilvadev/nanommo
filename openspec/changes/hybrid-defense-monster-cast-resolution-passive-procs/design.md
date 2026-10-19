# Design

## Decisions

### Hybrid physical DEF

For non-negative raw damage `D` and non-negative `DEF` `A`:

```text
flatReduction = 0.225 × A
relativeReduction = D × A / (A + 250)
finalDamage = max(0.01 × D, D - flatReduction - relativeReduction)
```

The flat term makes low-DEF investments visible immediately; the relative term causes reduction to scale with incoming hit size. The 1% floor avoids total physical immunity. The values are NanoMMO balancing parameters inspired by the desired flat-plus-relative behavior, not a copy of the Dota equation. The same shared method is used by character and monster physical attacks; magic MDEF is not changed. Final direct-damage variance/rounding stays in its existing location.

### Deterministic monster casts

There is one optional pending cast `{ skillId, castStartedAtTick, resolutionTick }`. On each tick without a pending cast, evaluate the canonical monster Cast Gambit and let its first legal `use_skill` begin immediately once in range. Normalize `baseCastTicks` to a non-negative whole tick count; absent catalog values use the former six-tick duration. A duration `N > 0` selected at T resolves at T+N; a zero-duration action resolves at T. Hold/reset the monster basic-Attack gauge from cast start through resolution. At resolution apply the existing effect, SP cost and cooldown exactly once. A zero-cooldown skill that remains the selected legal cast may begin its next pending cast at the resolution boundary, but never resolves a second effect on that same tick; this preserves Ice Bolt's T2/T4/T6 cadence. Player CTR, equipment and mastery are not inputs.

Out-of-range targeted monster skills set the existing approach intent and do not start a cast. A cast already accepted is not cancelled by a later Gambit condition change. Existing catalog-driven effect math/status/RNG remains in one resolution block.

### Passive proc and log visibility

`applyStatus()` marks `sourceSkillId === 'shield_bash'` status events with `passiveProc: true`. The proc remains a status event emitted after the incoming monster attack and doesn't create a new player action, gauge use, cooldown or Gambit evaluation. Both frontend log surfaces format its stun as `<target> is stunned by Shield Bash.` regardless of whether the event is newly generated or persisted from an older battle. New simulator logs do not emit `action_suppressed`; both frontends also filter this action for stored older logs. No change to stun's existing target-side effect is intended.

## Verification

Run shared/API/frontend production builds, focused DEF/monster-cast/Shield-Bash test, battle-distance movement regression, mastery-skill simulator regression, strict OpenSpec validation and `git diff --check`. Do not migrate or deploy.
