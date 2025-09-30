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

async function fixEscalationLoadBalancing() {
  console.log('🔧 Fixing Escalation Load Balancing...\n');

  try {
    // 1. Check current assignment distribution
    console.log('1️⃣ Current Assignment Distribution:');
    const currentDistribution = await pool.query(`
      SELECT 
        u.id,
        u.first_name || ' ' || u.last_name as user_name,
        COUNT(e.id) as total_escalations,
        COUNT(e.id) FILTER (WHERE e.status = 'open') as open_escalations,
        COUNT(e.id) FILTER (WHERE e.status = 'in_progress') as in_progress_escalations,
        COUNT(e.id) FILTER (WHERE e.status = 'resolved') as resolved_escalations
      FROM users u
      LEFT JOIN escalations e ON e.escalated_to = u.id
      WHERE u.role_id IN (SELECT id FROM roles WHERE name = 'Operations Manager')
        AND u.is_active = true
      GROUP BY u.id, u.first_name, u.last_name
      ORDER BY total_escalations DESC
    `);

    console.log('Current Distribution:');
    currentDistribution.rows.forEach((user, index) => {
      console.log(`  ${index + 1}. ${user.user_name}`);
      console.log(`     Total: ${user.total_escalations}`);
      console.log(`     Open: ${user.open_escalations}`);
      console.log(`     In Progress: ${user.in_progress_escalations}`);
      console.log(`     Resolved: ${user.resolved_escalations}`);
      console.log('');
    });

    // 2. Find overloaded users (more than 50 open escalations)
    console.log('2️⃣ Finding Overloaded Users:');
    const overloadedUsers = await pool.query(`
      SELECT 
        u.id,
        u.first_name || ' ' || u.last_name as user_name,
        COUNT(e.id) as open_count
      FROM users u
      JOIN escalations e ON e.escalated_to = u.id
      WHERE u.role_id IN (SELECT id FROM roles WHERE name = 'Operations Manager')
        AND u.is_active = true
        AND e.status = 'open'
      GROUP BY u.id, u.first_name, u.last_name
      HAVING COUNT(e.id) > 50
      ORDER BY open_count DESC
    `);

    if (overloadedUsers.rows.length === 0) {
      console.log('✅ No overloaded users found!');
    } else {
      console.log(`Found ${overloadedUsers.rows.length} overloaded user(s):`);
      overloadedUsers.rows.forEach((user, index) => {
        console.log(`  ${index + 1}. ${user.user_name} - ${user.open_count} open escalations`);
      });
    }

    // 3. Find underloaded users (less than 10 open escalations)
    console.log('\n3️⃣ Finding Underloaded Users:');
    const underloadedUsers = await pool.query(`
      SELECT 
        u.id,
        u.first_name || ' ' || u.last_name as user_name,
        COALESCE(COUNT(e.id), 0) as open_count
      FROM users u
      LEFT JOIN escalations e ON e.escalated_to = u.id AND e.status = 'open'
      WHERE u.role_id IN (SELECT id FROM roles WHERE name = 'Operations Manager')
        AND u.is_active = true
      GROUP BY u.id, u.first_name, u.last_name
      HAVING COALESCE(COUNT(e.id), 0) < 10
      ORDER BY open_count ASC
    `);

    console.log(`Found ${underloadedUsers.rows.length} underloaded user(s):`);
    underloadedUsers.rows.forEach((user, index) => {
      console.log(`  ${index + 1}. ${user.user_name} - ${user.open_count} open escalations`);
    });

    // 4. Redistribute escalations if needed
    if (overloadedUsers.rows.length > 0 && underloadedUsers.rows.length > 0) {
      console.log('\n4️⃣ Redistributing Escalations...');
      
      for (const overloadedUser of overloadedUsers.rows) {
        const excessEscalations = overloadedUser.open_count - 50; // Target 50 per user
        console.log(`\nRedistributing ${excessEscalations} escalations from ${overloadedUser.user_name}...`);
        
        // Get excess escalations from overloaded user
        const excessEscalationsList = await pool.query(`
          SELECT id, order_id, escalation_level, created_at
          FROM escalations
          WHERE escalated_to = $1 AND status = 'open'
          ORDER BY created_at ASC
          LIMIT $2
        `, [overloadedUser.id, excessEscalations]);

        console.log(`Found ${excessEscalationsList.rows.length} escalations to redistribute`);

        // Redistribute to underloaded users
        for (let i = 0; i < excessEscalationsList.rows.length; i++) {
          const escalation = excessEscalationsList.rows[i];
          const targetUser = underloadedUsers.rows[i % underloadedUsers.rows.length];
          
          // Update escalation assignment
          await pool.query(`
            UPDATE escalations 
            SET escalated_to = $1
            WHERE id = $2
          `, [targetUser.id, escalation.id]);

          console.log(`  Moved escalation ${escalation.id} to ${targetUser.user_name}`);
        }
      }
    }

    // 5. Show final distribution
    console.log('\n5️⃣ Final Assignment Distribution:');
    const finalDistribution = await pool.query(`
      SELECT 
        u.id,
        u.first_name || ' ' || u.last_name as user_name,
        COUNT(e.id) as total_escalations,
        COUNT(e.id) FILTER (WHERE e.status = 'open') as open_escalations,
        COUNT(e.id) FILTER (WHERE e.status = 'in_progress') as in_progress_escalations,
        COUNT(e.id) FILTER (WHERE e.status = 'resolved') as resolved_escalations
      FROM users u
      LEFT JOIN escalations e ON e.escalated_to = u.id
      WHERE u.role_id IN (SELECT id FROM roles WHERE name = 'Operations Manager')
        AND u.is_active = true
      GROUP BY u.id, u.first_name, u.last_name
      ORDER BY total_escalations DESC
    `);

    console.log('Final Distribution:');
    finalDistribution.rows.forEach((user, index) => {
      console.log(`  ${index + 1}. ${user.user_name}`);
      console.log(`     Total: ${user.total_escalations}`);
      console.log(`     Open: ${user.open_escalations}`);
      console.log(`     In Progress: ${user.in_progress_escalations}`);
      console.log(`     Resolved: ${user.resolved_escalations}`);
      console.log('');
    });

    console.log('✅ Load balancing fix completed!');
    console.log('\n📋 Next Steps:');
    console.log('1. Restart your backend server to load the new assignment logic');
    console.log('2. Test new escalations to verify load balancing works');
    console.log('3. Monitor the logs to see the new assignment metrics');

  } catch (error) {
    console.error('❌ Error fixing load balancing:', error);
  } finally {
    await pool.end();
  }
}

fixEscalationLoadBalancing().catch(console.error);
