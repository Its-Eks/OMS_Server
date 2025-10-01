import type { Pool } from 'pg';

export interface EscalationWorkflowState {
  id: string;
  definitionId: string;
  stateName: string;
  stateType: 'start' | 'normal' | 'end';
  description?: string | null;
}

export class EscalationWorkflowService {
  private readonly db: Pool;

  constructor(db: Pool) {
    this.db = db;
  }

  private async getActiveDefinitionId(): Promise<string> {
    const r = await this.db.query(
      `SELECT id FROM escalation_workflow_definitions WHERE is_active = true ORDER BY updated_at DESC LIMIT 1`
    );
    if (!r.rows[0]) throw new Error('No active escalation workflow definition');
    return r.rows[0].id as string;
  }

  public async startForEscalation(escalationId: string, context?: any): Promise<{ instanceId: string; stateName: string }> {
    const defId = await this.getActiveDefinitionId();
    const s = await this.db.query(
      `SELECT id, state_name FROM escalation_workflow_states WHERE definition_id = $1 AND state_type = 'start' LIMIT 1`,
      [defId]
    );
    if (!s.rows[0]) throw new Error('No start state configured for escalation workflow');
    const startStateId = s.rows[0].id as string;
    const startStateName = s.rows[0].state_name as string;

    const inst = await this.db.query(
      `INSERT INTO escalation_workflow_instances (definition_id, escalation_id, current_state_id, context)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [defId, escalationId, startStateId, context || null]
    );

    await this.db.query(
      `INSERT INTO escalation_workflow_execution_history (instance_id, from_state_id, to_state_id, executed_by, execution_reason)
       VALUES ($1, NULL, $2, NULL, 'escalation_created')`,
      [inst.rows[0].id, startStateId]
    );

    return { instanceId: inst.rows[0].id as string, stateName: startStateName };
  }

  public async getState(escalationId: string): Promise<{ stateName: string; instanceId: string } | null> {
    const r = await this.db.query(
      `SELECT i.id, s.state_name
         FROM escalation_workflow_instances i
         JOIN escalation_workflow_states s ON s.id = i.current_state_id
        WHERE i.escalation_id = $1
        ORDER BY i.last_updated_at DESC
        LIMIT 1`,
      [escalationId]
    );
    if (!r.rows[0]) return null;
    return { instanceId: r.rows[0].id, stateName: r.rows[0].state_name };
  }

  public async transition(escalationId: string, transitionName: string, executedBy?: string, reason?: string, data?: any): Promise<{ stateName: string }> {
    const defId = await this.getActiveDefinitionId();
    const inst = await this.db.query(
      `SELECT i.id, i.current_state_id
         FROM escalation_workflow_instances i
        WHERE i.escalation_id = $1
        ORDER BY i.last_updated_at DESC
        LIMIT 1`,
      [escalationId]
    );
    if (!inst.rows[0]) throw new Error('Escalation workflow instance not found');
    const instanceId = inst.rows[0].id as string;
    const currentStateId = inst.rows[0].current_state_id as string;

    const tr = await this.db.query(
      `SELECT t.id, t.to_state_id, s_to.state_name, s_to.state_type
         FROM escalation_workflow_transitions t
         JOIN escalation_workflow_states s_from ON s_from.id = t.from_state_id
         JOIN escalation_workflow_states s_to ON s_to.id = t.to_state_id
        WHERE t.definition_id = $1 AND t.from_state_id = $2 AND t.transition_name = $3
        LIMIT 1`,
      [defId, currentStateId, transitionName]
    );
    if (!tr.rows[0]) throw new Error(`Invalid transition '${transitionName}' from current state`);

    const toStateId = tr.rows[0].to_state_id as string;
    const toStateName = tr.rows[0].state_name as string;
    const toStateType = tr.rows[0].state_type as string;

    await this.db.query(
      `UPDATE escalation_workflow_instances
          SET current_state_id = $1, last_updated_at = NOW(),
              status = CASE WHEN $2 = 'end' THEN 'completed' ELSE 'active' END,
              completed_at = CASE WHEN $2 = 'end' THEN NOW() ELSE completed_at END
        WHERE id = $3`,
      [toStateId, toStateType, instanceId]
    );

    await this.db.query(
      `INSERT INTO escalation_workflow_execution_history (instance_id, from_state_id, to_state_id, transition_id, executed_by, execution_reason, execution_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [instanceId, currentStateId, toStateId, tr.rows[0].id, executedBy || null, reason || null, data || null]
    );

    return { stateName: toStateName };
  }

  public async history(escalationId: string): Promise<any[]> {
    const r = await this.db.query(
      `SELECT h.*, s_from.state_name AS from_state_name, s_to.state_name AS to_state_name
         FROM escalation_workflow_instances i
         JOIN escalation_workflow_execution_history h ON h.instance_id = i.id
         LEFT JOIN escalation_workflow_states s_from ON s_from.id = h.from_state_id
         LEFT JOIN escalation_workflow_states s_to ON s_to.id = h.to_state_id
        WHERE i.escalation_id = $1
        ORDER BY h.executed_at DESC`,
      [escalationId]
    );
    return r.rows;
  }
}


