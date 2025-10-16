import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const useSSL = process.env.POSTGRES_SSL === 'true';

const pgPool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: parseInt(process.env.POSTGRES_PORT as string),
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  ssl: useSSL ? { rejectUnauthorized: false } : false, // ✅ fixed here
});


// Handle ESM: __dirname is not defined by default
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function tableExists(tableName: string): Promise<boolean> {
  const res = await pgPool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = $1 LIMIT 1`,
    [tableName]
  );
  return res.rowCount && res.rowCount > 0;
}

async function runMigrations() {
  try {
    console.log('Running database migrations...');

    const usersExists = await tableExists('users');
    
    // Read and execute migration files
    const migrationDir = path.join(__dirname); // this file lives in src/migrations
    let files = fs.readdirSync(migrationDir).filter(f => f.endsWith('.sql')).sort();

    // If core schema already exists, skip the initial schema file to avoid conflicts
    if (usersExists) {
      files = files.filter(f => f !== '000_initial_schema.sql');
    }
    
    for (const file of files) {
      console.log(`Running migration: ${file}`);
      const sql = fs.readFileSync(path.join(migrationDir, file), 'utf8');
      await pgPool.query(sql);
      console.log(`✓ Migration ${file} completed`);
    }
    
    console.log('All migrations completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await pgPool.end();
  }
}

runMigrations();
