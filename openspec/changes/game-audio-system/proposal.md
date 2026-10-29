# Game audio system

## Why

Gameplay currently has login music but lacks a unified event-driven audio layer. Sound must be synchronized to actual battle results and confirmed quest/refinement actions, while regional music should transition cleanly and never leak into the next region.

## What Changes

- Add a frontend audio service for regional looping playlists, cross-region fades, and short gameplay effects.
- Play the region's tracks in filename order (region.mp3, region_2.mp3, region_3.mp3) while the character stays anywhere in that region.
- Trigger battle sounds from the authoritative battle event timeline; distinguish monster damage to the character from character damage to a monster.
- Trigger quest/refinement sounds only after successful server responses, and only play NPC quest dialogue audio after an explicit quest interaction.
- Trigger food, level-up, Bliss Stone/Divine Shard drop, poison, and Father Marcelus healing sounds at their actual events.
- Prevent login music's deferred autoplay retry from restarting it after leaving the login screen.

## Non-Goals

- Do not use Hit Sound Effect Ragnarok Online.mp3 or hit_1.mp3.
- Do not alter battle simulation, drop chances, quest authority, item use rules, or server APIs.
- Do not introduce PvP-specific audio behavior; monster-hit audio is explicitly keyed to actor === monster.

## Decisions

- Music regions are derived from canonical map ID prefixes, not numbered map suffixes.
- Music changes fade the current track out and fade the next track in; each playlist advances sequentially and repeats.
- Sound effects are presentation-only and are never used as evidence that a server action succeeded.
