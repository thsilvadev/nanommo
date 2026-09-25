"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GatewayModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const jwt_1 = require("@nestjs/jwt");
const nanommo_gateway_1 = require("./nanommo.gateway");
const gateway_service_1 = require("./gateway.service");
const character_entity_1 = require("../../database/entities/character.entity");
const user_entity_1 = require("../../database/entities/user.entity");
const data_module_1 = require("../data/data.module");
const redis_module_1 = require("../../config/redis.module");
let GatewayModule = class GatewayModule {
};
exports.GatewayModule = GatewayModule;
exports.GatewayModule = GatewayModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([character_entity_1.Character, user_entity_1.User]),
            jwt_1.JwtModule.register({
                secret: process.env.JWT_SECRET || 'dev_secret_key_change_in_production',
                signOptions: { expiresIn: '7d' },
            }),
            data_module_1.DataModule,
            redis_module_1.RedisModule,
        ],
        providers: [nanommo_gateway_1.NanommoGateway, gateway_service_1.GatewayService],
        exports: [nanommo_gateway_1.NanommoGateway, gateway_service_1.GatewayService],
    })
], GatewayModule);
//# sourceMappingURL=gateway.module.js.map