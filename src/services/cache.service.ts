// Support both ioredis and node-redis v4 clients
// We intentionally avoid importing specific types to allow either client
export class CacheService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly redis: any;
  private readonly defaultTtlSeconds: number;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(redis: any, defaultTtlSeconds: number = 300) {
    this.redis = redis;
    this.defaultTtlSeconds = defaultTtlSeconds;
  }

  async getJson<T>(key: string): Promise<T | null> {
    const value = await this.redis.get(key);
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const payload = JSON.stringify(value);
    const ttl = ttlSeconds ?? this.defaultTtlSeconds;
    if (ttl > 0) {
      // ioredis: setex(key, seconds, value)
      if (typeof this.redis.setex === 'function') {
        await this.redis.setex(key, ttl, payload);
        return;
      }
      // node-redis v4: set(key, value, { EX: seconds })
      await this.redis.set(key, payload, { EX: ttl });
    } else {
      await this.redis.set(key, payload);
    }
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async delByPrefix(prefix: string): Promise<void> {
    const match = `${prefix}*`;

    // Prefer iterator API when available (node-redis v4)
    if (typeof this.redis.scanIterator === 'function') {
      const buffer: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for await (const key of this.redis.scanIterator({ MATCH: match, COUNT: 100 } as any)) {
        buffer.push(String(key));
        if (buffer.length >= 100) {
          await this.redis.del(...buffer);
          buffer.length = 0;
        }
      }
      if (buffer.length) {
        await this.redis.del(...buffer);
      }
      return;
    }

    // Fallback to SCAN loop (works with ioredis)
    let cursor: string | number = '0';
    do {
      const scanResult = await this.redis.scan(cursor, 'MATCH', match, 'COUNT', '100');
      // ioredis returns [cursor, keys]
      // node-redis may return { cursor, keys }
      let nextCursor: string | number;
      let keys: string[] = [];
      if (Array.isArray(scanResult)) {
        [nextCursor, keys] = scanResult as [string | number, string[]];
      } else if (scanResult && typeof scanResult === 'object') {
        nextCursor = (scanResult as { cursor: string | number }).cursor;
        keys = (scanResult as { keys: string[] }).keys || [];
      } else {
        break;
      }
      cursor = nextCursor;
      if (keys.length) {
        await this.redis.del(...keys);
      }
    } while (String(cursor) !== '0');
  }
}

export function buildCacheKey(parts: Array<string | number | boolean | null | undefined>): string {
  return parts
    .map(p => (p === null || p === undefined ? '' : String(p)))
    .join(':')
    .replace(/\s+/g, '_')
    .toLowerCase();
}

