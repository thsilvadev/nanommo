"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.redisProvider = exports.REDIS_CLIENT = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
exports.REDIS_CLIENT = 'REDIS_CLIENT';
exports.redisProvider = {
    provide: exports.REDIS_CLIENT,
    useFactory: () => {
        return new ioredis_1.default({
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379', 10),
            db: 0,
            retryStrategy: (times) => {
                const delay = Math.min(times * 50, 2000);
                return delay;
            },
        });
    },
};
//# sourceMappingURL=redis.provider.js.map