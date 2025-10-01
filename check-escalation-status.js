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

async function checkEscalationStatus() {
  console.log('🔍 Checking Escalation Status Logic...\n');

  try {
    // 1. Check actual status values in database
    console.log('1️⃣ Actual Status Values in Database:');
    const statusCounts = await pool.query(`
      SELECT 
        status,
        COUNT(*) as count,
        MIN(created_at) as oldest,
        MAX(created_at) as newest
      FROM escalations 
      GROUP BY status 
      ORDER BY count DESC
    `);

    console.log('Status Distribution:');
    statusCounts.rows.forEach(row => {
      console.log(`  ${row.status}: ${row.count} escalations`);
      console.log(`    Oldest: ${row.oldest}`);
      console.log(`    Newest: ${row.newest}`);
      console.log('');
    });

    // 2. Check display_status logic
    console.log('2️⃣ Display Status Logic Test:');
    const displayStatusTest = await pool.query(`
      SELECT 
        e.id,
        e.status,
        e.escalated_to,
        u.first_name || ' ' || u.last_name as assigned_to_name,
        EXTRACT(EPOCH FROM (NOW() - e.created_at))/3600 as aging_hours,
        CASE 
          WHEN e.status = 'resolved' THEN 'resolved'
          WHEN e.status = 'in_progress' THEN 'in_progress'
          WHEN e.status = 'open' AND EXTRACT(EPOCH FROM (NOW() - e.created_at))/3600 > 24 THEN 'overdue'
          ELSE 'open'
        END as display_status
      FROM escalations e
      LEFT JOIN users u ON u.id = e.escalated_to
      ORDER BY e.created_at DESC
      LIMIT 10
    `);

    console.log('Sample Escalations with Display Status:');
    displayStatusTest.rows.forEach((row, index) => {
      console.log(`  ${index + 1}. ID: ${row.id}`);
      console.log(`     Status: ${row.status}`);
      console.log(`     Display Status: ${row.display_status}`);
      console.log(`     Assigned to: ${row.assigned_to_name || 'Unassigned'}`);
      console.log(`     Age: ${Math.round(row.aging_hours)} hours`);
      console.log('');
    });

    // 3. Check Mpho's escalations specifically
    console.log('3️⃣ Mpho Tjale Escalations:');
    const mphoEscalations = await pool.query(`
      SELECT 
        e.id,
        e.status,
        e.escalated_to,
        u.first_name || ' ' || u.last_name as assigned_to_name,
        EXTRACT(EPOCH FROM (NOW() - e.created_at))/3600 as aging_hours,
        CASE 
          WHEN e.status = 'resolved' THEN 'resolved'
          WHEN e.status = 'in_progress' THEN 'in_progress'
          WHEN e.status = 'open' AND EXTRACT(EPOCH FROM (NOW() - e.created_at))/3600 > 24 THEN 'overdue'
          ELSE 'open'
        END as display_status
      FROM escalations e
      LEFT JOIN users u ON u.id = e.escalated_to
      WHERE e.escalated_to = (SELECT id FROM users WHERE first_name = 'Mpho' AND last_name = 'Tjale')
      ORDER BY e.created_at DESC
    `);

    console.log(`Found ${mphoEscalations.rows.length} escalations assigned to Mpho:`);
    mphoEscalations.rows.forEach((row, index) => {
      console.log(`  ${index + 1}. ID: ${row.id}`);
      console.log(`     Status: ${row.status}`);
      console.log(`     Display Status: ${row.display_status}`);
      console.log(`     Age: ${Math.round(row.aging_hours)} hours`);
      console.log('');
    });

    // 4. Check Operations Manager assignments
    console.log('4️⃣ Operations Manager Assignments:');
    const omAssignments = await pool.query(`
      SELECT 
        u.first_name || ' ' || u.last_name as om_name,
        COUNT(e.id) as total_escalations,
        COUNT(CASE WHEN e.status = 'open' THEN 1 END) as open_escalations,
        COUNT(CASE WHEN e.status = 'in_progress' THEN 1 END) as in_progress_escalations,
        COUNT(CASE WHEN e.status = 'resolved' THEN 1 END) as resolved_escalations
      FROM users u
      JOIN roles r ON r.id = u.role_id
      LEFT JOIN escalations e ON e.escalated_to = u.id
      WHERE r.name = 'Operations Manager'
      GROUP BY u.id, u.first_name, u.last_name
      ORDER BY total_escalations DESC
    `);

    console.log('Operations Manager Assignment Summary:');
    omAssignments.rows.forEach(row => {
      console.log(`  ${row.om_name}:`);
      console.log(`    Total: ${row.total_escalations}`);
      console.log(`    Open: ${row.open_escalations}`);
      console.log(`    In Progress: ${row.in_progress_escalations}`);
      console.log(`    Resolved: ${row.resolved_escalations}`);
      console.log('');
    });

    console.log('✅ Status check completed!');

  } catch (error) {
    console.error('❌ Error checking escalation status:', error);
  } finally {
    await pool.end();
  }
}

checkEscalationStatus().catch(console.error);
