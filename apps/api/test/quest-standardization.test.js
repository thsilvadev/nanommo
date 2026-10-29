const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../..');
process.chdir(path.join(root, 'apps/api'));
const { DataService } = require('../dist/apps/api/src/modules/data/data.service');
const { QuestService } = require('../dist/apps/api/src/modules/quests/quest.service');
const { Character } = require('../dist/apps/api/src/database/entities/character.entity');
const { InventoryItem } = require('../dist/apps/api/src/database/entities/inventory-item.entity');
const { QuestInstance } = require('../dist/apps/api/src/database/entities/quest-instance.entity');
const { TownService } = require('../dist/apps/api/src/modules/town/town.service');
const { InventoryService } = require('../dist/apps/api/src/modules/inventory/inventory.service');
const { MarketService } = require('../dist/apps/api/src/modules/market/market.service');
const { MailService } = require('../dist/apps/api/src/modules/mail/mail.service');
const { MarketOrder } = require('../dist/apps/api/src/database/entities/market-order.entity');
const { MailMessage } = require('../dist/apps/api/src/database/entities/mail-message.entity');
const items = require('../../../items.json');
const maps = require('../../../maps.json');
const npcs = require('../../../npc_catalog.json');
const questCatalogue = require('../../../quests.json');
const allItems = [...(items.consumables || []), ...(items.equipment || []), ...(items.monsterParts || []), ...(items.materials || [])];
const itemById = id => allItems.find(row => row.id === id);
const baseQuest = questCatalogue.quests.find(row => row.id === 'cecilia_lucky_ring');
let generatedId = 0;
function repo(rows, entity) {
  const matches = (row, where = {}) => Object.entries(where || {}).every(([key, value]) => row[key] === value);
  return {
    find: async ({ where = {} } = {}) => rows.filter(row => matches(row, where)).sort((a,b) => (a.slotIndex ?? 0) - (b.slotIndex ?? 0)),
    findOne: async ({ where = {} } = {}) => rows.find(row => matches(row, where)) || null,
    save: async row => { const index = rows.findIndex(old => old === row || (entity === QuestInstance && old.id === row.id) || (entity === InventoryItem && old.id === row.id)); if (index < 0) rows.push(row); else rows[index] = row; return row; },
    remove: async row => { const index = rows.indexOf(row); if (index >= 0) rows.splice(index, 1); return row; },
    create: row => ({ ...row, ...(!row.id && (entity === QuestInstance || entity === InventoryItem) ? { id: `test-generated-${++generatedId}` } : {}) }),
  };
}
function harness(options = {}) {
  const character = options.character || { id: 'char-q1', userId: 'user-q1', status: 'town', currentMapId: 'map_town', pendingMapTransition: null, travelIntent: null, level: 1, xp: 0, gold: 0, unspentAttributePoints: 0, gatheringXp: 0, gatheringLevel: 1, cookingXp: 0, cookingLevel: 1, knownItemIds: [], questOfferProgress: {} };
  const invRows = options.inventory || [];
  const instanceRows = options.instances || [];
  const charRows = [character];
  const repos = new Map([
    [Character, repo(charRows, Character)],
    [InventoryItem, repo(invRows, InventoryItem)],
    [QuestInstance, repo(instanceRows, QuestInstance)],
  ]);
  const manager = { getRepository: entity => repos.get(entity) };
  manager.transaction = async callback => callback(manager);
  for (const repository of repos.values()) repository.manager = manager;
  const data = options.data || {
    getQuests: () => questCatalogue,
    getNpcCatalog: () => ({ npcs: npcs.npcs }),
    getNpcVendor: () => require('../../../npc_vendor.json'),
    getMapById: id => (maps.maps || []).find(map => map.id === id),
    getItemById: itemById,
    getXpToNextLevel: () => 100,
  };
  const service = new QuestService(repos.get(Character), repos.get(InventoryItem), repos.get(QuestInstance), data, { get: key => key === 'QUEST_ACTIVE_LIMIT' ? '5' : undefined });
  return { service, character, invRows, instanceRows, charRows, data, manager };
}
async function run() {
  // Full production catalogue boot validation catches dangling IDs and malformed data.
  const bootData = new DataService();
  bootData.onModuleInit();
  assert.strictEqual(bootData.getQuests().quests.length, 2);

  // Pajé's existing Portuguese dialogue remains intact: asking about the tears
  // leads to an explanation, and the explicit follow-up choice accepts the quest.
  const forestCharacter = {
    id: 'char-forest', userId: 'user-forest', status: 'town', currentMapId: 'map_kwaioua_taba',
    pendingMapTransition: null, travelIntent: null, level: 35, xp: 0, gold: 0,
    unspentAttributePoints: 0, gatheringXp: 0, gatheringLevel: 1, cookingXp: 0, cookingLevel: 1,
    knownItemIds: [], questOfferProgress: {},
  };
  const forest = harness({ character: forestCharacter });
  const forestQuestId = 'forest_ancient_teardrop';
  const npcInteraction = await forest.service.getNpcInteraction(forestCharacter.id, 'paje_piata');
  assert.strictEqual(npcInteraction.kind, 'select');
  const forestOfferAction = npcInteraction.actions.find(action => action.type === 'offer' && action.questId === forestQuestId);
  assert(forestOfferAction);
  assert.strictEqual(forestOfferAction.buttonText.locales['en-US'], 'What bothers you, Pajé Piatã?');
  assert.strictEqual(forestOfferAction.buttonText.locales['pt-BR'], 'O que o entristece, Pajé Piatã?');
  const forestOffer = await forest.service.getOffer(forestCharacter.id, forestQuestId);
  assert.strictEqual(forestOffer.nodeId, 'start');
  assert(forestOffer.choices.some(choice => choice.id === 'ask_tears'));
  const explanation = await forest.service.advanceOffer(forestCharacter.id, forestQuestId, 'ask_tears');
  assert.strictEqual(explanation.nodeId, 'explanation');
  assert.strictEqual(explanation.accepted, false);
  assert.strictEqual(explanation.npcText.locales['pt-BR'], 'Tu! Tu vai ajudar. Nossos rangers estão na floresta, livrando os sagrados Treants de seu sofrimento. Livra o sofrimento deles! Traga-me 5 lágrimas de ancião da floresta. Lágrima de ancião vai trazer peso e dor pro inimigo. Floresta vai ficar de pé. Lágrima pesa. Poupe fôlego para carregá-las. Vai! Apague o sofrimento dos ancestrais!');
  assert.strictEqual(forest.instanceRows.length, 0, 'Question/explanation path must not accept automatically');

  const forestInstanceResult = await forest.service.advanceOffer(forestCharacter.id, forestQuestId, 'accept_after_explanation');
  assert.strictEqual(forestInstanceResult.accepted, true);
  assert.strictEqual(forest.instanceRows.length, 1);
  const forestInstance = forest.instanceRows[0];
  assert.strictEqual(forestInstance.status, 'active');
  const forestActiveAction = await forest.service.getNpcInteraction(forestCharacter.id, 'paje_piata');
  assert.strictEqual(forestActiveAction.kind, 'select');
  assert.strictEqual(forestActiveAction.actions.length, 1);
  assert.strictEqual(forestActiveAction.actions[0].buttonText.locales['en-US'], "About the forest ancestors' tears...");
  assert.strictEqual(forestActiveAction.actions[0].interaction.action, 'close');

  // Simulate five independent successful deterministic 35% quest-only rolls, then
  // turn in the exact matching instance stack and verify fixed XP/provenance/reward.
  const createHash = require('crypto').createHash;
  for (let ordinal = 0; ordinal < 5; ordinal++) {
    let battleId = null;
    for (let attempt = 0; attempt < 1000; attempt++) {
      const candidate = 'forest-test-battle-' + ordinal + '-' + attempt;
      const roll = createHash('sha256').update(candidate + ':' + forestInstance.id + ':collect_tears').digest().readUInt32BE(0) % 10000;
      if (roll < 3500) { battleId = candidate; break; }
    }
    assert(battleId, 'Expected deterministic test seed under the 35% quest drop threshold');
    await forest.service.recordBattleVictory(forest.manager, forestCharacter, {
      id: battleId, monsterId: 'mon_flamingtreant', mapId: 'map_kwaioua_forest_1',
      endAt: new Date(Date.now() + 10000 + ordinal),
    });
  }
  assert.strictEqual(forestInstance.progress.collect_tears, 5);
  const tears = forest.invRows.filter(row => row.itemId === 'part_flamingtreant_common');
  assert.strictEqual(tears.reduce((sum, row) => sum + Number(row.quantity), 0), 5);
  assert(tears.every(row => row.instanceData?.questInstanceId === forestInstance.id));
  const forestReadyAction = await forest.service.getNpcInteraction(forestCharacter.id, 'paje_piata');
  assert.strictEqual(forestReadyAction.kind, 'select');
  assert.strictEqual(forestReadyAction.actions.length, 1);
  assert.strictEqual(forestReadyAction.actions[0].buttonText.locales['en-US'], 'What will you do with those tears? [handle items]');
  assert.strictEqual(forestReadyAction.actions[0].interaction.action, 'turn_in');
  assert.strictEqual(forestReadyAction.actions[0].interaction.instanceId, forestInstance.id);
  forest.data.getXpToNextLevel = () => 1000000;
  const completedQuestResult = await forest.service.turnIn(forestCharacter.id, forestInstance.id);
  assert.strictEqual(completedQuestResult.interaction.npcText.locales['pt-BR'], 'Você honrou a floresta. Fique com estas botas; que elas guiem seus passos em segurança.');
  assert.strictEqual(completedQuestResult.interaction.buttonText.locales['pt-BR'], 'Obrigado, Pajé.');
  assert.strictEqual(forestInstance.status, 'completed');
  assert.strictEqual(Number(forestCharacter.xp), 31630, 'Quest reward must grant the exact fixed Character XP');
  assert.strictEqual(forest.invRows.some(row => row.itemId === 'part_flamingtreant_common'), false);
  const groundedReward = forest.invRows.find(row => row.itemId === 'equip_shoes_earth_t2');
  assert(groundedReward);
  assert.deepStrictEqual(groundedReward.instanceData, { questReward: { questId: forestQuestId, marketTradable: false } });
  assert.strictEqual(groundedReward.instanceData.rolledAttribute, undefined, 'Grounded Boots reward must not receive a random roll');

  // Cecilia's approved delivery contract and instance-specific item metadata.
  assert.strictEqual(baseQuest.repeatable, false);
  assert.deepStrictEqual(baseQuest.objectives[0].items, [
    { itemId: 'part_slime_common', quantity: 20 },
    { itemId: 'part_fieldbat_common', quantity: 20 },
  ]);
  assert.strictEqual(baseQuest.rewards.items[0].itemId, 'equip_accessory_sor_t1');
  assert.strictEqual(itemById('quest_spring_flask').questOnly, true);
  assert.strictEqual(itemById('quest_field_sample').questOnly, true);
  for (const id of ['quest_spring_flask', 'quest_field_sample']) {
    assert.ok(fs.existsSync(path.join(root, 'apps/frontend/assets/ui/items/svg/materials', `${id}.svg`)));
    assert.ok(fs.existsSync(path.join(root, 'apps/frontend/assets/ui/items/svg-noframe/materials', `${id}.svg`)));
  }
  const ring = itemById('equip_accessory_sor_t1');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(ring, 'dropPool'), false);
  assert.strictEqual((require('../../../monsters.json').monsters || []).some(monster => (monster.drops || []).some(drop => drop.itemId === 'equip_accessory_sor_t1')), false);

  // Level unlocks are data-driven, and the one-button dialogue accepts only at its final step.
  const locked = { ...baseQuest, id: 'test_level_unlock', title: 'Level gate', minLevel: 2 };
  const questData = { quests: [locked] };
  const availableHarness = harness({ data: { ...harness().data, getQuests: () => questData } });
  assert.strictEqual((await availableHarness.service.getAvailable(availableHarness.character.id)).some(row => row.id === locked.id), false);
  availableHarness.character.level = 2;
  assert.strictEqual((await availableHarness.service.getAvailable(availableHarness.character.id)).some(row => row.id === locked.id), true);
  const offer = await availableHarness.service.getOffer(availableHarness.character.id, locked.id);
  assert.strictEqual(offer.acceptsQuest, false, 'Non-final dialogue steps must not be styled as quest acceptance actions');
  let state = await availableHarness.service.advanceOffer(availableHarness.character.id, locked.id);
  assert.strictEqual(state.accepted, false);
  state = await availableHarness.service.advanceOffer(availableHarness.character.id, locked.id);
  assert.strictEqual(state.accepted, true);
  assert.strictEqual(availableHarness.instanceRows.filter(row => row.status === 'active').length, 1);
  await assert.rejects(() => availableHarness.service.advanceOffer(availableHarness.character.id, locked.id), /Quest is not currently available/);
  assert.strictEqual(availableHarness.instanceRows.filter(row => row.status === 'active').length, 1);

  // Cecilia opens directly in dialogue; the single button accepts at the last offer step,
  // then the same panel switches into her active line with a readiness-sensitive action.
  const ceciliaEmpty = harness();
  ceciliaEmpty.character.level = 3;
  let interaction = await ceciliaEmpty.service.getNpcInteraction(ceciliaEmpty.character.id, 'cecilia');
  assert.strictEqual(interaction.kind, 'select');
  assert.strictEqual(interaction.actions.length, 1);
  assert.strictEqual(interaction.actions[0].type, 'offer');
  assert.strictEqual(interaction.actions[0].buttonText, baseQuest.title);
  interaction = await ceciliaEmpty.service.getOffer(ceciliaEmpty.character.id, baseQuest.id);
  assert.strictEqual(interaction.kind, 'offer');
  assert.strictEqual(interaction.npcText, baseQuest.offerDialogue[0].npcText);
  assert.strictEqual(interaction.buttonText.locales['en-US'], 'What can you do?');
  interaction = await ceciliaEmpty.service.advanceOffer(ceciliaEmpty.character.id, baseQuest.id);
  assert.strictEqual(interaction.accepted, false);
  assert.strictEqual(interaction.buttonText.locales['en-US'], 'I’ll take the job.');
  interaction = await ceciliaEmpty.service.advanceOffer(ceciliaEmpty.character.id, baseQuest.id);
  assert.strictEqual(interaction.accepted, true);
  assert.strictEqual(interaction.interaction.kind, 'active');
  assert.strictEqual(interaction.interaction.npcText, baseQuest.activeDialogue.npcText);
  assert.strictEqual(interaction.interaction.buttonText, "I'll be back");
  assert.strictEqual(interaction.interaction.action, 'close');
  const multiNpcQuest = { ...baseQuest, id: 'test_second_cecilia_quest', title: 'Second Cecilia quest' };
  // Active quest actions and other still-eligible offers must coexist in the same NPC action list.
  ceciliaEmpty.data.getQuests = () => ({ quests: [baseQuest, multiNpcQuest] });
  const mixedActions = await ceciliaEmpty.service.getNpcInteraction(ceciliaEmpty.character.id, 'cecilia');
  assert.deepStrictEqual(mixedActions.actions.map(action => `${action.type}:${action.questId}`).sort(), [
    `active:${baseQuest.id}`, `offer:${multiNpcQuest.id}`,
  ].sort());
  const multiQuestHarness = harness({ data: { ...harness().data, getQuests: () => ({ quests: [baseQuest, multiNpcQuest] }) } });
  multiQuestHarness.character.level = 3;
  const multiChoice = await multiQuestHarness.service.getNpcInteraction(multiQuestHarness.character.id, 'cecilia');
  assert.strictEqual(multiChoice.kind, 'select');
  assert.deepStrictEqual(multiChoice.actions.map((action) => action.title), [baseQuest.title, multiNpcQuest.title]);

  const fatherQuest = { ...baseQuest, id: 'test_father_offer', giverNpcId: 'father_marcelus', turnInNpcId: 'father_marcelus' };
  const fatherHarness = harness({ data: { ...harness().data, getQuests: () => ({ quests: [fatherQuest] }) } });
  fatherHarness.character.level = 3;
  const fatherChoice = await fatherHarness.service.getNpcInteraction(fatherHarness.character.id, 'father_marcelus');
  assert.strictEqual(fatherChoice.kind, 'select');
  assert.ok(!fatherChoice.actions.some((action) => action.type === 'dialogue'), 'Quest framework should not create a generic Talk menu action');
  assert.ok(fatherChoice.actions.some((action) => action.type === 'offer' && action.questId === fatherQuest.id));

  const ceciliaReady = harness({ inventory: [
    { id: 's-gel', characterId: 'char-q1', location: 'inventory', slotIndex: 0, itemId: 'part_slime_common', quantity: 20 },
    { id: 'b-wings', characterId: 'char-q1', location: 'inventory', slotIndex: 1, itemId: 'part_fieldbat_common', quantity: 20 },
  ] });
  ceciliaReady.character.level = 3;
  await ceciliaReady.service.getNpcInteraction(ceciliaReady.character.id, 'cecilia');
  await ceciliaReady.service.getOffer(ceciliaReady.character.id, baseQuest.id);
  await ceciliaReady.service.advanceOffer(ceciliaReady.character.id, baseQuest.id);
  const acceptedReady = await ceciliaReady.service.advanceOffer(ceciliaReady.character.id, baseQuest.id);
  assert.strictEqual(acceptedReady.interaction.buttonText.locales['en-US'], '[Handle items]');
  assert.strictEqual(acceptedReady.interaction.action, 'turn_in');

  // Active limit is checked transactionally at final acceptance.
  const many = Array.from({ length: 6 }, (_, i) => ({ ...baseQuest, id: `limit_quest_${i}`, title: `Limit ${i}` }));
  const limitData = { ...harness().data, getQuests: () => ({ quests: many }) };
  const limitHarness = harness({ data: limitData });
  limitHarness.character.level = 3;
  for (let i = 0; i < 5; i++) {
    await limitHarness.service.getOffer(limitHarness.character.id, many[i].id);
    const accepted = await limitHarness.service.advanceOffer(limitHarness.character.id, many[i].id);
    assert.strictEqual(accepted.accepted, false);
    const final = await limitHarness.service.advanceOffer(limitHarness.character.id, many[i].id);
    assert.strictEqual(final.accepted, true);
  }
  await limitHarness.service.getOffer(limitHarness.character.id, many[5].id);
  const lastOfferStep = await limitHarness.service.advanceOffer(limitHarness.character.id, many[5].id);
  assert.strictEqual(lastOfferStep.accepted, false);
  await assert.rejects(() => limitHarness.service.advanceOffer(limitHarness.character.id, many[5].id), /at most 5 active quests/);
  assert.strictEqual(limitHarness.instanceRows.filter(row => row.status === 'active').length, 5);

  // Abandonment removes only quest-only stacks tagged with that quest instance.
  const abandonQuest = { ...baseQuest, id: 'test_abandon_cleanup' };
  const abandonInstance = { id: 'instance-owned', characterId: 'char-q1', questId: abandonQuest.id, status: 'active', progress: {}, acceptedAt: new Date(), expiresAt: null, completedAt: null };
  const owned = { id: 'owned', characterId: 'char-q1', location: 'inventory', slotIndex: 0, itemId: 'quest_spring_flask', quantity: 2, instanceData: { questInstanceId: abandonInstance.id } };
  const other = { id: 'other', characterId: 'char-q1', location: 'inventory', slotIndex: 1, itemId: 'quest_spring_flask', quantity: 3, instanceData: { questInstanceId: 'different-instance' } };
  const cleanupData = { ...harness().data, getQuests: () => ({ quests: [abandonQuest] }) };
  const cleanup = harness({ data: cleanupData, instances: [abandonInstance], inventory: [owned, other] });
  cleanup.character.level = 3;
  await cleanup.service.abandon(cleanup.character.id, abandonInstance.id);
  assert.strictEqual(cleanup.instanceRows[0].status, 'abandoned');
  assert.deepStrictEqual(cleanup.invRows.map(row => row.id), ['other']);
  const questState = await cleanup.service.getState(cleanup.character.id);
  assert.deepStrictEqual(questState.active, []);
  assert.deepStrictEqual(questState.completed, []);
  assert.ok(questState.available.some(row => row.id === abandonQuest.id), 'the configured reaccept-after-abandon policy is respected');

  // A full Inventory rejects turn-in before requirements/rewards/status are mutated.
  const capacityQuest = { ...baseQuest, id: 'test_full_inventory', objectives: [{ id: 'kill', type: 'kill_monster', quantity: 1, monsterIds: ['mon_slime'] }], rewards: { gold: 500, items: [{ itemId: 'equip_accessory_sor_t1', quantity: 1 }] } };
  const capacityInstance = { id: 'full-inventory-quest', characterId: 'char-q1', questId: capacityQuest.id, status: 'active', progress: { kill: 1 }, acceptedAt: new Date(), expiresAt: null, completedAt: null };
  const fullInventory = Array.from({ length: 50 }, (_, i) => ({ id: `slot-${i}`, characterId: 'char-q1', location: 'inventory', slotIndex: i, itemId: 'pot_hp_small', quantity: 1, instanceData: null }));
  const capacityData = { ...harness().data, getQuests: () => ({ quests: [capacityQuest] }) };
  const capacity = harness({ data: capacityData, instances: [capacityInstance], inventory: fullInventory });
  await assert.rejects(() => capacity.service.turnIn(capacity.character.id, capacityInstance.id), /Not enough Inventory space/);
  assert.strictEqual(capacity.instanceRows[0].status, 'active');
  assert.strictEqual(capacity.character.gold, 0);
  assert.strictEqual(capacity.invRows.length, 50);
  const deliveryCapacityQuest = { ...baseQuest, id: 'test_delivery_capacity', objectives: [{ id: 'deliver', type: 'deliver_items', items: [{ itemId: 'part_slime_common', quantity: 1 }] }], rewards: { items: [{ itemId: 'quest_spring_flask', quantity: 40 }] } };
  const deliveryCapacityInstance = { id: 'delivery-capacity-instance', characterId: 'char-q1', questId: deliveryCapacityQuest.id, status: 'active', progress: {}, acceptedAt: new Date(), expiresAt: null, completedAt: null };
  const deliveryFull = Array.from({ length: 49 }, (_, i) => ({ id: `delivery-slot-${i}`, characterId: 'char-q1', location: 'inventory', slotIndex: i, itemId: 'pot_hp_small', quantity: 1, instanceData: null }));
  deliveryFull.push({ id: 'required-slime', characterId: 'char-q1', location: 'inventory', slotIndex: 49, itemId: 'part_slime_common', quantity: 1, instanceData: null });
  const deliveryRollback = harness({ data: { ...harness().data, getQuests: () => ({ quests: [deliveryCapacityQuest] }) }, instances: [deliveryCapacityInstance], inventory: deliveryFull });
  await assert.rejects(() => deliveryRollback.service.turnIn(deliveryRollback.character.id, deliveryCapacityInstance.id), /Not enough Inventory space/);
  assert.strictEqual(deliveryRollback.invRows.find(row => row.id === 'required-slime').quantity, 1);
  assert.strictEqual(deliveryRollback.instanceRows[0].status, 'active');

  // Successful turn-in consumes delivered stacks and locks only the newly granted ring instance.
  const required = [
    { id: 'slime', characterId: 'char-q1', location: 'inventory', slotIndex: 0, itemId: 'part_slime_common', quantity: 20, instanceData: null },
    { id: 'bat', characterId: 'char-q1', location: 'inventory', slotIndex: 1, itemId: 'part_fieldbat_common', quantity: 20, instanceData: null },
  ];
  const ceciliaInstance = { id: 'cecilia-instance', characterId: 'char-q1', questId: baseQuest.id, status: 'active', progress: {}, acceptedAt: new Date(), expiresAt: null, completedAt: null };
  const turnin = harness({ instances: [ceciliaInstance], inventory: required });
  const turninResult = await turnin.service.turnIn(turnin.character.id, ceciliaInstance.id);
  assert.strictEqual(turninResult.interaction.npcText, baseQuest.completionDialogue.npcText);
  assert.strictEqual(turninResult.interaction.buttonText, baseQuest.completionDialogue.buttonText);
  assert.strictEqual(turnin.instanceRows[0].status, 'completed');
  assert.strictEqual(turnin.invRows.filter(row => ['part_slime_common', 'part_fieldbat_common'].includes(row.itemId)).length, 0);
  const rewardRing = turnin.invRows.find(row => row.itemId === 'equip_accessory_sor_t1');
  assert.deepStrictEqual(rewardRing.instanceData.questReward, { questId: baseQuest.id, marketTradable: false });
  assert.strictEqual(baseQuest.completionDialogue.buttonText.locales['en-US'], 'Thank you!');

  // Successful battle resolution records multiple configured objectives in the same transaction.
  const combatQuest = { ...baseQuest, id: 'test_combat_objectives', objectives: [
    { id: 'slime_kills', type: 'kill_monster', quantity: 2, monsterIds: ['mon_slime'] },
    { id: 'quest_drop', type: 'monster_drop', quantity: 2, monsterIds: ['mon_slime'], itemId: 'quest_spring_flask', itemQuantity: 1, chancePercent: 100 },
  ], rewards: {} };
  const combatInstance = { id: 'combat-instance', characterId: 'char-q1', questId: combatQuest.id, status: 'active', progress: {}, acceptedAt: new Date(Date.now() - 5000), expiresAt: null, completedAt: null };
  const combatData = { ...harness().data, getQuests: () => ({ quests: [combatQuest] }) };
  const combat = harness({ data: combatData, instances: [combatInstance] });
  await combat.service.recordBattleVictory(combat.manager, combat.character, { id: 'battle-unique-1', monsterId: 'mon_slime', mapId: 'map_green_grounds_0', endAt: new Date() });
  assert.strictEqual(combat.instanceRows[0].progress.slime_kills, 1);
  assert.strictEqual(combat.instanceRows[0].progress.quest_drop, 1);
  assert.strictEqual(combat.invRows[0].itemId, 'quest_spring_flask');
  assert.strictEqual(combat.invRows[0].instanceData.questInstanceId, combatInstance.id);

  // Losses never invoke the victory hook, and battle resolution's existing row lock/guard is the retry boundary.
  const battleSource = fs.readFileSync(path.join(root, 'apps/api/src/modules/battle/battle.service.ts'), 'utf8');
  const lossBranch = battleSource.indexOf("if (battle.outcome === 'loss')");
  const victoryHook = battleSource.indexOf('await this.questService.recordBattleVictory(manager, character, battle)');
  assert.ok(lossBranch >= 0 && victoryHook > lossBranch);
  assert.ok(battleSource.slice(lossBranch, victoryHook).includes("kind: 'death' as const"));
  assert.ok(battleSource.indexOf('if (battle.resolved) return { alreadyResolved: true as const }') < victoryHook);

  // NPC actions are server checked against the NPC/objective pair and update persisted progress.
  const talkQuest = { ...baseQuest, id: 'test_npc_action', objectives: [{ id: 'talk_to_cecilia', type: 'npc_action', npcId: 'cecilia', quantity: 2 }], rewards: {} };
  const talkInstance = { id: 'talk-instance', characterId: 'char-q1', questId: talkQuest.id, status: 'active', progress: {}, acceptedAt: new Date(), expiresAt: null, completedAt: null };
  const talkData = { ...harness().data, getQuests: () => ({ quests: [talkQuest] }) };
  const talk = harness({ data: talkData, instances: [talkInstance] });
  await talk.service.completeNpcAction(talk.character.id, talkInstance.id, 'cecilia', 'talk_to_cecilia');
  assert.strictEqual(talk.instanceRows[0].progress.talk_to_cecilia, 1);
  await assert.rejects(() => talk.service.completeNpcAction(talk.character.id, talkInstance.id, 'father_marcelus', 'talk_to_cecilia'), /does not match an active quest objective/);
  await talk.service.completeNpcAction(talk.character.id, talkInstance.id, 'cecilia', 'talk_to_cecilia');
  assert.strictEqual(talk.instanceRows[0].progress.talk_to_cecilia, 2);

  // Gathering bonus rolls use the independent configured quest item; a 0% chance never grants it.
  const gatheringQuest = { ...baseQuest, id: 'test_gathering_bonus', objectives: [{ id: 'field_bonus', type: 'gathering_bonus', quantity: 2, mapIds: ['map_green_grounds_0'], chancePercent: 100, containerItem: 'quest_spring_flask' }], rewards: {} };
  const gatheringInstance = { id: 'gather-instance', characterId: 'char-q1', questId: gatheringQuest.id, status: 'active', progress: {}, acceptedAt: new Date(Date.now() - 1000), expiresAt: null, completedAt: null };
  const gathering = harness({ data: { ...harness().data, getQuests: () => ({ quests: [gatheringQuest] }) }, instances: [gatheringInstance] });
  await gathering.service.applyGatheringBonuses(gathering.manager, gathering.character, 'map_green_grounds_0', 4);
  assert.strictEqual(gathering.instanceRows[0].progress.field_bonus, 1);
  assert.strictEqual(gathering.invRows[0].instanceData.questInstanceId, gatheringInstance.id);
  const noBonusQuest = { ...gatheringQuest, id: 'test_gathering_zero_chance', objectives: [{ ...gatheringQuest.objectives[0], chancePercent: 0 }] };
  const noBonusInstance = { id: 'gather-zero-instance', characterId: 'char-q1', questId: noBonusQuest.id, status: 'active', progress: {}, acceptedAt: new Date(Date.now() - 1000), expiresAt: null, completedAt: null };
  const noBonus = harness({ data: { ...harness().data, getQuests: () => ({ quests: [noBonusQuest] }) }, instances: [noBonusInstance] });
  await noBonus.service.applyGatheringBonuses(noBonus.manager, noBonus.character, 'map_green_grounds_0', 4);
  assert.strictEqual(noBonus.invRows.length, 0);
  assert.strictEqual(noBonus.instanceRows[0].progress.field_bonus, undefined);
  const mapSource = fs.readFileSync(path.join(root, 'apps/api/src/modules/map/map.service.ts'), 'utf8');
  assert.ok(mapSource.indexOf('await this.questService.applyGatheringBonuses') < mapSource.indexOf('if (Array.isArray(map.gatheringPool) && map.gatheringPool.length)'));

  // Absolute offline deadlines expire quests and clean only the expired instance's tagged stacks.
  const expiredQuest = { ...baseQuest, id: 'test_offline_expiry' };
  const expiredInstance = { id: 'expired-instance', characterId: 'char-q1', questId: expiredQuest.id, status: 'active', progress: {}, acceptedAt: new Date(Date.now() - 100000), expiresAt: new Date(Date.now() - 1000), completedAt: null };
  const expiredOwned = { id: 'expired-owned', characterId: 'char-q1', location: 'inventory', slotIndex: 0, itemId: 'quest_spring_flask', quantity: 1, instanceData: { questInstanceId: expiredInstance.id } };
  const stillOwned = { id: 'still-owned', characterId: 'char-q1', location: 'inventory', slotIndex: 1, itemId: 'quest_spring_flask', quantity: 1, instanceData: { questInstanceId: 'live-instance' } };
  const expired = harness({ data: { ...harness().data, getQuests: () => ({ quests: [expiredQuest] }) }, instances: [expiredInstance], inventory: [expiredOwned, stillOwned] });
  const expiredState = await expired.service.getState(expired.character.id);
  assert.strictEqual(expired.instanceRows[0].status, 'expired');
  assert.deepStrictEqual(expiredState.active, []);
  assert.deepStrictEqual(expired.invRows.map(row => row.id), ['still-owned']);

  // Repeatability and reacceptance policies distinguish completed from abandoned instances.
  const completedOneOff = { id: 'complete-one-off', characterId: 'char-q1', questId: baseQuest.id, status: 'completed', progress: {}, acceptedAt: new Date(), expiresAt: null, completedAt: new Date() };
  const completedOnce = harness({ instances: [completedOneOff] });
  completedOnce.character.level = 3;
  assert.strictEqual((await completedOnce.service.getAvailable(completedOnce.character.id)).some(row => row.id === baseQuest.id), false);
  const repeatable = { ...baseQuest, id: 'test_repeatable', repeatable: true };
  const priorCompletion = { ...completedOneOff, id: 'repeatable-completion', questId: repeatable.id };
  const repeats = harness({ data: { ...harness().data, getQuests: () => ({ quests: [repeatable] }) }, instances: [priorCompletion] });
  repeats.character.level = 3;
  assert.strictEqual((await repeats.service.getAvailable(repeats.character.id)).some(row => row.id === repeatable.id), true);

  // Exercise the real service entry points: no quest-only item may be sold, mailed, or stored.
  const runtimeData = { getNpcVendor: () => require('../../../npc_vendor.json'), getNpcCatalog: () => npcs, getMapById: id => (maps.maps || []).find(map => map.id === id), getItemById: itemById };
  const town = new TownService(null, null, runtimeData, null, null, null, null);
  await assert.rejects(() => town.sellToVendor('char-q1', 'william', 'quest_spring_flask', 1), /Quest-only items cannot be sold to vendors/);
  const directInventory = new InventoryService(null, null, runtimeData, null);
  await assert.rejects(() => directInventory.sellToVendor('char-q1', 'quest_spring_flask', 1), /Quest-only items cannot be sold to vendors/);
  const townCharacter = { id: 'char-q1', userId: 'user-q1', name: 'Quest Tester', status: 'town', currentMapId: 'map_town', pendingMapTransition: null, travelIntent: null, gold: 100 };
  const storageManager = { getRepository: entity => entity === Character ? { findOne: async () => townCharacter } : {} };
  storageManager.transaction = async callback => callback(storageManager);
  const storageInventory = new InventoryService({ manager: storageManager }, null, runtimeData, null);
  await assert.rejects(() => storageInventory.transferItem('char-q1', 'quest_spring_flask', 1, 'inventory', 'warehouse'), /Quest-only items cannot be transferred to or from Storage/);

  const marketCharacterRepo = { findOne: async () => townCharacter, save: async row => row };
  const questItemManager = { getRepository: entity => entity === Character ? marketCharacterRepo : {} };
  questItemManager.transaction = async callback => callback(questItemManager);
  const lock = { withCharacterQueueLock: async (_id, callback) => callback() };
  const marketForQuestItems = new MarketService(null, null, null, null, runtimeData, lock, null, { transaction: callback => callback(questItemManager) });
  await assert.rejects(() => marketForQuestItems.placeSellOrder('char-q1', 'quest_spring_flask', 1, 10), /Quest-only items cannot be listed on the Market/);

  const rewardInstance = { questReward: { questId: baseQuest.id, marketTradable: false } };
  const marketRepoManager = {
    getRepository: entity => {
      if (entity === Character) return marketCharacterRepo;
      if (entity === MarketOrder) return { count: async () => 0 };
      if (entity === InventoryItem) return { findOne: async () => ({ id: 'ring-row', characterId: 'char-q1', location: 'inventory', itemId: 'equip_accessory_sor_t1', quantity: 1, instanceData: rewardInstance }) };
      return {};
    },
  };
  marketRepoManager.transaction = async callback => callback(marketRepoManager);
  const marketForRing = new MarketService(null, null, null, null, runtimeData, lock, null, { transaction: callback => callback(marketRepoManager) });
  await assert.rejects(() => marketForRing.placeSellOrder('char-q1', 'equip_accessory_sor_t1', 1, 100), /Quest-reward equipment cannot be listed on the Market/);

  const recipient = { id: 'char-q2', name: 'Other Tester', status: 'town', currentMapId: 'map_town', pendingMapTransition: null, travelIntent: null, gold: 0 };
  const mailManager = { getRepository: entity => {
    if (entity === Character) return { findOne: async ({ where }) => where.id === 'char-q1' ? townCharacter : recipient, save: async row => row };
    if (entity === MailMessage) return { findOne: async () => null, create: row => row };
    return {};
  } };
  mailManager.transaction = async callback => callback(mailManager);
  const mailService = new MailService(runtimeData, { transaction: callback => callback(mailManager) }, lock);
  await assert.rejects(() => mailService.sendMail('char-q1', recipient.name, 'Quest item', 'Do not transfer this', 0, 'quest_spring_flask', 1), /Quest-only items cannot be attached to Mail/);

  // Backend trade paths guard definitions/provenance; UI repeats the restrictions for usability.
  const textOf = rel => fs.readFileSync(path.join(root, rel), 'utf8');
  assert.match(textOf('apps/api/src/modules/town/town.service.ts'), /itemDefinition\.questOnly === true|item\.questOnly === true/);
  assert.match(textOf('apps/api/src/modules/market/market.service.ts'), /itemDef\.questOnly === true/);
  assert.match(textOf('apps/api/src/modules/market/market.service.ts'), /questReward\?\.marketTradable === false/);
  assert.match(textOf('apps/api/src/modules/market/market.service.ts'), /Quest-only items and quest-reward equipment cannot be purchased through the Market/);
  assert.strictEqual(textOf('apps/api/src/modules/market/market.service.ts').includes('equip_accessory_sor_t1'), false, 'Market must not block legacy ring copies by item ID');
  assert.match(textOf('apps/api/src/modules/mail/mail.service.ts'), /definition\.questOnly === true/);
  assert.match(textOf('apps/api/src/modules/mail/mail.service.ts'), /Quest-only item attachments cannot be collected from Mail/);
  assert.match(textOf('apps/api/src/modules/inventory/inventory.service.ts'), /Quest-only items cannot be transferred to or from Storage/);
  assert.match(textOf('apps/frontend/src/app/features/play/market.component.ts'), /Quest-reward equipment cannot be listed on the Market/);
  assert.match(textOf('apps/frontend/src/app/core/vendor.store.ts'), /Quest-only items cannot be attached to Mail/);
  const vendorTemplate = textOf('apps/frontend/src/app/features/play/vendor-panel.html');
  const vendorStyles = textOf('apps/frontend/src/app/features/play/vendor-panel.css');
  const globalStyles = textOf('apps/frontend/src/styles.css');
  const vendorComponent = textOf('apps/frontend/src/app/features/play/components.ts');
  assert.match(vendorTemplate, /!interactionTyping\(\)/, 'Dialogue/action controls should only appear after the typewriter finishes');
  assert.match(vendorTemplate, /npc-conversation[^>]*[\s\S]*?click.*revealInteractionText\(\)/, 'Clicking the speech box should reveal the full line');
  assert.doesNotMatch(vendorTemplate, /quest-offer-row|quest-actions-panel|quest-offer-dialogue/);
  assert.match(globalStyles, /font:18px\/1\.55 Georgia/);
  assert.match(globalStyles, /quest-action-button/);
  assert.match(globalStyles, /quest-primary-action:hover[^\{]*\{[^}]*0 0 18px/);
  assert.match(globalStyles, /crafting-open-button:hover[^\{]*\{[^}]*#9b7417/);
  assert.match(globalStyles, /#2c1e11/);
  assert.match(vendorTemplate, /choice.id==='alchemy'/);
  assert.match(vendorTemplate, /npc-conversation/);
  assert.match(vendorComponent, /The dialogue node is the source of truth for spoken text/);
  assert.doesNotMatch(vendorTemplate, /vendor\.questSpeechOverride\(\) as speech/);
  assert.doesNotMatch(vendorTemplate, /interaction\.kind==='active' && !interactionTyping\(\)/);
  assert.match(vendorComponent, /this.displayedInteractionText.set\(this.interactionTextTarget\)/);
  assert.match(vendorComponent, /this.interactionTyping.set\(false\)/);

  // Public mirrors and the no-normal-drop invariant are part of the catalogue contract.
  for (const name of ['items.json', 'npc_catalog.json', 'quests.json']) {
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')), JSON.parse(fs.readFileSync(path.join(root, 'apps/frontend/public/data', name), 'utf8')));
  }
  assert.ok(npcs.npcs.some(npc => npc.id === 'father_marcelus' && npc.types.includes('dialogue')));
  assert.ok(npcs.npcs.some(npc => npc.id === 'cecilia' && !(npc.types || []).includes('quest')));
  console.log('Quest standardization: catalogue validation, level gates, final-step acceptance, active limit, cleanup isolation, atomic capacity rejection, per-instance ring provenance, trade guards and mirror parity passed.');
}
run().catch(error => { console.error(error); process.exit(1); });
