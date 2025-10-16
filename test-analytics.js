const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'dpg-d3ma1vruibrs73drkshg-a.frankfurt-postgres.render.com',
  user: process.env.DB_USER || 'oms_ad9o_user',
  password: process.env.DB_PASSWORD || 'your-password',
  database: process.env.DB_NAME || 'oms_ad9o',
  port: process.env.DB_PORT || 5432,
  ssl: true
});

async function testAnalytics() {
  try {
    console.log('🔍 Testing trial analytics...');
    
    // Get trial orders from the orders table
    const trialOrdersResult = await pool.query(`
      SELECT 
        o.id,
        o.status,
        o.current_state,
        o.service_details,
        o.created_at,
        o.updated_at
      FROM orders o
      WHERE o.service_type = 'Trial' 
         OR o.service_details->>'serviceType' = 'Trial'
         OR o.service_details->>'service_type' = 'Trial'
      ORDER BY o.created_at DESC
    `);
    
    const trialOrders = trialOrdersResult.rows;
    console.log('📊 Found', trialOrders.length, 'trial orders');
    
    // Categorize orders by service type
    const fiberTrials = trialOrders.filter(order => {
      const serviceType = order.service_details?.serviceType || order.service_details?.service_type;
      return serviceType?.toLowerCase() === 'fiber';
    });
    
    const wirelessTrials = trialOrders.filter(order => {
      const serviceType = order.service_details?.serviceType || order.service_details?.service_type;
      return serviceType?.toLowerCase() === 'wireless';
    });
    
    console.log('🔍 Fiber trials:', fiberTrials.length);
    console.log('📡 Wireless trials:', wirelessTrials.length);
    
    // Show details of each trial order
    console.log('\n📋 Trial Orders Details:');
    trialOrders.forEach((order, index) => {
      const serviceType = order.service_details?.serviceType || order.service_details?.service_type || 'Unknown';
      console.log(`${index + 1}. Order ${order.id}:`);
      console.log(`   Status: ${order.status}`);
      console.log(`   Service Type: ${serviceType}`);
      console.log(`   Service Details:`, JSON.stringify(order.service_details, null, 2));
      console.log('');
    });
    
    // Calculate service-specific analytics
    const fiberActive = fiberTrials.filter(order => 
      ['trial_active', 'trial_engaged', 'trial_order_created', 'trial_fno_provisioning', 'trial_installation_pending', 'trial_installation_scheduled'].includes(order.status)
    ).length;
    const fiberConverted = fiberTrials.filter(order => order.status === 'trial_converted').length;
    const fiberConversionRate = fiberTrials.length > 0 ? ((fiberConverted / fiberTrials.length) * 100).toFixed(1) + '%' : '0%';
    
    const wirelessActive = wirelessTrials.filter(order => 
      ['trial_active', 'trial_engaged', 'trial_order_created', 'trial_fno_provisioning', 'trial_installation_pending', 'trial_installation_scheduled'].includes(order.status)
    ).length;
    const wirelessConverted = wirelessTrials.filter(order => order.status === 'trial_converted').length;
    const wirelessConversionRate = wirelessTrials.length > 0 ? ((wirelessConverted / wirelessTrials.length) * 100).toFixed(1) + '%' : '0%';
    
    console.log('📈 Analytics Summary:');
    console.log(`   Total Trials: ${trialOrders.length}`);
    console.log(`   Fiber: ${fiberTrials.length} (Active: ${fiberActive}, Converted: ${fiberConverted}, Rate: ${fiberConversionRate})`);
    console.log(`   Wireless: ${wirelessTrials.length} (Active: ${wirelessActive}, Converted: ${wirelessConverted}, Rate: ${wirelessConversionRate})`);
    
  } catch (error) {
    console.error('❌ Error testing analytics:', error);
  } finally {
    await pool.end();
  }
}

testAnalytics();
