import * as IORedis from 'ioredis';

const redisUrl = process.env.REDIS_URL;

// try {
//   const parsed = redisUrl ? new URL(redisUrl) : null;
//   const maskedAuth = parsed?.password ? parsed.password.slice(0, 4) + '...' : undefined;
//   console.log('[Redis Config]');
//   console.log('  URL:', redisUrl ? `${parsed?.protocol}//${parsed?.username ? parsed.username + ':' : ''}${maskedAuth ? '****@' : ''}${parsed?.host}` : undefined);
//   console.log('  HOST:', parsed?.hostname);
//   console.log('  PORT:', parsed?.port);
//   console.log('  TLS:', parsed?.protocol === 'rediss:');
// } catch {}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const redis = new (IORedis as any)(redisUrl as string);

redis.on('connect', () => {
  console.log('Redis: Client connected');
});

redis.on('error', (err: unknown) => {
  console.error('Redis: Client error:', err);
});
