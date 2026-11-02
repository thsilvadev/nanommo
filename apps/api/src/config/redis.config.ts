export interface RedisConnectionOptions {
  host: string;
  port: number;
  db: number;
  username?: string;
  password?: string;
  tls?: {};
}

/**
 * One Redis connection contract for ioredis and Bull.
 *
 * Production Redis providers commonly require ACL credentials and/or TLS,
 * while local docker-compose Redis remains passwordless by default.
 * REDIS_URL takes precedence when supplied; otherwise REDIS_HOST/PORT and
 * REDIS_USERNAME/PASSWORD are used.
 */
export function getRedisConnectionOptions(
  env: NodeJS.ProcessEnv = process.env,
): RedisConnectionOptions {
  const rawUrl = env.REDIS_URL?.trim();

  if (rawUrl) {
    const url = new URL(rawUrl);
    if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
      throw new Error('REDIS_URL must use redis:// or rediss://');
    }

    const database = url.pathname.length > 1
      ? Number.parseInt(url.pathname.slice(1), 10)
      : 0;
    if (!Number.isInteger(database) || database < 0) {
      throw new Error('REDIS_URL database path must be a non-negative integer');
    }

    return {
      host: url.hostname,
      port: url.port ? Number.parseInt(url.port, 10) : 6379,
      db: database,
      ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
      ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
      ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    };
  }

  const port = Number.parseInt(env.REDIS_PORT || '6379', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('REDIS_PORT must be an integer between 1 and 65535');
  }

  return {
    host: env.REDIS_HOST || 'localhost',
    port,
    db: 0,
    ...(env.REDIS_USERNAME ? { username: env.REDIS_USERNAME } : {}),
    ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
    ...(env.REDIS_TLS === 'true' ? { tls: {} } : {}),
  };
}
