import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import type { MongoClient } from 'mongodb';

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 987654321, // limit each IP to 987654321 requests per windowMs
  message: {
    success: false,
    error: { message: 'Too many authentication attempts, please try again later' }
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const path = req.path || '';
    // Allow password setup and verification HTML flows without rate limiting
    return path === '/reset-password-form' || path === '/verify-email-page' || path === '/set-password-page';
  }
});

// Lightweight cache to avoid reading MongoDB every request
let cachedMax: number | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 30_000; // 30s

async function resolveMaxFromSettings(req: Request): Promise<number> {
  try {
    const now = Date.now();
    if (cachedMax !== null && now - cachedAt < CACHE_TTL_MS) return cachedMax;
    const client: MongoClient | undefined = req.app.get('mongoClient');
    if (!client) return process.env.RATE_LIMIT_MAX ? Number(process.env.RATE_LIMIT_MAX) : 1000;
    const dbName = process.env.MONGO_DB_NAME || 'oms_db';
    const doc = await client.db(dbName).collection('system_settings').findOne({ key: 'system' });
    const max = Number(doc?.value?.security?.rateLimit?.maxRequests) || (process.env.RATE_LIMIT_MAX ? Number(process.env.RATE_LIMIT_MAX) : 1000);
    cachedMax = max;
    cachedAt = now;
    return max;
  } catch {
    return process.env.RATE_LIMIT_MAX ? Number(process.env.RATE_LIMIT_MAX) : 1000;
  }
}

export const generalRateLimit = rateLimit({
  windowMs: 60 * 1000, // 60 seconds window to align with settings windowSeconds
  max: async (req) => await resolveMaxFromSettings(req as Request),
  message: {
    success: false,
    error: { message: 'Too many requests, please try again later' }
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for localhost development
    const ip = req.ip || '';
    const host = (req.hostname || '').toLowerCase();
    return ip === '::1' || host === 'localhost' || host === '127.0.0.1';
  }
});
