import { Pool } from 'pg';

export const pgPool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'oms_db',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD,
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
