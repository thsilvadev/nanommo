# Proposal

## Why

The former physical DEF curve gives only about 1.4 damage reduction from 10 DEF against a 44-damage hit, making defensive equipment and War Cry's +10 DEF difficult to feel. Monster casts also resolve immediately after a gauge threshold rather than respecting their declared `baseCastTicks`, and combat logs expose internal action suppression and mislabel the Shield Bash passive proc as a character action.

## What Changes

- Replace physical mitigation with a tuned hybrid of flat and relative reduction: `max(raw × 0.01, raw - 0.225 × DEF - raw × DEF / (DEF + 250))` after clamping raw damage and DEF to zero. Magic mitigation is unchanged.
- Give monsters a minimal deterministic pending-cast state. A legal in-range Cast-Gambit skill begins casting immediately; its catalog `baseCastTicks` is the actual duration, defaulting to the legacy six ticks when absent. Pause basic attacks until resolution; pay SP and start cooldown at resolution. Keep zero-cooldown repeat casts on their established boundary timing.
- Stop emitting `action_suppressed` battle events and hide such legacy events from Grind and Battle History.
- Mark Shield Bash stun as a passive proc, format it as `<target> is stunned by Shield Bash.`, and ensure it is not interpreted as a character action.
- Preserve current player Attack-vs-Cast/poison action priority behavior; potion scheduling is explicitly out of scope for this change.

## Capabilities

### Modified Capabilities

- `combat-resolution`: physical DEF balance, monster cast lifecycle, and passive status/log event ownership.

## Impact

Shared battle engine, frontend Grind/Battle History log presentation, root and canonical SPEC copies, ARCHITECTURE.md, STATUS.md, and deterministic combat regressions. No database schema or migration is needed. No database mutation or deployment.
