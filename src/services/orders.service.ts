import { Pool } from 'pg';
import { WorkflowEngineService } from './workflow-engine.service.ts';
import { ConfigurableWorkflowService } from './configurable-workflow.service.ts';
import { WorkflowABTestingService } from './workflow-ab-testing.service.ts';
import { FNOCommunicationService } from './fno-communication.service.ts';
import { PolicyService } from './policy.service.ts';
import type { Order, OrderStatus } from '../models/order.model.ts';

export class OrdersService {
  private db: Pool;
  private workflowEngine: WorkflowEngineService;
  private configurableWorkflow: ConfigurableWorkflowService;
  private abTestingService: WorkflowABTestingService;
  private fnoCommunication: FNOCommunicationService;
  private policyService: PolicyService;

  constructor(db: Pool, fnoCommunication: FNOCommunicationService, policyService: PolicyService) {
    this.db = db;
    this.workflowEngine = new WorkflowEngineService();
    this.configurableWorkflow = new ConfigurableWorkflowService(db);
    this.abTestingService = new WorkflowABTestingService(db, this.configurableWorkflow);
    this.fnoCommunication = fnoCommunication;
    this.policyService = policyService;
  }

  async createOrder(orderData: any, createdBy: string): Promise<Order> {
    // Validate order data
    await this.validateOrderData(orderData);

    // Generate order number
    const orderNumber = await this.generateOrderNumber();

    // Create order
    const result = await this.db.query(
      `INSERT INTO orders (
        customer_id, order_number, order_type, status, priority, 
        service_address, service_details, created_by, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()) 
      RETURNING *`,
      [
        orderData.customerId,
        orderNumber,
        orderData.orderType,
        'created',
        orderData.priority || 'medium',
        JSON.stringify(orderData.serviceAddress),
        JSON.stringify(orderData.serviceDetails),
        createdBy
      ]
    );

    const order = result.rows[0];

    // Apply business policies
    await this.applyOrderPolicies(order);

    // PRD: A/B Testing - Assign order to workflow (control or variant)
    const orderType = orderData.orderType || 'new_install';
    const assignedWorkflowId = await this.abTestingService.assignOrderToWorkflow(order.id, orderType);
    
    // Create workflow instance with assigned workflow
    const workflowInstance = await this.configurableWorkflow.createWorkflowInstance(order.id, orderType, createdBy);
    
    console.log(`[orders] Created workflow instance ${workflowInstance.id} for order ${order.id} (A/B test assignment: ${assignedWorkflowId})`);

    // Record initial state in history (legacy support)
    try {
      await this.db.query(
        'INSERT INTO order_state_history (order_id, from_state, to_state, changed_by, change_reason, created_at) VALUES ($1, $2, $3, $4, $5, NOW())',
        [order.id, null, 'created', createdBy, 'Order created']
      );
    } catch (e) {
      console.warn('[orders] Failed to write initial order_state_history:', (e as any)?.message || e);
    }

    // PRD: Execute initial workflow transitions automatically
    await this.executeWorkflowTransitions(order.id, createdBy);

    return order;
  }

  async getOrder(orderId: string): Promise<Order | null> {
    const result = await this.db.query(
      `SELECT 
         id,
         order_number AS "orderNumber",
         customer_id AS "customerId",
         order_type AS "orderType",
         status,
         priority,
         service_address AS "serviceAddress",
         service_details AS "serviceDetails",
         fno_id AS "fnoId",
         fno_reference AS "fnoReference",
         created_by AS "createdBy",
         assigned_to AS "assignedTo",
         estimated_completion AS "estimatedCompletion",
         actual_completion AS "actualCompletion",
         created_at AS "createdAt",
         updated_at AS "updatedAt",
         estimated_completion_date AS "estimatedCompletionDate",
         actual_completion_date AS "actualCompletionDate"
       FROM orders WHERE id = $1`,
      [orderId]
    );
    return (result.rows[0] as unknown as Order) || null;
  }

  async getOrdersByCustomer(customerId: string): Promise<Order[]> {
    const result = await this.db.query(
      'SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC',
      [customerId]
    );
    return result.rows;
  }

  async updateOrder(orderId: string, updates: any): Promise<Order> {
    const setClause = Object.keys(updates)
      .map((key, index) => `${key} = $${index + 2}`)
      .join(', ');

    const result = await this.db.query(
      `UPDATE orders SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [orderId, ...Object.values(updates)]
    );

    if (result.rows.length === 0) {
      throw new Error('Order not found');
    }

    return result.rows[0];
  }

  async transitionOrder(orderId: string, newStatus: OrderStatus, changedBy?: string, changeReason?: string): Promise<Order> {
    const order = await this.getOrder(orderId);
    if (!order) {
      throw new Error('Order not found');
    }

    // PRD: Use configurable workflow for transitions
    const workflowInstance = await this.configurableWorkflow.getWorkflowInstance(orderId);
    if (workflowInstance) {
      // Get target state ID from workflow
      const states = await this.configurableWorkflow.getWorkflowStates(workflowInstance.workflowId);
      const targetState = states.find(s => s.stateName === newStatus);
      
      if (targetState) {
        // Execute workflow transition
        await this.configurableWorkflow.executeTransition(
          workflowInstance.id,
          targetState.id,
          changedBy || 'system',
          changeReason || `Transition to ${newStatus}`,
          { fnoId: order.fnoId, validationPassed: true }
        );
        
        // Update order status to match workflow
        await this.db.query(
          'UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2',
          [newStatus, orderId]
        );
        
        console.log(`[orders] Executed workflow transition for order ${orderId} to ${newStatus}`);
      } else {
        throw new Error(`State ${newStatus} not found in workflow`);
      }
    } else {
      // Fallback to legacy workflow engine
      const updatedOrder = await this.workflowEngine.transitionOrder(order, newStatus);
      
      // Update order in database
      await this.db.query(
        'UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2',
        [newStatus, orderId]
      );
      
      console.log(`[orders] Used legacy workflow for order ${orderId} to ${newStatus}`);
    }

    // Persist state change history (legacy support)
    try {
      await this.db.query(
        'INSERT INTO order_state_history (order_id, from_state, to_state, changed_by, change_reason, created_at) VALUES ($1, $2, $3, $4, $5, NOW())',
        [orderId, order.status, newStatus, changedBy || null, changeReason || null]
      );
    } catch (e) {
      // Do not block the main transition on history failure, but log it
      // eslint-disable-next-line no-console
      console.warn('[orders] Failed to write order_state_history:', (e as any)?.message || e);
    }

    // Handle status-specific actions
    await this.handleStatusTransition(order);

    const after = await this.getOrder(orderId);
    if (!after) {
      throw new Error('Order not found after transition');
    }
    return after;
  }

  async cancelOrder(orderId: string, reason: string): Promise<Order> {
    const order = await this.getOrder(orderId);
    if (!order) {
      throw new Error('Order not found');
    }

    // Check if order can be cancelled
    const validTransitions = this.workflowEngine.getValidTransitions(order.status);
    if (!validTransitions.includes('cancelled')) {
      throw new Error(`Order cannot be cancelled from ${order.status} status`);
    }

    // Update order
    await this.db.query(
      'UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2',
      ['cancelled', orderId]
    );

    // Record cancellation in history
    try {
      await this.db.query(
        'INSERT INTO order_state_history (order_id, from_state, to_state, changed_by, change_reason, created_at) VALUES ($1, $2, $3, $4, $5, NOW())',
        [orderId, order.status, 'cancelled', 'system', reason || 'Order cancelled']
      );
    } catch (e) {
      console.warn('[orders] Failed to write cancellation order_state_history:', (e as any)?.message || e);
    }

    // Log cancellation
    await this.fnoCommunication.logCommunication({
      orderId,
      fnoId: order.fnoId || 'system',
      messageType: 'order_cancellation',
      direction: 'outbound',
      payload: { reason, cancelledAt: new Date() },
      status: 'sent',
      retryCount: 0
    });

    const updated = await this.getOrder(orderId);
    if (!updated) {
      throw new Error('Order not found after cancellation');
    }
    return updated;
  }

  async enrichOrderWithFNOData(orderId: string): Promise<Order> {
    const order = await this.getOrder(orderId);
    if (!order) {
      throw new Error('Order not found');
    }

    // Determine FNO based on service address
    const fnoId = await this.determineFNO(order.serviceAddress);
    
    // Update order with FNO information
    await this.updateOrder(orderId, { fnoId });

    const enriched = await this.getOrder(orderId);
    if (!enriched) {
      throw new Error('Order not found after enrichment');
    }
    return enriched;
  }

  private async enrichOrder(orderId: string, enrichedBy: string): Promise<void> {
    // PRD: Order Enrichment - enrich with network-specific parameters and FNO-specific details
    const order = await this.getOrder(orderId);
    if (!order) {
      throw new Error('Order not found');
    }

    // Determine FNO based on service address
    const fnoId = await this.determineFNO(order.serviceAddress);
    
    // Enrich with network-specific parameters
    const networkParams = await this.getNetworkParameters(order.serviceAddress, order.serviceDetails);
    
    // Update order with enriched data
    await this.updateOrder(orderId, { 
      fnoId,
      serviceDetails: {
        ...order.serviceDetails,
        ...networkParams
      }
    });

    // Transition to enriched status
    await this.transitionOrder(orderId, 'enriched', enrichedBy, 'Order enriched with network-specific parameters and FNO details');
  }

  private async getNetworkParameters(address: any, serviceDetails: any): Promise<any> {
    // PRD: Network-specific parameters
    // TODO: Get actual network parameters from FNO systems
    return {
      networkType: 'fiber',
      maxBandwidth: '1000Mbps',
      installationComplexity: 'standard',
      estimatedInstallationTime: '4 hours'
    };
  }

  private async validateOrderData(orderData: any): Promise<void> {
    // PRD: Order Validation - data completeness and accuracy
    if (!orderData.customerId) {
      throw new Error('Customer ID is required');
    }
    if (!orderData.serviceAddress || !(orderData.serviceAddress.street || orderData.serviceAddress.street_name)) {
      throw new Error('Service address is required');
    }
    if (!orderData.serviceDetails || !(orderData.serviceDetails.serviceType || orderData.serviceDetails.service_type)) {
      throw new Error('Service type is required');
    }

    // PRD: Address validation
    await this.validateAddress(orderData.serviceAddress);
    
    // PRD: Service availability checks
    await this.checkServiceAvailability(orderData.serviceAddress, orderData.serviceDetails);
    
    // PRD: Credit checks (if applicable)
    await this.performCreditCheck(orderData.customerId);

    // Apply validation policies
    const validationRules = await this.policyService.evaluatePolicy(orderData, 'order_validation');
    await this.policyService.executePolicyRules(validationRules, orderData);
  }

  private async generateOrderNumber(): Promise<string> {
    const prefix = 'ORD';
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 4);
    return `${prefix}-${timestamp}-${random}`.toUpperCase();
  }

  private async applyOrderPolicies(order: Order): Promise<void> {
    const policies = await this.policyService.evaluatePolicy(order, 'business_rule');
    await this.policyService.executePolicyRules(policies, order);
  }

  private async handleStatusTransition(order: Order): Promise<void> {
    switch (order.status) {
      case 'fno_submitted':
        await this.submitToFNO(order);
        break;
      case 'installed':
        await this.activateService(order);
        break;
      case 'completed':
        await this.finalizeOrder(order);
        break;
    }
  }

  private async submitToFNO(order: Order): Promise<void> {
    if (!order.fnoId) {
      throw new Error('FNO not determined for order');
    }

    // Log FNO submission
    await this.fnoCommunication.logCommunication({
      orderId: order.id,
      fnoId: order.fnoId,
      messageType: 'order_submission',
      direction: 'outbound',
      payload: order,
      status: 'sent',
      retryCount: 0
    });
  }

  private async activateService(order: Order): Promise<void> {
    // TODO: Implement service activation logic
    console.log(`Activating service for order ${order.id}`);
  }

  private async finalizeOrder(order: Order): Promise<void> {
    // TODO: Implement order finalization logic
    console.log(`Finalizing order ${order.id}`);
  }

  private async determineFNO(address: any): Promise<string> {
    // TODO: Implement FNO determination logic based on address
    // For now, return a default FNO
    return 'default-fno';
  }

  private async validateAddress(address: any): Promise<void> {
    // PRD: Address validation
    // TODO: Integrate with third-party address validation service
    if (!address.street && !address.street_name) {
      throw new Error('Incomplete address information');
    }
    if (!address.city) {
      throw new Error('Incomplete address information');
    }
    const postal = address.postalCode || address.postal_code;
    if (!postal) {
      throw new Error('Incomplete address information');
    }
    // For now, just log the validation
    console.log(`[orders] Address validated for: ${address.street}, ${address.city}`);
  }

  private async checkServiceAvailability(address: any, serviceDetails: any): Promise<void> {
    // PRD: Service availability checks
    // TODO: Check with FNO systems for service availability at the address
    const serviceType = serviceDetails.serviceType || serviceDetails.service_type || 'internet';
    const street = address.street || address.street_name || 'unknown street';
    console.log(`[orders] Checking service availability for ${serviceType} at ${street}`);
    // For now, assume service is available
  }

  private async performCreditCheck(customerId: string): Promise<void> {
    // PRD: Credit checks (if applicable)
    // TODO: Integrate with credit checking service
    console.log(`[orders] Performing credit check for customer: ${customerId}`);
    // For now, assume credit check passes
  }

  // PRD: Execute automatic workflow transitions
  private async executeWorkflowTransitions(orderId: string, executedBy: string): Promise<void> {
    const workflowInstance = await this.configurableWorkflow.getWorkflowInstance(orderId);
    if (!workflowInstance) {
      console.warn(`[orders] No workflow instance found for order ${orderId}`);
      return;
    }

    // Get valid transitions from current state
    const validTransitions = await this.configurableWorkflow.getValidTransitions(workflowInstance.id);
    
    // Execute automatic transitions
    for (const transition of validTransitions) {
      if (transition.isAutomatic) {
        try {
          await this.configurableWorkflow.executeTransition(
            workflowInstance.id,
            transition.toStateId,
            executedBy,
            `Automatic transition: ${transition.transitionName}`,
            { automatic: true }
          );
          
          // Update order status to match workflow
          const states = await this.configurableWorkflow.getWorkflowStates(workflowInstance.workflowId);
          const newState = states.find(s => s.id === transition.toStateId);
          if (newState) {
            await this.db.query(
              'UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2',
              [newState.stateName, orderId]
            );
          }
          
          console.log(`[orders] Executed automatic transition for order ${orderId}: ${transition.transitionName}`);
        } catch (error) {
          console.error(`[orders] Failed to execute automatic transition for order ${orderId}:`, error);
        }
      }
    }
  }

  // Get workflow execution history for an order
  async getOrderWorkflowHistory(orderId: string): Promise<any[]> {
    const workflowInstance = await this.configurableWorkflow.getWorkflowInstance(orderId);
    if (!workflowInstance) {
      return [];
    }
    
    return await this.configurableWorkflow.getExecutionHistory(workflowInstance.id);
  }

  // Get current workflow state for an order
  async getOrderWorkflowState(orderId: string): Promise<string | null> {
    return await this.configurableWorkflow.getCurrentStateName(orderId);
  }

  // Record workflow metric for A/B testing
  async recordWorkflowMetric(orderId: string, metricName: string, value: number, unit?: string, context?: any): Promise<void> {
    await this.abTestingService.recordMetric(orderId, metricName, value, unit, context);
  }

  // Get A/B test results
  async getABTestResults(testId: string): Promise<any> {
    return await this.abTestingService.getABTestResults(testId);
  }

  // Get all A/B tests
  async getAllABTests(): Promise<any[]> {
    return await this.abTestingService.getAllABTests();
  }

  // Create A/B test
  async createABTest(test: any, createdBy: string): Promise<any> {
    return await this.abTestingService.createABTest(test, createdBy);
  }
}
