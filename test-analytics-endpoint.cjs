const axios = require('axios');

async function testAnalyticsEndpoint() {
  try {
    console.log('Testing analytics endpoint...');
    
    // Test with a longer timeout to see the actual error
    const response = await axios.get('http://localhost:3003/analytics/overall', {
      timeout: 30000 // 30 seconds
    });
    
    console.log('✅ Analytics endpoint working!');
    console.log('Response status:', response.status);
    console.log('Response data keys:', Object.keys(response.data));
    
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      console.log('❌ Analytics endpoint timed out after 5 seconds');
    } else {
      console.log('❌ Analytics endpoint error:', error.response?.status, error.message);
    }
  }
}

testAnalyticsEndpoint();
