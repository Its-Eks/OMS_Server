import { Pool } from 'pg';
import { WorkflowEngineService } from './workflow-engine.service';
import { FNOCommunicationService } from './fno-communication.service';
import { PolicyService } from './policy.service';
import type { Order, OrderStatus } from '../models/order.model';

export class OrdersService {
  private db: Pool;
  private workflowEngine: WorkflowEngineService;
  private fnoCommunication: FNOCommunicationService;
  private policyService: PolicyService;

  constructor(db: Pool, fnoCommunication: FNOCommunicationService, policyService: PolicyService) {
    this.db = db;
    this.workflowEngine = new WorkflowEngineService();
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
        'draft',
        orderData.priority || 'medium',
        JSON.stringify(orderData.serviceAddress),
        JSON.stringify(orderData.serviceDetails),
        createdBy
      ]
    );

    const order = result.rows[0];

    // Apply business policies
    await this.applyOrderPolicies(order);

    // Transition to pending validation
    await this.transitionOrder(order.id, 'pending_validation');

    return order;
  }

  async getOrder(orderId: string): Promise<Order | null> {
    const result = await this.db.query('SELECT * FROM orders WHERE id = $1', [orderId]);
    return result.rows[0] || null;
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

  async transitionOrder(orderId: string, newStatus: OrderStatus): Promise<Order> {
    const order = await this.getOrder(orderId);
    if (!order) {
      throw new Error('Order not found');
    }

    const updatedOrder = await this.workflowEngine.transitionOrder(order, newStatus);

    // Update order in database
    await this.db.query(
      'UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2',
      [newStatus, orderId]
    );

    // Handle status-specific actions
    await this.handleStatusTransition(updatedOrder);

    return updatedOrder;
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

    return await this.getOrder(orderId);
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

    return await this.getOrder(orderId);
  }

  private async validateOrderData(orderData: any): Promise<void> {
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
      case 'submitted_to_fno':
        await this.submitToFNO(order);
        break;
      case 'installation_completed':
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
}
