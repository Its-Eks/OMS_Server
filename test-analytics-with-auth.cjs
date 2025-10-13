const axios = require('axios');

async function testAnalyticsWithAuth() {
  try {
    console.log('Testing analytics with authentication...');
    
    // First login to get a token
    const loginResponse = await axios.post('http://localhost:3003/auth/login', {
      method: 'email',
      email: 'jmashoana@xnext.co.za',
      password: 'Marshall@Xnext'
    });
    
    const token = loginResponse.data.data?.accessToken;
    console.log('✅ Login successful');
    
    // Now test analytics with auth token
    const response = await axios.get('http://localhost:3003/analytics/overall', {
      headers: {
        'Authorization': `Bearer ${token}`
      },
      timeout: 15000 // 15 seconds
    });
    
    console.log('✅ Analytics endpoint working!');
    console.log('Response status:', response.status);
    console.log('Response data keys:', Object.keys(response.data));
    console.log('Has fallback data:', response.data.fallback);
    
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      console.log('❌ Analytics endpoint timed out');
    } else if (error.response?.status === 401) {
      console.log('❌ Authentication failed:', error.response.data?.error?.message);
    } else {
      console.log('❌ Analytics endpoint error:', error.response?.status, error.response?.data?.error?.message);
      console.log('Full error:', error.message);
    }
  }
}

testAnalyticsWithAuth();
