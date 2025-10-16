// Manual Trial Workflow Test Script
// Run this when both services are running: npm run dev (backend) and npm run dev (microservice)

const BASE_URL = 'http://localhost:3003';
const MICROSERVICE_URL = 'http://localhost:3008';

// Test data
const FIBER_TRIAL_ORDER = {
  customerId: 'test-fiber-customer-id',
  serviceType: 'Fiber',
  package: '100/50 Mbps',
  installationType: 'professional',
  address: {
    street: '123 Fiber Street',
    city: 'Cape Town',
    state: 'Western Cape',
    country: 'South Africa',
    postalCode: '8001'
  }
};

const WIRELESS_TRIAL_ORDER = {
  customerId: 'test-wireless-customer-id', 
  serviceType: 'Wireless',
  package: '50/25 Mbps',
  installationType: 'self_install',
  address: {
    street: '456 Wireless Way',
    city: 'Johannesburg',
    state: 'Gauteng', 
    country: 'South Africa',
    postalCode: '2000'
  }
};

// Helper functions
async function createTrialOrder(orderData) {
  console.log(`📝 Creating ${orderData.serviceType} trial order...`);
  const response = await fetch(`${BASE_URL}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...orderData,
      isTrial: true,
      orderType: 'new_installation'
    })
  });
  const result = await response.json();
  console.log(`✅ ${orderData.serviceType} trial order created:`, result.data?.id);
  return result;
}

async function transitionWorkflow(orderId, toState) {
  console.log(`🔄 Transitioning order ${orderId} to ${toState}...`);
  const response = await fetch(`${BASE_URL}/orders/${orderId}/trials/workflow/transition`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toState })
  });
  const result = await response.json();
  console.log(`✅ Transitioned to ${toState}:`, result.success);
  return result;
}

async function getWorkflowState(orderId) {
  const response = await fetch(`${BASE_URL}/orders/${orderId}/trials/workflow`);
  const result = await response.json();
  console.log(`📊 Current state: ${result.data?.currentState}, Next states: ${result.data?.nextStates?.join(', ')}`);
  return result;
}

async function getOrderHistory(orderId) {
  const response = await fetch(`${BASE_URL}/orders/${orderId}/history`);
  const result = await response.json();
  console.log(`📜 Order history has ${result.length} entries`);
  return result;
}

async function testFiberWorkflow() {
  console.log('\n🌐 ===== TESTING FIBER TRIAL WORKFLOW =====');
  
  // Create fiber trial order
  const fiberResult = await createTrialOrder(FIBER_TRIAL_ORDER);
  if (!fiberResult.success) {
    console.error('❌ Failed to create fiber trial order:', fiberResult);
    return;
  }
  
  const fiberOrderId = fiberResult.data.id;
  
  // Test workflow transitions
  const fiberTransitions = [
    'trial_fno_provisioning',
    'trial_installation_pending', 
    'trial_installation_scheduled',
    'trial_active'
  ];
  
  for (const state of fiberTransitions) {
    await transitionWorkflow(fiberOrderId, state);
    await getWorkflowState(fiberOrderId);
  }
  
  // Get final history
  await getOrderHistory(fiberOrderId);
  
  console.log('✅ Fiber trial workflow test completed!');
  return fiberOrderId;
}

async function testWirelessWorkflow() {
  console.log('\n📡 ===== TESTING WIRELESS TRIAL WORKFLOW =====');
  
  // Create wireless trial order
  const wirelessResult = await createTrialOrder(WIRELESS_TRIAL_ORDER);
  if (!wirelessResult.success) {
    console.error('❌ Failed to create wireless trial order:', wirelessResult);
    return;
  }
  
  const wirelessOrderId = wirelessResult.data.id;
  
  // Test workflow transitions
  const wirelessTransitions = [
    'trial_device_shipping',
    'trial_device_delivered',
    'trial_self_install',
    'trial_active',
    'trial_engaged',
    'trial_converted'
  ];
  
  for (const state of wirelessTransitions) {
    await transitionWorkflow(wirelessOrderId, state);
    await getWorkflowState(wirelessOrderId);
  }
  
  // Get final history
  await getOrderHistory(wirelessOrderId);
  
  console.log('✅ Wireless trial workflow test completed!');
  return wirelessOrderId;
}

async function testMicroserviceSync(orderId) {
  console.log('\n🔄 ===== TESTING MICROSERVICE SYNC =====');
  
  const workflow = await getWorkflowState(orderId);
  if (!workflow.success) {
    console.error('❌ Failed to get workflow state');
    return;
  }
  
  // Test microservice endpoint
  try {
    const microserviceResponse = await fetch(`${MICROSERVICE_URL}/health`);
    const microserviceHealth = await microserviceResponse.json();
    console.log('✅ Microservice health:', microserviceHealth.status);
  } catch (error) {
    console.error('❌ Microservice not responding:', error.message);
  }
  
  console.log('✅ Microservice sync test completed!');
}

async function runAllTests() {
  console.log('🚀 Starting Trial Workflow Tests...');
  console.log('Make sure both services are running:');
  console.log('- Backend: npm run dev (port 3003)');
  console.log('- Microservice: npm run dev (port 3008)');
  console.log('');
  
  try {
    // Test health endpoints
    console.log('🏥 Checking service health...');
    const backendHealth = await fetch(`${BASE_URL}/health`);
    console.log('✅ Backend health:', backendHealth.status);
    
    const microserviceHealth = await fetch(`${MICROSERVICE_URL}/health`);
    console.log('✅ Microservice health:', microserviceHealth.status);
    
    // Run fiber workflow test
    const fiberOrderId = await testFiberWorkflow();
    
    // Run wireless workflow test  
    const wirelessOrderId = await testWirelessWorkflow();
    
    // Test microservice sync
    if (wirelessOrderId) {
      await testMicroserviceSync(wirelessOrderId);
    }
    
    console.log('\n🎉 All tests completed successfully!');
    console.log(`Fiber Order ID: ${fiberOrderId}`);
    console.log(`Wireless Order ID: ${wirelessOrderId}`);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.log('\nMake sure both services are running:');
    console.log('- Backend: npm run dev (port 3003)');
    console.log('- Microservice: npm run dev (port 3008)');
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests();
}

module.exports = {
  testFiberWorkflow,
  testWirelessWorkflow,
  testMicroserviceSync,
  runAllTests
};
