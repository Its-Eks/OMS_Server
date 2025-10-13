const axios = require('axios');

async function testSimpleAnalytics() {
  try {
    console.log('Testing if we can get basic analytics data...');
    
    // Test a simpler endpoint first
    const response = await axios.get('http://localhost:3003/analytics/order-trends', {
      timeout: 10000
    });
    
    console.log('✅ Order trends endpoint working!');
    console.log('Response status:', response.status);
    console.log('Response data:', JSON.stringify(response.data, null, 2));
    
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      console.log('❌ Endpoint timed out');
    } else {
      console.log('❌ Endpoint error:', error.response?.status, error.response?.data?.error?.message);
      console.log('Full error:', error.message);
    }
  }
}

testSimpleAnalytics();
