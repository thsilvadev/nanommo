# Design — Quest Standardization

## Current State

- Root `npc_catalog.json` is the canonical NPC catalogue. NPC records currently embed dialogue graphs using `types: ["quest"]`.
- Father Marcelus uses this graph for conditional dialogue and eating; it is not persistent quest progress.
- Cecilia's graph hard-codes quantities, inventory checks, item removal, and an accessory reward.
- `DataService` loads canonical root JSON catalogues and validates map, monster, item, and NPC references. `scripts/sync-frontend-data.js` copies canonical catalogues to `apps/frontend/public/data`.
- The Character page uses query-parameter tabs and currently has Character, Gambits, Mastery, and Professions tabs.
- `InventoryItem.instanceData` is persisted JSONB and is copied to Market orders/deals/mail for equipment instance data. Quest reward provenance can be recorded there; Market listing validation must inspect it.
- Inventory, Market, Mail, Warehouse, vendor, battle, and Gathering are server-authoritative and have distinct transaction/lock boundaries that must be preserved.

## Proposed Boundaries

1. **NPC catalogue:** defines identity, portrait/name/location and current services/capabilities (vendor, storage, mailbox, cooking, dialogue). Rename the current dialogue-only `quest` capability/graph to `dialogue` while preserving Father Marcelus's behavior. An NPC's type does not imply a persistent quest.
2. **Quest catalogue:** new root `quests.json` defines unique quest ID, title/description, giver NPC, turn-in NPC, minimum level, completed-quest prerequisites, repeatability/reacceptance policy, optional time limit, offer dialogue, objectives, rewards, and source-specific quest item chances.
3. **Item catalogue:** quest-only physical items receive canonical item definitions (icons, display name, stackability/maxStack, quest-only classification). Each Gathering objective has a mandatory `containerItem` referencing a quest-only item such as `quest_liquid_flask` or `quest_material_box`.
4. **Quest state:** add a per-character quest-instance entity and forward-only migration for lifecycle status, acceptance/expiry/completion timestamps, and objective progress. Do not execute the migration. Abandoned/expired state may be persisted for lifecycle enforcement/audit but is not rendered in the requested Character panel.
5. **Active quest limit:** read `QUEST_ACTIVE_LIMIT` from environment at startup; default to 5. Require a positive integer and fail fast on invalid configuration. The limit counts active accepted quests, not completed history.
6. **Quest API/service:** centralize list, available quests, accept, abandon, progress, expiry checks, turn-in, and reward application. Revalidate level, prerequisites, current Town/NPC, active limit, lifecycle, expiry, objective completion, inventory quantities, capacity, and reward bounds server-side.
7. **Offer dialogue:** each quest defines an ordered sequence of NPC text plus exactly one button label per step. Each button advances to the next step. Only the decisive final button accepts the quest and creates its persisted instance; merely opening/reading dialogue does not. An available quest adds a quest-specific action button alongside other NPC actions.
8. **Quest actions / talk objectives:** a talk objective is fulfilled by selecting the specified Town NPC and pressing the quest-specific action/dialogue button associated with the active quest. The UI shows that action only while the quest is eligible and active. No hidden answer, multi-choice puzzle, or scripted correct response is required.
9. **Objectives:** v1 supports concurrent objectives for monster kills, explicit interaction with a Town NPC, ordinary item delivery, and acquisition of quest-only items through Gathering bonus rolls or independent monster drops. A kill counts only after a successful victory against the configured species; optional map restrictions may narrow qualifying kills.
10. **Gathering bonus semantics:** an active matching quest performs a separate configured chance roll per qualifying Gathering cycle. Normal Gathering output still occurs unchanged. On success, grant one (or the explicitly configured quantity) of the objective's `containerItem` and increment/merge its normal stack in Inventory; this item is the physical stack representation of the collected quest yield, not a nested inventory container. The field is mandatory for this Gathering objective type.
11. **Monster quest drops:** make a separate deterministic roll from ordinary loot, keyed from the resolved battle identity plus quest/objective identity. Only eligible active quests can receive the item, and retries must not duplicate it. Ordinary drops remain unchanged.
12. **Physical quest-item restrictions:** quest-only items remain visible, stackable inventory items but backend services must reject vendor sale, Market listing/purchase, Mail attachment, Warehouse transfer, and other player-to-player transfer. Hide/disable forbidden controls as presentation only; the server remains authoritative. On successful turn-in consume the required quantity. On abandon or expiry remove items owned by that quest instance without deleting items belonging to another active quest.
13. **Equipment reward provenance:** when granting equipment from a quest, persist `instanceData.questReward = { questId, marketTradable: false }` (or an equivalent validated structure). Market listing must reject such instances even if their base item catalogue is otherwise marketable. Do not add an item-ID-wide Market prohibition for Worn Lucky Ring: legacy/non-quest instances remain tradable, while new quest-reward instances are blocked by provenance. The ring is removed from its ordinary equipment-drop pool so all new copies come from quest rewards.
14. **Repeatability and abandon:** each quest explicitly defines whether it may be completed/repeated. Active quests may be abandoned; quest items owned by that instance are removed. Reacceptance after abandonment follows an explicit quest policy. For non-repeatable quests, a completed quest cannot be accepted again.
15. **Deadline:** a positive `timeLimitSeconds` starts at acceptance; persisted absolute `expiresAt` includes offline time. Server checks expiry before progress/reward. On expiry, the quest is terminal and its owned quest-only items are removed. Client countdowns are presentation only.
16. **Rewards and atomic turn-in:** support gold, Character XP, item rewards, and Gathering/Cooking (and other supported profession) XP. Validate all reward definitions and capacities before mutation. Consume delivery items, mark quest complete, grant all rewards and stamp quest reward equipment provenance within one transaction. If inventory cannot hold the complete item reward, reject without consuming any requirements or granting partial reward.
17. **Character UI:** add a Quests tab to the existing Character page query-param tab system (`tab=quests`). Auto-focus active quests and display objective progress, deadlines, reward preview, and turn-in NPC. Completed quests appear in a separate, secondary section showing only title and giver NPC. Do not render abandoned/expired entries or introduce filters in this first UI.
18. **Town NPC UI:** append quest actions to the current NPC dialogue/service panel. An NPC may offer many quests, and different quests on the same NPC may have different level/prerequisite states. Turn-in NPC may differ from giver. Only Town NPC interactions are implemented in v1.
19. **Catalogue validation:** validate unique quest/objective IDs, NPC/map/monster/item/prerequisite references, level/duration bounds, positive integer quantities, valid chances, supported reward types, and valid `containerItem` definitions. Add `quests.json` to `scripts/sync-frontend-data.js` if frontend needs the catalogue.
20. **Progress correctness:** only events after quest acceptance and before expiry count. Apply kill/drop progress at authoritative battle resolution without rewriting immutable battle snapshots. Gathering updates must use the authoritative activity transaction/cycle identity. All progression and turn-in operations must be idempotent.

## Illustrative Quest Definition

```json
{
  "id": "gather_liquid",
  "title": "A Sample of the Springs",
  "giverNpcId": "uncle_phillip",
  "turnInNpcId": "uncle_phillip",
  "minLevel": 5,
  "requiresCompletedQuestIds": [],
  "repeatable": false,
  "allowReacceptAfterAbandon": true,
  "timeLimitSeconds": 1800,
  "offerDialogue": [
    { "npcText": "Could you help me gather a sample?", "buttonText": "What do you need?" },
    { "npcText": "Bring me a few flasks from the springs.", "buttonText": "I'll take the job.", "acceptsQuest": true }
  ],
  "objectives": [
    {
      "id": "collect_flasks",
      "type": "gathering_bonus",
      "mapIds": ["map_id"],
      "chancePercent": 20,
      "containerItem": "quest_liquid_flask",
      "quantity": 5
    }
  ],
  "rewards": {
    "gold": 500,
    "characterXp": 250,
    "items": [{ "itemId": "reward_item", "quantity": 1 }],
    "professionXp": [{ "profession": "gathering", "amount": 30 }]
  }
}
```

This is an illustrative contract; IDs, rewards, dialogue text, probabilities, and actual quest content must be finalized as data, not hard-coded into services.

## Cecilia Migration

- Convert Cecilia's current 20 Slime Gel + 20 Bat Wings + 10 Thorn Barks exchange into one non-repeatable quest.
- Keep her tone/content and reward intent, but separate offer dialogue/acceptance from requirement delivery.
- Existing inventory materials count toward the deliver-items objective, as approved. After accepting, the player can complete objectives and explicitly turn in to Cecilia.
- The reward accessory is marked with per-instance quest-reward provenance that blocks it from Market listing. Do not add an item-level Market prohibition: legacy instances remain tradable until the planned wipe. Remove `dropPool` from `equip_accessory_sor_t1` so it is no longer selected by normal monster equipment drops and future copies are quest-only.
- Do not reset existing player inventory or automatically create quest completion history for previous exchanges without an explicit data-migration decision.

## Safety / Compatibility Constraints

- Never infer a quest ID from an NPC ID or use NPC dialogue state as persisted quest progress.
- Father Marcelus remains dialogue-only for the current feeding/blessing interaction and may offer quests later through `quests.json` without changing that dialogue.
- Normal Gathering and ordinary drops remain unchanged except that `equip_accessory_sor_t1` is removed from the normal equipment-drop pool. Quest bonus grants are independent and only run for eligible accepted quests.
- Quest items are never accepted by vendor, Market, Mail attachments, Warehouse transfer, or player-to-player transfer endpoints.
- Every quest equipment reward instance is Market-ineligible through quest-reward provenance. Existing Worn Lucky Ring instances remain Market-eligible; newly quest-rewarded copies will carry that provenance. The ring is removed from ordinary monster equipment-drop pools.
- Handle item capacity before mutation and use row locks/transaction-manager repositories in existing authoritative service paths.
- Keep the new forward-only migration unexecuted, do not mutate live data, and do not deploy during apply.

## Equipment and Legacy Compatibility

Worn Lucky Ring (`equip_accessory_sor_t1`) is removed from the ordinary equipment-drop pool. Existing copies can still be listed on the Market; no migration/backfill should mark or rewrite legacy InventoryItem instances. The planned wipe will clear that legacy state. New copies granted by Cecilia's quest carry quest-reward provenance and cannot be listed. Other equipment rewards use the same per-instance rule, without an item-ID-wide Market restriction.

The quest catalogue and service should keep reward/progress logic generic; no per-quest TypeScript branches. Verify restrictions in both listing UI and backend validation.
