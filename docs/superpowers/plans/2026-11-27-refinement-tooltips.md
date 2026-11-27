# Refinement tooltip presentation

**Approved scope:** keep existing gameplay bonuses, including rolled bonuses from +7. Show original values followed by accumulated refinement in parentheses, remove “(rolled)”, color rolled attributes light silver and rolled stats mango orange. Preserve tier identity, progressively strengthen/warm titles at +10/+11/+12, and give +12 a barely perceptible vibration.

**Architecture:** keep presentation in CatalogService and shared tooltip CSS. Read original rolled values from persisted refinementBaseRolledValue/refinementBaseRolledStatValue; never add a bonus again to the already-refined stored total. Legacy instances without a saved base show their known total without inventing a breakdown. Preserve off-hand rounding and comparisons. No API or database changes.

**Implementation plan (inline):**
- [x] Add failing catalog tests for native and rolled breakdowns, legacy metadata, percentages, off-hand rounding, and tier/refinement boundaries.
- [x] Implement presentation helpers and update tooltip consumers (inventory, equipped gear, vendor, storage, mail, crafting, market).
- [x] Add title palettes and subtle +12 motion with reduced-motion support; verify actual floating-tooltip styling in browser tests.
- [x] Run focused tests, frontend production build, and review the complete diff. Record results in STATUS.md.

**Visual decisions:** preserve pastel/green/blue/purple tier hues. Use silver #dce3eb and mango #ffb347 for rolled lines. Use a subpixel translation for +12 only; no animation of layout properties. Keep tier-5 compatibility. Apply title effects only to displayed tooltips so hidden inventory details do not animate.

**Review focus:** no double-counted rolls; no guessed legacy base; off-hand totals retain rounding; all instance-bearing tooltip titles receive instance data; motion disabled by prefers-reduced-motion.

**Verification:** 43/43 focused Chromium tests pass; production Angular build passes with size-budget warnings. A browser preview checked all 16 T1–T4 / +9–+12 combinations and disabled +12 animation under reduced motion. Full frontend suite did not complete: arena-performance exceeded its 0.15 ms threshold (0.158 ms); TownRuntime warmTownAssets timed out; browser disconnected at 468/718 tests.

**Review:** independent review found crafting defaults overriding tier colors below +10. Reproduced with a failing computed-style test, then fixed the default selector and verified green. Refiner detail tooltips now read the actual instance by preview.inventoryItemId.
