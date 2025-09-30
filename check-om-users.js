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

async function checkOperationsManagers() {
  console.log('🔍 Checking Operations Manager Users...\n');

  try {
    // Check all Operations Managers
    console.log('1️⃣ All Operations Manager Users:');
    const omUsers = await pool.query(`
      SELECT 
        u.id,
        u.first_name,
        u.last_name,
        u.email,
        u.is_active,
        u.reporting_manager_id,
        r.name as role_name,
        r.permissions
      FROM users u
      LEFT JOIN roles r ON r.id = u.role_id
      WHERE r.name = 'Operations Manager'
      ORDER BY u.created_at DESC
    `);

    console.log(`Found ${omUsers.rows.length} Operations Manager(s):`);
    omUsers.rows.forEach((user, index) => {
      console.log(`  ${index + 1}. ${user.first_name} ${user.last_name}`);
      console.log(`     ID: ${user.id}`);
      console.log(`     Email: ${user.email}`);
      console.log(`     Role: ${user.role_name}`);
      console.log(`     Active: ${user.is_active}`);
      console.log(`     Reporting Manager: ${user.reporting_manager_id || 'None'}`);
      console.log(`     Permissions: ${user.permissions || 'None'}`);
      console.log('');
    });

    // Check escalation assignment distribution
    console.log('2️⃣ Current Escalation Assignments:');
    const assignments = await pool.query(`
      SELECT 
        e.escalated_to,
        u.first_name || ' ' || u.last_name as assigned_to_name,
        COUNT(*) as assignment_count,
        COUNT(*) FILTER (WHERE e.status = 'open') as open_count,
        COUNT(*) FILTER (WHERE e.status = 'in_progress') as in_progress_count,
        COUNT(*) FILTER (WHERE e.status = 'resolved') as resolved_count
      FROM escalations e
      LEFT JOIN users u ON u.id = e.escalated_to
      GROUP BY e.escalated_to, u.first_name, u.last_name
      ORDER BY assignment_count DESC
    `);

    console.log('Assignment Distribution:');
    assignments.rows.forEach((assignment, index) => {
      const assignee = assignment.assigned_to_name || 'Unassigned';
      console.log(`  ${index + 1}. ${assignee}`);
      console.log(`     Total: ${assignment.assignment_count}`);
      console.log(`     Open: ${assignment.open_count}`);
      console.log(`     In Progress: ${assignment.in_progress_count}`);
      console.log(`     Resolved: ${assignment.resolved_count}`);
      console.log('');
    });

    // Check recent escalations
    console.log('3️⃣ Recent Escalations (Last 10):');
    const recentEscalations = await pool.query(`
      SELECT 
        e.id,
        e.escalated_to,
        u.first_name || ' ' || u.last_name as assigned_to_name,
        o.order_number,
        e.status,
        e.escalation_level,
        e.created_at
      FROM escalations e
      LEFT JOIN users u ON u.id = e.escalated_to
      LEFT JOIN orders o ON o.id = e.order_id
      ORDER BY e.created_at DESC
      LIMIT 10
    `);

    recentEscalations.rows.forEach((escalation, index) => {
      const assignee = escalation.assigned_to_name || 'Unassigned';
      console.log(`  ${index + 1}. ${escalation.order_number}`);
      console.log(`     Assigned to: ${assignee}`);
      console.log(`     Status: ${escalation.status}`);
      console.log(`     Level: ${escalation.escalation_level}`);
      console.log(`     Created: ${escalation.created_at}`);
      console.log('');
    });

    // Check all roles in the system
    console.log('4️⃣ All Roles in System:');
    const allRoles = await pool.query(`
      SELECT 
        r.id,
        r.name,
        r.description,
        r.permissions,
        COUNT(u.id) as user_count
      FROM roles r
      LEFT JOIN users u ON u.role_id = r.id
      GROUP BY r.id, r.name, r.description, r.permissions
      ORDER BY r.name
    `);

    console.log(`Found ${allRoles.rows.length} role(s):`);
    allRoles.rows.forEach((role, index) => {
      console.log(`  ${index + 1}. ${role.name}`);
      console.log(`     Description: ${role.description || 'None'}`);
      console.log(`     Users with this role: ${role.user_count}`);
      console.log(`     Permissions: ${role.permissions || 'None'}`);
      console.log('');
    });

    // Check escalation rules
    console.log('5️⃣ Escalation Rules:');
    const rules = await pool.query(`
      SELECT 
        id,
        name,
        order_type,
        task_type,
        priority,
        time_threshold_hours,
        target_role,
        is_active
      FROM escalation_rules
      ORDER BY created_at DESC
    `);

    console.log(`Found ${rules.rows.length} escalation rule(s):`);
    rules.rows.forEach((rule, index) => {
      console.log(`  ${index + 1}. ${rule.name}`);
      console.log(`     Order Type: ${rule.order_type || 'Any'}`);
      console.log(`     Task Type: ${rule.task_type || 'Any'}`);
      console.log(`     Priority: ${rule.priority || 'Any'}`);
      console.log(`     Threshold: ${rule.time_threshold_hours}h`);
      console.log(`     Target Role: ${rule.target_role}`);
      console.log(`     Active: ${rule.is_active}`);
      console.log('');
    });

  } catch (error) {
    console.error('❌ Error checking Operations Managers:', error);
  } finally {
    await pool.end();
  }
}

checkOperationsManagers().catch(console.error);
