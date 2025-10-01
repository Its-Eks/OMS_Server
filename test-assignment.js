import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const BASE_URL = 'http://localhost:3003';

// Test data - replace with actual values from your database
const TEST_DATA = {
  escalationId: 'escalation123', // Replace with actual escalation ID
  validUserId: 'user456',        // Replace with actual user ID
  validUserName: 'John Doe',    // Replace with actual user name
  invalidUserId: 'nonexistent',
  adminToken: 'YOUR_ADMIN_TOKEN_HERE' // Replace with actual admin token
};

async function testAssignment() {
  console.log('🧪 Testing Escalation Assignment API\n');

  // Test 1: Valid Assignment
  console.log('1️⃣ Testing valid assignment...');
  try {
    const response = await axios.post(
      `${BASE_URL}/escalation/${TEST_DATA.escalationId}/assign`,
      {
        assignedTo: TEST_DATA.validUserId,
        assignedToName: TEST_DATA.validUserName
      },
      {
        headers: {
          'Authorization': `Bearer ${TEST_DATA.adminToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('✅ Valid assignment successful:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.log('❌ Valid assignment failed:');
    console.log(error.response?.data || error.message);
  }

  console.log('\n' + '='.repeat(50) + '\n');

  // Test 2: Missing Fields
  console.log('2️⃣ Testing missing fields...');
  try {
    const response = await axios.post(
      `${BASE_URL}/escalation/${TEST_DATA.escalationId}/assign`,
      {
        assignedTo: TEST_DATA.validUserId
        // Missing assignedToName
      },
      {
        headers: {
          'Authorization': `Bearer ${TEST_DATA.adminToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('❌ Should have failed but succeeded:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.log('✅ Missing fields correctly rejected:');
    console.log(error.response?.data || error.message);
  }

  console.log('\n' + '='.repeat(50) + '\n');

  // Test 3: Invalid User
  console.log('3️⃣ Testing invalid user...');
  try {
    const response = await axios.post(
      `${BASE_URL}/escalation/${TEST_DATA.escalationId}/assign`,
      {
        assignedTo: TEST_DATA.invalidUserId,
        assignedToName: 'Invalid User'
      },
      {
        headers: {
          'Authorization': `Bearer ${TEST_DATA.adminToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('❌ Should have failed but succeeded:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.log('✅ Invalid user correctly rejected:');
    console.log(error.response?.data || error.message);
  }

  console.log('\n' + '='.repeat(50) + '\n');

  // Test 4: Non-existent Escalation
  console.log('4️⃣ Testing non-existent escalation...');
  try {
    const response = await axios.post(
      `${BASE_URL}/escalation/nonexistent123/assign`,
      {
        assignedTo: TEST_DATA.validUserId,
        assignedToName: TEST_DATA.validUserName
      },
      {
        headers: {
          'Authorization': `Bearer ${TEST_DATA.adminToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('❌ Should have failed but succeeded:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.log('✅ Non-existent escalation correctly rejected:');
    console.log(error.response?.data || error.message);
  }

  console.log('\n' + '='.repeat(50) + '\n');

  // Test 5: Unauthorized Access
  console.log('5️⃣ Testing unauthorized access...');
  try {
    const response = await axios.post(
      `${BASE_URL}/escalation/${TEST_DATA.escalationId}/assign`,
      {
        assignedTo: TEST_DATA.validUserId,
        assignedToName: TEST_DATA.validUserName
      },
      {
        headers: {
          'Authorization': 'Bearer invalid_token',
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('❌ Should have failed but succeeded:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.log('✅ Unauthorized access correctly rejected:');
    console.log(error.response?.data || error.message);
  }

  console.log('\n🎯 Assignment testing completed!');
}

// Helper function to get actual test data from database
async function getTestData() {
  console.log('📋 Getting test data from database...\n');
  
  try {
    // Get escalations
    const escalationsResponse = await axios.get(
      `${BASE_URL}/escalation/all`,
      {
        headers: {
          'Authorization': `Bearer ${TEST_DATA.adminToken}`
        }
      }
    );
    
    if (escalationsResponse.data.success && escalationsResponse.data.data.length > 0) {
      const escalation = escalationsResponse.data.data[0];
      console.log('📊 Available escalation:');
      console.log(`   ID: ${escalation.id}`);
      console.log(`   Status: ${escalation.status}`);
      console.log(`   Level: ${escalation.escalation_level}`);
      console.log(`   Assigned to: ${escalation.escalated_to || 'Unassigned'}`);
    } else {
      console.log('⚠️  No escalations found. Create some escalations first.');
    }
    
  } catch (error) {
    console.log('❌ Failed to get test data:', error.response?.data || error.message);
  }
}

// Run tests
async function main() {
  console.log('🚀 Escalation Assignment API Test Suite\n');
  
  // First, get actual test data
  await getTestData();
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Then run assignment tests
  await testAssignment();
}

main().catch(console.error);
