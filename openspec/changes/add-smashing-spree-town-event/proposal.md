# Smashing Spree (Quebra-Quebra) town event + item-obtained toast

## Why

Idle players rarely meet in the 3D towns. A short, scheduled, server-run event gives them a reason to gather at fixed times and rewards being present, quick and lucky. Separately, loot currently lands in the bag silently; a single Ragnarok-style "item obtained" line makes gains visible.

Design: `docs/superpowers/specs/2026-11-24-quebradeira-design.md`. Plan: `docs/superpowers/plans/2026-11-24-quebradeira.md`.

## Scope

1. `town_events.json` catalogue (schedule, vase count, range, cooldown, prize table), validated at boot, not mirrored to the frontend.
2. Per-minute Bull repeatable tick (America/Sao_Paulo) that runs announce/start/end phases idempotently.
3. Redis-only event state: public vase layout, server-only prize map, atomic first-hit claim, early end per town.
4. Socket intents `town:hitVase` and `town:move { vaseId }`; town broadcasts `town:event:vases|vaseBroken|ended`; roster sync carries the live event.
5. Prize grant to the bag, falling back to idempotent system mail, then to a Redis pending list.
6. Three.js vases, break effect, melee attack clip and shatter sound in the town scene.
7. Yellow, localized `server_announce` messages in chat and on screen.
8. `inventory:obtained` socket event from every real inventory-gain path, and a single replace-in-place toast.

## Amendment (user, 2026-11-24)

Sierra Village only (`townMapId: map_town`), 500 vases, 40 prize vases, 5 minutes; announcements say where; event music in Sierra while the event runs (`project/sons/new_packs/7/eventMusic.mp3`).

## Non-goals

- No battle-engine involvement, no migrations, no events outside 3D towns, no auto-travel to town, no per-character prize cap.
- No deployment.
