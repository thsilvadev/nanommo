import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Character, WeaponProficiency, GambitPage, EquippedItem, InventoryItem } from '@/database/entities';
import { CharacterDto, Attribute, WeaponType, BattleEngine } from '@nanommo/shared';
import { DataService } from '../data/data.service';

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
  ) {}

  async createCharacter(userId: string, username: string): Promise<CharacterDto> {
    // Check if character already exists
    const existing = await this.characterRepository.findOne({
      where: { userId },
    });

    if (existing) {
      throw new BadRequestException('Character already exists for this user');
    }

    // Calculate base stats
    const baseStats = BattleEngine.calculateDerivedStats(1, {
      str: 5, agi: 5, dex: 5, vit: 5, int: 5, sor: 5,
    }, { weaponFixedAtk: 8 });

    // Create character
    const character = this.characterRepository.create({
      userId,
      name: username,
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

    // Starter equipment is authoritative, not a frontend-only assumption.
    await this.equippedItemRepository.save(this.equippedItemRepository.create({
      characterId: savedCharacter.id,
      slot: 'mainHand',
      itemId: 'equip_sword_t1',
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

    // Create weapon proficiencies for all 7 weapon types
    const weaponTypes: WeaponType[] = [
      WeaponType.SWORD,
      WeaponType.GREATSWORD,
      WeaponType.DAGGER,
      WeaponType.BOW,
      WeaponType.STAFF,
      WeaponType.WAND,
      WeaponType.SHIELD,
    ];

    for (const weaponType of weaponTypes) {
      const proficiency = this.weaponProficiencyRepository.create({
        characterId: savedCharacter.id,
        weaponType,
        level: 1,
        xp: 0,
      });
      await this.weaponProficiencyRepository.save(proficiency);
    }

    // Create 3 empty gambit pages (slots 0, 1, 2) as per SPEC
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

  async getWeaponProficiencyByUserId(userId: string): Promise<Array<{ weaponType: WeaponType; level: number }>> {
    const character = await this.getCharacterByUserId(userId);
    if (!character) throw new NotFoundException('Character not found');
    const rows = await this.weaponProficiencyRepository.find({ where: { characterId: character.id } });
    return rows.map((row) => ({ weaponType: row.weaponType, level: row.level }));
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

    // The DTO carries no class-validator metadata, so a malformed body reaches
    // here as `undefined`. Reject it as a 400 instead of letting
    // `Object.values(undefined)` surface as a 500.
    if (attributes === null || typeof attributes !== 'object' || Array.isArray(attributes)) {
      throw new BadRequestException('attributes must be an object');
    }

    const totalToSpend = Object.values(attributes).reduce((sum, val) => sum + (val ?? 0), 0);
    if (totalToSpend > character.unspentAttributePoints) {
      throw new BadRequestException('Not enough unspent attribute points');
    }

    // Update attributes
    if (attributes.str) character.str += attributes.str;
    if (attributes.agi) character.agi += attributes.agi;
    if (attributes.dex) character.dex += attributes.dex;
    if (attributes.vit) character.vit += attributes.vit;
    if (attributes.int) character.int += attributes.int;
    if (attributes.sor) character.sor += attributes.sor;

    character.unspentAttributePoints -= totalToSpend;

    const saved = await this.characterRepository.save(character);
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
    const equipment = { def: 0, maxHp: 0, maxSp: 0, weaponFixedAtk: 0, statBonus: { STR: 0, AGI: 0, DEX: 0, VIT: 0, INT: 0, SOR: 0 } };
    for (const row of equipped) {
      const item = this.dataService.getItemById(row.itemId);
      equipment.def += Number(item?.fixedStats?.def ?? 0);
      equipment.maxHp += Number(item?.fixedStats?.maxHp ?? 0);
      equipment.maxSp += Number(item?.fixedStats?.maxSp ?? 0);
      if (row.slot === 'mainHand') equipment.weaponFixedAtk += Number(item?.fixedStats?.atk ?? 0);
      for (const [key, value] of Object.entries(item?.fixedStats?.statBonus ?? {})) {
        if (key in equipment.statBonus && typeof value === 'number') (equipment.statBonus as any)[key] += value;
      }
    }
    const attrs = {
      str: character.str + equipment.statBonus.STR,
      agi: character.agi + equipment.statBonus.AGI,
      dex: character.dex + equipment.statBonus.DEX,
      vit: character.vit + equipment.statBonus.VIT,
      int: character.int + equipment.statBonus.INT,
      sor: character.sor + equipment.statBonus.SOR,
    };
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
    const equipment = { def: 0, maxHp: 0, maxSp: 0, weaponFixedAtk: 0, statBonus: { STR: 0, AGI: 0, DEX: 0, VIT: 0, INT: 0, SOR: 0 } };
    for (const row of equipped) {
      const item = this.dataService.getItemById(row.itemId);
      equipment.def += Number(item?.fixedStats?.def ?? 0);
      equipment.maxHp += Number(item?.fixedStats?.maxHp ?? 0);
      equipment.maxSp += Number(item?.fixedStats?.maxSp ?? 0);
      if (row.slot === 'mainHand') equipment.weaponFixedAtk += Number(item?.fixedStats?.atk ?? 0);
      for (const [key, value] of Object.entries(item?.fixedStats?.statBonus ?? {})) {
        if (key in equipment.statBonus && typeof value === 'number') (equipment.statBonus as any)[key] += value;
      }
    }

    const attrs = {
      str: character.str + equipment.statBonus.STR,
      agi: character.agi + equipment.statBonus.AGI,
      dex: character.dex + equipment.statBonus.DEX,
      vit: character.vit + equipment.statBonus.VIT,
      int: character.int + equipment.statBonus.INT,
      sor: character.sor + equipment.statBonus.SOR,
    };
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
    // Entries past their digestion boundary are history, not active slots, so they are
    // filtered out of the DTO instead of being persisted away. This is display-only:
    // nothing that validates or resolves food reads the DTO. consumeFood and
    // applyResolvedFoodState read the entity's own diet, and the repeat-food digestion
    // gate keys off dietLevels[itemId].lastDigestUntil, which this leaves untouched, so
    // permanent mastery survives an entry leaving the window.
    const activeDiet = character.diet.filter((entry) => Date.parse(entry.digestUntil) > Date.now());
    const equipped = await this.equippedItemRepository.find({ where: { characterId: character.id } });
    const equipment = { def: 0, maxHp: 0, maxSp: 0, weaponFixedAtk: 0, statBonus: { STR: 0, AGI: 0, DEX: 0, VIT: 0, INT: 0, SOR: 0 } };
    for (const row of equipped) {
      const item = this.dataService.getItemById(row.itemId);
      equipment.def += Number(item?.fixedStats?.def ?? 0);
      equipment.maxHp += Number(item?.fixedStats?.maxHp ?? 0);
      equipment.maxSp += Number(item?.fixedStats?.maxSp ?? 0);
      if (row.slot === 'mainHand') equipment.weaponFixedAtk += Number(item?.fixedStats?.atk ?? 0);
      for (const [key, value] of Object.entries(item?.fixedStats?.statBonus ?? {})) {
        if (key in equipment.statBonus && typeof value === 'number') (equipment.statBonus as any)[key] += value;
      }
    }
    const attrs = { str: character.str + equipment.statBonus.STR, agi: character.agi + equipment.statBonus.AGI, dex: character.dex + equipment.statBonus.DEX, vit: character.vit + equipment.statBonus.VIT, int: character.int + equipment.statBonus.INT, sor: character.sor + equipment.statBonus.SOR };
    const derived = BattleEngine.calculateDerivedStats(character.level, attrs, equipment);
    return {
      id: character.id,
      userId: character.userId,
      name: character.name,
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
      gold: Number(character.gold),
      hpCurrent: character.hpCurrent,
      spCurrent: character.spCurrent,
      maxHp: derived.maxHp,
      maxSp: derived.maxSp,
      attack: derived.atk,
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
      currentMapId: character.currentMapId || undefined,
      status: character.status,
      activeGambitPageId: character.activeGambitPageId || undefined,
      lastSeenAt: character.lastSeenAt,
      createdAt: character.createdAt,
      updatedAt: character.updatedAt,
      stateVersion: character.stateVersion,
    };
  }
}
