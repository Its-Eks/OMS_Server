import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

const pgPool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'oms_db',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD,
});

async function runMigrations() {
  try {
    console.log('Running database migrations...');
    
    // Read and execute migration files
    const migrationDir = path.join(__dirname, '..', 'migrations');
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
