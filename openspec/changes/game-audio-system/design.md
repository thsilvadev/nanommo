# Design: Game Audio System

## Frontend boundaries

- `GameAudioService` owns short sound playback, the active regional music element, playlist progression, transition fades, and audio-control state for the gameplay header.
- `PlayComponent` starts the service once the gameplay shell mounts and destroys it when leaving gameplay, preventing regional music/timers from leaking into authentication routes.
- `LoginMusicService` remains the login-only music owner. A successful transition to gameplay fades it out and invalidates pending gesture-retry listeners. The header control in gameplay uses `GameAudioService`, not login music.
- `VendorStore` emits quest/NPC/refinement sounds only after the corresponding API response confirms the action. `InventoryStore` emits the food sound only after a successful server-backed consumable response.

## Music selection and timing

- Canonical map IDs select a named region; numbered map suffixes do not select individual tracks.
- The active playlist advances in filename order, loops after its final track, and is not restarted by movement between maps in the same region.
- A region transition fades out the old audio element before starting the next region's first track with fade-in. Unknown/unmapped regions stop the current regional track.

## Battle event timing

- The service reads the active immutable queue entry's `log.events`, compares event ticks with elapsed wall-clock ticks from `startAt`, and remembers the last processed event index per entry to avoid replaying the same event during polling.
- Weapon and skill sounds are chosen from event actor/target, skill ID, damage type and the character snapshot's equipped weapon categories.
- Monster incoming-hit sounds are explicitly limited to `actor === 'monster'` and `target === 'character'`; future PvP event ownership can be handled separately.
- Drops are handled from `battle:resolved` data, so Bliss Stone/Divine Shard audio only occurs after the server confirms the result.

## Authority and failure handling

- Sound playback never changes gameplay state or makes an action authoritative.
- Failed requests do not play quest acceptance/completion, refinement result or Father Marcelus healing audio.
- Browser autoplay rejection is caught. Regional music retries after a user gesture; login retry listeners are removed when login music is stopped.

## Verification

- Frontend production build, OpenSpec validation, and `git diff --check` pass.
- Karma test bundles compile, but this workstation lacks a ChromeHeadless binary, so browser test execution remains an environment limitation.

## Follow-up: interrupted regional transition and new effects

Regional fades now resolve their pending animation promise when a transition is superseded, so rapid intermediate map changes (including a saved-town teleport en route to the selected destination) cannot leave the next region waiting on a cancelled fade. When the map remains in the same region but its audio element is unexpectedly absent or paused, the service attempts to resume/restart that region's playlist.

- potion_drink.mp3 plays after a successful potion/elixir consumable action, and for potion-use events in battle logs.
- flee.mp3 plays only after the battle-resolution event confirms cancellationReason === 'flee'.
