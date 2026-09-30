# Proposal

## Why

The current play/character UI is functionally in place, but the latest visual pass exposed
layout duplication, oversized inventory cells, stale weapon-proficiency presentation, and
gambit alignment issues. The next pass should polish the existing game UI without changing
the battle contracts.

## Scope

1. Remove the redundant lower map selector/list from the grind screen.
2. Compact the 50 inventory cells so all 50 fit without vertical scrolling.
3. Render Character equipment icons white/light.
4. Replace the standalone Weapon Proficiency right panel with one large contextual Info Panel.
5. Replace Character `Equipment` tab with `Mastery`; add the Weapons list and empty mastery tree.
6. Show the active Gambit page title above the XP bar.
7. Character tab contains only Attributes and Derived Stats.
8. Polish Gambit value controls.
9. Rebuild Gambit line layout with conditions above action and a minimal enabled switch.
10. Replace the navbar `NANOMMO online` wordmark with `assets/lords.png`.

## Reference

- `SPEC.md` is authoritative for the updated product contract.
- `project/image.png` is the visual reference for the Gambit row composition.
- Existing item/equipment icons remain the source assets.
- Do not replace the dark-fantasy visual language.

## Important compatibility rule

When `PLAY_WINDOW_SPEC.md` or `FRONTEND_SPEC.md` conflicts with this change or the updated
`SPEC.md`, this OpenSpec change wins for the affected UI. Do not reintroduce the old
Equipment tab, duplicate map strip, bottom weapon-proficiency panel, Paper Doll/Build Summary
inside Character tab, or large inventory grid.

## Non-goals

- No weapon XP/proficiency progression implementation.
- No new battle mechanics.
- No changes to derived-stat formulas.
- No replacement of the existing item icon pack.
- No client-authoritative gameplay logic.

## Acceptance

- Grind has one central map selector and no duplicate map strip below it.
- All 50 inventory cells are visible in the intended desktop layout without vertical scroll.
- Character equipment icons are white/light.
- Right side is one contextual Info Panel.
- Character tabs are Character, Gambits, Mastery.
- Mastery has left empty skill-tree workspace and right Weapons list.
- Active Gambit title is above the XP bar.
- Character tab only contains Attributes and Derived Stats.
- Gambit rows match the requested two-level composition and minimal switch.
- Navbar uses `assets/lords.png`.
- Shared/API/frontend builds and OpenSpec strict validation pass.