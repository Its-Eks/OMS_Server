// src/Database/main.ts
import pkg from 'pg';
import { createClient } from 'redis';
import { MongoClient, Db } from 'mongodb';
import admin from 'firebase-admin';
import dotenv from 'dotenv';
dotenv.config()


// ---------- PostgreSQL ----------
const { Pool } = pkg;

export const pgPool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
});

// ---------- Redis ----------
export const redis = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
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
