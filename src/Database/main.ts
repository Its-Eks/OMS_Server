// src/Database/main.ts
import pkg from 'pg';
import { createClient } from 'redis';
import { MongoClient, Db } from 'mongodb';
import admin from 'firebase-admin';
import dotenv from 'dotenv';
dotenv.config()


// ---------- PostgreSQL ----------
const { Pool } = pkg;

const useSSL = process.env.POSTGRES_SSL === 'true';

console.log('[Postgres Config]');
console.log('  HOST:', process.env.POSTGRES_HOST);
console.log('  USER:', process.env.POSTGRES_USER);
console.log('  DATABASE:', process.env.POSTGRES_DB);
console.log('  PORT:', process.env.POSTGRES_PORT);
console.log('  SSL:', useSSL);

export const pgPool = new Pool({
  host: process.env.POSTGRES_HOST,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  port: parseInt(process.env.POSTGRES_PORT, 10),
  ssl: {
    rejectUnauthorized: false, // for self-signed certs; be careful in prod
  },
  max: 20,
  idleTimeoutMillis: 30000,
  // Increase connection acquisition timeout to avoid spurious timeouts under load
  connectionTimeoutMillis: 10000,
});

// ---------- Redis ----------
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

export const redis = createClient({
  url: redisUrl ?? '',
});

// ---------- MongoDB ----------
let mongoClient: MongoClient | null = null;
let mongodb: Db | null = null;

export async function connectMongoDB() {
  if (!mongoClient) {
    mongoClient = new MongoClient(process.env.MONGODB_URI as string);
    await mongoClient.connect();
    mongodb = mongoClient.db(process.env.DB || 'oms_db');
  }
  return { mongoClient, mongodb };
}

export { mongoClient, mongodb };

// ---------- Firebase ----------
let firebaseInitialized = false;

export async function initializeFirebaseAdmin() {
  if (firebaseInitialized) return;

  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });

  firebaseInitialized = true;
}
