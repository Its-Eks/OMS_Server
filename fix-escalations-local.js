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

async function fixEscalationsLocally() {
  try {
    console.log('🔧 Fixing Unassigned Escalations Locally...\n');

    // 1. Find all unassigned escalations
    const unassigned = await pool.query(`
      SELECT e.id, e.order_id, e.escalation_level, e.escalation_reason, e.created_at,
             o.order_type, o.priority
      FROM escalations e
      LEFT JOIN orders o ON o.id = e.order_id
      WHERE e.escalated_to IS NULL
      ORDER BY e.created_at DESC
    `);

    console.log(`Found ${unassigned.rows.length} unassigned escalations`);

    if (unassigned.rows.length === 0) {
      console.log('✅ No unassigned escalations found');
      return;
    }

    // 2. Find active Operations Manager users
    const opsManagers = await pool.query(`
      SELECT u.id, u.first_name, u.last_name, r.name as role_name
      FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE (r.name ILIKE '%operations%manager%' OR r.name ILIKE '%operations manager%') 
        AND u.is_active = true
      ORDER BY u.updated_at DESC
    `);

    console.log(`Found ${opsManagers.rows.length} active Operations Manager users`);
    opsManagers.rows.forEach((user, i) => {
      console.log(`${i+1}. ${user.first_name} ${user.last_name} (${user.role_name})`);
    });

    if (opsManagers.rows.length === 0) {
      console.log('❌ No active Operations Manager users found');
      return;
    }

    // 3. Get load balancing data
    const loadData = await pool.query(`
      SELECT escalated_to, COUNT(*) as open_count
      FROM escalations
      WHERE escalated_to IS NOT NULL AND status <> 'resolved'
      GROUP BY escalated_to
    `);

    const loadMap = new Map();
    loadData.rows.forEach(row => {
      loadMap.set(row.escalated_to, parseInt(row.open_count));
    });

    console.log('\n📊 Current load distribution:');
    for (const user of opsManagers.rows) {
      const load = loadMap.get(user.id) || 0;
      console.log(`- ${user.first_name} ${user.last_name}: ${load} open escalations`);
    }

    // 4. Assign escalations using load balancing
    let assigned = 0;
    const assignments = [];

    console.log('\n🔄 Assigning escalations...');

    for (const escalation of unassigned.rows) {
      // Find the Operations Manager with the fewest open escalations
      let bestUser = null;
      let minLoad = Infinity;

      for (const user of opsManagers.rows) {
        const currentLoad = loadMap.get(user.id) || 0;
        if (currentLoad < minLoad) {
          minLoad = currentLoad;
          bestUser = user;
        }
      }

      if (bestUser) {
        // Update the escalation
        await pool.query(
          'UPDATE escalations SET escalated_to = $1 WHERE id = $2',
          [bestUser.id, escalation.id]
        );

        // Update load map
        loadMap.set(bestUser.id, (loadMap.get(bestUser.id) || 0) + 1);
        assigned++;

        assignments.push({
          escalationId: escalation.id,
          assignedTo: bestUser.id,
          assignedToName: `${bestUser.first_name} ${bestUser.last_name}`,
          load: minLoad
        });

        if (assigned % 10 === 0) {
          console.log(`✅ Assigned ${assigned} escalations so far...`);
        }
      }
    }

    console.log(`\n🎉 Successfully assigned ${assigned} escalations`);

    // 5. Show final load distribution
    console.log('\n📊 Final load distribution:');
    for (const user of opsManagers.rows) {
      const load = loadMap.get(user.id) || 0;
      console.log(`- ${user.first_name} ${user.last_name}: ${load} open escalations`);
    }

    // 6. Verify the fix
    const remaining = await pool.query(`
      SELECT COUNT(*) as count FROM escalations WHERE escalated_to IS NULL
    `);

    console.log(`\n📊 Remaining unassigned escalations: ${remaining.rows[0].count}`);

    // 7. Show some sample assignments
    if (assignments.length > 0) {
      console.log('\n📋 Sample assignments:');
      assignments.slice(0, 5).forEach((assignment, i) => {
        console.log(`${i+1}. Escalation ${assignment.escalationId} → ${assignment.assignedToName} (load: ${assignment.load})`);
      });
      if (assignments.length > 5) {
        console.log(`... and ${assignments.length - 5} more`);
      }
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await pool.end();
  }
}

fixEscalationsLocally();

