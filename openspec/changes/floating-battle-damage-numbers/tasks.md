# Tasks

## 1. Shared damage feedback controller

- [x] 1.1 Implement a focused presentation helper that advances through immutable battle-log events once per current tick and skips historical events on initial mount; verified cursor follows the same elapsed-tick/event-index model as battle audio.
- [x] 1.2 Implement event eligibility and styling classification for positive character/monster damage, criticals, burn/general DoT, poison, and bleed; added table-driven unit tests covering misses and fully absorbed hits.
- [x] 1.3 Implement transient overlay creation, deterministic collision offsets, parabolic outward animation, and cleanup; active numbers have animation-end and bounded timeout cleanup, with pending timers cleared when the directive is destroyed or the battle changes.

## 2. Character and monster feedback anchors

- [x] 2.1 Attach a positioned feedback overlay and brief red flash to the character portrait; verified Angular production compilation and that the portrait's layout structure is unchanged.
- [x] 2.2 Attach feedback to the monster sprite with an alpha-preserving white flash; the filter is applied to `.foe-sprite` itself, not its rectangular wrapper.
- [x] 2.3 Apply the required visual tokens for ordinary numbers, critical numbers (yellow, 60% larger, thicker black outline), orange DoT, dark-green poison, and brighter-red bleed; CSS uses 25px base and 40px critical text.

## 3. Integration and documentation

- [ ] 3.1 Execute frontend unit tests for event timing, target mapping, styling, multiple simultaneous events, and lifecycle cleanup in a browser. Tests were added and the Angular test bundle compiles, but ChromeHeadless could not launch because no Chrome binary/`CHROME_BIN` is available on this machine.
- [x] 3.2 Update root `SPEC.md`, `ARCHITECTURE.md`, and `STATUS.md` to document the resulting contract and implementation outcome; documentation matches the implemented presentation behavior.
- [x] 3.3 Run OpenSpec validation, frontend production build, and `git diff --check`; all three passed. No server/database/deployment actions were taken.
