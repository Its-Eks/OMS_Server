import { Pool } from 'pg';

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/oms_db'
});

async function debugEscalations() {
  try {
    console.log('🔍 Debugging Escalation Assignments...\n');

    // 1. Check all escalations
    const escalations = await pool.query(`
      SELECT 
        e.id, e.escalated_to, e.escalation_level, e.status, e.created_at,
        o.order_number, o.order_type, o.priority,
        u_to.first_name || ' ' || u_to.last_name as assigned_to_name,
        r.name as assigned_role
      FROM escalations e
      LEFT JOIN orders o ON o.id = e.order_id
      LEFT JOIN users u_to ON u_to.id = e.escalated_to
      LEFT JOIN roles r ON r.id = u_to.role_id
      ORDER BY e.created_at DESC
      LIMIT 10
    `);

    console.log('📊 Recent Escalations:');
    console.log('Total escalations found:', escalations.rows.length);
    escalations.rows.forEach((esc, i) => {
      console.log(`${i+1}. ID: ${esc.id}, Assigned to: ${esc.assigned_to_name || 'NULL'}, Role: ${esc.assigned_role || 'NULL'}, Status: ${esc.status}`);
    });

    // 2. Check Operations Manager users
    const opsManagers = await pool.query(`
      SELECT u.id, u.first_name, u.last_name, r.name as role_name, u.is_active
      FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE r.name ILIKE '%operations%manager%' OR r.name ILIKE '%operations manager%'
    `);

    console.log('\n👥 Operations Manager Users:');
    console.log('Found:', opsManagers.rows.length);
    opsManagers.rows.forEach((user, i) => {
      console.log(`${i+1}. ${user.first_name} ${user.last_name} (${user.role_name}) - Active: ${user.is_active}`);
    });

    // 3. Check escalation rules
    const rules = await pool.query(`
      SELECT * FROM escalation_rules 
      WHERE target_role ILIKE '%operations%manager%' OR target_role ILIKE '%operations manager%'
    `);

    console.log('\n📋 Escalation Rules for Operations Manager:');
    console.log('Found:', rules.rows.length);
    rules.rows.forEach((rule, i) => {
      console.log(`${i+1}. ${rule.name} - Target: ${rule.target_role} - Active: ${rule.is_active}`);
    });

    // 4. Check escalation assignment logic
    console.log('\n🔧 Testing Assignment Logic:');
    if (opsManagers.rows.length > 0 && rules.rows.length > 0) {
      const testRule = rules.rows[0];
      const testUser = opsManagers.rows[0];
      
      console.log(`Testing rule: ${testRule.name}`);
      console.log(`Target role: ${testRule.target_role}`);
      console.log(`Available user: ${testUser.first_name} ${testUser.last_name} (${testUser.role_name})`);
      
      // Test the role matching
      const roleMatch = testUser.role_name.toLowerCase().includes('operations') && 
                       testUser.role_name.toLowerCase().includes('manager');
      console.log(`Role match: ${roleMatch}`);
    }

    // 5. Check for unassigned escalations
    const unassigned = await pool.query(`
      SELECT COUNT(*) as count FROM escalations WHERE escalated_to IS NULL
    `);

    console.log(`\n❌ Unassigned escalations: ${unassigned.rows[0].count}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

debugEscalations();
