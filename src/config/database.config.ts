import { Pool } from 'pg';

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
  ssl: useSSL ? { rejectUnauthorized: false } : undefined,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test connection
pgPool.on('connect', () => {
  console.log('New PostgreSQL connection established');
});

pgPool.on('error', (err) => {
  console.error('PostgreSQL connection error:', err);
});
