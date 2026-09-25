"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const bull_1 = require("@nestjs/bull");
const config_1 = require("@nestjs/config");
const typeorm_1 = require("@nestjs/typeorm");
const jwt_1 = require("@nestjs/jwt");
const passport_1 = require("@nestjs/passport");
const auth_module_1 = require("./modules/auth/auth.module");
const character_module_1 = require("./modules/character/character.module");
const battle_module_1 = require("./modules/battle/battle.module");
const gambit_module_1 = require("./modules/gambit/gambit.module");
const inventory_module_1 = require("./modules/inventory/inventory.module");
const equipment_module_1 = require("./modules/equipment/equipment.module");
const map_module_1 = require("./modules/map/map.module");
const town_module_1 = require("./modules/town/town.module");
const market_module_1 = require("./modules/market/market.module");
const mail_module_1 = require("./modules/mail/mail.module");
const chat_module_1 = require("./modules/chat/chat.module");
const gateway_module_1 = require("./modules/gateway/gateway.module");
const data_module_1 = require("./modules/data/data.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                envFilePath: '.env',
            }),
            bull_1.BullModule.forRoot({
                redis: {
                    host: process.env.REDIS_HOST || 'localhost',
                    port: parseInt(process.env.REDIS_PORT || '6379', 10),
                },
            }),
            typeorm_1.TypeOrmModule.forRoot({
                type: 'postgres',
                host: process.env.DB_HOST || 'localhost',
                port: parseInt(process.env.DB_PORT || '5432', 10),
                username: process.env.DB_USER || 'nanommo',
                password: process.env.DB_PASSWORD || 'nanommo_dev_password',
                database: process.env.DB_NAME || 'nanommo',
                synchronize: process.env.NODE_ENV === 'development',
                logging: process.env.DB_LOGGING === 'true',
                entities: [__dirname + '/**/*.entity{.ts,.js}'],
                migrations: [__dirname + '/database/migrations/*{.ts,.js}'],
                migrationsRun: process.env.RUN_MIGRATIONS === 'true',
            }),
            passport_1.PassportModule,
            jwt_1.JwtModule.register({
                secret: process.env.JWT_SECRET || 'dev_secret_key',
                signOptions: { expiresIn: '7d' },
            }),
            auth_module_1.AuthModule,
            character_module_1.CharacterModule,
            battle_module_1.BattleModule,
            gambit_module_1.GambitModule,
            inventory_module_1.InventoryModule,
            equipment_module_1.EquipmentModule,
            map_module_1.MapModule,
            town_module_1.TownModule,
            market_module_1.MarketModule,
            mail_module_1.MailModule,
            chat_module_1.ChatModule,
            gateway_module_1.GatewayModule,
            data_module_1.DataModule,
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map