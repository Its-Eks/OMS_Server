import { Pool } from 'pg';

// Database connection - you'll need to set these environment variables
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'password',
  database: process.env.POSTGRES_DB || 'oms_db',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

async function fixUnassignedEscalations() {
  try {
    console.log('🔧 Fixing Unassigned Escalations...\n');

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

    // 2. Find Operations Manager users
    const opsManagers = await pool.query(`
      SELECT u.id, u.first_name, u.last_name, r.name as role_name
      FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE (r.name ILIKE '%operations%manager%' OR r.name ILIKE '%operations manager%') 
        AND u.is_active = true
      ORDER BY u.updated_at DESC
    `);

    console.log(`Found ${opsManagers.rows.length} Operations Manager users`);

    if (opsManagers.rows.length === 0) {
      console.log('❌ No Operations Manager users found');
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

    // 4. Assign escalations using load balancing
    let assigned = 0;
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

        console.log(`✅ Assigned escalation ${escalation.id} to ${bestUser.first_name} ${bestUser.last_name} (load: ${minLoad})`);
      }
    }

    console.log(`\n🎉 Successfully assigned ${assigned} escalations`);

    // 5. Verify the fix
    const remaining = await pool.query(`
      SELECT COUNT(*) as count FROM escalations WHERE escalated_to IS NULL
    `);

    console.log(`📊 Remaining unassigned escalations: ${remaining.rows[0].count}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

fixUnassignedEscalations();

