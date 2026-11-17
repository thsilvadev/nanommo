# Design

## Context

The current status definition is loaded from canonical status_effects.json and mirrored to the frontend. BattleEngine has a generic status instance helper, but monster offensive skills implement a separate inline application path, character offensive skills implement their own chance/stack checks, passive effects and push effects have additional call sites, and InventoryService persists tonic statuses independently. Item and status catalogues also duplicate tonic modifiers. DoT behavior is partly embedded in status definitions and partly hardcoded by status ID in BattleEngine.

Battle status instances use tick-based expiresAtTick values; Character.statusEffects persisted outside battle use absolute expiresAt timestamps. BattleService converts between these formats when building later queued snapshots and committing checkpoints. Runtime instance values therefore need to be fully resolved when applied and carried unchanged across that boundary.

## Goals / Non-Goals

**Goals:**

- One typed application payload for status-producing skills, passive effects, monster abilities and consumables.
- One shared resolver for defaults, per-source overrides, duration, modifiers and DoT payload.
- One combat application path for stack caps, refresh rules, chance/RNG behavior and source/target event semantics.
- Reuse the same payload resolution for out-of-battle item use while preserving absolute expiry and existing cooldown/consumption behavior.
- Remove the Violent Shot duplicate status ID and move source-specific DoT values to the source that applies them.
- Keep runtime status instances self-contained so queued battles and persisted statuses do not depend on a later catalogue reload to reconstruct their values.

**Non-Goals:**

- Changing any current chance, duration, damage, movement penalty, status stack cap or reapplication result.
- Reworking the frontend status icon set or redesigning the status UI.
- Changing the existing item cooldown, consumption, battle-queue or flee rules.
- Adding new combat actions, status types, database columns or migrations.
- Replacing status-specific intrinsic mechanics such as Tip of Pain's next-basic-attack behavior with a generic scripting system.

## Decisions

### 1. Split canonical status identity from a source-owned application

Keep the canonical status catalogue responsible for:
- stable status ID and display name;
- polarity;
- stackable / non-stackable behavior;
- maxStacks;
- reapplication policy;
- optional default application values for callers that intentionally rely on a standard application;
- status-intrinsic behavior that defines what the status itself means (for example Tip of Pain's consume-on-next-basic-attack flags).

Each source declares a nested statusApplication payload at the effect that causes the status. The normalized payload is:

```json
{
  "statusId": "slow",
  "trigger": "successful_push",
  "chance": 1,
  "durationTicks": 12,
  "modifiers": {
    "moveSpeedPenalty": 0,
    "moveSpeedMultiplier": 0.2
  }
}
```

The equivalent payload is placed under skill/item effect data; passive hook records use the same payload shape inside their own effect entry. The ID stays canonical and is validated against status_effects.json. Legacy parallel fields (applyStatus, statusChance, statusDurationTicks, statusDurationTicksByRank, targetDebuffOnSuccessfulPush, targetDebuffDurationTicks, targetMoveSpeedMultiplier and status-specific burn/poison/bleed payload fields) are migrated and removed where they duplicate statusApplication.

### 2. Keep status defaults, but make their role explicit

Move catalog defaults into an optional defaultApplication object rather than leaving a mixture of default payload fields at the top level. Example:

```json
{
  "id": "slow",
  "name": "Slow",
  "stackable": false,
  "maxStacks": 1,
  "reapplication": "refresh",
  "polarity": "debuff",
  "defaultApplication": {
    "durationTicks": 40,
    "modifiers": { "moveSpeedPenalty": 50 }
  }
}
```

Resolution order is:
1. application payload explicitly authored on the source;
2. the canonical status defaultApplication;
3. no value / no expiry for optional properties without either source.

Application values replace matching default keys; they are not added to them. This is essential for Violent Shot: explicitly setting moveSpeedPenalty to zero suppresses Slow's default flat penalty while moveSpeedMultiplier 0.2 applies the 80% reduction. Preserve explicit zero by checking property presence rather than using nullish/falsy fallback. durationTicks: 0 is an explicit untimed duration and must not fall back to a positive default. Structural rules (maxStacks, stackability and refresh) are never overridden by an application.

### 3. Use one typed data shape for modifiers and damage-over-time

Add shared types for StatusApplicationDefinition, resolved application values, status modifiers, and DoT payloads. Modifiers are a typed dictionary of the status fields already consumed by the game (including movement and attack speed penalties/multipliers, DEF/MDEF/ATK/MATK bonuses, cast-time modifiers, barrier capacity and other existing per-instance status mechanics).

DoT is an optional application payload with:
- a numeric amount or a supported deterministic formula;
- optional rank scaling for flat base amounts;
- intervalTicks;
- damageType (pure or magic for current DoTs).

The initial supported formula identifiers cover the actual catalogue needs: source_matk_div_5 (Burn), source_matk_div_2 (Poison). Bleed uses a flat base amount of 5 scaled by Swordsmanship rank; Opening Spear uses a flat 5 per stack. Resolve formulas once at application time from the applying combatant and store damagePerTick, damageIntervalTicks, damageType and nextDamageAtTick on each runtime instance. Do not re-read source stats on later DoT ticks. Keep per-stack payload/timing independent.

### 4. Centralize resolution and combat application

Add pure shared helpers (in a focused shared status-effects module) to:
- select durationTicks or durationTicksByRank while preserving explicit zero;
- merge source modifiers over status defaults;
- resolve the supported DoT amount/formula using source stats and rank;
- create a flattened runtime status instance from the resolved payload;
- apply stackability, maxStacks and refresh rules to an existing list for both tick-based combat instances and absolute-expiry persistent instances.

BattleEngine retains seeded RNG and event logging, but a single applyStatusApplication path owns:
- resolving the status ID and definition;
- checking whether the instance can be added/refreshed before consuming RNG;
- calculating chance (chance or chancePerRank and Save Butt Luck where configured);
- creating the resolved instance;
- emitting status_applied / status_stack_applied / status_refreshed with actor, target, source skill/item and duration.

Character active skills, monster active skills, passive procs, status-on-basic-attack hooks, and in-battle item use call this same path. Call sites remain responsible only for deciding that their action/proc occurred and selecting the target. The special successful_push trigger is evaluated only after the lane position actually changes; blocked pushes do not call the resolver.

### 5. Reuse resolution for out-of-battle item application

InventoryService uses the same shared pure resolver and status-list policy with an absolute timestamp. Item status payloads use durationTicks as the canonical unit; convert to milliseconds using DEFAULT_BATTLE_TICK_DURATION_MS when writing expiresAt. Keep resolved modifier fields flattened on the persisted Character status instance, matching the current DTO/world-speed contract. Do not store only a status ID and expect later catalogue lookup to reconstruct source-specific values.

This preserves the existing statusEffects JSON column and the BattleService conversions between expiresAt and expiresAtTick; no database migration is required. Keep existing item consumption/cooldown behavior unchanged.

### 6. Migrate the current status producers without changing outcomes

- Violent Shot: use statusId slow; successful_push trigger; 12 ticks; modifiers { moveSpeedPenalty: 0, moveSpeedMultiplier: 0.2 }. Remove violent_shot_slow.
- Heavy Swing: disarm application with guaranteed chance and the existing rank-duration array.
- Ice Bolt / Ground Slam: freeze / stun application chance and their existing catalogue defaults.
- Fire Ball / Fire Blast: Burn chance from each skill, 50-tick duration, source MATK / 5, 10-tick damage interval.
- Swordsmanship: Bleed chancePerRank 0.01, no expiry, flat 5 damage per tick scaled by skill rank, 10-tick interval, pure damage, max five stacks from the status definition.
- Opening Spear: Bleed chance 0.5, 40-tick duration, flat 5 pure damage per tick, 10-tick interval.
- Poison Sting: Poison chance 0.5 with Save Butt Luck, 50-tick duration, source MATK / 2, 10-tick interval and magic damage.
- Silk Prey and Channel passive hooks: declare their Web Pack and Magic Prowess durations/modifiers in their own hook payloads instead of duplicating them in the status catalogue.
- War Cry, Magic Barrier, reflection, rage and conditional statuses: use the same resolver, retaining their currently declared duration/payload values.
- Tonics: declare duration and stat modifiers in items.json only; remove duplicate Fontoura/Kombucha/Haste Shot/Çapó values from status definitions.
- Status definitions retain canonical stack policies and any defaults still required by callers that omit a value.

Keep current gameplay values and tick units exactly as currently resolved by the engine. Where legacy catalogue defaults still serve non-skill callers, retain them under defaultApplication rather than deleting the fallback prematurely.

### 7. Preserve compatibility for immutable historical battle logs

Previously generated, not-yet-consumed battle entries may still contain the old status ID violent_shot_slow. Remove it from the canonical active status catalogue, but add a presentation-only legacy alias from violent_shot_slow to slow when resolving status names/tooltips for historical event timelines. Do not write the old ID into new simulation logs or new Character state.

## Risks / Trade-offs

- [Different producer paths can subtly diverge during migration] → Route every current status producer through the same resolver and add source-by-source deterministic regression tests before removing legacy fields.
- [Merging defaults with overrides can accidentally double-apply a modifier] → Define override-by-key semantics and explicitly test the Slow zero-flat-penalty plus multiplier case.
- [Seeded simulations can change outcomes if random rolls move] → Check stack eligibility before RNG; guaranteed chances and impossible applications consume no random value; preserve event/action ordering and verify seed-based regressions.
- [Old queued logs can outlive the removed catalogue row] → Resolve the former Violent Shot ID through a presentation-only alias to canonical Slow; do not retain a second active status definition.
- [Out-of-battle and battle time units differ] → Store duration in battle ticks in all source catalogues and convert with the shared 500 ms tick constant only at the persistence boundary.

## Migration Plan

1. Introduce shared types and pure status-application resolution/list helpers while keeping existing runtime status instance fields readable.
2. Migrate all current skill, monster passive/skill and item source data to statusApplication; migrate status defaults into defaultApplication; synchronize frontend public data.
3. Route character/monster combat status applications and in-battle item effects through the shared application path, then route InventoryService out-of-battle status application through the shared resolver.
4. Update status tooltip fallback reads, historical log alias handling, and SPEC/ARCHITECTURE.
5. Run focused regression tests, shared/API/frontend builds and catalogue parity checks. Only after all checks pass, delete the duplicate status row and legacy application fields.
6. Rollback is a code/catalogue revert. Persisted Character status instances remain flattened and self-contained, so no data conversion or database migration is required.

## Open Questions

None.