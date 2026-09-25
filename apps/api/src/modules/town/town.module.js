"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TownModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const town_controller_1 = require("./town.controller");
const town_service_1 = require("./town.service");
const character_entity_1 = require("../../database/entities/character.entity");
const inventory_item_entity_1 = require("../../database/entities/inventory-item.entity");
const data_module_1 = require("../data/data.module");
let TownModule = class TownModule {
};
exports.TownModule = TownModule;
exports.TownModule = TownModule = __decorate([
    (0, common_1.Module)({
        imports: [typeorm_1.TypeOrmModule.forFeature([character_entity_1.Character, inventory_item_entity_1.InventoryItem]), data_module_1.DataModule],
        controllers: [town_controller_1.TownController],
        providers: [town_service_1.TownService],
        exports: [town_service_1.TownService],
    })
], TownModule);
//# sourceMappingURL=town.module.js.map