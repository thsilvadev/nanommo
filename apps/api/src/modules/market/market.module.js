"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const market_controller_1 = require("./market.controller");
const market_service_1 = require("./market.service");
const market_order_entity_1 = require("../../database/entities/market-order.entity");
const market_deal_entity_1 = require("../../database/entities/market-deal.entity");
const mail_message_entity_1 = require("../../database/entities/mail-message.entity");
const inventory_item_entity_1 = require("../../database/entities/inventory-item.entity");
const character_entity_1 = require("../../database/entities/character.entity");
const data_module_1 = require("../data/data.module");
const gateway_module_1 = require("../gateway/gateway.module");
const redis_module_1 = require("../../config/redis.module");
let MarketModule = class MarketModule {
};
exports.MarketModule = MarketModule;
exports.MarketModule = MarketModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([
                market_order_entity_1.MarketOrder,
                market_deal_entity_1.MarketDeal,
                mail_message_entity_1.MailMessage,
                inventory_item_entity_1.InventoryItem,
                character_entity_1.Character,
            ]),
            data_module_1.DataModule,
            gateway_module_1.GatewayModule,
            redis_module_1.RedisModule,
        ],
        controllers: [market_controller_1.MarketController],
        providers: [market_service_1.MarketService],
        exports: [market_service_1.MarketService],
    })
], MarketModule);
//# sourceMappingURL=market.module.js.map