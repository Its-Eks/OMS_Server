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

    const states = await this.getWorkflowStates(workflow.id);
    const startState = states.find(s => s.stateType === 'start');
    if (!startState) {
      throw new Error(`No start state found for workflow: ${workflow.name}`);
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

    return updatedInstance;
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

  private async recordExecutionHistory(
    instanceId: string,
    fromStateId: string | null,
    toStateId: string,
    transitionId: string | null,
    executedBy: string,
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
