"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var DataService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataService = void 0;
const common_1 = require("@nestjs/common");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
let DataService = DataService_1 = class DataService {
    logger = new common_1.Logger(DataService_1.name);
    // Cached data
    items = null;
    monsters = null;
    skillTrees = null;
    gambitCatalog = null;
    charXpCurve = null;
    weaponXpCurve = null;
    npcVendor = null;
    onModuleInit() {
        this.loadAllData();
    }
    loadAllData() {
        try {
            const dataDir = path.join(process.cwd(), '../../');
            this.items = this.loadJsonFile(path.join(dataDir, 'items.json'));
            this.monsters = this.loadJsonFile(path.join(dataDir, 'monsters.json'));
            this.skillTrees = this.loadJsonFile(path.join(dataDir, 'skill_trees.json'));
            this.gambitCatalog = this.loadJsonFile(path.join(dataDir, 'gambit_catalog.json'));
            this.charXpCurve = this.loadJsonFile(path.join(dataDir, 'char_xp_curve.json'));
            this.weaponXpCurve = this.loadJsonFile(path.join(dataDir, 'weapon_xp_curve.json'));
            this.npcVendor = this.loadJsonFile(path.join(dataDir, 'npc_vendor.json'));
            this.logger.log('All data files loaded successfully');
        }
        catch (error) {
            this.logger.error('Failed to load data files', error);
            throw error;
        }
    }
    loadJsonFile(filePath) {
        try {
            const data = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(data);
        }
        catch (error) {
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
    // Specific getters
    getMonsterById(monsterId) {
        if (!this.monsters || !this.monsters.monsters)
            return null;
        return this.monsters.monsters.find((m) => m.id === monsterId);
    }
    getMapById(mapId) {
        if (!this.monsters || !this.monsters.maps)
            return null;
        return this.monsters.maps.find((m) => m.id === mapId);
    }
    getMonstersInMap(mapId) {
        if (!this.monsters || !this.monsters.monsters)
            return [];
        return this.monsters.monsters.filter((m) => m.map === mapId);
    }
    getItemById(itemId) {
        if (!this.items)
            return null;
        const allItems = [
            ...(this.items.consumables || []),
            ...(this.items.equipment || []),
            ...(this.items.monsterParts || []),
        ];
        return allItems.find((item) => item.id === itemId);
    }
    getSkillById(skillId) {
        if (!this.skillTrees || !this.skillTrees.trees)
            return null;
        for (const weaponType in this.skillTrees.trees) {
            const skills = this.skillTrees.trees[weaponType];
            const skill = skills.find((s) => s.id === skillId);
            if (skill)
                return skill;
        }
        return null;
    }
    getXpToNextLevel(level) {
        if (!this.charXpCurve || level < 1 || level > 99)
            return 0;
        const entry = this.charXpCurve[level - 1];
        return entry?.xpToNext ?? 0;
    }
    getWeaponXpToNextLevel(level) {
        if (!this.weaponXpCurve || level < 1 || level > 50)
            return 0;
        return this.weaponXpCurve[level - 1]?.xpToNext ?? 0;
    }
};
exports.DataService = DataService;
exports.DataService = DataService = DataService_1 = __decorate([
    (0, common_1.Injectable)()
], DataService);
//# sourceMappingURL=data.service.js.map