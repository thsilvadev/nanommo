"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GambitModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const gambit_controller_1 = require("./gambit.controller");
const gambit_service_1 = require("./gambit.service");
const gambit_page_entity_1 = require("../../database/entities/gambit-page.entity");
const character_entity_1 = require("../../database/entities/character.entity");
const data_module_1 = require("../data/data.module");
let GambitModule = class GambitModule {
};
exports.GambitModule = GambitModule;
exports.GambitModule = GambitModule = __decorate([
    (0, common_1.Module)({
        imports: [typeorm_1.TypeOrmModule.forFeature([gambit_page_entity_1.GambitPage, character_entity_1.Character]), data_module_1.DataModule],
        controllers: [gambit_controller_1.GambitController],
        providers: [gambit_service_1.GambitService],
        exports: [gambit_service_1.GambitService],
    })
], GambitModule);
//# sourceMappingURL=gambit.module.js.map