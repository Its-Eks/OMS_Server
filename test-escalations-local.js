import { Pool } from 'pg';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Database connection using local environment
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'password',
  database: process.env.POSTGRES_DB || 'oms_db',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function testEscalationsLocally() {
  try {
    console.log('🔍 Testing Escalations Locally...\n');

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

    // 4. Check for unassigned escalations
    const unassigned = await pool.query(`
      SELECT COUNT(*) as count FROM escalations WHERE escalated_to IS NULL
    `);

    console.log(`\n❌ Unassigned escalations: ${unassigned.rows[0].count}`);

    // 5. Check specific user's escalations (if we can find a user ID)
    if (opsManagers.rows.length > 0) {
      const userId = opsManagers.rows[0].id;
      const userEscalations = await pool.query(`
        SELECT COUNT(*) as count FROM escalations WHERE escalated_to = $1
      `, [userId]);

      console.log(`\n👤 Escalations assigned to ${opsManagers.rows[0].first_name} ${opsManagers.rows[0].last_name}: ${userEscalations.rows[0].count}`);
    }

    // 6. Test the role matching logic
    if (opsManagers.rows.length > 0 && rules.rows.length > 0) {
      const testRule = rules.rows[0];
      const testUser = opsManagers.rows[0];
      
      console.log(`\n🔧 Testing Assignment Logic:`);
      console.log(`Rule target role: "${testRule.target_role}"`);
      console.log(`User role name: "${testUser.role_name}"`);
      
      // Test exact match
      const exactMatch = testUser.role_name === testRule.target_role;
      console.log(`Exact match: ${exactMatch}`);
      
      // Test case-insensitive match
      const caseInsensitiveMatch = testUser.role_name.toLowerCase() === testRule.target_role.toLowerCase();
      console.log(`Case-insensitive match: ${caseInsensitiveMatch}`);
      
      // Test contains match
      const containsMatch = testUser.role_name.toLowerCase().includes('operations') && 
                           testUser.role_name.toLowerCase().includes('manager');
      console.log(`Contains "operations" and "manager": ${containsMatch}`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await pool.end();
  }
}

testEscalationsLocally();
