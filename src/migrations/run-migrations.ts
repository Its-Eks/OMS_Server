import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const pgPool = new Pool({
  host: process.env.POSTGRES_HOST ,
  port: parseInt(process.env.POSTGRES_PORT ),
  database: process.env.POSTGRES_DB ,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
});

// Handle ESM: __dirname is not defined by default
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigrations() {
  try {
    console.log('Running database migrations...');
    
    // Read and execute migration files
    const migrationDir = path.join(__dirname); // this file lives in src/migrations
    const files = fs.readdirSync(migrationDir).filter(f => f.endsWith('.sql')).sort();
    
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
