import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class DataService implements OnModuleInit {
  private readonly logger = new Logger(DataService.name);

  // Cached data
  private items: any = null;
  private monsters: any = null;
  private skillTrees: any = null;
  private gambitCatalog: any = null;
  private charXpCurve: any = null;
  private weaponXpCurve: any = null;
  private npcVendor: any = null;
  private npcCatalog: any = null;

  onModuleInit() {
    this.loadAllData();
  }

  private loadAllData() {
    try {
      const dataDir = path.join(process.cwd(), '../../');

      this.items = this.loadJsonFile(path.join(dataDir, 'items.json'));
      this.monsters = this.loadJsonFile(path.join(dataDir, 'monsters.json'));
      this.skillTrees = this.loadJsonFile(path.join(dataDir, 'skill_trees.json'));
      this.gambitCatalog = this.loadJsonFile(path.join(dataDir, 'gambit_catalog.json'));
      this.charXpCurve = this.loadJsonFile(path.join(dataDir, 'char_xp_curve.json'));
      this.weaponXpCurve = this.loadJsonFile(path.join(dataDir, 'weapon_xp_curve.json'));
      this.npcVendor = this.loadJsonFile(path.join(dataDir, 'npc_vendor.json'));
      this.npcCatalog = this.loadJsonFile(path.join(dataDir, 'npc_catalog.json'));

      this.logger.log('All data files loaded successfully');
    } catch (error) {
      this.logger.error('Failed to load data files', error);
      throw error;
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

  // Specific getters
  getMonsterById(monsterId: string): any {
    if (!this.monsters || !this.monsters.monsters) return null;
    return this.monsters.monsters.find((m: any) => m.id === monsterId);
  }

  getMapById(mapId: string): any {
    if (!this.monsters || !this.monsters.maps) return null;
    return this.monsters.maps.find((m: any) => m.id === mapId);
  }

  getMonstersInMap(mapId: string): any[] {
    if (!this.monsters || !this.monsters.monsters) return [];
    return this.monsters.monsters.filter((m: any) => m.map === mapId);
  }

  getItemById(itemId: string): any {
    if (!this.items) return null;
    const allItems = [
      ...(this.items.consumables || []),
      ...(this.items.equipment || []),
      ...(this.items.monsterParts || []),
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
