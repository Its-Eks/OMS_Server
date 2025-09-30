import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  user: process.env.POSTGRES_USER || 'postgres',
  host: process.env.POSTGRES_HOST || 'localhost',
  database: process.env.POSTGRES_DB || 'oms_platform',
  password: process.env.POSTGRES_PASSWORD || 'password',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false
});

async function fixEscalationDataConsistency() {
  console.log('🔧 Fixing Escalation Data Consistency...\n');

  try {
    // Check for data inconsistencies
    console.log('1️⃣ Checking for data inconsistencies...');
    const inconsistentData = await pool.query(`
      SELECT 
        e.id,
        e.escalated_to,
        e.escalated_to_name,
        u.first_name || ' ' || u.last_name as computed_name
      FROM escalations e
      LEFT JOIN users u ON u.id = e.escalated_to
      WHERE (e.escalated_to IS NULL AND e.escalated_to_name IS NOT NULL)
         OR (e.escalated_to IS NOT NULL AND e.escalated_to_name IS NULL)
         OR (e.escalated_to IS NOT NULL AND e.escalated_to_name IS NOT NULL 
             AND e.escalated_to_name != u.first_name || ' ' || u.last_name)
    `);

    console.log(`Found ${inconsistentData.rows.length} inconsistent records:`);
    inconsistentData.rows.forEach(row => {
      console.log(`  - ID: ${row.id}`);
      console.log(`    escalated_to: ${row.escalated_to}`);
      console.log(`    escalated_to_name: ${row.escalated_to_name}`);
      console.log(`    computed_name: ${row.computed_name}`);
      console.log('');
    });

    if (inconsistentData.rows.length === 0) {
      console.log('✅ No data inconsistencies found!');
      return;
    }

    // Fix inconsistencies
    console.log('2️⃣ Fixing data inconsistencies...');
    
    // Case 1: escalated_to is NULL but escalated_to_name has value
    const fixNullAssigned = await pool.query(`
      UPDATE escalations 
      SET escalated_to_name = NULL 
      WHERE escalated_to IS NULL AND escalated_to_name IS NOT NULL
    `);
    console.log(`✅ Fixed ${fixNullAssigned.rowCount} records where escalated_to was NULL but name had value`);

    // Case 2: escalated_to has value but escalated_to_name is NULL
    const fixNullName = await pool.query(`
      UPDATE escalations 
      SET escalated_to_name = u.first_name || ' ' || u.last_name
      FROM users u
      WHERE escalations.escalated_to = u.id 
        AND escalations.escalated_to IS NOT NULL 
        AND escalations.escalated_to_name IS NULL
    `);
    console.log(`✅ Fixed ${fixNullName.rowCount} records where escalated_to had value but name was NULL`);

    // Case 3: Names don't match
    const fixMismatchedNames = await pool.query(`
      UPDATE escalations 
      SET escalated_to_name = u.first_name || ' ' || u.last_name
      FROM users u
      WHERE escalations.escalated_to = u.id 
        AND escalations.escalated_to IS NOT NULL 
        AND escalations.escalated_to_name IS NOT NULL
        AND escalations.escalated_to_name != u.first_name || ' ' || u.last_name
    `);
    console.log(`✅ Fixed ${fixMismatchedNames.rowCount} records where names didn't match`);

    // Verify fixes
    console.log('\n3️⃣ Verifying fixes...');
    const remainingInconsistencies = await pool.query(`
      SELECT COUNT(*) as count
      FROM escalations e
      LEFT JOIN users u ON u.id = e.escalated_to
      WHERE (e.escalated_to IS NULL AND e.escalated_to_name IS NOT NULL)
         OR (e.escalated_to IS NOT NULL AND e.escalated_to_name IS NULL)
         OR (e.escalated_to IS NOT NULL AND e.escalated_to_name IS NOT NULL 
             AND e.escalated_to_name != u.first_name || ' ' || u.last_name)
    `);

    if (remainingInconsistencies.rows[0].count === '0') {
      console.log('✅ All data inconsistencies have been fixed!');
    } else {
      console.log(`⚠️  ${remainingInconsistencies.rows[0].count} inconsistencies still remain`);
    }

    // Show final statistics
    console.log('\n4️⃣ Final Statistics:');
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_escalations,
        COUNT(*) FILTER (WHERE escalated_to IS NULL) as unassigned,
        COUNT(*) FILTER (WHERE escalated_to IS NOT NULL) as assigned,
        COUNT(*) FILTER (WHERE escalated_to IS NOT NULL AND escalated_to_name IS NOT NULL) as with_names
      FROM escalations
    `);

    const stat = stats.rows[0];
    console.log(`  Total Escalations: ${stat.total_escalations}`);
    console.log(`  Unassigned: ${stat.unassigned}`);
    console.log(`  Assigned: ${stat.assigned}`);
    console.log(`  With Names: ${stat.with_names}`);

  } catch (error) {
    console.error('❌ Error fixing data consistency:', error);
  } finally {
    await pool.end();
  }
}

fixEscalationDataConsistency().catch(console.error);
