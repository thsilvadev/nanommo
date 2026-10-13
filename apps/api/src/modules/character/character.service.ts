import { Injectable, BadRequestException, NotFoundException, Logger, ConflictException, forwardRef, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Character, WeaponProficiency, GambitPage, EquippedItem, InventoryItem } from '@/database/entities';
import { CharacterDto, Attribute, WeaponType, BattleEngine, effectiveWeaponAttack, sumAttributeBonuses, applyAttributeBonuses, masteryPassiveAttributeBonuses, type AttributeBonuses } from '@nanommo/shared';
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
      statBonus: { STR: 0, AGI: 0, DEX: 0, VIT: 0, INT: 0, SOR: 0 },
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
      if (item.weaponType === 'bow') equipment.accuracyModifier -= ({ 1: 75, 2: 74, 3: 73 } as Record<number, number>)[Number(item.tier)] ?? 75;
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
      str: 5, agi: 5, dex: 5, vit: 5, int: 5, sor: 5,
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
      sor: 5,
      gold: 0,
      hpCurrent: baseStats.maxHp,
      spCurrent: baseStats.maxSp,
      status: 'town',
      diet: [],
      dietLevels: {},
      autoFeed: false,
      lastSeenAt: new Date(),
      regenAnchorAt: new Date(),
    });

    const savedCharacter = await this.characterRepository.save(character);

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

  async allocateMasterySkill(userId: string, category: string, skillId: string): Promise<{ category: string; level: number; xp: number; spentSkillPoints: number; skillRanks: Record<string, number> }> {
    const character = await this.getCharacterByUserId(userId);
    if (!character) throw new NotFoundException('Character not found');
    const categorySkills = this.dataService.getSkillsForWeapon(category);
    const skill = categorySkills.find((entry: any) => entry.id === skillId);
    if (!skill || !['sword','greatsword','dagger','bow','staff','rod','shield','rune'].includes(category)) {
      throw new BadRequestException('Unknown Mastery category or skill');
    }
    const maximum = Math.max(1, Math.min(10, Number(skill.maxRank ?? 5)));
    // The entire rank mutation, including validation, is accepted at the shared
    // future-combat boundary; active queue snapshots remain untouched.
    return this.battleService.runFutureCombatMutation(character.id, async () => {
      return this.weaponProficiencyRepository.manager.transaction(async (manager) => {
        const repo = manager.getRepository(WeaponProficiency);
        const fresh = await repo.findOne({ where: { characterId: character.id, weaponType: category }, lock: { mode: 'pessimistic_write' } });
        if (!fresh) throw new NotFoundException('Mastery category not found');
        const freshRanks = { ...(fresh.skillRanks ?? {}) };
        const freshSpent = Number(fresh.spentSkillPoints ?? 0);
        const rankTotal = Object.values(freshRanks).reduce((total, rank) => total + Math.max(0, Math.floor(Number(rank) || 0)), 0);
        if (rankTotal !== freshSpent) throw new BadRequestException('Stored Mastery rank total is inconsistent');
        if (freshSpent >= Number(fresh.level) || Number(freshRanks[skillId] ?? 0) >= maximum) throw new BadRequestException('No unspent Mastery points or skill is at maximum rank');
        if (skill.prerequisite && Number(freshRanks[skill.prerequisite.skillId] ?? 0) < Number(skill.prerequisite.rank)) throw new BadRequestException('Skill prerequisite is not met');
        if (skill.node !== 1 && Number(freshRanks[categorySkills[0]?.id] ?? 0) < 5) throw new BadRequestException('First node must reach rank 5 before this skill');
        freshRanks[skillId] = Number(freshRanks[skillId] ?? 0) + 1;
        fresh.skillRanks = freshRanks;
        fresh.spentSkillPoints = freshSpent + 1;
        const saved = await repo.save(fresh);
        return { category, level: saved.level, xp: Number(saved.xp), spentSkillPoints: saved.spentSkillPoints, skillRanks: saved.skillRanks ?? {} };
      });
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
    if (attributes.sor) character.sor += attributes.sor;

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
    const foodActive = character.activeFoodBuff?.expiresAt && new Date(character.activeFoodBuff.expiresAt).getTime() > now;
    const foodHpRegen = foodActive ? Number(character.activeFoodBuff?.hpRegenPerTenTicks ?? 0) : 0;
    const foodSpRegen = foodActive ? Number(character.activeFoodBuff?.spRegenPerTenTicks ?? 0) : 0;

    character.hpCurrent = Math.min(derived.maxHp, character.hpCurrent + tenTickPeriods * (derived.hpRegenPerTenTicks + foodHpRegen));
    character.spCurrent = Math.min(derived.maxSp, character.spCurrent + tenTickPeriods * (derived.spRegenPerTenTicks + foodSpRegen));
    if (!foodActive && character.activeFoodBuff?.expiresAt && new Date(character.activeFoodBuff.expiresAt).getTime() <= now) {
      character.activeFoodBuff = null;
    }
    character.lastSeenAt = new Date(last + tenTickPeriods * 10_000);
    await this.characterRepository.save(character);
  }

  private async toDto(character: Character): Promise<CharacterDto> {
    if (!Array.isArray(character.diet)) character.diet = [];
    if (!character.dietLevels) character.dietLevels = {};
    const activeDiet = character.diet;
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
      sor: character.sor,
      attributeBonuses: {
        STR: attributeBonuses.STR,
        AGI: attributeBonuses.AGI,
        DEX: attributeBonuses.DEX,
        VIT: attributeBonuses.VIT,
        INT: attributeBonuses.INT,
        SOR: attributeBonuses.SOR,
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
      castSpeed: derived.castSpeed,
      evasion: derived.evasion,
      accuracy: derived.accuracy,
      hpRegenPerTenTicks: derived.hpRegenPerTenTicks,
      spRegenPerTenTicks: derived.spRegenPerTenTicks,
      criticalChance: derived.critChance,
      hungry: !character.activeFoodBuff?.expiresAt || new Date(character.activeFoodBuff.expiresAt).getTime() <= Date.now(),
      foodBuffExpiresAt: character.activeFoodBuff?.expiresAt ? new Date(character.activeFoodBuff.expiresAt) : undefined,
      diet: activeDiet,
      dietLevels: character.dietLevels ?? {},
      autoFeed: character.autoFeed === true,
      currentMapId: character.currentMapId,
      status: character.status,
      activeGambitPageId: character.activeGambitPageId || undefined,
      lastSeenAt: character.lastSeenAt,
      createdAt: character.createdAt,
      updatedAt: character.updatedAt,
      stateVersion: character.stateVersion,
    };
  }
}
