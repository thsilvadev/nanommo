import { Logger, Provider } from '@nestjs/common';
import Redis from 'ioredis';
import { getRedisConnectionOptions } from './redis.config';

export const REDIS_CLIENT = 'REDIS_CLIENT';

export const redisProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: () => {
    const logger = new Logger('RedisClient');
    const client = new Redis({
      ...getRedisConnectionOptions(),
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
    });
    client.on('error', (error: Error) => {
      // Keep Redis outages visible without allowing an unhandled EventEmitter error
      // to crash the Node process. Credentials are deliberately never logged.
      logger.error(`Redis connection error: ${error.message}`);
    });
    return client;
  },
};
