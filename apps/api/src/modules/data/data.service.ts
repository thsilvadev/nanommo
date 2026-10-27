import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import type { StatusEffectDefinition } from '@nanommo/shared';

@Injectable()
export class DataService implements OnModuleInit {
  private readonly logger = new Logger(DataService.name);

  // Cached data
  private items: any = null;
  private monsters: any = null;
  private maps: any = null;
  private skillTrees: any = null;
  private statusEffects: any = null;
  private gambitCatalog: any = null;
  private charXpCurve: any = null;
  private weaponXpCurve: any = null;
  private npcVendor: any = null;
  private npcCatalog: any = null;
  private cookingRecipes: any = null;
  private alchemyRecipes: any = null;
  private blacksmithRecipes: any = null;
  private globalItemDrops: any = null;
  private quests: any = null;

  onModuleInit() {
    this.loadAllData();
  }

  private loadAllData() {
    try {
      const dataDir = path.join(process.cwd(), '../../');

      this.items = this.loadJsonFile(path.join(dataDir, 'items.json'));
      this.monsters = this.loadJsonFile(path.join(dataDir, 'monsters.json'));
      this.maps = this.loadJsonFile(path.join(dataDir, 'maps.json'));
      this.skillTrees = this.loadJsonFile(path.join(dataDir, 'skill_trees.json'));
      this.statusEffects = this.loadJsonFile(path.join(dataDir, 'status_effects.json'));
      this.gambitCatalog = this.loadJsonFile(path.join(dataDir, 'gambit_catalog.json'));
      this.charXpCurve = this.loadJsonFile(path.join(dataDir, 'char_xp_curve.json'));
      this.weaponXpCurve = this.loadJsonFile(path.join(dataDir, 'weapon_xp_curve.json'));
      this.npcVendor = this.loadJsonFile(path.join(dataDir, 'npc_vendor.json'));
      this.npcCatalog = this.loadJsonFile(path.join(dataDir, 'npc_catalog.json'));
      this.cookingRecipes = this.loadJsonFile(path.join(dataDir, 'cooking_recipes.json'));
      this.alchemyRecipes = this.loadJsonFile(path.join(dataDir, 'alchemy_recipes.json'));
      this.blacksmithRecipes = this.loadJsonFile(path.join(dataDir, 'blacksmith_recipes.json'));
      this.globalItemDrops = this.loadJsonFile(path.join(dataDir, 'global_item_drops.json'));
      this.quests = this.loadJsonFile(path.join(dataDir, 'quests.json'));

      this.validateCatalogues();
      this.logger.log('All data files loaded successfully');
    } catch (error) {
      this.logger.error('Failed to load data files', error);
      throw error;
    }
  }

  private validateCatalogues(): void {
    const maps = this.maps?.maps;
    const monsters = this.monsters?.monsters;
    if (!Array.isArray(maps) || !Array.isArray(monsters)) throw new Error('maps.json and monsters.json must contain maps/species arrays');
    const monsterIds = new Set<string>();
    for (const monster of monsters) {
      if (!monster?.id || monsterIds.has(monster.id)) throw new Error(`Duplicate or missing monster ID: ${monster?.id}`);
      monsterIds.add(monster.id);
      if (typeof monster.isAggressive !== 'boolean' || !Number.isFinite(Number(monster.moveSpd)) || Number(monster.moveSpd) < 0) throw new Error(`Monster ${monster.id} must define boolean isAggressive and non-negative moveSpd`);
      const passiveMonsterIds = new Set(['mon_slime', 'mon_thornsprout', 'mon_saltfangcrab', 'mon_moonleafarcanist', 'mon_giantmantis']);
      if (monster.isAggressive === passiveMonsterIds.has(monster.id)) throw new Error(`Unexpected isAggressive value for ${monster.id}`);
      for (const field of ['level', 'hp', 'atk', 'matk', 'def', 'accuracy', 'evasion', 'xpReward']) {
        if (!Number.isFinite(Number(monster[field])) || Number(monster[field]) < (field === 'level' || field === 'hp' || field === 'xpReward' ? 1 : 0)) {
          throw new Error(`Invalid ${field} for monster ${monster.id}`);
        }
      }
    }
    const materials = this.items?.materials;
    if (!Array.isArray(materials)) throw new Error('items.json must define a materials array');
    const materialIds = new Set<string>();
    for (const material of materials) {
      if (!material?.id || materialIds.has(material.id) || material.type !== 'material' || !material.stackable || Number(material.maxStack) < 1) throw new Error(`Invalid or duplicate material definition: ${material?.id}`);
      materialIds.add(material.id);
    }
    const meatOwners = monsters.filter((monster: any) => (monster.drops ?? []).some((drop: any) => drop.itemId === 'mat_meat' && Number(drop.chance) === 0.2)).map((monster: any) => monster.id).sort();
    if (meatOwners.join(',') !== 'mon_direwolf,mon_needlebackstalker') throw new Error('Meat must have an independent 20% drop only from Dire Wolf and Needleback Stalker');

    // Town NPC placement is catalog-owned, not hardcoded in the frontend. A
    // future Town map must declare the same canonical Storage ID and resolve every
    // referenced NPC. William lives in npc_vendor.json; quest/Storage IDs live in
    // npc_catalog.json.
    const npcRows = Array.isArray(this.npcCatalog?.npcs) ? this.npcCatalog.npcs : [];
    const questRows = Array.isArray(this.quests?.quests) ? this.quests.quests : null;
    if (!questRows) throw new Error('quests.json must define a quests array');
    const npcIds = new Set<string>();
    for (const npc of npcRows) {
      if (!npc?.id || npcIds.has(npc.id)) throw new Error(`Duplicate or missing NPC ID: ${npc?.id}`);
      npcIds.add(npc.id);
    }
    const vendorId = String(this.npcVendor?.id ?? '');
    if (!vendorId || npcIds.has(vendorId)) throw new Error(`Duplicate or missing standalone Vendor NPC ID: ${vendorId}`);
    const validNpcIds = new Set([...npcIds, vendorId]);
    const validTownNpcIds = new Set([...npcRows.filter((npc: any) => npc.location === 'town').map((npc: any) => npc.id), ...(this.npcVendor?.location === 'town' ? [vendorId] : [])]);
    const storageRows = npcRows.filter((npc: any) => npc.id === 'storage');
    const storageMonologue = "You know I have a name, right? But you'll keep calling me Storage anyway.";
    if (storageRows.length !== 1 || storageRows[0].name !== 'Storage' || storageRows[0].location !== 'town' ||
      !Array.isArray(storageRows[0].types) || storageRows[0].types.length !== 1 || storageRows[0].types[0] !== 'storage' ||
      storageRows[0].monologue !== storageMonologue) {
      throw new Error('npc_catalog.json must define exactly one canonical Storage NPC with the approved name, town location, storage-only capability and exact monologue');
    }
    const mailboxRows = npcRows.filter((npc: any) => npc.id === 'mailbox');
    if (mailboxRows.length !== 1 || mailboxRows[0].name !== 'Mailbox' || mailboxRows[0].location !== 'town' ||
      !Array.isArray(mailboxRows[0].types) || mailboxRows[0].types.length !== 1 || mailboxRows[0].types[0] !== 'mailbox') {
      throw new Error('npc_catalog.json must define exactly one canonical Mailbox NPC with the mailbox-only capability');
    }
    const townMaps = maps.filter((map: any) => map?.type === 'town');
    if (townMaps.length === 0) throw new Error('maps.json must define at least one map with type=town');
    for (const map of maps) {
      if (map.npcIds !== undefined && !Array.isArray(map.npcIds)) throw new Error(`Map ${map.id} npcIds must be an array when provided`);
      const seenNpcIds = new Set<string>();
      for (const npcId of (Array.isArray(map.npcIds) ? map.npcIds : [])) {
        if (seenNpcIds.has(npcId)) throw new Error(`Map ${map.id} duplicates NPC reference ${npcId}`);
        if (!validNpcIds.has(npcId)) throw new Error(`Map ${map.id} references missing NPC ${npcId}`);
        seenNpcIds.add(npcId);
      }
      if (map.type === 'town' && !seenNpcIds.has('storage')) throw new Error(`Town map ${map.id} must reference canonical Storage NPC`);
      if (map.type === 'town' && !seenNpcIds.has('mailbox')) throw new Error('Town map ' + map.id + ' must reference canonical Mailbox NPC');
    }

    const recipeRows = Array.isArray(this.cookingRecipes?.recipes) ? this.cookingRecipes.recipes : null;
    if (!recipeRows || recipeRows.length !== 7) throw new Error('cooking_recipes.json must define exactly seven recipes');
    const recipeIds = new Set<string>();
    const itemIds = new Set([...(this.items.consumables || []), ...(this.items.equipment || []), ...(this.items.monsterParts || []), ...(this.items.materials || [])].map((item: any) => item.id));
    const orderedRecipes = [...recipeRows].sort((a: any, b: any) => Number(a.order) - Number(b.order));
    for (const recipe of recipeRows) {
      if (!recipe?.id || recipeIds.has(recipe.id) || !Number.isInteger(Number(recipe.requiredLevel)) || Number(recipe.requiredLevel) < 1 || !Number.isInteger(Number(recipe.xpReward)) || Number(recipe.xpReward) < 1 || !Number.isInteger(Number(recipe.order))) throw new Error(`Invalid or duplicate Cooking recipe ${recipe?.id}`);
      recipeIds.add(recipe.id);
      const output = this.getItemById(recipe.outputItemId);
      if (!output || output.type !== 'food' || output.effect?.type !== 'food_buff') throw new Error(`Cooking recipe ${recipe.id} references invalid food output ${recipe.outputItemId}`);
      if (!Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0) throw new Error(`Cooking recipe ${recipe.id} requires ingredients`);
      for (const ingredient of recipe.ingredients) if (!itemIds.has(ingredient.itemId) || !this.items.materials.some((x: any) => x.id === ingredient.itemId) || !Number.isInteger(Number(ingredient.quantity)) || Number(ingredient.quantity) < 1) throw new Error(`Cooking recipe ${recipe.id} references invalid ingredient ${ingredient.itemId}`);
    }
    if (new Set(recipeRows.map((x: any) => x.order)).size !== recipeRows.length || orderedRecipes.some((x: any, i: number) => x.order !== i + 1)) throw new Error('Cooking recipe order must be unique and contiguous from 1');
    const recipeOutputs = orderedRecipes.map((x: any) => x.outputItemId).join(',');
    if (recipeOutputs !== 'food_bread,food_blueberry,food_cheese,food_herbtea,food_honey,food_stew,food_roast') throw new Error('Cooking recipe order/output catalogue differs from the approved progression');

    const uncle = npcRows.filter((npc: any) => npc.id === 'uncle_phillip');
    if (uncle.length !== 1 || uncle[0].name !== 'Uncle Phillip' || uncle[0].location !== 'town' || JSON.stringify(uncle[0].types) !== '["cooking"]' || uncle[0].greeting !== 'Hmmm… delicious… this might go well with tha - Oy! Young traveler! I know you have a great taste for food. You wanna use my kitchen? Fell free to, oy!') throw new Error('npc_catalog.json must define Uncle Phillip with the canonical greeting and cooking-only capability');
    const questIds = new Set<string>();
    const validItemRows = [...(this.items.consumables || []), ...(this.items.equipment || []), ...(this.items.monsterParts || []), ...(this.items.materials || [])];
    const validItemIds = new Set(validItemRows.map((x: any) => String(x.id)));
    for (const item of validItemRows) {
      if (item.questOnly !== undefined && typeof item.questOnly !== 'boolean') throw new Error(`Item ${item.id} questOnly must be boolean`);
      if (item.questOnly === true && (item.stackable !== true || !Number.isInteger(Number(item.maxStack)) || Number(item.maxStack) < 2)) throw new Error(`Quest-only item ${item.id} must be a stackable Inventory item`);
    }
    for (const quest of questRows) {
      if (!quest?.id || questIds.has(quest.id)) throw new Error(`Duplicate or missing quest ID: ${quest?.id}`);
      questIds.add(quest.id);
      if (!quest.title || !quest.description || !validNpcIds.has(quest.giverNpcId) || !validNpcIds.has(quest.turnInNpcId) || !validTownNpcIds.has(quest.giverNpcId) || !validTownNpcIds.has(quest.turnInNpcId)) throw new Error(`Quest ${quest.id} has invalid title/description/giver/turn-in Town NPC`);
      if (!Number.isInteger(Number(quest.minLevel)) || Number(quest.minLevel) < 1) throw new Error(`Quest ${quest.id} has invalid minLevel`);
      if (quest.timeLimitSeconds !== null && quest.timeLimitSeconds !== undefined && (!Number.isInteger(Number(quest.timeLimitSeconds)) || Number(quest.timeLimitSeconds) < 1)) throw new Error(`Quest ${quest.id} has invalid timeLimitSeconds`);
      if (typeof quest.repeatable !== 'boolean' || typeof quest.allowReacceptAfterAbandon !== 'boolean') throw new Error(`Quest ${quest.id} must define repeatability and reacceptance policy`);
      if (!Array.isArray(quest.requiresCompletedQuestIds) || quest.requiresCompletedQuestIds.some((id: string) => typeof id !== 'string')) throw new Error(`Quest ${quest.id} must define prerequisite IDs`);
      if (!Array.isArray(quest.offerDialogue) || !quest.offerDialogue.length || quest.offerDialogue.filter((step: any) => step?.acceptsQuest === true).length !== 1 || quest.offerDialogue[quest.offerDialogue.length - 1]?.acceptsQuest !== true) throw new Error(`Quest ${quest.id} must have exactly one decisive final offer step`);
      for (const step of quest.offerDialogue) if (!step?.npcText || !step?.buttonText) throw new Error(`Quest ${quest.id} has malformed offer dialogue`);
      if (quest.activeDialogue !== undefined && (!quest.activeDialogue || typeof quest.activeDialogue.npcText !== 'string' || !quest.activeDialogue.npcText.trim() || typeof quest.activeDialogue.waitButtonText !== 'string' || !quest.activeDialogue.waitButtonText.trim())) throw new Error(`Quest ${quest.id} has malformed activeDialogue`);
      if (quest.completionDialogue !== undefined && (!quest.completionDialogue || typeof quest.completionDialogue.npcText !== 'string' || !quest.completionDialogue.npcText.trim() || typeof quest.completionDialogue.buttonText !== 'string' || !quest.completionDialogue.buttonText.trim())) throw new Error(`Quest ${quest.id} has malformed completionDialogue`);
      if (!Array.isArray(quest.objectives) || !quest.objectives.length) throw new Error(`Quest ${quest.id} must define objectives`);
      const objectiveIds = new Set<string>();
      for (const objective of quest.objectives) {
        if (!objective?.id || objectiveIds.has(objective.id)) throw new Error(`Quest ${quest.id} has duplicate/missing objective ID`);
        objectiveIds.add(objective.id);
        if (!['kill_monster','npc_action','deliver_items','gathering_bonus','monster_drop'].includes(objective.type)) throw new Error(`Quest ${quest.id}/${objective.id} has unsupported objective type`);
        if (objective.quantity !== undefined && (!Number.isInteger(Number(objective.quantity)) || Number(objective.quantity) < 1)) throw new Error(`Quest ${quest.id}/${objective.id} has invalid quantity`);
        for (const id of [...(objective.monsterIds ?? []), ...(objective.mapIds ?? [])]) {
          if (objective.monsterIds?.includes(id) && !monsterIds.has(id)) throw new Error(`Quest ${quest.id} references missing monster ${id}`);
          if (objective.mapIds?.includes(id) && !maps.some((m: any) => m.id === id)) throw new Error(`Quest ${quest.id} references missing map ${id}`);
        }
        if (objective.npcId && (!validNpcIds.has(objective.npcId) || !validTownNpcIds.has(objective.npcId))) throw new Error(`Quest ${quest.id} references missing Town NPC ${objective.npcId}`);
        if (objective.type === 'kill_monster' && (!Array.isArray(objective.monsterIds) || !objective.monsterIds.length || !Number.isInteger(Number(objective.quantity)) || Number(objective.quantity) < 1)) throw new Error(`Quest ${quest.id}/${objective.id} requires monsterIds and positive kill quantity`);
        if (objective.type === 'npc_action' && !objective.npcId) throw new Error(`Quest ${quest.id}/${objective.id} requires npcId`);
        if (objective.type === 'deliver_items') {
          if (!Array.isArray(objective.items) || !objective.items.length) throw new Error(`Quest ${quest.id} delivery objective requires items`);
          for (const req of objective.items) {
            const deliveryItem = validItemRows.find((x: any) => x.id === req.itemId);
            if (!validItemIds.has(req.itemId) || deliveryItem?.questOnly === true || !Number.isInteger(Number(req.quantity)) || Number(req.quantity) < 1) throw new Error(`Quest ${quest.id} has invalid ordinary delivery item ${req.itemId}`);
          }
        }
        if (objective.type === 'gathering_bonus') {
          if (!Array.isArray(objective.mapIds) || !objective.mapIds.length || !Number.isFinite(Number(objective.chancePercent)) || Number(objective.chancePercent) < 0 || Number(objective.chancePercent) > 100 || !validItemIds.has(objective.containerItem) || !validItemRows.find((x: any) => x.id === objective.containerItem && x.questOnly === true)) throw new Error(`Quest ${quest.id}/${objective.id} has invalid Gathering quest item/chance/maps`);
          for (const mapId of objective.mapIds) if (!maps.some((m: any) => m.id === mapId && m.type === 'grind')) throw new Error(`Quest ${quest.id} Gathering objective references non-Grind map ${mapId}`);
        }
        if (objective.type === 'monster_drop' && (!objective.itemId || !validItemIds.has(objective.itemId) || !Number.isFinite(Number(objective.chancePercent)) || Number(objective.chancePercent) < 0 || Number(objective.chancePercent) > 100)) throw new Error(`Quest ${quest.id}/${objective.id} has invalid monster-drop item/chance`);
        if (objective.itemQuantity !== undefined && (!Number.isInteger(Number(objective.itemQuantity)) || Number(objective.itemQuantity) < 1)) throw new Error(`Quest ${quest.id}/${objective.id} has invalid itemQuantity`);
        if (objective.type === 'monster_drop' && validItemRows.find((x: any) => x.id === objective.itemId)?.questOnly !== true) throw new Error(`Quest ${quest.id}/${objective.id} monster drop must grant a quest-only item`);
      }
      const rewards = quest.rewards ?? {};
      if (typeof rewards !== 'object' || Array.isArray(rewards)) throw new Error(`Quest ${quest.id} rewards must be an object`);
      for (const key of Object.keys(rewards)) if (!['gold','characterXp','items','professionXp'].includes(key)) throw new Error(`Quest ${quest.id} has unsupported reward type ${key}`);
      for (const field of ['gold','characterXp']) if (rewards[field] !== undefined && (!Number.isSafeInteger(Number(rewards[field])) || Number(rewards[field]) < 0)) throw new Error(`Quest ${quest.id} has invalid ${field} reward`);
      if (rewards.gold !== undefined && Number(rewards.gold) > 999999999) throw new Error(`Quest ${quest.id} gold reward exceeds shared Market cap`);
      if (rewards.items !== undefined && !Array.isArray(rewards.items)) throw new Error(`Quest ${quest.id} rewards.items must be an array`);
      for (const reward of (rewards.items ?? [])) {
        const rewardItem = validItemRows.find((x: any) => x.id === reward.itemId);
        if (!validItemIds.has(reward.itemId) || !Number.isInteger(Number(reward.quantity)) || Number(reward.quantity) < 1 || (rewardItem?.type === 'equipment' && Number(reward.quantity) !== 1)) throw new Error(`Quest ${quest.id} has invalid item reward ${reward.itemId}`);
      }
      if (rewards.professionXp !== undefined && !Array.isArray(rewards.professionXp)) throw new Error(`Quest ${quest.id} rewards.professionXp must be an array`);
      for (const reward of (rewards.professionXp ?? [])) if (!['gathering','cooking','alchemy','blacksmith'].includes(reward.profession) || !Number.isSafeInteger(Number(reward.amount)) || Number(reward.amount) < 0) throw new Error(`Quest ${quest.id} has invalid profession XP reward`);
    }
    for (const quest of questRows) for (const prerequisite of quest.requiresCompletedQuestIds) if (!questIds.has(prerequisite) || prerequisite === quest.id) throw new Error(`Quest ${quest.id} has invalid prerequisite ${prerequisite}`);

    for (const map of maps) {
      const hasUncle = (map.npcIds ?? []).includes('uncle_phillip');
      if (hasUncle !== (map.id === 'map_town')) throw new Error('Uncle Phillip must be listed only in Sierra Village (map_town)');
    }

    const mapIds = new Set<string>();
    const coordinates = new Set<string>();
    const exactGatheringAllowList = new Map<string, Set<string>>([
      ['map_green_grounds_0', new Set(['mat_wheat', 'mat_milk'])],
      ['map_green_grounds_1', new Set(['mat_cabbage', 'mat_carrot', 'mat_honeycomb'])],
      ['map_green_grounds_2', new Set(['mat_cabbage', 'mat_carrot'])],
      ['map_green_grounds_3', new Set(['mat_wheat'])],
      ['map_green_grounds_4', new Set(['mat_sugar', 'mat_honeycomb'])],
      ['map_green_grounds_5', new Set(['mat_sugar'])],
      ['map_menace_hills_0', new Set(['mat_wild_blueberries'])],
      ['map_menace_hills_1', new Set(['mat_wild_blueberries'])],
      ['map_menace_hills_3', new Set(['mat_wild_blueberries'])],
      ['map_ipora_beach_0', new Set(['mat_cooking_oil'])],
      ['map_ipora_beach_1', new Set(['mat_cooking_oil'])],
      ['map_wastelands_0', new Set(['mat_bronze_ore'])],
      ['map_wastelands_1', new Set(['mat_bronze_ore'])],
      ['map_wastelands_2', new Set(['mat_bronze_ore'])],
      ['map_menace_hills_2', new Set(['mat_bronze_ore'])],
    ]);
    for (const map of maps) {
      if (/^map_kwaioua_forest_[0-7]$/.test(String(map.id)) || /^map_forest_ruins_[0-3]$/.test(String(map.id)) || /^map_caete_[0-7]$/.test(String(map.id))) {
        exactGatheringAllowList.set(String(map.id), new Set(['mat_herbs']));
      }
    }
    for (const map of maps) {
      if (!map?.id || mapIds.has(map.id)) throw new Error(`Duplicate or missing map ID: ${map?.id}`);
      mapIds.add(map.id);
      const coord = `${Number(map.coordinates?.x)},${Number(map.coordinates?.y)}`;
      if (!Number.isFinite(Number(map.coordinates?.x)) || !Number.isFinite(Number(map.coordinates?.y)) || coordinates.has(coord)) throw new Error(`Invalid or duplicate map coordinates for ${map.id}`);
      coordinates.add(coord);
      if (!Array.isArray(map.monsters)) throw new Error(`Map ${map.id} must define a monster roster`);
      if (map.mapLength === undefined || !Number.isFinite(Number(map.mapLength)) || Number(map.mapLength) < 0) throw new Error(`Invalid mapLength for ${map.id}`);
      if (map.type === 'town' && Number(map.mapLength) !== 0) throw new Error(`Town map ${map.id} must have mapLength 0`);
      if (map.type === 'grind' && Number(map.mapLength) < 25) throw new Error(`Grind map ${map.id} must have mapLength >= 25`);
      if (map.type === 'town' && map.gatheringPool !== undefined) throw new Error(`Town map ${map.id} must not define a gatheringPool`);
      const allowedGatherables = exactGatheringAllowList.get(String(map.id)) ?? new Set<string>();
      if (map.type === 'grind' && allowedGatherables.size === 0 && map.gatheringPool !== undefined) throw new Error(`Grind map ${map.id} has no regional assignment and must omit gatheringPool`);
      if (map.type === 'grind' && allowedGatherables.size > 0 && (!Array.isArray(map.gatheringPool) || map.gatheringPool.length === 0)) throw new Error(`Grind map ${map.id} must define its assigned gatheringPool`);
      if (map.type === 'grind' && map.gatheringPool !== undefined) {
        if (!Array.isArray(map.gatheringPool)) throw new Error(`Map ${map.id} gatheringPool must be an array`);
        const poolTotal = map.gatheringPool.reduce((sum: number, entry: any) => sum + Number(entry.weight ?? 0), 0);
        if (Math.abs(poolTotal - 100) > 0.001) throw new Error(`Gathering weights for ${map.id} sum to ${poolTotal}, not 100`);
        for (const entry of map.gatheringPool) {
          const item = [...(this.items?.materials ?? [])].find((candidate: any) => candidate.id === entry.itemId);
          if (!item || item.type !== 'material') throw new Error(`Map ${map.id} gathering pool references non-material ${entry.itemId}`);
          if (entry.itemId === 'mat_meat') throw new Error('Meat cannot appear in a gathering pool');
          if (!Number.isFinite(Number(entry.weight)) || Number(entry.weight) < 0) throw new Error(`Map ${map.id} has invalid gathering weight for ${entry.itemId}`);
          if (!allowedGatherables.has(String(entry.itemId))) throw new Error(`Map ${map.id} cannot gather ${entry.itemId}; regional assignment does not allow it`);
        }
      }
      if (map.type === 'grind') {
        const total = map.monsters.reduce((sum: number, entry: any) => sum + Number(entry.presenceRate ?? 0), 0);
        if (Math.abs(total - 100) > 0.02) throw new Error(`Monster presence rates for ${map.id} sum to ${total}, not 100`);
        if (Number(map.monsters_quantity) < 1) throw new Error(`Invalid monsters_quantity for ${map.id}`);
      }
      for (const entry of map.monsters) {
        if (!monsterIds.has(entry.monsterId)) throw new Error(`Map ${map.id} references missing monster ${entry.monsterId}`);
        if (!Number.isFinite(Number(entry.presenceRate)) || Number(entry.presenceRate) < 0) throw new Error(`Invalid presenceRate in ${map.id}`);
      }
    }

    const validOutputIds = new Set(validItemRows.map((row: any) => String(row.id)));
    for (const [label, catalogue] of [['Alchemy', this.alchemyRecipes], ['Blacksmith', this.blacksmithRecipes]] as const) {
      if (!Array.isArray(catalogue?.recipes)) throw new Error(label + ' recipes must define a recipes array');
      const recipeIds = new Set<string>();
      for (const recipe of catalogue.recipes) {
        if (!recipe?.id || recipeIds.has(String(recipe.id))) throw new Error(label + ' recipes have duplicate/missing recipe IDs');
        recipeIds.add(String(recipe.id));
        if (!Number.isInteger(Number(recipe.requiredLevel)) || Number(recipe.requiredLevel) < 1 || !Number.isFinite(Number(recipe.xpReward)) || Number(recipe.xpReward) < 0) throw new Error(label + ' recipe has invalid level/XP: ' + recipe.id);
        if (!validOutputIds.has(String(recipe.outputItemId)) || !Array.isArray(recipe.ingredients) || !recipe.ingredients.length) throw new Error(label + ' recipe has invalid output/ingredients: ' + recipe.id);
        if (label === 'Alchemy' && this.getItemById(recipe.outputItemId)?.type !== 'consumable') throw new Error('Alchemy outputs must be consumables: ' + recipe.id);
        if (label === 'Blacksmith' && !['material', 'equipment'].includes(String(this.getItemById(recipe.outputItemId)?.type))) throw new Error('Blacksmith output must be a material/equipment: ' + recipe.id);
        for (const ingredient of recipe.ingredients) if (!validItemIds.has(String(ingredient.itemId)) || !Number.isInteger(Number(ingredient.quantity)) || Number(ingredient.quantity) < 1) throw new Error(label + ' recipe has invalid ingredient: ' + recipe.id);
      }
    }
    if (!Array.isArray(this.globalItemDrops?.drops) || this.globalItemDrops.drops.length < 2) throw new Error('global_item_drops.json must define independent global drops');
    for (const drop of this.globalItemDrops.drops) {
      if (!validItemIds.has(String(drop.itemId)) || !Number.isFinite(Number(drop.baseChancePercent)) || !Number.isFinite(Number(drop.perLevelIncreasePercent)) || !Number.isFinite(Number(drop.maxChancePercent)) || Number(drop.baseChancePercent) < 0 || Number(drop.perLevelIncreasePercent) < 0 || Number(drop.maxChancePercent) < Number(drop.baseChancePercent)) throw new Error('Invalid global item drop definition: ' + drop.itemId);
    }
  }

  private loadJsonFile(filePath: string): any {
    try {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      this.logger.warn(`Failed to load ${filePath}`);
      return null;
    }
  }

  // Getters
  getItems() {
    return this.items;
  }

  getMonsters() {
    return this.monsters;
  }

  getSkillTrees() {
    return this.skillTrees;
  }

  getStatusEffects(): StatusEffectDefinition[] {
    return this.statusEffects?.statusEffects ?? [];
  }

  getGambitCatalog() {
    return this.gambitCatalog;
  }

  getCharXpCurve() {
    return this.charXpCurve;
  }

  getWeaponXpCurve() {
    return this.weaponXpCurve;
  }

  getNpcVendor() {
    return this.npcVendor;
  }

  getNpcCatalog() {
    return this.npcCatalog;
  }

  getCookingRecipes() { return this.cookingRecipes; }

  getAlchemyRecipes() { return this.alchemyRecipes; }

  getBlacksmithRecipes() { return this.blacksmithRecipes; }

  getGlobalItemDrops() { return this.globalItemDrops; }

  getQuests() { return this.quests; }

  // Specific getters
  getMonsterById(monsterId: string): any {
    if (!this.monsters || !this.monsters.monsters) return null;
    return this.monsters.monsters.find((m: any) => m.id === monsterId);
  }

  getMaps(): any[] { return Array.isArray(this.maps?.maps) ? this.maps.maps : []; }

  getMapById(mapId: string): any { return this.getMaps().find((m: any) => m.id === mapId) ?? null; }

  getMonstersInMap(mapId: string): any[] {
    const map = this.getMapById(mapId);
    if (!map || !Array.isArray(map.monsters) || !Array.isArray(this.monsters?.monsters)) return [];
    const byId = new Map<string, any>(this.monsters.monsters.map((m: any) => [m.id, m]));
    return map.monsters.map((entry: any) => { const monster = byId.get(entry.monsterId); return monster ? { ...monster, weight: Number(entry.presenceRate ?? 0) } : null; }).filter(Boolean);
  }

  getItemById(itemId: string): any {
    if (!this.items) return null;
    const allItems = [
      ...(this.items.consumables || []),
      ...(this.items.equipment || []),
      ...(this.items.monsterParts || []),
      ...(this.items.materials || []),
    ];
    return allItems.find((item: any) => item.id === itemId);
  }

  getSkillById(skillId: string): any {
    if (!this.skillTrees || !this.skillTrees.trees) return null;
    for (const weaponType in this.skillTrees.trees) {
      const skills = this.skillTrees.trees[weaponType];
      const skill = skills.find((s: any) => s.id === skillId);
      if (skill) return skill;
    }
    return null;
  }

  /**
   * All skills of a weapon tree (SPEC §9.1) - the caller applies the
   * WeaponProficiency unlock gate.
   */
  getSkillsForWeapon(weaponType: string): any[] {
    return this.skillTrees?.trees?.[weaponType] ?? [];
  }

  /**
   * Monster-only skills (SPEC §9)
   */
  getMonsterSkills(): any[] {
    return this.skillTrees?.monsterSkills ?? [];
  }

  /**
   * SPEC §7.2: per-weapon base attack gauge ticks
   */
  getWeaponBaseAttackTicks(): Record<string, number> {
    return this.skillTrees?.weaponBaseAttackTicks ?? {};
  }

  getXpToNextLevel(level: number): number {
    if (!this.charXpCurve || level < 1 || level > 99) return 0;
    const entry = this.charXpCurve[level - 1];
    return entry?.xpToNext ?? 0;
  }

  getWeaponXpToNextLevel(level: number): number {
    if (!this.weaponXpCurve || level < 1 || level > 50) return 0;
    return this.weaponXpCurve[level - 1]?.xpToNext ?? 0;
  }
}
