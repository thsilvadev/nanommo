"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MapModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const entities_1 = require("../../database/entities");
const map_controller_1 = require("./map.controller");
const map_service_1 = require("./map.service");
const data_module_1 = require("../data/data.module");
const battle_module_1 = require("../battle/battle.module");
const character_module_1 = require("../character/character.module");
let MapModule = class MapModule {
};
exports.MapModule = MapModule;
exports.MapModule = MapModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([entities_1.MapKillCounter, entities_1.Character]),
            data_module_1.DataModule,
            battle_module_1.BattleModule,
            character_module_1.CharacterModule,
        ],
        controllers: [map_controller_1.MapController],
        providers: [map_service_1.MapService],
        exports: [map_service_1.MapService],
    })
], MapModule);
//# sourceMappingURL=map.module.js.map