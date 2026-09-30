import { Attribute, WeaponType, DamageType, EquipmentSlot } from '../enums';

export * from '../enums';

// Derived Stats
export interface DerivedStats {
  maxHp: number;
  maxSp: number;
  atk: number;
  matk: number;
  def: number;
  mdefPercent: number;
  accuracy: number;
  evasion: number;
  critChance: number;
  hpRegenPerTenTicks: number;
  spRegenPerTenTicks: number;
}

// Character snapshot for battle
export interface CharacterSnapshot {
  level: number;
  hp: number;
  sp: number;
  attributes: Record<Attribute, number>;
  stats: DerivedStats;
  equipment: EquipmentSnapshot;
  gambitPage: GambitPage | null;
  foodBuff: FoodBuff | null;
  statusEffects: StatusEffect[];
  cooldowns: Record<string, number>;
}

export interface EquipmentSnapshot {
  mainHand: EquippedItemSnapshot | null;
  offHand: EquippedItemSnapshot | null;
  [key: string]: EquippedItemSnapshot | null;
}

export interface EquippedItemSnapshot {
  id: string;
  weaponType?: WeaponType;
  damageType?: DamageType;
  statBonus?: Record<Attribute, number>;
  def?: number;
  mdefPercent?: number;
  instanceData?: { rolledAttribute: Attribute; rolledValue: number };
}

export interface MonsterSnapshot {
  level: number;
  hp: number;
  atk: number;
  matk: number;
  def: number;
  mdefPercent: number;
  accuracy: number;
  evasion: number;
  critChance: number;
  atkSpeedTicks: number;
  damageType: DamageType;
}

// Gambit
export interface GambitPage {
  id: string;
  characterId: string;
  slotIndex: number;
  title?: string;
  lines: GambitLine[];
}

export interface GambitLine {
  priority: number;
  conditions: [GambitCondition];
  action: GambitAction;
}

export interface GambitCondition {
  id: string;
  params?: Record<string, string | number>;
}

export interface GambitAction {
  id: string;
  params?: Record<string, string | number>;
}

// Battle
export interface BattleEvent {
  tick: number;
  actor: 'character' | 'monster';
  action: string;
  target: 'character' | 'monster';
  damage?: number;
  damageType?: DamageType;
  crit?: boolean;
  healAmount?: number;
  hpRemaining: { character: number; monster: number };
  spRemaining?: { character: number; monster: number };
}

export interface BattleLog {
  header: {
    mapId: string;
    monsterId: string;
    seedUsed: string;
    characterSnapshot: CharacterSnapshot;
    monsterSnapshot: MonsterSnapshot;
  };
  events: BattleEvent[];
  outcome: 'win' | 'loss';
  durationTicks: number;
}

export interface BattleResult {
  outcome: 'win' | 'loss';
  durationTicks: number;
  log: BattleLog;
  xpGain: number;
  goldGain: number;
  drops: { itemId: string; quantity: number }[];
  hpAfter: number;
  spAfter: number;
}

// Food buff
export interface FoodBuff {
  itemId: string;
  hpRegenPerTenTicks: number;
  spRegenPerTenTicks: number;
  expiresAt: Date;
}

// Status effects
export interface StatusEffect {
  type: string;
  appliedAtTick: number;
  expiresAtTick: number;
  sourceSkillId?: string;
}

// Weapon Proficiency
export interface WeaponProficiency {
  characterId: string;
  weaponType: WeaponType;
  level: number;
  xp: number;
}

// XP Curves
export interface XpCurveEntry {
  level: number;
  xpToNext: number;
  cumulativeXp: number;
  estHoursAtThisLevel: number;
  estDaysAtThisLevel: number;
}

export type NpcCapabilityType = 'vendor' | 'quest';
export interface TownNpc { id: string; name: string; location: 'town'; types: NpcCapabilityType[]; }
export interface VendorNpc extends TownNpc { types: ['vendor']; }
export interface QuestNpc extends TownNpc { types: ['quest']; }
export interface NpcDialogueChoice { id: string; text: string; nextNodeId?: string; }
export interface NpcDialogueNode { id: string; npcText: string; choices: NpcDialogueChoice[]; }
export interface NpcDialogueState { npcId: string; nodeId: string; npcText: string; choices: NpcDialogueChoice[]; }

export interface VendorStockItem { slotIndex: number; itemId: string; quantity: number | null; infiniteStock: boolean; buyPrice: number; item: Record<string, unknown>; }
export interface VendorQuote { vendorId: string; itemId: string; buyPrice: number | null; sellPrice: number | null; stackable: boolean; maxStack: number; }
export interface VendorTransactionResponse { itemId: string; quantity: number; unitPrice: number; goldSpent?: number; goldReceived?: number; }
