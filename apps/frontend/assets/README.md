# NanoMMO UI assets

This folder is intentionally dependency-free.

## Recommended Angular usage

The project stack is Angular standalone + Tailwind + Angular CDK. Angular itself does
not ship a fantasy icon library. Do **not** add Angular Material solely for icons.

Preferred order:
1. Use the SVG files in `ui/` for fixed assets with `<img>`.
2. For icons that need dynamic CSS color/hover state, inline the same SVG paths in a
   small `IconComponent` or use the provided `icons.svg` symbol source with `<svg><use>`.
3. Use CSS/Tailwind for borders, glows, bars, shadows, panel surfaces and state colors.
4. Only add a third-party icon library if a future screen has a demonstrated need for
   a large dynamic icon vocabulary.

## Visual concepts

`concepts/play-window-concept.png` is the target composition reference for `/play`.
`concepts/character-window-concept.png` is the target composition reference for
`/play/character`.
`reference/original-reference.png` is the original user-provided reference image.

The concept PNGs are references, not a reason to hard-code the screenshot as one image.
The Angular implementation must remain semantic, responsive and data-driven.
