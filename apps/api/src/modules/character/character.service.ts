import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Character, WeaponProficiency, GambitPage } from '@/database/entities';
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
      str: 5,
      agi: 5,
      dex: 5,
      vit: 5,
      int: 5,
      sor: 5,
    }, {});

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
      lastSeenAt: new Date(),
    });

    const savedCharacter = await this.characterRepository.save(character);

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
    for (let slotIndex = 0; slotIndex < 3; slotIndex++) {
      const gambitPage = this.gambitPageRepository.create({
        characterId: savedCharacter.id,
        slotIndex,
        title: `Page ${slotIndex + 1}`,
        lines: [],
      });
      await this.gambitPageRepository.save(gambitPage);
    }

    return this.toDto(savedCharacter);
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
    return this.toDto(saved);
  }

  async gainXp(characterId: string, xpAmount: number): Promise<void> {
    const character = await this.getCharacterById(characterId);
    if (!character) return;

    character.xp += xpAmount;

    // Check for level-ups
    while (character.level < 99) {
      const xpToNext = this.dataService.getXpToNextLevel(character.level);
      if (character.xp >= xpToNext) {
        character.level++;
        character.xp -= xpToNext;
        character.unspentAttributePoints += 5;

        // Recalculate HP/SP (ratio-adjusted)
        const oldStats = BattleEngine.calculateDerivedStats(character.level - 1, {
          str: character.str,
          agi: character.agi,
          dex: character.dex,
          vit: character.vit,
          int: character.int,
          sor: character.sor,
        }, {});

        const newStats = BattleEngine.calculateDerivedStats(character.level, {
          str: character.str,
          agi: character.agi,
          dex: character.dex,
          vit: character.vit,
          int: character.int,
          sor: character.sor,
        }, {});

        character.hpCurrent = Math.round(character.hpCurrent * (newStats.maxHp / oldStats.maxHp));
        character.spCurrent = Math.round(character.spCurrent * (newStats.maxSp / oldStats.maxSp));
      } else {
        break;
      }
    }

    await this.characterRepository.save(character);
  }

  private toDto(character: Character): CharacterDto {
    return {
      id: character.id,
      userId: character.userId,
      name: character.name,
      level: character.level,
      xp: character.xp,
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
      currentMapId: character.currentMapId || undefined,
      status: character.status,
      activeGambitPageId: character.activeGambitPageId || undefined,
      lastSeenAt: character.lastSeenAt,
      createdAt: character.createdAt,
      updatedAt: character.updatedAt,
    };
  }
}
