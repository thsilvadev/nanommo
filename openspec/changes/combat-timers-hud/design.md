# Design

See approved design at docs/superpowers/specs/2026-11-22-combat-timers-hud-design.md.
One shared Angular component renders pure projections from server timestamps and visible events using UiClockService. Successful actions carry their actual cooldown key and tick duration. Public opening snapshots expose only known active timers and corresponding durations; inventory, Gambits and Diet stay private. Existing logs receive metadata from their immutable effective definitions without mutation. Absolute persisted timers remain visible between encounters.
