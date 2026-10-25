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
  assert.strictEqual(bootData.getQuests().quests.length, 1);

  // Cecilia's approved delivery contract and instance-specific item metadata.
  assert.strictEqual(baseQuest.repeatable, false);
  assert.deepStrictEqual(baseQuest.objectives[0].items, [
    { itemId: 'part_slime_common', quantity: 20 },
    { itemId: 'part_fieldbat_common', quantity: 20 },
    { itemId: 'part_thornsprout_common', quantity: 10 },
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
  assert.strictEqual(offer.acceptsQuest, undefined);
  let state = await availableHarness.service.advanceOffer(availableHarness.character.id, locked.id);
  assert.strictEqual(state.accepted, false);
  state = await availableHarness.service.advanceOffer(availableHarness.character.id, locked.id);
  assert.strictEqual(state.accepted, false);
  state = await availableHarness.service.advanceOffer(availableHarness.character.id, locked.id);
  assert.strictEqual(state.accepted, true);
  assert.strictEqual(availableHarness.instanceRows.filter(row => row.status === 'active').length, 1);
  await assert.rejects(() => availableHarness.service.advanceOffer(availableHarness.character.id, locked.id), /Quest is not currently available/);
  assert.strictEqual(availableHarness.instanceRows.filter(row => row.status === 'active').length, 1);

  // Active limit is checked transactionally at final acceptance.
  const many = Array.from({ length: 6 }, (_, i) => ({ ...baseQuest, id: `limit_quest_${i}`, title: `Limit ${i}` }));
  const limitData = { ...harness().data, getQuests: () => ({ quests: many }) };
  const limitHarness = harness({ data: limitData });
  for (let i = 0; i < 5; i++) {
    await limitHarness.service.getOffer(limitHarness.character.id, many[i].id);
    await limitHarness.service.advanceOffer(limitHarness.character.id, many[i].id);
    await limitHarness.service.advanceOffer(limitHarness.character.id, many[i].id);
    const accepted = await limitHarness.service.advanceOffer(limitHarness.character.id, many[i].id);
    assert.strictEqual(accepted.accepted, true);
  }
  await limitHarness.service.getOffer(limitHarness.character.id, many[5].id);
  await limitHarness.service.advanceOffer(limitHarness.character.id, many[5].id);
  await limitHarness.service.advanceOffer(limitHarness.character.id, many[5].id);
  await assert.rejects(() => limitHarness.service.advanceOffer(limitHarness.character.id, many[5].id), /at most 5 active quests/);
  assert.strictEqual(limitHarness.instanceRows.filter(row => row.status === 'active').length, 5);

  // Abandonment removes only quest-only stacks tagged with that quest instance.
  const abandonQuest = { ...baseQuest, id: 'test_abandon_cleanup' };
  const abandonInstance = { id: 'instance-owned', characterId: 'char-q1', questId: abandonQuest.id, status: 'active', progress: {}, acceptedAt: new Date(), expiresAt: null, completedAt: null };
  const owned = { id: 'owned', characterId: 'char-q1', location: 'inventory', slotIndex: 0, itemId: 'quest_spring_flask', quantity: 2, instanceData: { questInstanceId: abandonInstance.id } };
  const other = { id: 'other', characterId: 'char-q1', location: 'inventory', slotIndex: 1, itemId: 'quest_spring_flask', quantity: 3, instanceData: { questInstanceId: 'different-instance' } };
  const cleanupData = { ...harness().data, getQuests: () => ({ quests: [abandonQuest] }) };
  const cleanup = harness({ data: cleanupData, instances: [abandonInstance], inventory: [owned, other] });
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
    { id: 'thorn', characterId: 'char-q1', location: 'inventory', slotIndex: 2, itemId: 'part_thornsprout_common', quantity: 10, instanceData: null },
  ];
  const ceciliaInstance = { id: 'cecilia-instance', characterId: 'char-q1', questId: baseQuest.id, status: 'active', progress: {}, acceptedAt: new Date(), expiresAt: null, completedAt: null };
  const turnin = harness({ instances: [ceciliaInstance], inventory: required });
  await turnin.service.turnIn(turnin.character.id, ceciliaInstance.id);
  assert.strictEqual(turnin.instanceRows[0].status, 'completed');
  assert.strictEqual(turnin.invRows.filter(row => ['part_slime_common', 'part_fieldbat_common', 'part_thornsprout_common'].includes(row.itemId)).length, 0);
  const rewardRing = turnin.invRows.find(row => row.itemId === 'equip_accessory_sor_t1');
  assert.deepStrictEqual(rewardRing.instanceData.questReward, { questId: baseQuest.id, marketTradable: false });

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
  assert.strictEqual((await completedOnce.service.getAvailable(completedOnce.character.id)).some(row => row.id === baseQuest.id), false);
  const repeatable = { ...baseQuest, id: 'test_repeatable', repeatable: true };
  const priorCompletion = { ...completedOneOff, id: 'repeatable-completion', questId: repeatable.id };
  const repeats = harness({ data: { ...harness().data, getQuests: () => ({ quests: [repeatable] }) }, instances: [priorCompletion] });
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

  // Public mirrors and the no-normal-drop invariant are part of the catalogue contract.
  for (const name of ['items.json', 'npc_catalog.json', 'quests.json']) {
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')), JSON.parse(fs.readFileSync(path.join(root, 'apps/frontend/public/data', name), 'utf8')));
  }
  assert.ok(npcs.npcs.some(npc => npc.id === 'father_marcelus' && npc.types.includes('dialogue')));
  assert.ok(npcs.npcs.some(npc => npc.id === 'cecilia' && !(npc.types || []).includes('quest')));
  console.log('Quest standardization: catalogue validation, level gates, final-step acceptance, active limit, cleanup isolation, atomic capacity rejection, per-instance ring provenance, trade guards and mirror parity passed.');
}
run().catch(error => { console.error(error); process.exit(1); });
