# Proposal

## Why

The current /play shell is desktop-first: below 900px it simply hides the character and grind panels, removes the compact XP display, and leaves the player without an intentional mobile game cockpit. This change adds a parallel touch-first shell while preserving the existing desktop composition and server-authoritative game contracts.

## What Changes

- Add an intentional mobile /play shell for widths below 900px with a fixed header, five-tab bottom navigation, full-screen character backdrop, and an overlaid grind/town bottom sheet.
- Add three persisted sheet detents (10%, 50%, 90%) with separate defaults and persistence for grind and town contexts.
- Add exact mobile routes `/play/m/battle`, `/play/m/map`, `/play/m/items`, `/play/m/gambits`, and `/play/m/character`; preserve desktop `/play/grind`, `/play/character`, and `/play/gambits`. At viewport >=900px, `/play/m/*` redirects to the equivalent desktop route, while mobile `/play/grind` acts as the Battle alias.
- Add touch-safe item actions through a large action sheet instead of double-click or CDK drag/drop.
- Add a complete per-battle mobile event log with safe auto-follow behavior.
- Add mobile menu/settings surfaces, including volume and account deletion, while keeping Chat as the existing mock.
- Add shared viewport/format/ticker/preferences infrastructure to prevent duplicated timers, formatting logic, and ad-hoc touch detection; the shared ticker pauses while the document is hidden.
- Keep all gameplay outcomes, inventory authority, food/diet state, battle calculations, and server contracts unchanged.

## Capabilities

### New Capabilities
- mobile-responsive-shell: Defines the touch-first /play shell, navigation, responsive presentation, sheet behavior, mobile item interactions, and mobile battle/town presentation.

### Modified Capabilities
- None. The project currently has no registered OpenSpec capability specs; the repository-level SPEC.md and PLAY_WINDOW_SPEC.md remain the authoritative product contracts.

## Impact

- Frontend Angular routing, Play shell components, mobile-only components and styles, shared formatting/timing/viewport services, and touch interaction gates.
- No backend, database, API, Socket.IO, combat, or persistence contract changes.
- No new external dependency; Angular CDK already exists in the frontend.