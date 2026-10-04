
export interface DietEntry { itemId:string; consumedAt:string; digestUntil:string; dietLevel:number; }
export interface Character { id:string; userId:string; name:string; level:number; xp:number; xpToNext:number; unspentAttributePoints:number; str:number; agi:number; dex:number; vit:number; int:number; sor:number; attributeBonuses:Record<string,number>; gold:number; hpCurrent:number; spCurrent:number; maxHp:number; maxSp:number; attack:number; magicAttack:number; defense:number; attackSpeed:number; castSpeed:number; evasion:number; accuracy:number; hpRegenPerTenTicks:number; spRegenPerTenTicks:number; criticalChance:number; hungry:boolean; foodBuffExpiresAt?:string; diet:DietEntry[]; dietLevels:Record<string,{level:number;lastDigestUntil:string}>; autoFeed:boolean; currentMapId?:string; status:string; activeGambitPageId?:string; lastSeenAt:string; createdAt:string; updatedAt:string; stateVersion:number; }
export interface InventoryItem { id:string; characterId:string; location:'inventory'|'warehouse'; slotIndex:number; itemId:string; quantity:number; instanceData?:any; }
export interface EquippedItem { id:string; characterId:string; slot:string; itemId:string; instanceData?:any; }
export interface EquipmentMutationResponse { character:Character; equipment:EquippedItem[]; inventory:InventoryItem[]; stateVersion:number; }
export interface BattleQueueEntry { id:string; characterId:string; sequenceIndex:number; mapId:string; monsterId:string; startAt:string; endAt:string; outcome:'win'|'loss'; log?:unknown; xpGain:number; goldGain:number; drops:unknown[]; itemsConsumed:Array<{itemId:string;quantity:number}>; hpAfter:number; spAfter:number; resolved:false; seedUsed:string; }
export interface BattleQueueUpdated { entries:BattleQueueEntry[]; stateRevision?:number; characterAfter?:Character; inventoryAfter?:InventoryItem[]; }
export interface BattleResolved { entryId:string; outcome:'win'|'loss'; xpGain:number; goldGain:number; drops:unknown[]; stateRevision:number; characterAfter:Character; inventoryAfter:InventoryItem[]; }
export interface MapPresence { mapId:string; playersOnMap:number; }
export interface CharacterLeveledUp { newLevel:number; unspentAttributePoints:number; }
export interface CharacterDied { deathLog:{monsterId:string;mapId:string;timestamp:string;log:unknown}; }
export interface GambitCondition { id:string; params?:Record<string,string|number>; [key:string]:any; }
export interface GambitAction { id:string; params?:Record<string,string|number>; [key:string]:any; }
export interface GambitLine { priority:number; conditions:GambitCondition[]; action:GambitAction; enabled?:boolean; }
export interface GambitPage { id:string; characterId:string; slotIndex:number; title?:string; lines:GambitLine[]; }
export interface MapInfo { id:string; name:string; unlockLevel:number; }
export interface GambitCatalog { meta:any; conditions:any[]; actions:any[]; }
export interface ItemDefinition { id:string; name:string; type:string; rarity?:string; stackable?:boolean; maxStack?:number; weaponType?:string; slot?:string; fixedStats?:any; }
export interface MonsterDefinition { id:string; name:string; map:string; level:number; hp:number; }
export interface WeaponCurve { weaponLevel:number; xpToNext:number; cumulativeXp:number; }
export type WeaponType = 'sword'|'greatsword'|'dagger'|'bow'|'staff'|'wand'|'shield';
export type EquipmentSlot = 'head'|'body'|'mainHand'|'offHand'|'shoes'|'cape'|'accessoryLeft'|'accessoryRight';
