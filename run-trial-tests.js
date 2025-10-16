#!/usr/bin/env node

// Trial Workflow Test Runner
// This script runs comprehensive tests for both fiber and wireless trial workflows

const { runAllTests } = require('./test-trials.js');

console.log('🧪 Trial Workflow Test Runner');
console.log('=============================');
console.log('');
console.log('This will test:');
console.log('✅ Fiber trial workflow (FNO provisioning path)');
console.log('✅ Wireless trial workflow (device shipping path)');
console.log('✅ Email notifications for all states');
console.log('✅ Microservice state synchronization');
console.log('✅ Workflow history tracking');
console.log('');

// Check if services are running
async function checkServices() {
  try {
    const backendResponse = await fetch('http://localhost:3003/health');
    const microserviceResponse = await fetch('http://localhost:3008/health');
    
    if (backendResponse.ok && microserviceResponse.ok) {
      console.log('✅ Both services are running');
      return true;
    } else {
      console.log('❌ Services not ready');
      return false;
    }
  } catch (error) {
    console.log('❌ Services not accessible:', error.message);
    return false;
  }
}

async function main() {
  console.log('🔍 Checking if services are running...');
  
  const servicesReady = await checkServices();
  
  if (!servicesReady) {
    console.log('');
    console.log('Please start both services first:');
    console.log('');
    console.log('Terminal 1 (Backend):');
    console.log('  cd "OMS Backend"');
    console.log('  npm run dev');
    console.log('');
    console.log('Terminal 2 (Microservice):');
    console.log('  cd "TBYB-OMS-MicroService"');
    console.log('  npm run dev');
    console.log('');
    console.log('Then run this script again:');
    console.log('  node run-trial-tests.js');
    console.log('');
    process.exit(1);
  }
  
  console.log('');
  console.log('🚀 Starting comprehensive trial workflow tests...');
  console.log('');
  
  await runAllTests();
}

main().catch(console.error);
