const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://oms_ad9o_user:4LKmi30trvVwjYRyXgX2rkDtBQsAQ4v8@dpg-d3ma1vruibrs73drkshg-a.frankfurt-postgres.render.com/oms_ad9o',
  ssl: { rejectUnauthorized: false }
});

async function checkTables() {
  const client = await pool.connect();
  try {
    // Check if analytics tables exist
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('analytics_metrics', 'analytics_aggregates', 'daily_metrics_snapshot', 'escalations')
      ORDER BY table_name
    `);
    
    console.log('Analytics tables found:', result.rows.map(r => r.table_name));
    
    // Check if orders table has data
    const ordersResult = await client.query('SELECT COUNT(*) as count FROM orders');
    console.log('Orders count:', ordersResult.rows[0].count);
    
    // Check if customers table has data
    const customersResult = await client.query('SELECT COUNT(*) as count FROM customers');
    console.log('Customers count:', customersResult.rows[0].count);
    
  } finally {
    client.release();
    await pool.end();
  }
}

checkTables().catch(console.error);
