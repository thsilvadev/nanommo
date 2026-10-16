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
      for (const field of ['level', 'hp', 'atk', 'matk', 'def', 'accuracy', 'evasion', 'xpReward']) {
        if (!Number.isFinite(Number(monster[field])) || Number(monster[field]) < (field === 'level' || field === 'hp' || field === 'xpReward' ? 1 : 0)) {
          throw new Error(`Invalid ${field} for monster ${monster.id}`);
        }
      }
    }
    const mapIds = new Set<string>();
    const coordinates = new Set<string>();
    for (const map of maps) {
      if (!map?.id || mapIds.has(map.id)) throw new Error(`Duplicate or missing map ID: ${map?.id}`);
      mapIds.add(map.id);
      const coord = `${Number(map.coordinates?.x)},${Number(map.coordinates?.y)}`;
      if (!Number.isFinite(Number(map.coordinates?.x)) || !Number.isFinite(Number(map.coordinates?.y)) || coordinates.has(coord)) throw new Error(`Invalid or duplicate map coordinates for ${map.id}`);
      coordinates.add(coord);
      if (!Array.isArray(map.monsters)) throw new Error(`Map ${map.id} must define a monster roster`);
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
