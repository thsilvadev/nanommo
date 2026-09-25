import { OnModuleInit } from '@nestjs/common';
export declare class DataService implements OnModuleInit {
    private readonly logger;
    private items;
    private monsters;
    private skillTrees;
    private gambitCatalog;
    private charXpCurve;
    private weaponXpCurve;
    private npcVendor;
    onModuleInit(): void;
    private loadAllData;
    private loadJsonFile;
    getItems(): any;
    getMonsters(): any;
    getSkillTrees(): any;
    getGambitCatalog(): any;
    getCharXpCurve(): any;
    getWeaponXpCurve(): any;
    getNpcVendor(): any;
    getMonsterById(monsterId: string): any;
    getMapById(mapId: string): any;
    getMonstersInMap(mapId: string): any[];
    getItemById(itemId: string): any;
    getSkillById(skillId: string): any;
    getXpToNextLevel(level: number): number;
    getWeaponXpToNextLevel(level: number): number;
}
//# sourceMappingURL=data.service.d.ts.map