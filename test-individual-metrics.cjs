const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://oms_ad9o_user:4LKmi30trvVwjYRyXgX2rkDtBQsAQ4v8@dpg-d3ma1vruibrs73drkshg-a.frankfurt-postgres.render.com/oms_ad9o',
  ssl: { rejectUnauthorized: false }
});

async function testIndividualQueries() {
  const client = await pool.connect();
  try {
    console.log('Testing individual analytics queries...\n');
    
    // Test basic order queries
    console.log('1. Testing basic order count...');
    const orderCount = await client.query('SELECT COUNT(*) as count FROM orders');
    console.log('✅ Orders count:', orderCount.rows[0].count);
    
    // Test order processing metrics query
    console.log('\n2. Testing order processing metrics...');
    const orderProcessing = await client.query(`
      SELECT 
        COUNT(*) as total_orders,
        COUNT(CASE WHEN current_state = 'completed' THEN 1 END) as completed_orders,
        COUNT(CASE WHEN current_state NOT IN ('completed', 'cancelled') THEN 1 END) as active_orders,
        AVG(CASE 
          WHEN current_state = 'completed' 
          THEN EXTRACT(EPOCH FROM (updated_at - created_at))/3600 
        END) as avg_processing_time
      FROM orders 
      WHERE created_at >= NOW() - INTERVAL '30 days'
    `);
    console.log('✅ Order processing metrics:', orderProcessing.rows[0]);
    
    // Test customer queries
    console.log('\n3. Testing customer count...');
    const customerCount = await client.query('SELECT COUNT(*) as count FROM customers');
    console.log('✅ Customers count:', customerCount.rows[0].count);
    
    // Test escalations table
    console.log('\n4. Testing escalations table...');
    try {
      const escalationCount = await client.query('SELECT COUNT(*) as count FROM escalations');
      console.log('✅ Escalations count:', escalationCount.rows[0].count);
    } catch (error) {
      console.log('❌ Escalations query failed:', error.message);
    }
    
    // Test analytics_metrics table
    console.log('\n5. Testing analytics_metrics table...');
    try {
      const metricsCount = await client.query('SELECT COUNT(*) as count FROM analytics_metrics');
      console.log('✅ Analytics metrics count:', metricsCount.rows[0].count);
    } catch (error) {
      console.log('❌ Analytics metrics query failed:', error.message);
    }
    
    // Test daily_metrics_snapshot table
    console.log('\n6. Testing daily_metrics_snapshot table...');
    try {
      const snapshotCount = await client.query('SELECT COUNT(*) as count FROM daily_metrics_snapshot');
      console.log('✅ Daily metrics snapshot count:', snapshotCount.rows[0].count);
    } catch (error) {
      console.log('❌ Daily metrics snapshot query failed:', error.message);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

testIndividualQueries();
