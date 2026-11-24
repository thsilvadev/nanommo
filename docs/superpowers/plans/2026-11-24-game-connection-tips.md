# Game Connection Tips Implementation Plan

**Goal:** Show a localized fantasy-style gameplay tip after the first successful socket connection, at most once per character per 24 hours.

**Architecture:** A small service owns per-character local storage, cooldown, and non-repeating random selection. The persistent `/play` shell latches the first connected event, waits for CharacterStore identity, and shows a focused modal component.

**Tech Stack:** Angular standalone components/signals, RxJS, Jasmine, CSS.

**Spec:** `docs/superpowers/specs/2026-11-24-game-connection-tips-design.md`

## Constraints and review focus
- One tip per character per 24 hours; no automatic reconnect popups; pt-BR/en-US; no server API/storage; responsive NanoMMO styling.
- Cover already-connected socket state, socket connection before character load, reconnect suppression, malformed/unavailable localStorage, and repeated play mounts within the cooldown.

### Task 1: Tip service and tests
- [ ] Test per-character cooldown, expiry, malformed/unavailable storage, and non-repeating selection; run the focused spec to see it fail.
- [ ] Implement localized tips, `takeTip(characterId)` and `markDismissed(characterId, tipId)`; verify focused tests.

### Task 2: Popup
- [ ] Add accessible responsive modal with themed styling, focus management, Escape dismissal, and close action.

### Task 3: Play integration
- [ ] Latch first socket `connected`, ignore later connections, defer until character ID exists, render in `/play` shell, save dismissal and clean subscriptions.

### Task 4: Verification
- [ ] Run focused specs and frontend build; review keyboard, mobile and locale behavior.
