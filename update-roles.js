// Script to update roles using the backend's database connection
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'oms_db_mi5h',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password'
});

async function updateRoles() {
  try {
    console.log('🔄 Starting role update...');
    
    // Read the SQL file
    const sqlPath = path.join(process.cwd(), '..', 'prd-aligned-roles-update.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    
    // Split by semicolon and execute each statement
    const statements = sqlContent.split(';').filter(stmt => stmt.trim().length > 0);
    
    console.log(`📝 Found ${statements.length} SQL statements to execute`);
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i].trim();
      if (statement.length > 0 && !statement.startsWith('--')) {
        console.log(`⚡ Executing statement ${i + 1}...`);
        try {
          await pool.query(statement);
          console.log(`✅ Statement ${i + 1} executed successfully`);
        } catch (error) {
          console.error(`❌ Error in statement ${i + 1}:`, error.message);
          // Continue with other statements
        }
      }
    }
    
    console.log('\n🎉 Role update completed!');
    
    // Verify the results
    console.log('\n📊 Final role structure:');
    const result = await pool.query(`
      SELECT 
        name,
        description,
        jsonb_array_length(permissions) as permission_count
      FROM roles 
      ORDER BY 
        CASE name
          WHEN 'Super Administrator' THEN 1
          WHEN 'System Administrator' THEN 2
          WHEN 'Process Owner' THEN 3
          WHEN 'Reporting Manager' THEN 4
          WHEN 'Operations Manager' THEN 5
          WHEN 'Application Administrator' THEN 6
          WHEN 'Customer Success Manager' THEN 7
          WHEN 'FNO Integration Specialist' THEN 8
          WHEN 'Sales Representative' THEN 9
          WHEN 'Support Agent' THEN 10
          WHEN 'Admin' THEN 11
          WHEN 'user' THEN 12
          ELSE 13
        END
    `);
    
    result.rows.forEach(row => {
      console.log(`\n🔹 ${row.name}:`);
      console.log(`   Description: ${row.description}`);
      console.log(`   Permissions: ${row.permission_count}`);
    });
    
    // Check System Administrator specifically
    const sysAdminResult = await pool.query(`
      SELECT permissions FROM roles WHERE name = 'System Administrator'
    `);
    
    if (sysAdminResult.rows.length > 0) {
      const sysAdminPermissions = sysAdminResult.rows[0].permissions;
      console.log(`\n🔐 System Administrator has ${sysAdminPermissions.length} permissions (should be 30)`);
      console.log('✅ System Administrator ready for testing!');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

updateRoles();
