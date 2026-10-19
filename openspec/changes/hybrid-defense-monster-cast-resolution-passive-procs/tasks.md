# Tasks

- [x] 1.1 Implement hybrid flat + relative physical DEF mitigation with non-negative input clamps and a 10% raw-damage floor.
- [x] 1.2 Replace monster cast-gauge-as-duration behavior with a deterministic pending cast resolved at the catalog `baseCastTicks`, defaulting to six when absent.
- [x] 1.3 Pause monster basic attacks during casting; preserve SP/cooldown at resolution and the zero-cooldown Ice Bolt repeat cadence.
- [x] 1.4 Stop emitting `action_suppressed`; filter old persisted instances from Grind and Battle History.
- [x] 1.5 Mark Shield Bash stun as a passive proc and format it as `<target> is stunned by Shield Bash.` in both log surfaces.
- [x] 1.6 Align SPEC.md and its canonical mirror, ARCHITECTURE.md and STATUS.md with implemented behavior.
- [x] 1.7 Add deterministic regression coverage for DEF values/floor, monster four-tick casting, no attacks during a cast and passive Shield Bash metadata.
- [x] 1.8 Run shared/API/frontend builds, focused combat regressions, strict OpenSpec validation and `git diff --check`.
