import { Injectable, BadRequestException, NotFoundException, Logger, ConflictException, forwardRef, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Character, WeaponProficiency, GambitPage, EquippedItem, InventoryItem } from '@/database/entities';
import { CharacterDto, Attribute, WeaponType, BattleEngine, effectiveWeaponAttack, sumAttributeBonuses, applyAttributeBonuses, masteryPassiveAttributeBonuses, type AttributeBonuses, effectiveFoodStatValue } from '@nanommo/shared';
import { DataService } from '../data/data.service';
import { BattleService } from '../battle/battle.service';

@Injectable()
export class CharacterService {
  private readonly logger = new Logger(CharacterService.name);

  constructor(
    @InjectRepository(Character)
    private characterRepository: Repository<Character>,
    @InjectRepository(WeaponProficiency)
    private weaponProficiencyRepository: Repository<WeaponProficiency>,
    @InjectRepository(GambitPage)
    private gambitPageRepository: Repository<GambitPage>,
    @InjectRepository(EquippedItem)
    private equippedItemRepository: Repository<EquippedItem>,
    @InjectRepository(InventoryItem)
    private inventoryItemRepository: Repository<InventoryItem>,
    private dataService: DataService,
    @Inject(forwardRef(() => BattleService))
    private battleService: BattleService,
  ) {}

  private readonly NAME_PATTERN = /^[a-zA-Z0-9]{3,16}$/;

  private validateName(name: string): void {
    if (!this.NAME_PATTERN.test(name)) {
      throw new BadRequestException('Character name must be 3-16 alphanumeric characters');
    }
  }

  private buildEquipmentStats(equipped: EquippedItem[]) {
    const equipment = {
      def: 0,
      mdefPercent: 0,
      maxHp: 0,
      maxSp: 0,
      weaponFixedAtk: 0,
      weaponFixedMatk: 0,
      accuracyModifier: 0,
      accuracyMultiplier: 1,
      statBonus: { STR: 0, AGI: 0, DEX: 0, VIT: 0, INT: 0, LUK: 0 },
    };
    for (const row of equipped) {
      const item = this.dataService.getItemById(row.itemId);
      if (!item || item.type !== 'equipment') continue;
      equipment.def += Number(item.fixedStats?.def ?? 0);
      equipment.mdefPercent += Number(item.fixedStats?.mdefPercent ?? 0);
      equipment.maxHp += Number(item.fixedStats?.maxHp ?? 0);
      equipment.maxSp += Number(item.fixedStats?.maxSp ?? 0);
      if (row.slot === 'mainHand' || row.slot === 'offHand') {
        equipment.weaponFixedAtk += effectiveWeaponAttack(item, row.slot);
        if (row.slot === 'mainHand') equipment.weaponFixedMatk += Number(item.fixedStats?.matk ?? 0);
      }
      if (item.weaponType === 'bow') equipment.accuracyMultiplier *= 0.5;
      for (const [key, value] of Object.entries(item.fixedStats?.statBonus ?? {})) {
        if (key in equipment.statBonus && typeof value === 'number') (equipment.statBonus as any)[key] += value;
      }
      const rolledAttribute = row.instanceData?.rolledAttribute as keyof typeof equipment.statBonus | undefined;
      const rolledValue = Number(row.instanceData?.rolledValue ?? 0);
      if (rolledAttribute && rolledValue > 0 && rolledAttribute in equipment.statBonus) {
        (equipment.statBonus as any)[rolledAttribute] += rolledValue;
      }
    }
    equipment.mdefPercent = Math.min(100, Math.max(0, equipment.mdefPercent));
    return equipment;
  }

  /**
   * Learned skill definitions for the character's equipped weapon
   * categories — the same equipped-weapon gate BattleService applies
   * when building immutable combat snapshots.
   */
  private async buildLearnedSkillDefs(characterId: string, equipped: EquippedItem[]): Promise<Record<string, any>> {
    const weaponTypes: string[] = [];
    for (const row of equipped) {
      if (row.slot !== 'mainHand' && row.slot !== 'offHand') continue;
      const def = this.dataService.getItemById(row.itemId);
      if (def?.weaponType && !weaponTypes.includes(def.weaponType)) weaponTypes.push(def.weaponType);
    }
    if (weaponTypes.length === 0) return {};
    const proficiencyRows = await this.weaponProficiencyRepository.find({ where: { characterId } });
    const skillDefs: Record<string, any> = {};
    for (const weaponType of weaponTypes) {
      const ranks = proficiencyRows.find((row) => row.weaponType === weaponType)?.skillRanks ?? {};
      for (const skill of this.dataService.getSkillsForWeapon(weaponType)) {
        const rank = Math.max(0, Math.floor(Number(ranks[skill.id] ?? 0)));
        if (rank < 1) continue;
        skillDefs[skill.id] = { ...skill, masteryRank: rank };
      }
    }
    return skillDefs;
  }

  /**
   * The authoritative non-base attribute contribution (SPEC §17):
   * every modifier source — equipment stat bonuses plus learned
   * mastery passives — aggregated into one total bonus.
   */
  private async buildTotalAttributeBonuses(characterId: string, equipped: EquippedItem[], equipmentStatBonus: Record<string, number>): Promise<AttributeBonuses> {
    const skillDefs = await this.buildLearnedSkillDefs(characterId, equipped);
    return sumAttributeBonuses(equipmentStatBonus, masteryPassiveAttributeBonuses(skillDefs));
  }

  async createCharacter(userId: string, name: string, dominantHand: 'right' | 'left'): Promise<CharacterDto> {
    this.validateName(name);
    if (dominantHand !== 'right' && dominantHand !== 'left') throw new BadRequestException('dominantHand must be right or left');

    const existing = await this.characterRepository.findOne({
      where: { userId },
    });

    if (existing) {
      throw new BadRequestException('Character already exists for this user');
    }

    const duplicateName = await this.characterRepository.findOne({
      where: { name },
    });

    if (duplicateName) {
      throw new ConflictException('Character name already in use');
    }

    const baseStats = BattleEngine.calculateDerivedStats(1, {
      str: 5, agi: 5, dex: 5, vit: 5, int: 5, luk: 5,
    }, {});

    const character = this.characterRepository.create({
      userId,
      name,
      dominantHand,
      knownItemIds: this.dataService.getNpcVendor()?.sellStock?.map((row: any) => row.itemId) ?? [],
      level: 1,
      xp: 0,
      unspentAttributePoints: 0,
      str: 5,
      agi: 5,
      dex: 5,
      vit: 5,
      int: 5,
      luk: 5,
      gold: 0,
      hpCurrent: baseStats.maxHp,
      spCurrent: baseStats.maxSp,
      status: 'town',
      currentMapId: 'map_town',
      savedTownMapId: 'map_town',
      discoveredMapIds: ['map_town'],
      diet: [],
      dietLevels: {},
      autoFeed: false,
      lastSeenAt: new Date(),
      regenAnchorAt: new Date(),
    });

    const savedCharacter = await this.characterRepository.save(character);

    // Every new character starts with the canonical starter Knife equipped.
    // Dagger is one-handed and uses the semantic mainHand slot regardless of
    // the character's dominant-hand presentation preference.
    await this.equippedItemRepository.save(this.equippedItemRepository.create({
      characterId: savedCharacter.id,
      slot: 'mainHand',
      itemId: 'equip_knife',
      instanceData: null,
    }));

    await this.inventoryItemRepository.save([
      this.inventoryItemRepository.create({
        characterId: savedCharacter.id,
        location: 'inventory',
        slotIndex: 0,
        itemId: 'pot_hp_small',
        quantity: 50,
      }),
      this.inventoryItemRepository.create({
        characterId: savedCharacter.id,
        location: 'inventory',
        slotIndex: 1,
        itemId: 'food_bread',
        quantity: 5,
      }),
    ]);

    const weaponTypes: WeaponType[] = [
      WeaponType.SWORD,
      WeaponType.GREATSWORD,
      WeaponType.DAGGER,
      WeaponType.BOW,
      WeaponType.STAFF,
      WeaponType.ROD,
      WeaponType.SHIELD,
      'rune' as any,
    ];

    for (const weaponType of weaponTypes) {
      const proficiency = this.weaponProficiencyRepository.create({
        characterId: savedCharacter.id,
        weaponType,
        level: 0,
        xp: 0,
        spentSkillPoints: 0,
        skillRanks: {},
      });
      await this.weaponProficiencyRepository.save(proficiency);
    }

    let firstGambitPageId: string | undefined;
    for (let slotIndex = 0; slotIndex < 3; slotIndex++) {
      const gambitPage = this.gambitPageRepository.create({
        characterId: savedCharacter.id,
        slotIndex,
        title: slotIndex === 0 ? 'Default Gambit' : `Page ${slotIndex + 1}`,
        lines: slotIndex === 0 ? [
          { priority: 1, conditions: [{ id: 'self_hp_below_percent', params: { value: 30 } }], action: { id: 'use_item', params: { itemId: 'pot_hp_small' } }, enabled: true },
          { priority: 2, conditions: [{ id: 'always' }], action: { id: 'attack' }, enabled: true },
        ] : [],
      });
      const savedGambitPage = await this.gambitPageRepository.save(gambitPage);
      if (slotIndex === 0) firstGambitPageId = savedGambitPage.id;
    }

    savedCharacter.activeGambitPageId = firstGambitPageId;
    await this.characterRepository.save(savedCharacter);

    return await this.toDto(savedCharacter);
  }

  async getCharacterByUserId(userId: string): Promise<Character | null> {
    return this.characterRepository.findOne({
      where: { userId },
    });
  }

  async getCharacterById(characterId: string): Promise<Character | null> {
    return this.characterRepository.findOne({
      where: { id: characterId },
    });
  }

  async getWeaponProficiencyByUserId(userId: string): Promise<Array<{ weaponType: string; level: number; xp: number; spentSkillPoints: number; skillRanks: Record<string, number> }>> {
    const character = await this.getCharacterByUserId(userId);
    if (!character) throw new NotFoundException('Character not found');
    const rows = await this.weaponProficiencyRepository.find({ where: { characterId: character.id } });
    return rows.map((row) => ({ weaponType: row.weaponType, level: row.level, xp: Number(row.xp), spentSkillPoints: row.spentSkillPoints, skillRanks: row.skillRanks ?? {} }));
  }

  async applyMasteryRanks(userId: string, category: string, targetRanks: Record<string, number>): Promise<{ category: string; level: number; xp: number; spentSkillPoints: number; skillRanks: Record<string, number> }> {
    const character = await this.getCharacterByUserId(userId);
    if (!character) throw new NotFoundException('Character not found');
    if (!targetRanks || typeof targetRanks !== 'object' || Array.isArray(targetRanks)) throw new BadRequestException('targetRanks must be an object');
    const skills = this.dataService.getSkillsForWeapon(category).filter((entry: any) => !entry.hidden && !entry.deprecated);
    if (!['sword','greatsword','dagger','bow','staff','rod','shield','rune'].includes(category)) throw new BadRequestException('Unknown Mastery category');
    const allowed = new Map(skills.map((skill: any) => [skill.id, skill]));
    const ranks: Record<string, number> = {};
    for (const [id, value] of Object.entries(targetRanks)) {
      const skill: any = allowed.get(id); const rank = Number(value);
      if (!skill || !Number.isInteger(rank) || rank < 0 || rank > Number(skill.maxRank ?? 5)) throw new BadRequestException(`Invalid target rank for ${id}`);
      if (rank > 0) ranks[id] = rank;
    }
    const spent = Object.values(ranks).reduce((sum, rank) => sum + rank, 0);
    return this.battleService.runFutureCombatMutation(character.id, async () => this.weaponProficiencyRepository.manager.transaction(async (manager) => {
      const repo = manager.getRepository(WeaponProficiency);
      const row = await repo.findOne({ where: { characterId: character.id, weaponType: category }, lock: { mode: 'pessimistic_write' } });
      if (!row) throw new NotFoundException('Mastery category not found');
      if (spent > Number(row.level)) throw new BadRequestException('Target ranks exceed available Mastery points');
      const first = skills.find((skill: any) => skill.node === 1);
      for (const [id, rank] of Object.entries(ranks)) {
        const skill: any = allowed.get(id);
        if (skill.prerequisite && Number(ranks[skill.prerequisite.skillId] ?? 0) < Number(skill.prerequisite.rank)) throw new BadRequestException(`Prerequisite not met for ${id}`);
        if (skill.node !== 1 && Number(ranks[first?.id ?? ''] ?? 0) < 5) throw new BadRequestException(`First node must reach rank 5 before ${id}`);
      }
      row.skillRanks = ranks; row.spentSkillPoints = spent;
      const saved = await repo.save(row);
      return { category, level: saved.level, xp: Number(saved.xp), spentSkillPoints: saved.spentSkillPoints, skillRanks: saved.skillRanks ?? {} };
    }));
  }

  async resetMasteryForCharacterName(characterName: string): Promise<{ characterName: string; categoriesReset: number; preservedProgress: true }> {
    const matches = await this.characterRepository.find({ where: { name: characterName }, take: 2 });
    if (matches.length === 0) throw new NotFoundException('Character not found');
    if (matches.length > 1) throw new BadRequestException('Character name is ambiguous; no data was changed');
    const character = matches[0];
    return this.weaponProficiencyRepository.manager.transaction(async (manager) => {
      const repo = manager.getRepository(WeaponProficiency);
      const rows = await repo.find({ where: { characterId: character.id }, lock: { mode: 'pessimistic_write' } });
      const categories = ['sword', 'greatsword', 'dagger', 'bow', 'staff', 'rod', 'shield', 'rune'];
      const existing = new Set(rows.map((row) => row.weaponType));
      for (const category of categories) {
        if (existing.has(category)) continue;
        rows.push(repo.create({ characterId: character.id, weaponType: category, level: 0, xp: 0, skillRanks: {}, spentSkillPoints: 0 }));
      }
      for (const row of rows) { row.skillRanks = {}; row.spentSkillPoints = 0; }
      await repo.save(rows);
      this.logger.warn(`Mastery tree reset for ${character.name}; XP and levels preserved`);
      return { characterName: character.name, categoriesReset: rows.length, preservedProgress: true as const };
    });
  }

  async setAutoFeed(characterId: string, enabled: boolean): Promise<CharacterDto> {
    const character = await this.getCharacterById(characterId);
    if (!character) throw new NotFoundException('Character not found');
    character.autoFeed = enabled === true;
    await this.characterRepository.save(character);
    return this.toDto(character);
  }

  async spendAttributePoints(characterId: string, attributes: Partial<Record<Attribute, number>>): Promise<CharacterDto> {
    const character = await this.getCharacterById(characterId);
    if (!character) {
      throw new NotFoundException('Character not found');
    }

    if (attributes === null || typeof attributes !== 'object' || Array.isArray(attributes)) {
      throw new BadRequestException('attributes must be an object');
    }

    const totalToSpend = Object.values(attributes).reduce((sum, val) => sum + (val ?? 0), 0);
    if (totalToSpend > character.unspentAttributePoints) {
      throw new BadRequestException('Not enough unspent attribute points');
    }

    if (attributes.str) character.str += attributes.str;
    if (attributes.agi) character.agi += attributes.agi;
    if (attributes.dex) character.dex += attributes.dex;
    if (attributes.vit) character.vit += attributes.vit;
    if (attributes.int) character.int += attributes.int;
    if (attributes.luk) character.luk += attributes.luk;

    character.unspentAttributePoints -= totalToSpend;

    const saved = await this.battleService.runFutureCombatMutation(characterId, async () => {
      return this.characterRepository.save(character);
    });
    return await this.toDto(saved);
  }

  async getCharacterDtoByUserId(userId: string): Promise<CharacterDto | null> {
    const character = await this.getCharacterByUserId(userId);
    if (!character) return null;
    await this.applyTownRegeneration(character);
    return this.toDto(character);
  }

  async getCharacterDtoById(characterId: string): Promise<CharacterDto | null> {
    const character = await this.getCharacterById(characterId);
    if (!character) return null;
    return this.toDto(character);
  }

  async getDerivedStatsForCharacter(character: Character): Promise<{ maxHp: number; maxSp: number }> {
    const equipped = await this.equippedItemRepository.find({ where: { characterId: character.id } });
    const equipment = this.buildEquipmentStats(equipped);
    const attributeBonuses = await this.buildTotalAttributeBonuses(character.id, equipped, equipment.statBonus);
    const attrs = applyAttributeBonuses(character, attributeBonuses);
    const derived = BattleEngine.calculateDerivedStats(character.level, attrs, equipment);
    return { maxHp: derived.maxHp, maxSp: derived.maxSp };
  }

  /** Sum every food whose own digestion window is active at the requested instant. */
  private getFoodRegenAt(character: Character, atTime: number): { hp: number; sp: number; count: number; expiresAt: number } {
    const diet = Array.isArray((character as any).diet) ? (character as any).diet : [];
    let hp = 0; let sp = 0; let count = 0; let expiresAt = 0;
    for (const entry of diet) {
      const itemExpiry = Date.parse(String(entry?.digestUntil ?? ''));
      if (!entry?.itemId || !Number.isFinite(itemExpiry) || itemExpiry <= atTime) continue;
      const definition = this.dataService.getItemById(String(entry.itemId));
      if (definition?.effect?.type !== 'food_buff') continue;
      const level = Math.max(0, Math.min(3, Number(entry.dietLevel ?? 0)));
      hp += effectiveFoodStatValue(definition.effect.hpRegenPerTenTicks, level);
      sp += effectiveFoodStatValue(definition.effect.spRegenPerTenTicks, level);
      count += 1;
      expiresAt = Math.max(expiresAt, itemExpiry);
    }
    // Older rows can have an activeFoodBuff without a corresponding Diet row.
    const legacy = (character as any).activeFoodBuff;
    const legacyExpiry = legacy?.expiresAt ? Date.parse(String(legacy.expiresAt)) : 0;
    if (count === 0 && legacy && Number.isFinite(legacyExpiry) && legacyExpiry > atTime) {
      hp = Number(legacy.hpRegenPerTenTicks ?? 0);
      sp = Number(legacy.spRegenPerTenTicks ?? 0);
      count = 1;
      expiresAt = legacyExpiry;
    }
    return { hp, sp, count, expiresAt };
  }

  private async applyTownRegeneration(character: Character): Promise<void> {
    if (character.status !== 'town') return;

    const now = Date.now();
    const last = character.lastSeenAt?.getTime?.() ?? now;
    const elapsedTicks = Math.max(0, Math.floor((now - last) / 1000));
    const tenTickPeriods = Math.floor(elapsedTicks / 10);
    if (tenTickPeriods <= 0) return;

    const equipped = await this.equippedItemRepository.find({ where: { characterId: character.id } });
    const equipment = this.buildEquipmentStats(equipped);
    const attributeBonuses = await this.buildTotalAttributeBonuses(character.id, equipped, equipment.statBonus);
    const attrs = applyAttributeBonuses(character, attributeBonuses);
    const derived = BattleEngine.calculateDerivedStats(character.level, attrs, equipment);
    let hpGain = 0;
    let spGain = 0;
    // Food slots can expire at different instants. Evaluate each 10-tick boundary
    // independently, so one food stops contributing without removing the others.
    for (let period = 1; period <= tenTickPeriods; period += 1) {
      const boundaryAt = last + period * 10_000;
      const food = this.getFoodRegenAt(character, boundaryAt);
      hpGain += derived.hpRegenPerTenTicks + food.hp;
      spGain += derived.spRegenPerTenTicks + food.sp;
    }
    character.hpCurrent = Math.min(derived.maxHp, character.hpCurrent + hpGain);
    character.spCurrent = Math.min(derived.maxSp, character.spCurrent + spGain);
    if (character.activeFoodBuff?.expiresAt && new Date(character.activeFoodBuff.expiresAt).getTime() <= now) {
      character.activeFoodBuff = null;
    }
    character.lastSeenAt = new Date(last + tenTickPeriods * 10_000);
    await this.characterRepository.save(character);
  }

  private async toDto(character: Character): Promise<CharacterDto> {
    if (!Array.isArray(character.diet)) character.diet = [];
    if (!character.dietLevels) character.dietLevels = {};
    const activeDiet = character.diet;
    const foodState = this.getFoodRegenAt(character, Date.now());
    const equipped = await this.equippedItemRepository.find({ where: { characterId: character.id } });
    const equipment = this.buildEquipmentStats(equipped);
    const attributeBonuses = await this.buildTotalAttributeBonuses(character.id, equipped, equipment.statBonus);
    const attrs = applyAttributeBonuses(character, attributeBonuses);
    const derived = BattleEngine.calculateDerivedStats(character.level, attrs, equipment);
    return {
      id: character.id,
      userId: character.userId,
      name: character.name,
      dominantHand: character.dominantHand ?? 'right',
      knownItemIds: character.knownItemIds ?? [],
      level: character.level,
      xp: character.xp,
      xpToNext: this.dataService.getXpToNextLevel(character.level),
      unspentAttributePoints: character.unspentAttributePoints,
      str: character.str,
      agi: character.agi,
      dex: character.dex,
      vit: character.vit,
      int: character.int,
      luk: character.luk,
      attributeBonuses: {
        STR: attributeBonuses.STR,
        AGI: attributeBonuses.AGI,
        DEX: attributeBonuses.DEX,
        VIT: attributeBonuses.VIT,
        INT: attributeBonuses.INT,
        LUK: attributeBonuses.LUK,
      },
      gold: Number(character.gold),
      hpCurrent: character.hpCurrent,
      spCurrent: character.spCurrent,
      maxHp: derived.maxHp,
      maxSp: derived.maxSp,
      attack: derived.atk,
      magicAttack: derived.matk,
      defense: derived.def,
      attackSpeed: derived.attackSpeed,
      castTimeReduction: derived.castTimeReduction,
      evasion: derived.evasion,
      accuracy: derived.accuracy,
      hpRegenPerTenTicks: derived.hpRegenPerTenTicks,
      spRegenPerTenTicks: derived.spRegenPerTenTicks,
      criticalChance: derived.critChance,
      hungry: foodState.count <= 0,
      foodBuffExpiresAt: foodState.expiresAt > 0 ? new Date(foodState.expiresAt) : undefined,
      diet: activeDiet,
      dietLevels: character.dietLevels ?? {},
      autoFeed: character.autoFeed === true,
      currentMapId: character.currentMapId,
      savedTownMapId: character.savedTownMapId ?? null,
      lastGrindStance: character.lastGrindStance === 'gathering' ? 'gathering' : 'hunting',
      travelIntent: character.travelIntent ?? null,
      gatheringLevel: Math.max(1, Number(character.gatheringLevel ?? 1)),
      cookingLevel: Math.max(1, Number(character.cookingLevel ?? 1)),
      cookingXp: Math.max(0, Number(character.cookingXp ?? 0)),
      cookingSession: character.cookingSession ?? null,
      gatheringCycle: character.gatheringCycle ?? { progress: 0, cycleIndex: 0, varianceSeconds: null, lastUpdatedAt: null },
      encounterCycle: character.encounterCycle ?? { cycleIndex: 0, nextAt: null },
      fleeAttemptIndex: Math.max(0, Number(character.fleeAttemptIndex ?? 0)),
      fleeNextAttemptAt: character.fleeNextAttemptAt ?? null,
      pendingMapTransition: character.pendingMapTransition ?? null,
      discoveredMapIds: Array.isArray(character.discoveredMapIds) ? character.discoveredMapIds : ['map_town'],
      status: character.status,
      activeGambitPageId: character.activeGambitPageId || undefined,
      lastSeenAt: character.lastSeenAt,
      createdAt: character.createdAt,
      updatedAt: character.updatedAt,
      stateVersion: character.stateVersion,
    };
  }
}
