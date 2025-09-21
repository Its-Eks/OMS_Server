import { Pool } from 'pg';

export interface OnboardingWorkflowState {
  id: string;
  definitionId: string;
  stateName: string;
  stateType: 'start' | 'normal' | 'end';
  description?: string;
  slaHours?: number | null;
}

export interface OnboardingWorkflowTransition {
  id: string;
  definitionId: string;
  fromStateId: string;
  toStateId: string;
  transitionName?: string | null;
  conditions?: any;
  actions?: any;
}

export class OnboardingWorkflowService {
  private readonly db: Pool;

  constructor(db: Pool) {
    this.db = db;
  }

  async getActiveDefinitionId(): Promise<string> {
    const r = await this.db.query(
      `SELECT id FROM onboarding_workflow_definitions WHERE is_active = true ORDER BY version DESC LIMIT 1`
    );
    if (!r.rows[0]) throw new Error('No active onboarding workflow definition');
    return r.rows[0].id as string;
  }

  async getStates(definitionId: string): Promise<OnboardingWorkflowState[]> {
    const r = await this.db.query(
      `SELECT id, definition_id AS "definitionId", state_name AS "stateName", state_type AS "stateType", description, sla_hours AS "slaHours"
       FROM onboarding_workflow_states WHERE definition_id = $1`,
      [definitionId]
    );
    return r.rows as OnboardingWorkflowState[];
  }

  async getStartState(definitionId: string): Promise<OnboardingWorkflowState> {
    const r = await this.db.query(
      `SELECT id, definition_id AS "definitionId", state_name AS "stateName", state_type AS "stateType", description, sla_hours AS "slaHours"
       FROM onboarding_workflow_states WHERE definition_id = $1 AND state_type = 'start' LIMIT 1`,
      [definitionId]
    );
    if (!r.rows[0]) throw new Error('No start state found for onboarding workflow');
    return r.rows[0] as OnboardingWorkflowState;
  }

  async getValidTransitions(definitionId: string, fromStateId: string): Promise<OnboardingWorkflowTransition[]> {
    const r = await this.db.query(
      `SELECT id, definition_id AS "definitionId", from_state_id AS "fromStateId", to_state_id AS "toStateId", transition_name AS "transitionName", conditions, actions
       FROM onboarding_workflow_transitions WHERE definition_id = $1 AND from_state_id = $2`,
      [definitionId, fromStateId]
    );
    return r.rows as OnboardingWorkflowTransition[];
  }

  async ensureInstance(onboardingId: string): Promise<{ instanceId: string; currentStateId: string }> {
    const definitionId = await this.getActiveDefinitionId();
    const existing = await this.db.query(
      `SELECT id, current_state_id FROM onboarding_workflow_instances WHERE definition_id = $1 AND onboarding_id = $2 LIMIT 1`,
      [definitionId, onboardingId]
    );
    if (existing.rows[0]) return { instanceId: existing.rows[0].id, currentStateId: existing.rows[0].current_state_id };
    const start = await this.getStartState(definitionId);
    const ins = await this.db.query(
      `INSERT INTO onboarding_workflow_instances (definition_id, onboarding_id, current_state_id) VALUES ($1, $2, $3) RETURNING id, current_state_id`,
      [definitionId, onboardingId, start.id]
    );
    return { instanceId: ins.rows[0].id, currentStateId: ins.rows[0].current_state_id };
  }

  async transition(onboardingId: string, toStateName: string, actorId?: string, reason?: string, context?: any): Promise<{ currentStateName: string }> {
    const definitionId = await this.getActiveDefinitionId();
    const inst = await this.ensureInstance(onboardingId);
    const states = await this.getStates(definitionId);
    const stateById = new Map(states.map(s => [s.id, s] as const));
    const stateByName = new Map(states.map(s => [s.stateName, s] as const));
    const current = stateById.get(inst.currentStateId);
    if (!current) throw new Error('Invalid current onboarding state');
    const target = stateByName.get(toStateName);
    if (!target) throw new Error(`Unknown onboarding state: ${toStateName}`);
    const valid = await this.getValidTransitions(definitionId, current.id);
    const match = valid.find(v => v.toStateId === target.id);
    if (!match) throw new Error(`Invalid transition from ${current.stateName} to ${target.stateName}`);

    // Move state
    await this.db.query(
      `UPDATE onboarding_workflow_instances SET current_state_id = $1, updated_at = NOW() WHERE id = $2`,
      [target.id, inst.instanceId]
    );

    // Compute duration since last transition
    let durationSeconds = 0;
    const last = await this.db.query(
      `SELECT occurred_at FROM onboarding_workflow_execution_history WHERE instance_id = $1 ORDER BY occurred_at DESC LIMIT 1`,
      [inst.instanceId]
    );
    if (last.rows[0]?.occurred_at) {
      const diffMs = Date.now() - new Date(last.rows[0].occurred_at).getTime();
      durationSeconds = Math.max(0, Math.floor(diffMs / 1000));
    }

    // Record history
    await this.db.query(
      `INSERT INTO onboarding_workflow_execution_history (instance_id, from_state_id, to_state_id, transition_name, actor_id, actor_type, reason, context, duration_seconds)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [inst.instanceId, current.id, target.id, match.transitionName || null, actorId || null, actorId ? 'user' : 'system', reason || null, context || null, durationSeconds]
    );

    return { currentStateName: target.stateName };
  }
}


