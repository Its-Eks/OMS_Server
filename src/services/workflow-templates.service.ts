import type { Pool } from 'pg';
import { ConfigurableWorkflowService } from './configurable-workflow.service.ts';
import { CamundaBPMService } from './camunda-bpm.service.ts';

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: 'standard' | 'premium' | 'enterprise' | 'trial' | 'custom';
  orderTypes: string[];
  estimatedDuration: number; // in hours
  complexity: 'simple' | 'medium' | 'complex';
  features: string[];
  template: {
    states: Array<{
      name: string;
      type: 'start' | 'end' | 'task' | 'gateway' | 'validation' | 'enrichment';
      displayName: string;
      description: string;
      config: any;
      isRequired: boolean;
      estimatedDurationHours: number;
    }>;
    transitions: Array<{
      fromState: string;
      toState: string;
      name: string;
      isAutomatic: boolean;
      conditions: any;
      actions: any;
    }>;
    policies: Array<{
      name: string;
      type: 'validation' | 'escalation' | 'notification' | 'enrichment';
      conditions: any;
      actions: any;
    }>;
  };
  bpmnDefinition?: string;
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
}

export class WorkflowTemplatesService {
  private db: Pool;
  private workflowService: ConfigurableWorkflowService;
  private camundaService: CamundaBPMService;

  constructor(db: Pool, workflowService: ConfigurableWorkflowService, camundaService: CamundaBPMService) {
    this.db = db;
    this.workflowService = workflowService;
    this.camundaService = camundaService;
  }

  // Get all workflow templates
  async getAllTemplates(): Promise<WorkflowTemplate[]> {
    const result = await this.db.query(
      'SELECT * FROM workflow_templates WHERE is_active = true ORDER BY category, name'
    );
    return result.rows;
  }

  // Get template by ID
  async getTemplate(templateId: string): Promise<WorkflowTemplate | null> {
    const result = await this.db.query(
      'SELECT * FROM workflow_templates WHERE id = $1 AND is_active = true',
      [templateId]
    );
    return result.rows[0] || null;
  }

  // Get templates by category
  async getTemplatesByCategory(category: string): Promise<WorkflowTemplate[]> {
    const result = await this.db.query(
      'SELECT * FROM workflow_templates WHERE category = $1 AND is_active = true ORDER BY name',
      [category]
    );
    return result.rows;
  }

  // Get templates for order type
  async getTemplatesForOrderType(orderType: string): Promise<WorkflowTemplate[]> {
    const result = await this.db.query(
      'SELECT * FROM workflow_templates WHERE $1 = ANY(order_types) AND is_active = true ORDER BY complexity, name',
      [orderType]
    );
    return result.rows;
  }

  // Create workflow from template
  async createWorkflowFromTemplate(
    templateId: string, 
    orderType: string, 
    customizations: any = {},
    createdBy: string
  ): Promise<string> {
    const template = await this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    // Apply customizations to template
    const customizedTemplate = this.applyCustomizations(template, customizations);

    // Create workflow definition
    const workflowDefinition = await this.workflowService.createWorkflowDefinition({
      name: `${template.name} - ${orderType}`,
      orderType,
      description: template.description,
      definition: customizedTemplate.template
    }, createdBy);

    // Create states
    for (const state of customizedTemplate.template.states) {
      await this.db.query(
        `INSERT INTO workflow_states (workflow_id, state_name, state_type, order_index, display_name, description, config, is_required, estimated_duration_hours)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          workflowDefinition.id,
          state.name,
          state.type,
          customizedTemplate.template.states.indexOf(state) + 1,
          state.displayName,
          state.description,
          JSON.stringify(state.config),
          state.isRequired,
          state.estimatedDurationHours
        ]
      );
    }

    // Create transitions
    for (const transition of customizedTemplate.template.transitions) {
      const fromState = await this.getStateByName(workflowDefinition.id, transition.fromState);
      const toState = await this.getStateByName(workflowDefinition.id, transition.toState);
      
      if (fromState && toState) {
        await this.db.query(
          `INSERT INTO workflow_transitions (workflow_id, from_state_id, to_state_id, transition_name, is_automatic, conditions, actions)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            workflowDefinition.id,
            fromState.id,
            toState.id,
            transition.name,
            transition.isAutomatic,
            JSON.stringify(transition.conditions),
            JSON.stringify(transition.actions)
          ]
        );
      }
    }

    // Create policies
    for (const policy of customizedTemplate.template.policies) {
      await this.db.query(
        `INSERT INTO workflow_policies (workflow_id, policy_name, policy_type, conditions, actions, priority)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          workflowDefinition.id,
          policy.name,
          policy.type,
          JSON.stringify(policy.conditions),
          JSON.stringify(policy.actions),
          100
        ]
      );
    }

    // Deploy to Camunda if available
    if (this.camundaService.isAvailable() && customizedTemplate.bpmnDefinition) {
      try {
        await this.camundaService.deployProcessDefinition(
          customizedTemplate.bpmnDefinition,
          workflowDefinition.name
        );
        console.log(`[templates] Deployed workflow ${workflowDefinition.name} to Camunda`);
      } catch (error) {
        console.warn(`[templates] Failed to deploy to Camunda:`, error);
      }
    }

    return workflowDefinition.id;
  }

  // Apply customizations to template
  private applyCustomizations(template: WorkflowTemplate, customizations: any): WorkflowTemplate {
    const customized = { ...template };

    // Apply state customizations
    if (customizations.states) {
      customized.template.states = customized.template.states.map(state => {
        const customization = customizations.states[state.name];
        if (customization) {
          return {
            ...state,
            ...customization,
            config: { ...state.config, ...customization.config }
          };
        }
        return state;
      });
    }

    // Apply transition customizations
    if (customizations.transitions) {
      customized.template.transitions = customized.template.transitions.map(transition => {
        const customization = customizations.transitions[`${transition.fromState}_${transition.toState}`];
        if (customization) {
          return {
            ...transition,
            ...customization,
            conditions: { ...transition.conditions, ...customization.conditions },
            actions: { ...transition.actions, ...customization.actions }
          };
        }
        return transition;
      });
    }

    // Apply policy customizations
    if (customizations.policies) {
      customized.template.policies = customized.template.policies.map(policy => {
        const customization = customizations.policies[policy.name];
        if (customization) {
          return {
            ...policy,
            ...customization,
            conditions: { ...policy.conditions, ...customization.conditions },
            actions: { ...policy.actions, ...customization.actions }
          };
        }
        return policy;
      });
    }

    return customized;
  }

  // Get state by name
  private async getStateByName(workflowId: string, stateName: string): Promise<any> {
    const result = await this.db.query(
      'SELECT * FROM workflow_states WHERE workflow_id = $1 AND state_name = $2',
      [workflowId, stateName]
    );
    return result.rows[0] || null;
  }

  // Create template
  async createTemplate(template: Partial<WorkflowTemplate>, createdBy: string): Promise<WorkflowTemplate> {
    const result = await this.db.query(
      `INSERT INTO workflow_templates (name, description, category, order_types, estimated_duration, complexity, features, template, bpmn_definition, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        template.name,
        template.description,
        template.category,
        template.orderTypes,
        template.estimatedDuration,
        template.complexity,
        template.features,
        JSON.stringify(template.template),
        template.bpmnDefinition,
        createdBy
      ]
    );
    return result.rows[0];
  }

  // Update template
  async updateTemplate(templateId: string, updates: Partial<WorkflowTemplate>): Promise<WorkflowTemplate> {
    const result = await this.db.query(
      `UPDATE workflow_templates 
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           category = COALESCE($3, category),
           order_types = COALESCE($4, order_types),
           estimated_duration = COALESCE($5, estimated_duration),
           complexity = COALESCE($6, complexity),
           features = COALESCE($7, features),
           template = COALESCE($8, template),
           bpmn_definition = COALESCE($9, bpmn_definition),
           updated_at = NOW()
       WHERE id = $10
       RETURNING *`,
      [
        updates.name,
        updates.description,
        updates.category,
        updates.orderTypes,
        updates.estimatedDuration,
        updates.complexity,
        updates.features,
        updates.template ? JSON.stringify(updates.template) : undefined,
        updates.bpmnDefinition,
        templateId
      ]
    );
    return result.rows[0];
  }

  // Delete template
  async deleteTemplate(templateId: string): Promise<void> {
    await this.db.query(
      'UPDATE workflow_templates SET is_active = false WHERE id = $1',
      [templateId]
    );
  }

  // Get template recommendations for order
  async getTemplateRecommendations(orderType: string, customerTier?: string): Promise<WorkflowTemplate[]> {
    let query = `
      SELECT * FROM workflow_templates 
      WHERE $1 = ANY(order_types) AND is_active = true
    `;
    const params = [orderType];

    // Add customer tier filtering if provided
    if (customerTier) {
      query += ` AND (category = $2 OR category = 'standard')`;
      params.push(customerTier);
    }

    query += ` ORDER BY 
      CASE 
        WHEN category = $${params.length + 1} THEN 1
        WHEN category = 'standard' THEN 2
        ELSE 3
      END,
      complexity,
      estimated_duration`;

    params.push(customerTier || 'standard');

    const result = await this.db.query(query, params);
    return result.rows;
  }
}
