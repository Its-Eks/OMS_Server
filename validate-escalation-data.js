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

async function validateEscalationData() {
  console.log('🔍 Validating Escalation Data Consistency...\n');

  try {
    // Check for data inconsistencies
    console.log('1️⃣ Checking for data inconsistencies...');
    const inconsistentData = await pool.query(`
      SELECT 
        e.id,
        e.escalated_to,
        e.escalated_to_name,
        u.first_name || ' ' || u.last_name as computed_name,
        o.order_number,
        e.status,
        e.escalation_level
      FROM escalations e
      LEFT JOIN users u ON u.id = e.escalated_to
      LEFT JOIN orders o ON o.id = e.order_id
      WHERE (e.escalated_to IS NULL AND e.escalated_to_name IS NOT NULL)
         OR (e.escalated_to IS NOT NULL AND e.escalated_to_name IS NULL)
         OR (e.escalated_to IS NOT NULL AND e.escalated_to_name IS NOT NULL 
             AND e.escalated_to_name != u.first_name || ' ' || u.last_name)
      ORDER BY e.created_at DESC
      LIMIT 10
    `);

    console.log(`Found ${inconsistentData.rows.length} inconsistent records:`);
    inconsistentData.rows.forEach((row, index) => {
      console.log(`  ${index + 1}. ID: ${row.id}`);
      console.log(`     Order: ${row.order_number}`);
      console.log(`     Status: ${row.status}`);
      console.log(`     Level: ${row.escalation_level}`);
      console.log(`     escalated_to: ${row.escalated_to}`);
      console.log(`     escalated_to_name: ${row.escalated_to_name}`);
      console.log(`     computed_name: ${row.computed_name}`);
      console.log('');
    });

    if (inconsistentData.rows.length === 0) {
      console.log('✅ No data inconsistencies found!');
    } else {
      console.log(`⚠️  Found ${inconsistentData.rows.length} inconsistent records`);
    }

    // Check assignment statistics
    console.log('\n2️⃣ Assignment Statistics:');
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_escalations,
        COUNT(*) FILTER (WHERE escalated_to IS NULL) as unassigned,
        COUNT(*) FILTER (WHERE escalated_to IS NOT NULL) as assigned,
        COUNT(*) FILTER (WHERE escalated_to IS NOT NULL AND escalated_to_name IS NOT NULL) as with_names,
        COUNT(*) FILTER (WHERE escalated_to IS NOT NULL AND escalated_to_name IS NULL) as assigned_no_name
      FROM escalations
    `);

    const stat = stats.rows[0];
    console.log(`  Total Escalations: ${stat.total_escalations}`);
    console.log(`  Unassigned: ${stat.unassigned}`);
    console.log(`  Assigned: ${stat.assigned}`);
    console.log(`  With Names: ${stat.with_names}`);
    console.log(`  Assigned but No Name: ${stat.assigned_no_name}`);

    // Check recent escalations
    console.log('\n3️⃣ Recent Escalations (Last 5):');
    const recentEscalations = await pool.query(`
      SELECT 
        e.id,
        e.escalated_to,
        e.escalated_to_name,
        u.first_name || ' ' || u.last_name as computed_name,
        o.order_number,
        e.status,
        e.escalation_level,
        e.created_at
      FROM escalations e
      LEFT JOIN users u ON u.id = e.escalated_to
      LEFT JOIN orders o ON o.id = e.order_id
      ORDER BY e.created_at DESC
      LIMIT 5
    `);

    recentEscalations.rows.forEach((row, index) => {
      console.log(`  ${index + 1}. ID: ${row.id}`);
      console.log(`     Order: ${row.order_number}`);
      console.log(`     Status: ${row.status}`);
      console.log(`     Level: ${row.escalation_level}`);
      console.log(`     escalated_to: ${row.escalated_to}`);
      console.log(`     escalated_to_name: ${row.escalated_to_name}`);
      console.log(`     computed_name: ${row.computed_name}`);
      console.log(`     Created: ${row.created_at}`);
      console.log('');
    });

    // Check for NULL assignments
    console.log('\n4️⃣ NULL Assignment Analysis:');
    const nullAssignments = await pool.query(`
      SELECT 
        COUNT(*) as total_null,
        COUNT(*) FILTER (WHERE escalated_to_name IS NOT NULL) as null_with_name,
        COUNT(*) FILTER (WHERE escalated_to_name IS NULL) as null_no_name
      FROM escalations 
      WHERE escalated_to IS NULL
    `);

    const nullStat = nullAssignments.rows[0];
    console.log(`  Total NULL escalated_to: ${nullStat.total_null}`);
    console.log(`  NULL with name: ${nullStat.null_with_name}`);
    console.log(`  NULL no name: ${nullStat.null_no_name}`);

    if (nullStat.null_with_name > 0) {
      console.log('  ⚠️  Found escalations with NULL escalated_to but non-NULL escalated_to_name!');
    }

  } catch (error) {
    console.error('❌ Error validating data:', error);
  } finally {
    await pool.end();
  }
}

validateEscalationData().catch(console.error);
