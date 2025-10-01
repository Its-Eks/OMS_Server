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
  ssl: useSSL ? { rejectUnauthorized: false } : undefined,
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runEscalationMigrations() {
  try {
    console.log('Running escalation-related migrations...');
    const migrationDir = path.join(__dirname);
    const files = [
      '013_escalation_rules.sql',
      '014_default_sla_escalation_data.sql',
      '015_escalation_workflow.sql',
    ];

    for (const file of files) {
      const full = path.join(migrationDir, file);
      if (!fs.existsSync(full)) {
        console.warn(`Skipping missing migration file: ${file}`);
        continue;
      }
      console.log(`Running migration: ${file}`);
      const sql = fs.readFileSync(full, 'utf8');
      await pgPool.query(sql);
      console.log(`✓ Migration ${file} completed`);
    }

    // Ensure unique index for ON CONFLICT (order_id, level)
    await pgPool.query(
      `CREATE TABLE IF NOT EXISTS automated_escalations (
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         order_id UUID REFERENCES orders(id) NOT NULL,
         rule_id UUID REFERENCES escalation_rules(id),
         level INTEGER NOT NULL,
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
       );
       CREATE UNIQUE INDEX IF NOT EXISTS ux_automated_escalations_order_level
         ON automated_escalations(order_id, level);`
    );

    console.log('Escalation migrations completed successfully!');
  } catch (error) {
    console.error('Escalation migration failed:', error);
    process.exit(1);
  } finally {
    await pgPool.end();
  }
}

runEscalationMigrations();


