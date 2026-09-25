"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BattleModule = void 0;
const common_1 = require("@nestjs/common");
const bull_1 = require("@nestjs/bull");
const typeorm_1 = require("@nestjs/typeorm");
const battle_queue_entry_entity_1 = require("../../database/entities/battle-queue-entry.entity");
const character_entity_1 = require("../../database/entities/character.entity");
const map_kill_counter_entity_1 = require("../../database/entities/map-kill-counter.entity");
const gambit_page_entity_1 = require("../../database/entities/gambit-page.entity");
const battle_controller_1 = require("./battle.controller");
const battle_service_1 = require("./battle.service");
const battle_queue_processor_1 = require("./battle-queue.processor");
const data_module_1 = require("../data/data.module");
const character_module_1 = require("../character/character.module");
const inventory_module_1 = require("../inventory/inventory.module");
const equipment_module_1 = require("../equipment/equipment.module");
const gateway_module_1 = require("../gateway/gateway.module");
const redis_module_1 = require("../../config/redis.module");
let BattleModule = class BattleModule {
};
exports.BattleModule = BattleModule;
exports.BattleModule = BattleModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([battle_queue_entry_entity_1.BattleQueueEntry, character_entity_1.Character, map_kill_counter_entity_1.MapKillCounter, gambit_page_entity_1.GambitPage]),
            bull_1.BullModule.registerQueue({
                name: 'battle-queue',
                defaultJobOptions: {
                    attempts: 3,
                    backoff: {
                        type: 'exponential',
                        delay: 2000,
                    },
                },
            }),
            data_module_1.DataModule,
            character_module_1.CharacterModule,
            inventory_module_1.InventoryModule,
            equipment_module_1.EquipmentModule,
            gateway_module_1.GatewayModule,
            redis_module_1.RedisModule,
        ],
        controllers: [battle_controller_1.BattleController],
        providers: [battle_service_1.BattleService, battle_queue_processor_1.BattleQueueProcessor],
        exports: [battle_service_1.BattleService],
    })
], BattleModule);
//# sourceMappingURL=battle.module.js.map