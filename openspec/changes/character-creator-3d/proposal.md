# Proposal

## Why

Characters have no visual identity: the Character Summary portrait shows only the name's initial. A 3D body chosen once, shown in Idle with the equipped hand items, is the foundation for a future arena and for wearing equipment on the model. `sex` is also needed later for gendered PT-BR text, and height becomes a small, permanent build choice (STR/LUK).

## What Changes

- **Data:** nullable `sex`, `height` (band 1–4), `heightCm` (145–205) and `appearance` (jsonb of catalogue indices) on `characters`. NULL `appearance` means the character has not been through the creator.
- **Catalogue:** canonical `appearance_catalog.json` (11 traits — hair, hair colour, skin, face shape, nose, mouth, mouth details, chest, facial hair/eyebrows, piercing, tattoo — 1–8 options each, sex-specific except piercing and tattoo; pt-BR/en-US names), validated at API boot and mirrored to the frontend.
- **API:** `POST /characters` requires the appearance; `POST /characters/appearance` saves it exactly once for older characters. Both apply the one-time height adjustment to base STR/LUK.
- **Rollout:** an offline cutover parks every character in Town and clears battle queues; afterwards a character without appearance cannot perform game actions (`403 APPEARANCE_REQUIRED`) until it goes through the creator.
- **Client:** a 3D creator at `/create-character` (new or existing character) and a 3D Idle portrait in the Character Summary, built with three.js loaded on demand and CC0 assets.

## Capabilities

### New Capabilities

- `character-appearance`: appearance data, catalogue, one-time save, height adjustment, creator and portrait.
- `character-3d-rollout`: action block for characters without appearance, offline cutover and fail-closed startup.

### Modified Capabilities

None.

## Impact

- Migration `1800400000000-CharacterAppearance` (additive, written but not executed).
- New env `CHARACTER_3D_CUTOVER_COMPLETE`, required by the deploy workflow and API startup.
- Frontend dependency `three@0.170.0`; ~1.1 MB of character assets downloaded on first view.
- Design: `docs/superpowers/specs/2026-11-16-criador-personagem-3d-design.md`.
