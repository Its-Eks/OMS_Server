import { Pool } from 'pg';
import axios from 'axios';
import { WorkflowEngineService } from './workflow-engine.service.ts';
import { ConfigurableWorkflowService } from './configurable-workflow.service.ts';
import { WorkflowABTestingService } from './workflow-ab-testing.service.ts';
import { FNOCommunicationService } from './fno-communication.service.ts';
import { PolicyService } from './policy.service.ts';
import type { Order, OrderStatus } from '../models/order.model.ts';
// import { TrialManagementService } from './TrialManagementService.ts';
import dotenv from 'dotenv';
dotenv.config();

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

  // Ensure an FNO row exists and return its id (by code or name)
  async ensureFno(nameOrCode?: string): Promise<string> {
    const client = await this.db.connect();
    try {
      const token = (nameOrCode || 'default-fno').toString();
      const code = token.trim().toLowerCase().replace(/\s+/g, '_').slice(0, 20);
      // try by code or name
      const found = await client.query(
        `SELECT id FROM fnos WHERE code = $1 OR LOWER(name) = LOWER($2) LIMIT 1`,
        [code, token]
      );
      if (found.rows[0]?.id) return found.rows[0].id as string;

      // insert minimal FNO
      const inserted = await client.query(
        `INSERT INTO fnos (name, code, integration_type, is_active) VALUES ($1, $2, 'manual', true) RETURNING id`,
        [token, code]
      );
      return inserted.rows[0].id as string;
    } finally {
      client.release();
    }
  }

  private isTrialService(serviceDetails: any): boolean {
    const type = (serviceDetails?.serviceType || serviceDetails?.service_type || '').toString().toLowerCase();
    return type === 'trial';
  }

  private isUuidLike(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  async createOrder(orderData: any, createdBy: string): Promise<Order> {
    // Validate order data
    await this.validateOrderData(orderData);

    // Enforce single active order per customer
    const existing = await this.db.query(
      `SELECT id FROM orders 
         WHERE customer_id = $1 
           AND status NOT IN ('completed','cancelled') 
         ORDER BY created_at DESC LIMIT 1`,
      [orderData.customerId]
    );
    if (existing.rows[0]) {
      throw new Error('Customer already has an active order');
    }

    // Generate order number
    const orderNumber = await this.generateOrderNumber();

    // Create order
    const result = await this.db.query(
      `INSERT INTO orders (
        customer_id, order_number, order_type, status, priority,
        installation_address, service_details, created_by, assigned_to, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      RETURNING *`,
      [
        orderData.customerId,
        orderNumber,
        orderData.orderType,
        'created',
        orderData.priority || 'medium',
        JSON.stringify(orderData.serviceAddress),
        JSON.stringify(orderData.serviceDetails),
        createdBy,
        createdBy
      ]
    );

    let order = result.rows[0];

    // Check if customer is marked as trial and auto-set order as trial
    const customerResult = await this.db.query(
      'SELECT is_trial FROM customers WHERE id = $1', 
      [orderData.customerId]
    );
    const customerIsTrial = customerResult.rows[0]?.is_trial;

    if (customerIsTrial) {
      console.log(`[orders] Customer ${orderData.customerId} is marked as trial - marking order as trial`);
      
      // Auto-set order as trial type (but don't create trial record yet)
      const updatedServiceDetails = {
        ...orderData.serviceDetails,
        serviceType: 'Trial'
      };
      
      // Update the order with trial service type
      await this.db.query(
        `UPDATE orders 
         SET service_details = $1, updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(updatedServiceDetails), order.id]
      );
      
      console.log(`[orders] Updated order ${order.id} with trial service type - trial record will be created after FNO provisioning`);
      
      // Refresh the order object to get updated service_details
      order = await this.getOrder(order.id);
      
      // NOTE: Trial record creation moved to FNO provisioning step
      // This prevents premature email sending before installation
    }

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

    // Do NOT auto-validate on create; remain in 'created' until explicit validation

    // Initiate onboarding immediately for this customer and order
    try {
      await this.ensureOnboardingForOrder(order.id, orderData.customerId, createdBy);
    } catch {}

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
         installation_address AS "serviceAddress",
         service_details AS "serviceDetails",
         fno_id AS "fnoId",
         fno_reference AS "fnoReference",
         created_by AS "createdBy",
         assigned_to AS "assignedTo",
         estimated_completion AS "estimatedCompletion",
         is_paid AS "isPaid",
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
      `SELECT 
         id,
         order_number AS "orderNumber",
         customer_id AS "customerId",
         order_type AS "orderType",
         status,
         priority,
         installation_address AS "serviceAddress",
         service_details AS "serviceDetails",
         fno_id AS "fnoId",
         fno_reference AS "fnoReference",
         created_by AS "createdBy",
         assigned_to AS "assignedTo",
         estimated_completion AS "estimatedCompletion",
         is_paid AS "isPaid",
         actual_completion AS "actualCompletion",
         created_at AS "createdAt",
         updated_at AS "updatedAt",
         estimated_completion_date AS "estimatedCompletionDate",
         actual_completion_date AS "actualCompletionDate"
       FROM orders 
       WHERE customer_id = $1 
       ORDER BY created_at DESC`,
      [customerId]
    );
    return result.rows;
  }

  async updateOrder(orderId: string, updates: any): Promise<Order> {
    // Map camelCase keys to snake_case DB columns where needed
    const mappedEntries = Object.entries(updates).map(([key, value]) => {
      switch (key) {
        case 'fnoId':
          return ['fno_id', value] as const;
        case 'serviceDetails':
          return ['service_details', value] as const;
        case 'serviceAddress':
          return ['installation_address', value] as const;
        default:
          return [key, value] as const;
      }
    });

    const setClause = mappedEntries
      .map(([key], index) => `${key} = $${index + 2}`)
      .join(', ');

    const result = await this.db.query(
      `UPDATE orders SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [orderId, ...mappedEntries.map(([, v]) => v)]
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

    // Business rule: 'enriched' transitions must be triggered by enrichment flow, not direct status update
    if (newStatus === 'enriched') {
      throw new Error('Order must be enriched via the Enrichment tab');
    }

    // PRD: Use configurable workflow for transitions
    const workflowInstance = await this.configurableWorkflow.getWorkflowInstance(orderId);
    if (workflowInstance) {
      // Ensure PRD defaults present for this workflow (handles legacy instances with only 'created')
      const orderType = order.orderType || (order as any).order_type || 'new_install';
      await this.configurableWorkflow.ensurePrdDefaults(workflowInstance.workflowId, orderType);

      // First, attempt to find a valid transition to the requested state from current state
      let [states, validTransitions] = await Promise.all([
        this.configurableWorkflow.getWorkflowStates(workflowInstance.workflowId),
        this.configurableWorkflow.getValidTransitions(workflowInstance.id)
      ]);

      const stateIdToName = new Map(states.map(s => [s.id, s.stateName] as const));
      const nameToState = new Map(states.map(s => [s.stateName, s] as const));

      // Prefer a transition whose destination state's name matches the requested status
      const transitionToRequested = validTransitions.find(t => (stateIdToName.get(t.toStateId) || '').toLowerCase() === newStatus.toLowerCase());
      let targetStateId = transitionToRequested?.toStateId || nameToState.get(newStatus)?.id;

      if (!targetStateId) {
        const available = states.map(s => s.stateName).join(', ');
        throw new Error(`State ${newStatus} not found in workflow. Available: ${available}`);
      }

      // If no valid transition exists from current state to target, attempt to seed it on the fly
      const hasDirect = validTransitions.some(t => t.toStateId === targetStateId);
      if (!hasDirect) {
        // Upsert transition from current state to requested target
        try {
          const currentStateId = workflowInstance.currentStateId;
          await this.configurableWorkflow.upsertTransition(workflowInstance.workflowId, currentStateId, targetStateId, `Transition to ${newStatus}`, false, { requires_validation: true });
          // refresh transitions
          validTransitions = await this.configurableWorkflow.getValidTransitions(workflowInstance.id);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[orders] failed to upsert missing transition:', (e as any)?.message || e);
        }
      }

    const executedBy = this.isUuidLike(changedBy) ? (changedBy as string) : null;
    await this.configurableWorkflow.executeTransition(
        workflowInstance.id,
        targetStateId,
      executedBy || null as any,
        changeReason || `Transition to ${newStatus}`,
        { fnoId: order.fnoId, validationPassed: true }
      );

      // Update order status to match workflow
      await this.db.query(
        'UPDATE orders SET status = $1::text, current_state = $1::text, updated_at = NOW() WHERE id = $2::uuid',
        [newStatus, orderId]
      );

      // After workflow execution, sync order current_state to authoritative workflow state name
      try {
        const authoritativeState = await this.configurableWorkflow.getCurrentStateName(orderId);
        if (authoritativeState && typeof authoritativeState === 'string') {
          await this.db.query(
            'UPDATE orders SET current_state = $1::text, status = $1::text, updated_at = NOW() WHERE id = $2::uuid',
            [authoritativeState, orderId]
          );
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[orders] Failed to sync order current_state from workflow:', (e as any)?.message || e);
      }

      console.log(`[orders] Executed workflow transition for order ${orderId} to ${newStatus}`);
    } else {
      // Fallback to legacy workflow engine
    const updatedOrder = await this.workflowEngine.transitionOrder(order, newStatus);

    // Update order in database
    await this.db.query(
      'UPDATE orders SET status = $1::text, current_state = $1::text, updated_at = NOW() WHERE id = $2::uuid',
      [newStatus, orderId]
    );

      console.log(`[orders] Used legacy workflow for order ${orderId} to ${newStatus}`);
    }

    // Persist state change history (legacy support)
    try {
      const actorId = this.isUuidLike(changedBy) ? (changedBy as string) : null;
      await this.db.query(
        'INSERT INTO order_state_history (order_id, from_state, to_state, changed_by, change_reason, created_at) VALUES ($1::uuid, $2::text, $3::text, $4::uuid, $5::text, NOW())',
        [orderId, order.status, newStatus, actorId, changeReason || null]
      );
    } catch (e) {
      // Do not block the main transition on history failure, but log it
      // eslint-disable-next-line no-console
      console.warn('[orders] Failed to write order_state_history:', (e as any)?.message || e);
    }

    const after = await this.getOrder(orderId);
    if (!after) {
      throw new Error('Order not found after transition');
    }

    // Handle status-specific actions with updated order
    await this.handleStatusTransition(after);
    // If order reached validated, ensure onboarding exists (customer + order anchored)
    if ((after as any).status === 'validated') {
      await this.ensureOnboardingForOrder(after.id, (after as any).customerId, changedBy || 'system');
    }
    // Sync onboarding progression with order status per PRD mapping and order type
    await this.syncOnboardingForOrder(after);
    return after;
  }

  // Internal-only transition used by enrichment flow to move validated -> enriched
  async transitionToEnrichedInternal(orderId: string, changedBy?: string, changeReason?: string): Promise<Order> {
    const order = await this.getOrder(orderId);
    if (!order) {
      throw new Error('Order not found');
    }

    const targetStatus: OrderStatus = 'enriched' as OrderStatus;

    const workflowInstance = await this.configurableWorkflow.getWorkflowInstance(orderId);
    if (workflowInstance) {
      const orderType = order.orderType || (order as any).order_type || 'new_install';
      await this.configurableWorkflow.ensurePrdDefaults(workflowInstance.workflowId, orderType);

      const [states, validTransitions] = await Promise.all([
        this.configurableWorkflow.getWorkflowStates(workflowInstance.workflowId),
        this.configurableWorkflow.getValidTransitions(workflowInstance.id)
      ]);

      const stateIdToName = new Map(states.map(s => [s.id, s.stateName] as const));
      const nameToState = new Map(states.map(s => [s.stateName, s] as const));

      const transitionToRequested = validTransitions.find(t => (stateIdToName.get(t.toStateId) || '').toLowerCase() === targetStatus.toLowerCase());
      const targetStateId = transitionToRequested?.toStateId || nameToState.get(targetStatus)?.id;

      if (!targetStateId) {
        const available = states.map(s => s.stateName).join(', ');
        throw new Error(`State ${targetStatus} not found in workflow. Available: ${available}`);
      }

      await this.configurableWorkflow.executeTransition(
        workflowInstance.id,
        targetStateId,
        changedBy || 'system',
        changeReason || `Transition to ${targetStatus} (enrichment)`,
        { enrichment: true }
      );

      await this.db.query(
        'UPDATE orders SET status = $1::text, current_state = $1::text, updated_at = NOW() WHERE id = $2::uuid',
        [targetStatus, orderId]
      );
    } else {
      // Legacy fallback
      await this.db.query(
        'UPDATE orders SET status = $1::text, current_state = $1::text, updated_at = NOW() WHERE id = $2::uuid',
        [targetStatus, orderId]
      );
    }

    try {
      await this.db.query(
        'INSERT INTO order_state_history (order_id, from_state, to_state, changed_by, change_reason, created_at) VALUES ($1::uuid, $2::text, $3::text, $4::uuid, $5::text, NOW())',
        [orderId, order.status, targetStatus, changedBy || null, changeReason || 'Order enriched']
      );
    } catch {}

    const after = await this.getOrder(orderId);
    if (!after) throw new Error('Order not found after enrichment transition');
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
      'UPDATE orders SET status = $1::text, current_state = $1::text, updated_at = NOW() WHERE id = $2::uuid',
      ['cancelled', orderId]
    );

    // Record cancellation in history
    try {
      await this.db.query(
        'INSERT INTO order_state_history (order_id, from_state, to_state, changed_by, change_reason, created_at) VALUES ($1::uuid, $2::text, $3::text, $4::uuid, $5::text, NOW())',
        [orderId, order.status, 'cancelled', null, reason || 'Order cancelled']
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
    // Also cancel related onboarding per PRD mapping
    try {
      await this.syncOnboardingForOrder({ ...(updated as any), status: 'cancelled' } as any);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[orders] failed to sync onboarding on cancel:', (e as any)?.message || e);
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

    // Determine or create FNO based on service address (fallback default)
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
      case 'fno_accepted':
        // Notify trial customers that installation scheduling is next
        try {
          const orderIsTrial = this.isTrialService(order.serviceDetails);
          if (orderIsTrial) {
            const client = await this.db.connect();
            try {
              const info = await client.query(
                `SELECT c.email, c.first_name, c.last_name, o.order_number
                   FROM orders o
                   JOIN customers c ON c.id = o.customer_id
                  WHERE o.id = $1`,
                [order.id]
              );
              const row = info.rows[0];
              if (row?.email) {
                const { NotificationService } = await import('../services/notification.service.ts');
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const notif = new NotificationService((global as any).__mongoClient || null);
                const name = [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Customer';
                const subject = 'Trial order accepted by FNO – Installation scheduling next';
                const html = `<p>Hi ${name},</p>
                              <p>Your trial order <strong>${row.order_number}</strong> has been accepted by the network operator.</p>
                              <p>We will contact you shortly to schedule your installation. No payment is required yet.</p>
                              <p>Thank you for trying our service.</p>`;
                const text = `Hi ${name},\nYour trial order ${row.order_number} has been accepted by the network operator.\nWe will contact you shortly to schedule your installation. No payment is required yet.`;
                await notif.send({ to: row.email, subject, html, text });
                console.log(`[orders] Sent installation scheduling notice for trial order ${order.id} to ${row.email}`);
              }
            } finally {
              client.release();
            }
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[orders] fno_accepted trial notification failed:', (e as any)?.message || e);
        }
        break;
      case 'installed':
        await this.activateService(order);
        break;
      case 'completed':
        await this.finalizeOrder(order);
        break;
    }
  }

  // Update related onboarding current_step based on order status, per PRD mapping
  private async syncOnboardingForOrder(order: Order): Promise<void> {
    const client = await this.db.connect();
    try {
      // Re-read authoritative order status from DB to avoid stale state
      const ord = await client.query('SELECT status FROM orders WHERE id = $1', [order.id]);
      const authoritativeStatus = (ord.rows[0]?.status || (order as any).status || (order as any).current_state || '').toString();

      const res = await client.query('SELECT id, current_step, onboarding_type FROM customer_onboarding WHERE order_id = $1 ORDER BY started_at DESC LIMIT 1', [order.id]);
      if (res.rows.length === 0) return; // no onboarding tied to this order

      const onboardingId = res.rows[0].id as string;
      const onboardingType = (res.rows[0].onboarding_type || '').toString();
      const status = authoritativeStatus;
      const orderIsTrial = this.isTrialService(order.serviceDetails);
      let step: string | null = null;
      if (orderIsTrial || onboardingType === 'trial') {
        // For trials, avoid moving through standard installation steps.
        // Only reflect terminal/activation states to keep onboarding parallel and minimal.
        switch (String(status)) {
          case 'activated':
            step = 'service_activated';
            break;
          case 'completed':
            step = 'completed';
            break;
          case 'cancelled':
            step = 'cancelled';
            break;
          default:
            step = null; // no-op for intermediate statuses on trials
        }
      } else {
        // Standard onboarding mapping
        switch (String(status)) {
          case 'validated':
            step = 'initiated';
            break;
          case 'enriched':
            step = 'requirements_confirmed';
            break;
          case 'fno_submitted':
            step = 'provisioning_requested';
            break;
          case 'fno_accepted':
            step = 'provisioning_in_flight';
            break;
          case 'installation_scheduled':
            step = 'installation_scheduled';
            break;
          case 'installed':
            step = 'installation_complete';
            break;
          case 'activated':
            step = 'service_activated';
            break;
          case 'completed':
            step = 'completed';
            break;
          case 'cancelled':
            step = 'cancelled';
            break;
          default:
            step = null;
        }
      }
      if (step === null) return;

      // If already at the correct step, no-op
      const currentStep = (res.rows[0].current_step || '').toString();
      if (currentStep === step) return;

      const setCompleted = step === 'completed' || step === 'cancelled';
      await client.query(
        `UPDATE customer_onboarding 
           SET current_step = $1::text,
               completion_percentage = CASE 
                 WHEN $1::text = 'initiated' THEN 10
                 WHEN $1::text = 'requirements_confirmed' THEN 20
                 WHEN $1::text = 'provisioning_requested' THEN 30
                 WHEN $1::text = 'provisioning_in_flight' THEN 50
                 WHEN $1::text = 'installation_scheduled' THEN 60
                 WHEN $1::text = 'installation_complete' THEN 80
                 WHEN $1::text = 'service_activated' THEN 90
                 WHEN $1::text IN ('completed','cancelled') THEN 100
                 ELSE LEAST(100, COALESCE(completion_percentage, 0)) END,
               updated_at = NOW(),
               completed_at = CASE WHEN $2::boolean THEN NOW() ELSE completed_at END
         WHERE id = $3::uuid`,
        [step, setCompleted, onboardingId]
      );

      // Send welcome email when onboarding becomes 'initiated' (triggered by order validated)
      if (step === 'initiated') {
        try {
          // Fetch customer email and order number
          const info = await client.query(
            `SELECT c.email, c.first_name, c.last_name, o.order_number
               FROM customer_onboarding co
               JOIN customers c ON c.id = co.customer_id
               JOIN orders o ON o.id = co.order_id
              WHERE co.id = $1`,
            [onboardingId]
          );
          const row = info.rows[0];
          if (row?.email) {
            const { NotificationService } = await import('../services/notification.service.ts');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const notif = new NotificationService((global as any).__mongoClient || null);
            const name = [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Customer';
            const subject = 'Welcome to Onboarding';
            const html = `<p>Hi ${name},</p><p>Your order ${row.order_number} has been validated. We have initiated your onboarding.</p>`;
            const text = `Hi ${name},\nYour order ${row.order_number} has been validated. We have initiated your onboarding.`;
            await notif.send({ to: row.email, subject, html, text });
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[onboarding] welcome email (on validated) failed:', (e as any)?.message || e);
        }
      }
    } finally {
      client.release();
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
    // TODO: Implement proper FNO determination based on address
    // For now, ensure a default FNO exists and return its id
    return await this.ensureFno('default-fno');
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

  // Ensure there is exactly one active onboarding for the customer; create if missing and link to the order
  private async ensureOnboardingForOrder(orderId: string, customerId: string, initiatedBy: string): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      // Check existing active onboarding
      const existing = await client.query(
        `SELECT id FROM customer_onboarding 
           WHERE customer_id = $1 
             AND (completed_at IS NULL)
             AND (current_step IS NULL OR current_step <> 'completed')
         ORDER BY started_at DESC LIMIT 1`,
        [customerId]
      );
      if (existing.rows.length > 0) {
        // If exists but order_id is null, attach this order
        const obId = existing.rows[0].id as string;
        await client.query(`UPDATE customer_onboarding SET order_id = COALESCE(order_id, $1), updated_at = NOW() WHERE id = $2`, [orderId, obId]);
        await client.query('COMMIT');
        return;
      }

      // Snapshot minimal customer info
      const customer = await client.query(`SELECT email, first_name, last_name FROM customers WHERE id = $1 LIMIT 1`, [customerId]);
      const email = customer.rows[0]?.email || null;
      const first = customer.rows[0]?.first_name || null;
      const last = customer.rows[0]?.last_name || null;

      // Read order details to determine onboarding type
      const orderRow = await client.query('SELECT service_details FROM orders WHERE id = $1', [orderId]);
      const serviceDetails = orderRow.rows[0]?.service_details || {};
      const onboardingType = this.isTrialService(serviceDetails) ? 'trial' : 'standard';

      // Create onboarding anchored to this order
      await client.query(
        `INSERT INTO customer_onboarding (customer_id, order_id, onboarding_type, current_step, completion_percentage, assigned_to, customer_email, customer_first_name, customer_last_name, started_at)
         VALUES ($1, $2, $3, 'created', 5, NULL, $4, $5, $6, NOW())`,
        [customerId, orderId, onboardingType, email, first, last]
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      // eslint-disable-next-line no-console
      console.warn('[orders] ensureOnboardingForOrder failed:', (e as any)?.message || e);
    } finally {
      client.release();
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

  // Convert trial customer to regular customer
  private async convertTrialToRegularCustomer(customerId: string): Promise<void> {
    try {
      // Update customer trial flags
      await this.db.query(
        `UPDATE customers
         SET is_trial = FALSE,
             trial_start_date = NULL,
             trial_end_date = NULL,
             updated_at = NOW()
       WHERE id = $1`,
        [customerId]
      );

      console.log(`Customer ${customerId} converted from trial to regular`);
    } catch (error) {
      console.error('Failed to convert trial customer to regular:', error);
      throw error;
    }
  }

  // Remove trial record from microservice
  private async removeTrialRecord(orderId: string): Promise<void> {
    try {
      const trialServiceUrl = process.env.TRIAL_SERVICE_URL;
      
      // First, get the trial ID by order ID
      const trialResponse = await axios.get(
        `${trialServiceUrl}/api/internal/trials/by-order/${orderId}`,
        {
          timeout: 10000,
          headers: { 'Content-Type': 'application/json' }
        }
      );

      if (trialResponse.data?.data?.id) {
        const trialId = trialResponse.data.data.id;
        
        // Delete the trial record
        await axios.delete(
          `${trialServiceUrl}/api/internal/trials/${trialId}`,
          {
            timeout: 10000,
            headers: { 'Content-Type': 'application/json' }
          }
        );

        console.log(`Trial record ${trialId} removed for order: ${orderId}`);
      }
    } catch (error) {
      console.error('Failed to remove trial record:', error);
      // Don't throw - trial removal failure shouldn't break order processing
    }
  }

  // Create trial customer when order service type is 'Trial'
  private async createTrialCustomer(order: any): Promise<void> {
    try {
      console.log(`[orders] Creating trial customer for order ${order.id}`);
      
      // Get customer details for trial creation (including name)
      const customerResult = await this.db.query(
        'SELECT email, phone, first_name, last_name FROM customers WHERE id = $1',
        [order.customer_id]
      );

      if (customerResult.rows.length === 0) {
        console.error(`[orders] Customer not found for trial creation: ${order.customer_id}`);
        return;
      }

      const customer = customerResult.rows[0];
      const customerName = `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'Customer';
      const trialServiceUrl = process.env.TRIAL_SERVICE_URL;

      console.log(`[orders] Calling trial service at ${trialServiceUrl}/api/internal/trials`);

      const response = await axios.post(
        `${trialServiceUrl}/api/internal/trials`,
        {
          customerId: order.customer_id,
          orderId: order.id,
          email: customer.email,
          phone: customer.phone || '',
          metadata: {
            name: customerName,
            firstName: customer.first_name,
            lastName: customer.last_name
          }
        },
        {
          timeout: 10000,
          headers: { 'Content-Type': 'application/json' }
        }
      );

      console.log(`[orders] Trial customer created successfully: ${response.data?.data?.id || 'unknown'} for order: ${order.id}`);
    } catch (error) {
      console.error('[orders] Failed to create trial customer via microservice:', error);
      console.error('[orders] Error details:', {
        message: (error as any)?.message,
        response: (error as any)?.response?.data,
        status: (error as any)?.response?.status
      });
      
      // Fallback: Create trial record directly in OMS database
      try {
        console.log('[orders] Attempting fallback: creating trial record in OMS database');
        
        // Get customer details again for fallback
        const fallbackCustomerResult = await this.db.query(
          'SELECT email, phone, first_name, last_name FROM customers WHERE id = $1',
          [order.customer_id]
        );
        
        if (fallbackCustomerResult.rows.length > 0) {
          const fallbackCustomer = fallbackCustomerResult.rows[0];
          const customerName = `${fallbackCustomer.first_name || ''} ${fallbackCustomer.last_name || ''}`.trim() || 'Customer';
          
          await this.db.query(
            `INSERT INTO trial_customers (
              id, customer_id, order_id, email, phone, status, 
              trial_start_date, trial_end_date, engagement_level, 
              engagement_score, total_data_usage_gb, metadata, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())`,
            [
              require('crypto').randomUUID(),
              order.customer_id,
              order.id,
              fallbackCustomer.email,
              fallbackCustomer.phone || '',
              'ACTIVE',
              new Date(),
              new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
              'WARM',
              50,
              0,
              JSON.stringify({
                name: customerName,
                firstName: fallbackCustomer.first_name,
                lastName: fallbackCustomer.last_name
              })
            ]
          );
          console.log('[orders] Fallback trial record created successfully in OMS database');
        }
      } catch (fallbackError) {
        console.error('[orders] Fallback trial creation also failed:', fallbackError);
      }
    }
  }
}
