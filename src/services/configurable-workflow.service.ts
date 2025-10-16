import type { Pool } from 'pg';
import type { Order, OrderStatus } from '../models/order.model.ts';

export interface WorkflowDefinition {
  id: string;
  name: string;
  orderType: string;
  version: number;
  isActive: boolean;
  description?: string;
  definition: any;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowState {
  id: string;
  workflowId: string;
  stateName: string;
  stateType: 'start' | 'end' | 'task' | 'gateway' | 'validation' | 'enrichment';
  orderIndex: number;
  displayName: string;
  description?: string;
  config: any;
  isRequired: boolean;
  estimatedDurationHours: number;
}

export interface WorkflowTransition {
  id: string;
  workflowId: string;
  fromStateId: string;
  toStateId: string;
  transitionName: string;
  conditions: any;
  actions: any;
  isAutomatic: boolean;
  requiresApproval: boolean;
}

export interface WorkflowInstance {
  id: string;
  orderId: string;
  workflowId: string;
  currentStateId: string;
  status: 'active' | 'completed' | 'cancelled' | 'error';
  startedAt: Date;
  completedAt?: Date;
  lastUpdatedAt: Date;
  context: any;
  errorMessage?: string;
}

export interface WorkflowExecutionHistory {
  id: string;
  instanceId: string;
  fromStateId?: string;
  toStateId: string;
  transitionId?: string;
  executedBy?: string;
  executionReason?: string;
  executionData: any;
  executedAt: Date;
  durationSeconds?: number;
}

export class ConfigurableWorkflowService {
  private db: Pool;

  constructor(db: Pool) {
    this.db = db;
  }

  // Ensure PRD default states/transitions exist for known order types
  async ensurePrdDefaults(workflowId: string, orderType: string): Promise<void> {
    // Check how many states exist
    const statesResult = await this.db.query(
      'SELECT id, state_name FROM workflow_states WHERE workflow_id = $1 ORDER BY order_index ASC',
      [workflowId]
    );
    const existingNames = new Set<string>(statesResult.rows.map((r: any) => r.state_name));

    // Define PRD workflows per order type
    let desiredStates: Array<{ name: string; type: string; index: number; display: string; desc: string }> = [];
    let transitions: Array<{ from: string; to: string; name: string; isAutomatic: boolean; conditions?: any }> = [];

    if (orderType === 'new_install') {
      desiredStates = [
        { name: 'created', type: 'start', index: 1, display: 'Order Created', desc: 'Order has been created and is ready for processing' },
        { name: 'validated', type: 'validation', index: 2, display: 'Order Validated', desc: 'Order data has been validated for completeness and accuracy' },
        { name: 'enriched', type: 'enrichment', index: 3, display: 'Order Enriched', desc: 'Order has been enriched with network-specific parameters' },
        { name: 'fno_submitted', type: 'task', index: 4, display: 'Submitted to FNO', desc: 'Order has been submitted to the appropriate FNO' },
        { name: 'fno_accepted', type: 'gateway', index: 5, display: 'FNO Accepted', desc: 'FNO has accepted the order for processing' },
        { name: 'installation_scheduled', type: 'task', index: 6, display: 'Installation Scheduled', desc: 'Installation has been scheduled with customer' },
        { name: 'in_progress', type: 'task', index: 7, display: 'Installation In Progress', desc: 'Installation is currently in progress' },
        { name: 'installed', type: 'task', index: 8, display: 'Installation Completed', desc: 'Installation has been completed successfully' },
        { name: 'activated', type: 'task', index: 9, display: 'Service Activated', desc: 'Service has been activated for customer' },
        { name: 'completed', type: 'end', index: 10, display: 'Order Completed', desc: 'Order has been completed successfully' },
        { name: 'cancelled', type: 'end', index: 11, display: 'Order Cancelled', desc: 'Order has been cancelled' }
      ];
      transitions = [
        { from: 'created', to: 'validated', name: 'Validate Order', isAutomatic: true },
        { from: 'validated', to: 'enriched', name: 'Enrich Order', isAutomatic: true },
        { from: 'enriched', to: 'fno_submitted', name: 'Submit to FNO', isAutomatic: false, conditions: { requires_fno_id: true } },
        { from: 'fno_submitted', to: 'fno_accepted', name: 'FNO Accepts', isAutomatic: false },
        { from: 'fno_accepted', to: 'installation_scheduled', name: 'Schedule Installation', isAutomatic: false },
        { from: 'installation_scheduled', to: 'in_progress', name: 'Start Installation', isAutomatic: false },
        { from: 'in_progress', to: 'installed', name: 'Complete Installation', isAutomatic: false },
        { from: 'installed', to: 'activated', name: 'Activate Service', isAutomatic: false },
        { from: 'activated', to: 'completed', name: 'Complete Order', isAutomatic: false },
      ];
    } else if (orderType === 'service_change') {
      desiredStates = [
        { name: 'created', type: 'start', index: 1, display: 'Order Created', desc: 'Service change order created' },
        { name: 'validated', type: 'validation', index: 2, display: 'Order Validated', desc: 'Order validated for change' },
        { name: 'change_scheduled', type: 'task', index: 3, display: 'Change Scheduled', desc: 'Change has been scheduled' },
        { name: 'in_progress', type: 'task', index: 4, display: 'Change In Progress', desc: 'Service change is being applied' },
        { name: 'changed', type: 'task', index: 5, display: 'Change Applied', desc: 'Service change applied successfully' },
        { name: 'activated', type: 'task', index: 6, display: 'Service Re-Activated', desc: 'Service re-activated after change' },
        { name: 'completed', type: 'end', index: 7, display: 'Order Completed', desc: 'Service change completed' },
        { name: 'cancelled', type: 'end', index: 8, display: 'Order Cancelled', desc: 'Order has been cancelled' }
      ];
      transitions = [
        { from: 'created', to: 'validated', name: 'Validate Order', isAutomatic: true },
        { from: 'validated', to: 'change_scheduled', name: 'Schedule Change', isAutomatic: false },
        { from: 'change_scheduled', to: 'in_progress', name: 'Start Change', isAutomatic: false },
        { from: 'in_progress', to: 'changed', name: 'Apply Change', isAutomatic: false },
        { from: 'changed', to: 'activated', name: 'Re-Activate Service', isAutomatic: false },
        { from: 'activated', to: 'completed', name: 'Complete Order', isAutomatic: false },
      ];
    } else if (orderType === 'disconnect') {
      desiredStates = [
        { name: 'created', type: 'start', index: 1, display: 'Order Created', desc: 'Disconnect order created' },
        { name: 'validated', type: 'validation', index: 2, display: 'Order Validated', desc: 'Order validated for disconnection' },
        { name: 'disconnection_scheduled', type: 'task', index: 3, display: 'Disconnection Scheduled', desc: 'Disconnection scheduled with customer' },
        { name: 'in_progress', type: 'task', index: 4, display: 'Disconnection In Progress', desc: 'Disconnection underway' },
        { name: 'disconnected', type: 'task', index: 5, display: 'Disconnected', desc: 'Service disconnected' },
        { name: 'completed', type: 'end', index: 6, display: 'Order Completed', desc: 'Disconnection completed' },
        { name: 'cancelled', type: 'end', index: 7, display: 'Order Cancelled', desc: 'Order has been cancelled' }
      ];
      transitions = [
        { from: 'created', to: 'validated', name: 'Validate Order', isAutomatic: true },
        { from: 'validated', to: 'disconnection_scheduled', name: 'Schedule Disconnection', isAutomatic: false },
        { from: 'disconnection_scheduled', to: 'in_progress', name: 'Start Disconnection', isAutomatic: false },
        { from: 'in_progress', to: 'disconnected', name: 'Complete Disconnection', isAutomatic: false },
        { from: 'disconnected', to: 'completed', name: 'Complete Order', isAutomatic: false },
      ];
    } else {
      // Unknown order type: do nothing
      return;
    }

    // Insert missing states
    for (const s of desiredStates) {
      if (!existingNames.has(s.name)) {
        await this.db.query(
          `INSERT INTO workflow_states (workflow_id, state_name, state_type, order_index, display_name, description, config, is_required, estimated_duration_hours)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT DO NOTHING`,
          [workflowId, s.name, s.type, s.index, s.display, s.desc, {}, s.name !== 'completed', 0]
        );
      }
    }

    // Insert missing states
    for (const s of desiredStates) {
      if (!existingNames.has(s.name)) {
        await this.db.query(
          `INSERT INTO workflow_states (workflow_id, state_name, state_type, order_index, display_name, description, config, is_required, estimated_duration_hours)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT DO NOTHING`,
          [workflowId, s.name, s.type, s.index, s.display, s.desc, {}, s.name !== 'completed', 0]
        );
      }
    }

    // Map state names to ids
    const refreshed = await this.db.query(
      'SELECT id, state_name FROM workflow_states WHERE workflow_id = $1',
      [workflowId]
    );
    const nameToId = new Map<string, string>(refreshed.rows.map((r: any) => [r.state_name, r.id] as const));

    // Add base transitions per orderType
    for (const t of transitions) {
      const fromId = nameToId.get(t.from);
      const toId = nameToId.get(t.to);
      if (!fromId || !toId) continue;
      await this.db.query(
        `INSERT INTO workflow_transitions (workflow_id, from_state_id, to_state_id, transition_name, is_automatic, conditions)
         SELECT $1, $2, $3, $4, $5, $6
         WHERE NOT EXISTS (
           SELECT 1 FROM workflow_transitions 
           WHERE workflow_id = $1 AND from_state_id = $2 AND to_state_id = $3
         )`,
        [workflowId, fromId, toId, t.name, t.isAutomatic, t.conditions || {}]
      );
    }

    // Add cancellation transitions from most active states where applicable
    const cancellableFrom = ['created','validated','enriched','fno_submitted','fno_accepted','installation_scheduled','in_progress','installed','activated','change_scheduled','changed','disconnection_scheduled','disconnected'];
    if (nameToId.has('cancelled')) {
      const toCancelled = nameToId.get('cancelled') as string;
      for (const from of cancellableFrom) {
        const fromId = nameToId.get(from);
        if (!fromId) continue;
        await this.db.query(
          `INSERT INTO workflow_transitions (workflow_id, from_state_id, to_state_id, transition_name, is_automatic, conditions)
           SELECT $1, $2, $3, $4, $5, $6
           WHERE NOT EXISTS (
             SELECT 1 FROM workflow_transitions 
             WHERE workflow_id = $1 AND from_state_id = $2 AND to_state_id = $3
           )`,
          [workflowId, fromId, toCancelled, 'Cancel Order', false, {}]
        );
      }
    }
  }

  // Get workflow definition for order type
  async getWorkflowForOrderType(orderType: string): Promise<WorkflowDefinition | null> {
    const result = await this.db.query(
      `SELECT 
         id,
         name,
         order_type AS "orderType",
         COALESCE(version, 1) AS version,
         is_active AS "isActive",
         description,
         definition,
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM workflow_definitions 
       WHERE order_type = $1 AND is_active = true 
       ORDER BY version DESC, created_at DESC 
       LIMIT 1`,
      [orderType]
    );
    return result.rows[0] || null;
  }

  // Get all states for a workflow
  async getWorkflowStates(workflowId: string): Promise<WorkflowState[]> {
    const result = await this.db.query(
      `SELECT 
         id,
         workflow_id AS "workflowId",
         state_name AS "stateName",
         state_type AS "stateType",
         order_index AS "orderIndex",
         display_name AS "displayName",
         description,
         config,
         COALESCE(is_required, false) AS "isRequired",
         COALESCE(estimated_duration_hours, 0) AS "estimatedDurationHours"
       FROM workflow_states 
       WHERE workflow_id = $1 
       ORDER BY order_index ASC`,
      [workflowId]
    );
    return result.rows as unknown as WorkflowState[];
  }

  // Get all transitions for a workflow
  async getWorkflowTransitions(workflowId: string): Promise<WorkflowTransition[]> {
    const result = await this.db.query(
      `SELECT 
         id,
         workflow_id AS "workflowId",
         from_state_id AS "fromStateId",
         to_state_id AS "toStateId",
         transition_name AS "transitionName",
         conditions,
         actions,
         COALESCE(is_automatic, false) AS "isAutomatic",
         COALESCE(requires_approval, false) AS "requiresApproval"
       FROM workflow_transitions 
       WHERE workflow_id = $1`,
      [workflowId]
    );
    return result.rows as unknown as WorkflowTransition[];
  }

  // Create workflow instance for an order
  async createWorkflowInstance(orderId: string, orderType: string, createdBy: string): Promise<WorkflowInstance> {
    const workflow = await this.getWorkflowForOrderType(orderType);
    if (!workflow) {
      throw new Error(`No active workflow found for order type: ${orderType}`);
    }

    // Ensure PRD default states/transitions exist for this workflow if missing
    await this.ensurePrdDefaults(workflow.id, orderType);
    const states = await this.getWorkflowStates(workflow.id);
    let startState = states.find(s => s.stateType === 'start');
    if (!startState) {
      // Safety net: seed minimal 'created' start state and retry
      await this.db.query(
        `INSERT INTO workflow_states (workflow_id, state_name, state_type, order_index, display_name, description, config, is_required, estimated_duration_hours)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT DO NOTHING`,
        [workflow.id, 'created', 'start', 1, 'Order Created', 'Auto-seeded start state', {}, true, 0]
      );
      const refetched = await this.getWorkflowStates(workflow.id);
      startState = refetched.find(s => s.stateType === 'start') || null as any;
      if (!startState) {
        throw new Error(`No start state found for workflow: ${workflow.name}`);
      }
    }

    const result = await this.db.query(
      `INSERT INTO workflow_instances (order_id, workflow_id, current_state_id, context, started_at, last_updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       RETURNING 
         id,
         order_id AS "orderId",
         workflow_id AS "workflowId",
         current_state_id AS "currentStateId",
         COALESCE(status, 'active') AS status,
         started_at AS "startedAt",
         completed_at AS "completedAt",
         last_updated_at AS "lastUpdatedAt",
         context,
         error_message AS "errorMessage"`,
      [orderId, workflow.id, startState.id, { createdBy, orderType }]
    );

    // Record initial state in execution history
    await this.recordExecutionHistory(result.rows[0].id, null, startState.id, null, createdBy, 'Workflow instance created', {}, null);

    return result.rows[0] as unknown as WorkflowInstance;
  }

  // Get workflow instance for an order
  async getWorkflowInstance(orderId: string): Promise<WorkflowInstance | null> {
    const result = await this.db.query(
      `SELECT 
         id,
         order_id AS "orderId",
         workflow_id AS "workflowId",
         current_state_id AS "currentStateId",
         status,
         started_at AS "startedAt",
         completed_at AS "completedAt",
         last_updated_at AS "lastUpdatedAt",
         context,
         error_message AS "errorMessage"
       FROM workflow_instances 
       WHERE order_id = $1 AND status = $2 
       ORDER BY started_at DESC 
       LIMIT 1`,
      [orderId, 'active']
    );
    return (result.rows[0] as unknown as WorkflowInstance) || null;
  }

  // Get valid transitions from current state
  async getValidTransitions(instanceId: string): Promise<WorkflowTransition[]> {
    const instance = await this.getWorkflowInstanceById(instanceId);
    if (!instance) {
      throw new Error('Workflow instance not found');
    }

    const result = await this.db.query(
      `SELECT 
         id,
         workflow_id AS "workflowId",
         from_state_id AS "fromStateId",
         to_state_id AS "toStateId",
         transition_name AS "transitionName",
         conditions,
         actions,
         COALESCE(is_automatic, false) AS "isAutomatic",
         COALESCE(requires_approval, false) AS "requiresApproval"
       FROM workflow_transitions 
       WHERE from_state_id = $1`,
      [instance.currentStateId]
    );
    return result.rows as unknown as WorkflowTransition[];
  }

  // Execute transition
  async executeTransition(
    instanceId: string, 
    toStateId: string, 
    executedBy: string, 
    reason: string, 
    executionData: any = {}
  ): Promise<WorkflowInstance> {
    const instance = await this.getWorkflowInstanceById(instanceId);
    if (!instance) {
      throw new Error('Workflow instance not found');
    }

    // Validate transition
    const validTransitions = await this.getValidTransitions(instanceId);
    const transition = validTransitions.find(t => t.toStateId === toStateId);
    if (!transition) {
      throw new Error(`Invalid transition from current state to state ${toStateId}`);
    }

    // Check conditions
    if (transition.conditions && !this.evaluateConditions(transition.conditions, executionData)) {
      throw new Error(`Transition conditions not met: ${JSON.stringify(transition.conditions)}`);
    }

    const startTime = new Date();
    const fromStateId = instance.currentStateId;

    // Update instance
    const result = await this.db.query(
      `UPDATE workflow_instances 
       SET current_state_id = $1, last_updated_at = NOW(), context = $2
       WHERE id = $3
       RETURNING 
         id,
         order_id AS "orderId",
         workflow_id AS "workflowId",
         current_state_id AS "currentStateId",
         status,
         started_at AS "startedAt",
         completed_at AS "completedAt",
         last_updated_at AS "lastUpdatedAt",
         context,
         error_message AS "errorMessage"`,
      [toStateId, { ...instance.context, ...executionData }, instanceId]
    );

    const updatedInstance = result.rows[0];

    // Record execution history
    const endTime = new Date();
    const durationSeconds = Math.floor((endTime.getTime() - startTime.getTime()) / 1000);
    await this.recordExecutionHistory(instanceId, fromStateId, toStateId, transition.id, executedBy, reason, executionData, durationSeconds);

    // Execute transition actions
    if (transition.actions) {
      await this.executeActions(transition.actions, updatedInstance, executionData);
    }

    // Check if workflow is completed
    await this.checkWorkflowCompletion(updatedInstance);

    // Safety net: keep orders.status and onboarding step in sync with workflow state
    try {
      const stateNameRow = await this.db.query('SELECT state_name FROM workflow_states WHERE id = $1', [toStateId]);
      const newStateName: string | undefined = stateNameRow.rows[0]?.state_name;
      if (newStateName) {
        await this.syncOrderAndOnboarding(updatedInstance.orderId, newStateName);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[workflow] post-transition sync failed:', (e as any)?.message || e);
    }

    return updatedInstance;
  }

  // Upsert a transition between two states for a workflow
  async upsertTransition(
    workflowId: string,
    fromStateId: string,
    toStateId: string,
    transitionName: string,
    isAutomatic: boolean,
    conditions?: any
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO workflow_transitions (workflow_id, from_state_id, to_state_id, transition_name, is_automatic, conditions)
       SELECT $1, $2, $3, $4, $5, $6
       WHERE NOT EXISTS (
         SELECT 1 FROM workflow_transitions WHERE workflow_id = $1 AND from_state_id = $2 AND to_state_id = $3
       )`,
      [workflowId, fromStateId, toStateId, transitionName, isAutomatic, conditions || {}]
    );
  }

  // Get workflow execution history
  async getExecutionHistory(instanceId: string): Promise<WorkflowExecutionHistory[]> {
    const result = await this.db.query(
      `SELECT weh.*, ws_from.state_name as from_state_name, ws_to.state_name as to_state_name
       FROM workflow_execution_history weh
       LEFT JOIN workflow_states ws_from ON weh.from_state_id = ws_from.id
       LEFT JOIN workflow_states ws_to ON weh.to_state_id = ws_to.id
       WHERE weh.instance_id = $1
       ORDER BY weh.executed_at ASC`,
      [instanceId]
    );
    return result.rows;
  }

  // Get current state name for an order
  async getCurrentStateName(orderId: string): Promise<string | null> {
    const instance = await this.getWorkflowInstance(orderId);
    if (!instance) {
      return null;
    }

    const result = await this.db.query(
      'SELECT state_name FROM workflow_states WHERE id = $1',
      [instance.currentStateId]
    );
    return result.rows[0]?.state_name || null;
  }

  // Private helper methods
  private async getWorkflowInstanceById(instanceId: string): Promise<WorkflowInstance | null> {
    const result = await this.db.query(
      `SELECT 
         id,
         order_id AS "orderId",
         workflow_id AS "workflowId",
         current_state_id AS "currentStateId",
         status,
         started_at AS "startedAt",
         completed_at AS "completedAt",
         last_updated_at AS "lastUpdatedAt",
         context,
         error_message AS "errorMessage"
       FROM workflow_instances 
       WHERE id = $1`,
      [instanceId]
    );
    return (result.rows[0] as unknown as WorkflowInstance) || null;
  }

  private   async recordExecutionHistory(
    instanceId: string,
    fromStateId: string | null,
    toStateId: string,
    transitionId: string | null,
    executedBy: string | null, // Changed to allow NULL for system actions
    reason: string,
    executionData: any,
    durationSeconds?: number | null
  ): Promise<void> {
    const duration = typeof durationSeconds === 'number' ? durationSeconds : null;
    await this.db.query(
      `INSERT INTO workflow_execution_history
       (instance_id, from_state_id, to_state_id, transition_id, executed_by, execution_reason, execution_data, executed_at, duration_seconds)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)`,
      [instanceId, fromStateId, toStateId, transitionId, executedBy, reason, executionData, duration]
    );
  }

  private evaluateConditions(conditions: any, executionData: any): boolean {
    // Simple condition evaluation - can be extended for complex rules
    if (conditions.requires_fno_id && !executionData.fnoId) {
      return false;
    }
    if (conditions.requires_validation && !executionData.validationPassed) {
      return false;
    }
    return true;
  }

  private async executeActions(actions: any, instance: WorkflowInstance, executionData: any): Promise<void> {
    // Execute workflow actions - can be extended for complex actions
    if (actions.send_notification) {
      console.log(`[workflow] Sending notification for order ${instance.orderId}`);
    }
    if (actions.update_fno) {
      console.log(`[workflow] Updating FNO for order ${instance.orderId}`);
    }
  }

  private async checkWorkflowCompletion(instance: WorkflowInstance): Promise<void> {
    const result = await this.db.query(
      'SELECT state_type FROM workflow_states WHERE id = $1',
      [instance.currentStateId]
    );
    
    const currentState = result.rows[0];
    if (currentState?.state_type === 'end') {
      await this.db.query(
        'UPDATE workflow_instances SET status = $1, completed_at = NOW() WHERE id = $2',
        ['completed', instance.id]
      );
    }
  }

  // Update orders.status and the linked onboarding step to reflect the new workflow state
  private async syncOrderAndOnboarding(orderId: string, stateName: string): Promise<void> {
    // Update order row with explicit casts to avoid parameter type ambiguity
    await this.db.query('UPDATE orders SET status = $1::text, current_state = $1::text, updated_at = NOW() WHERE id = $2::uuid', [stateName, orderId]);

    // Fetch order_type for per-type onboarding mapping
    const ord = await this.db.query('SELECT order_type FROM orders WHERE id = $1 LIMIT 1', [orderId]);
    const orderType: string = (ord.rows[0]?.order_type || 'new_install') as string;

    // Map order status to onboarding step per order type (PRD-aligned)
    const mapNewInstall = (s: string): string | null => {
      switch (s) {
        case 'validated': return 'initiated';
        case 'enriched': return 'requirements_confirmed';
        case 'fno_submitted': return 'provisioning_requested';
        case 'fno_accepted': return 'provisioning_in_flight';
        case 'installation_scheduled': return 'installation_scheduled';
        case 'installed': return 'installation_complete';
        case 'activated': return 'service_activated';
        case 'completed': return 'completed';
        case 'cancelled': return 'cancelled';
        default: return null;
      }
    };
    const mapServiceChange = (s: string): string | null => {
      switch (s) {
        case 'validated': return 'initiated';
        case 'change_scheduled': return 'service_configuration';
        case 'in_progress': return 'provisioning_in_flight';
        case 'changed': return 'service_activated';
        case 'activated': return 'service_activated';
        case 'completed': return 'completed';
        case 'cancelled': return 'cancelled';
        default: return null;
      }
    };
    const mapDisconnect = (s: string): string | null => {
      switch (s) {
        case 'validated': return 'initiated';
        case 'disconnection_scheduled': return 'service_configuration';
        case 'in_progress': return 'provisioning_in_flight';
        case 'disconnected': return 'installation_complete';
        case 'completed': return 'completed';
        case 'cancelled': return 'cancelled';
        default: return null;
      }
    };

    const mapper = orderType === 'service_change' ? mapServiceChange : orderType === 'disconnect' ? mapDisconnect : mapNewInstall;
    const step = mapper(String(stateName));
    if (step === null) return;

    const r = await this.db.query('SELECT id, current_step FROM customer_onboarding WHERE order_id = $1 ORDER BY started_at DESC LIMIT 1', [orderId]);
    if (!r.rows[0]) return;
    const onboardingId = r.rows[0].id as string;
    const current = (r.rows[0].current_step || '').toString();
    if (current === step) return;

    const setCompleted = step === 'completed' || step === 'cancelled';
    await this.db.query(
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
  }

  // Admin methods for workflow management
  async createWorkflowDefinition(definition: Partial<WorkflowDefinition>, createdBy: string): Promise<WorkflowDefinition> {
    const result = await this.db.query(
      `INSERT INTO workflow_definitions (name, order_type, description, definition, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [definition.name, definition.orderType, definition.description, definition.definition, createdBy]
    );
    return result.rows[0];
  }

  async updateWorkflowDefinition(id: string, updates: Partial<WorkflowDefinition>): Promise<WorkflowDefinition> {
    const result = await this.db.query(
      `UPDATE workflow_definitions 
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           definition = COALESCE($3, definition),
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [updates.name, updates.description, updates.definition, id]
    );
    return result.rows[0];
  }

  async getAllWorkflowDefinitions(): Promise<WorkflowDefinition[]> {
    const result = await this.db.query(
      `SELECT 
         id,
         name,
         order_type AS "orderType",
         COALESCE(version, 1) AS version,
         is_active AS "isActive",
         description,
         definition,
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM workflow_definitions 
       ORDER BY order_type, version DESC`
    );
    return result.rows as unknown as WorkflowDefinition[];
  }
}
