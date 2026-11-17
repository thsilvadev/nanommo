# Tasks

## 1. Shared status-application contract

- [ ] 1.1 Add typed status application, modifier, duration, chance, and damage-over-time definitions plus optional status defaultApplication to shared types; verify the shared package builds.
- [ ] 1.2 Implement pure shared resolution helpers for source overrides, catalogue defaults, rank-scaled duration, explicit zero/untimed values, and supported DoT formulas; add unit tests for default precedence and formula snapshots.
- [ ] 1.3 Implement shared status-list eligibility and instance construction for stack caps and refresh policy across tick-based and absolute-expiry representations; add tests for stack cap, refresh, and explicit-zero overrides.

## 2. Migrate canonical and mirrored data

- [ ] 2.1 Move retained status defaults into status_effects.defaultApplication, keep stackability/caps/reapplication/polarity canonical, remove violent_shot_slow, and move source-owned Web Pack / Magic Prowess payload values out of status defaults; validate JSON.
- [ ] 2.2 Migrate character skills, passives, monster skills and monster passive hooks in skill_trees.json to the nested statusApplication contract, including Violent Shot, Heavy Swing, Burn, Freeze, Stun, Poison, Bleed, Web Pack and Magic Prowess; remove legacy application fields and validate the source data.
- [ ] 2.3 Migrate tonic effect payloads in items.json to statusApplication with durationTicks and modifiers, removing duplicated tonic modifiers from status_effects; validate JSON.
- [ ] 2.4 Synchronize all three frontend public catalogue mirrors and add/adjust canonical-to-frontend parity assertions.

## 3. Unify combat application and DoT resolution

- [ ] 3.1 Replace the character-skill, monster-skill, passive, push and in-battle item application branches with one BattleEngine statusApplication resolver; verify actor/source and target ownership, stack events, and existing no-roll RNG behavior.
- [ ] 3.2 Move Burn, Poison and Bleed source-specific damage formulas, intervals and duration into application payloads; make DoT ticking consume only resolved per-instance payloads, with deterministic regressions for each source.
- [ ] 3.3 Migrate War Cry, Magic Barrier, rage, Tip of Pain, reflection, Prowess, Magic Prowess and other conditional status producers to the shared instance path without changing their current trigger or payload; add focused regressions for each distinct path.
- [ ] 3.4 Update battle Move Speed, Attack Speed, defense, MATK, barrier and other status consumers to read resolved per-instance modifiers with canonical default fallback for legacy instances; verify stacked and explicit-zero cases.
- [ ] 3.5 Preserve successful-push-only Violent Shot application using canonical slow (12 ticks, multiplier 0.2, flat penalty zero); verify no application when the push cannot move the monster and unchanged push displacement/damage.

## 4. Persistent item use and status presentation

- [ ] 4.1 Route out-of-battle InventoryService status application through the shared resolver/list policy, convert durationTicks to absolute expiresAt using the shared 500 ms tick constant, and preserve existing item consumption/cooldowns; add API regressions for tonic modifiers, refresh, stack cap, and expiry.
- [ ] 4.2 Update status tooltip/default presentation reads to use defaultApplication and add a presentation-only violent_shot_slow-to-slow alias for historical immutable battle logs; test both canonical and legacy timeline data.
- [ ] 4.3 Update SPEC.md and ARCHITECTURE.md to document status identity vs application ownership, DoT snapshots, defaults/overrides, persistence, and the canonical Slow reuse; remove contradictory claims that all durations and penalties belong exclusively to status_effects.json.

## 5. Integration verification

- [ ] 5.1 Run focused status, battle movement, battle distance, item persistence, status timeline, and passive-proc regression tests; investigate and report any pre-existing unrelated failures separately.
- [ ] 5.2 Run shared, API and frontend production builds, catalogue JSON/parity validation, OpenSpec strict validation and git diff --check; confirm no database migration, Docker operation, deployment or commit was performed.
