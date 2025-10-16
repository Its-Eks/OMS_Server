// Comprehensive Trial Workflow Tests
// Tests both Fiber and Wireless trial workflows from creation to conversion

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';

// Test configuration
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
async function createTrialOrder(orderData: any) {
  const response = await fetch(`${BASE_URL}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...orderData,
      isTrial: true,
      orderType: 'new_installation'
    })
  });
  return response.json();
}

async function transitionWorkflow(orderId: string, toState: string) {
  const response = await fetch(`${BASE_URL}/orders/${orderId}/trials/workflow/transition`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toState })
  });
  return response.json();
}

async function getWorkflowState(orderId: string) {
  const response = await fetch(`${BASE_URL}/orders/${orderId}/trials/workflow`);
  return response.json();
}

async function getOrderHistory(orderId: string) {
  const response = await fetch(`${BASE_URL}/orders/${orderId}/history`);
  return response.json();
}

describe('Trial Workflow Tests', () => {
  let fiberOrderId: string;
  let wirelessOrderId: string;

  beforeAll(async () => {
    console.log('🚀 Starting Trial Workflow Tests...');
    
    // Verify services are running
    const healthCheck = await fetch(`${BASE_URL}/health`);
    expect(healthCheck.status).toBe(200);
    
    const microserviceHealth = await fetch(`${MICROSERVICE_URL}/health`);
    expect(microserviceHealth.status).toBe(200);
  });

  describe('Fiber Trial Workflow', () => {
    it('should create fiber trial order successfully', async () => {
      const result = await createTrialOrder(FIBER_TRIAL_ORDER);
      
      expect(result.success).toBe(true);
      expect(result.data.serviceType).toBe('Fiber');
      expect(result.data.isTrial).toBe(true);
      
      fiberOrderId = result.data.id;
      console.log(`✅ Fiber trial order created: ${fiberOrderId}`);
    });

    it('should start in trial_order_created state', async () => {
      const workflow = await getWorkflowState(fiberOrderId);
      
      expect(workflow.success).toBe(true);
      expect(workflow.data.currentState).toBe('trial_order_created');
      expect(workflow.data.nextStates).toContain('trial_fno_provisioning');
      expect(workflow.data.serviceType).toBe('Fiber');
      
      console.log('✅ Fiber trial starts in correct state');
    });

    it('should transition to trial_fno_provisioning', async () => {
      const result = await transitionWorkflow(fiberOrderId, 'trial_fno_provisioning');
      
      expect(result.success).toBe(true);
      expect(result.data.toState).toBe('trial_fno_provisioning');
      
      const workflow = await getWorkflowState(fiberOrderId);
      expect(workflow.data.currentState).toBe('trial_fno_provisioning');
      
      console.log('✅ Fiber trial transitioned to FNO provisioning');
    });

    it('should transition to trial_installation_pending', async () => {
      const result = await transitionWorkflow(fiberOrderId, 'trial_installation_pending');
      
      expect(result.success).toBe(true);
      expect(result.data.toState).toBe('trial_installation_pending');
      
      console.log('✅ Fiber trial transitioned to installation pending');
    });

    it('should transition to trial_installation_scheduled', async () => {
      const result = await transitionWorkflow(fiberOrderId, 'trial_installation_scheduled');
      
      expect(result.success).toBe(true);
      expect(result.data.toState).toBe('trial_installation_scheduled');
      
      console.log('✅ Fiber trial transitioned to installation scheduled');
    });

    it('should transition to trial_active', async () => {
      const result = await transitionWorkflow(fiberOrderId, 'trial_active');
      
      expect(result.success).toBe(true);
      expect(result.data.toState).toBe('trial_active');
      
      const workflow = await getWorkflowState(fiberOrderId);
      expect(workflow.data.currentState).toBe('trial_active');
      expect(workflow.data.nextStates).toContain('trial_converted');
      
      console.log('✅ Fiber trial is now active');
    });

    it('should have complete workflow history', async () => {
      const history = await getOrderHistory(fiberOrderId);
      
      expect(history.length).toBeGreaterThan(0);
      
      const states = history.map((h: any) => h.to_state);
      expect(states).toContain('trial_order_created');
      expect(states).toContain('trial_fno_provisioning');
      expect(states).toContain('trial_installation_pending');
      expect(states).toContain('trial_installation_scheduled');
      expect(states).toContain('trial_active');
      
      console.log('✅ Fiber trial has complete workflow history');
    });
  });

  describe('Wireless Trial Workflow', () => {
    it('should create wireless trial order successfully', async () => {
      const result = await createTrialOrder(WIRELESS_TRIAL_ORDER);
      
      expect(result.success).toBe(true);
      expect(result.data.serviceType).toBe('Wireless');
      expect(result.data.isTrial).toBe(true);
      
      wirelessOrderId = result.data.id;
      console.log(`✅ Wireless trial order created: ${wirelessOrderId}`);
    });

    it('should start in trial_order_created state', async () => {
      const workflow = await getWorkflowState(wirelessOrderId);
      
      expect(workflow.success).toBe(true);
      expect(workflow.data.currentState).toBe('trial_order_created');
      expect(workflow.data.nextStates).toContain('trial_device_shipping');
      expect(workflow.data.serviceType).toBe('Wireless');
      
      console.log('✅ Wireless trial starts in correct state');
    });

    it('should transition to trial_device_shipping', async () => {
      const result = await transitionWorkflow(wirelessOrderId, 'trial_device_shipping');
      
      expect(result.success).toBe(true);
      expect(result.data.toState).toBe('trial_device_shipping');
      
      const workflow = await getWorkflowState(wirelessOrderId);
      expect(workflow.data.currentState).toBe('trial_device_shipping');
      
      console.log('✅ Wireless trial transitioned to device shipping');
    });

    it('should transition to trial_device_delivered', async () => {
      const result = await transitionWorkflow(wirelessOrderId, 'trial_device_delivered');
      
      expect(result.success).toBe(true);
      expect(result.data.toState).toBe('trial_device_delivered');
      
      console.log('✅ Wireless trial transitioned to device delivered');
    });

    it('should transition to trial_self_install', async () => {
      const result = await transitionWorkflow(wirelessOrderId, 'trial_self_install');
      
      expect(result.success).toBe(true);
      expect(result.data.toState).toBe('trial_self_install');
      
      console.log('✅ Wireless trial transitioned to self install');
    });

    it('should transition to trial_active', async () => {
      const result = await transitionWorkflow(wirelessOrderId, 'trial_active');
      
      expect(result.success).toBe(true);
      expect(result.data.toState).toBe('trial_active');
      
      const workflow = await getWorkflowState(wirelessOrderId);
      expect(workflow.data.currentState).toBe('trial_active');
      expect(workflow.data.nextStates).toContain('trial_converted');
      
      console.log('✅ Wireless trial is now active');
    });

    it('should transition to trial_engaged', async () => {
      const result = await transitionWorkflow(wirelessOrderId, 'trial_engaged');
      
      expect(result.success).toBe(true);
      expect(result.data.toState).toBe('trial_engaged');
      
      console.log('✅ Wireless trial transitioned to engaged');
    });

    it('should transition to trial_converted', async () => {
      const result = await transitionWorkflow(wirelessOrderId, 'trial_converted');
      
      expect(result.success).toBe(true);
      expect(result.data.toState).toBe('trial_converted');
      
      const workflow = await getWorkflowState(wirelessOrderId);
      expect(workflow.data.currentState).toBe('trial_converted');
      
      console.log('✅ Wireless trial converted successfully');
    });

    it('should have complete wireless workflow history', async () => {
      const history = await getOrderHistory(wirelessOrderId);
      
      expect(history.length).toBeGreaterThan(0);
      
      const states = history.map((h: any) => h.to_state);
      expect(states).toContain('trial_order_created');
      expect(states).toContain('trial_device_shipping');
      expect(states).toContain('trial_device_delivered');
      expect(states).toContain('trial_self_install');
      expect(states).toContain('trial_active');
      expect(states).toContain('trial_engaged');
      expect(states).toContain('trial_converted');
      
      console.log('✅ Wireless trial has complete workflow history');
    });
  });

  describe('Email Notifications', () => {
    it('should send email for trial_order_created', async () => {
      // This test would verify email was sent
      // In a real test, you'd check email logs or mock the email service
      console.log('✅ Email notification test placeholder');
    });

    it('should send email for trial_device_shipping', async () => {
      console.log('✅ Email notification test placeholder');
    });

    it('should send email for trial_device_delivered', async () => {
      console.log('✅ Email notification test placeholder');
    });

    it('should send email for trial_self_install', async () => {
      console.log('✅ Email notification test placeholder');
    });

    it('should send email for trial_active', async () => {
      console.log('✅ Email notification test placeholder');
    });
  });

  describe('Microservice Integration', () => {
    it('should sync state with microservice', async () => {
      const workflow = await getWorkflowState(wirelessOrderId);
      
      // Verify microservice is returning the same state
      const microserviceResponse = await fetch(`${MICROSERVICE_URL}/api/trials/${workflow.data.trialId}/workflow`);
      const microserviceData = await microserviceResponse.json();
      
      expect(microserviceData.success).toBe(true);
      expect(microserviceData.data.currentState).toBe(workflow.data.currentState);
      
      console.log('✅ Microservice state sync working');
    });
  });

  afterAll(async () => {
    console.log('🎉 All trial workflow tests completed!');
    console.log(`Fiber Order ID: ${fiberOrderId}`);
    console.log(`Wireless Order ID: ${wirelessOrderId}`);
  });
});

// Export for manual testing
export {
  createTrialOrder,
  transitionWorkflow,
  getWorkflowState,
  getOrderHistory
};