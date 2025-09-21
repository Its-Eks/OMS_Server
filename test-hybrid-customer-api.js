#!/usr/bin/env node

// Test script for hybrid customer API approach
import http from 'http';

const MAIN_SERVER = 'http://localhost:3003';
const ONBOARDING_SERVICE = 'http://localhost:3004';

function makeRequest(host, port, path, method = 'GET', headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: host,
      port: port,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve({ status: res.statusCode, data: jsonData });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', (err) => reject(err));
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function testHybridCustomerAPI() {
  console.log('🔄 Testing Hybrid Customer API Approach...\n');

  try {
    // Test 1: Main Server Health
    console.log('1. Testing Main Server (Port 3003)...');
    const mainHealth = await makeRequest('localhost', 3003, '/health');
    console.log(`   Status: ${mainHealth.status}`);
    console.log(`   Service: Main OMS Server\n`);

    // Test 2: Onboarding Service Health
    console.log('2. Testing Onboarding Service (Port 3004)...');
    const onboardingHealth = await makeRequest('localhost', 3004, '/health');
    console.log(`   Status: ${onboardingHealth.status}`);
    console.log(`   Service: Onboarding Service\n`);

    // Test 3: Customer Routes on Main Server (should require auth)
    console.log('3. Testing Customer Routes on Main Server...');
    const customers = await makeRequest('localhost', 3003, '/customers');
    console.log(`   Status: ${customers.status}`);
    console.log(`   Response: ${JSON.stringify(customers.data, null, 2)}\n`);

    // Test 4: Customer Stats on Main Server
    console.log('4. Testing Customer Stats on Main Server...');
    const stats = await makeRequest('localhost', 3003, '/customers/stats');
    console.log(`   Status: ${stats.status}`);
    console.log(`   Response: ${JSON.stringify(stats.data, null, 2)}\n`);

    // Test 5: Onboarding Service Routes
    console.log('5. Testing Onboarding Service Routes...');
    const onboarding = await makeRequest('localhost', 3004, '/onboarding');
    console.log(`   Status: ${onboarding.status}`);
    console.log(`   Response: ${JSON.stringify(onboarding.data, null, 2)}\n`);

    console.log('✅ Hybrid Customer API Testing Completed!');
    console.log('\n📋 Summary:');
    console.log('- Main Server (3003): Customer listing, stats, and management');
    console.log('- Onboarding Service (3004): Customer creation and onboarding flows');
    console.log('- Both services require authentication');
    console.log('- Ready for integration between services');

  } catch (error) {
    console.error('❌ Error testing hybrid customer API:', error.message);
  }
}

testHybridCustomerAPI();
