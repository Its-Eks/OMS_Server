-- Escalation workflow schema and defaults

-- Definitions
CREATE TABLE IF NOT EXISTS escalation_workflow_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(150) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  definition JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_escal_wf_def_name_version
  ON escalation_workflow_definitions (name, version);

-- States
CREATE TABLE IF NOT EXISTS escalation_workflow_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id UUID NOT NULL REFERENCES escalation_workflow_definitions(id) ON DELETE CASCADE,
  state_name VARCHAR(100) NOT NULL,
  state_type VARCHAR(20) NOT NULL DEFAULT 'normal', -- start | normal | end
  description TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_escal_wf_states_unique
  ON escalation_workflow_states (definition_id, state_name);

-- Transitions
CREATE TABLE IF NOT EXISTS escalation_workflow_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id UUID NOT NULL REFERENCES escalation_workflow_definitions(id) ON DELETE CASCADE,
  from_state_id UUID NOT NULL REFERENCES escalation_workflow_states(id) ON DELETE CASCADE,
  to_state_id UUID NOT NULL REFERENCES escalation_workflow_states(id) ON DELETE CASCADE,
  transition_name VARCHAR(120),
  conditions JSONB,
  actions JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_escal_wf_transitions_unique
  ON escalation_workflow_transitions (definition_id, from_state_id, to_state_id, transition_name);

-- Instances (per escalation)
CREATE TABLE IF NOT EXISTS escalation_workflow_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id UUID NOT NULL REFERENCES escalation_workflow_definitions(id) ON DELETE CASCADE,
  escalation_id UUID NOT NULL REFERENCES escalations(id) ON DELETE CASCADE,
  current_state_id UUID NOT NULL REFERENCES escalation_workflow_states(id),
  context JSONB,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) DEFAULT 'active',
  completed_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_escal_wf_instances_unique
  ON escalation_workflow_instances (definition_id, escalation_id);

-- History
CREATE TABLE IF NOT EXISTS escalation_workflow_execution_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID NOT NULL REFERENCES escalation_workflow_instances(id) ON DELETE CASCADE,
  from_state_id UUID REFERENCES escalation_workflow_states(id),
  to_state_id UUID REFERENCES escalation_workflow_states(id),
  transition_id UUID REFERENCES escalation_workflow_transitions(id),
  executed_by UUID,
  execution_reason TEXT,
  execution_data JSONB,
  executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed default definition if none exists
INSERT INTO escalation_workflow_definitions (name, version, is_active)
SELECT 'Default Escalation Workflow', 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM escalation_workflow_definitions WHERE name = 'Default Escalation Workflow' AND version = 1
);

-- Insert default states
WITH def AS (
  SELECT id FROM escalation_workflow_definitions WHERE name = 'Default Escalation Workflow' AND is_active = true LIMIT 1
)
INSERT INTO escalation_workflow_states (definition_id, state_name, state_type, description)
SELECT def.id, 'received', 'start', 'Escalation created and pending acknowledgement'
FROM def
ON CONFLICT (definition_id, state_name) DO NOTHING;

WITH def AS (
  SELECT id FROM escalation_workflow_definitions WHERE name = 'Default Escalation Workflow' AND is_active = true LIMIT 1
)
INSERT INTO escalation_workflow_states (definition_id, state_name, state_type, description)
SELECT def.id, 'acknowledged', 'normal', 'Assignee acknowledged the escalation'
FROM def
ON CONFLICT (definition_id, state_name) DO NOTHING;

WITH def AS (
  SELECT id FROM escalation_workflow_definitions WHERE name = 'Default Escalation Workflow' AND is_active = true LIMIT 1
)
INSERT INTO escalation_workflow_states (definition_id, state_name, state_type, description)
SELECT def.id, 'investigating', 'normal', 'Investigation in progress'
FROM def
ON CONFLICT (definition_id, state_name) DO NOTHING;

WITH def AS (
  SELECT id FROM escalation_workflow_definitions WHERE name = 'Default Escalation Workflow' AND is_active = true LIMIT 1
)
INSERT INTO escalation_workflow_states (definition_id, state_name, state_type, description)
SELECT def.id, 'awaiting_external', 'normal', 'Waiting on external party (e.g., FNO)'
FROM def
ON CONFLICT (definition_id, state_name) DO NOTHING;

WITH def AS (
  SELECT id FROM escalation_workflow_definitions WHERE name = 'Default Escalation Workflow' AND is_active = true LIMIT 1
)
INSERT INTO escalation_workflow_states (definition_id, state_name, state_type, description)
SELECT def.id, 'resolved', 'end', 'Issue resolved and verified'
FROM def
ON CONFLICT (definition_id, state_name) DO NOTHING;

-- Transitions between states
WITH def AS (
  SELECT id FROM escalation_workflow_definitions WHERE name = 'Default Escalation Workflow' AND is_active = true LIMIT 1
), s AS (
  SELECT 
    (SELECT id FROM escalation_workflow_states WHERE definition_id = def.id AND state_name = 'received') AS received,
    (SELECT id FROM escalation_workflow_states WHERE definition_id = def.id AND state_name = 'acknowledged') AS acknowledged,
    (SELECT id FROM escalation_workflow_states WHERE definition_id = def.id AND state_name = 'investigating') AS investigating,
    (SELECT id FROM escalation_workflow_states WHERE definition_id = def.id AND state_name = 'awaiting_external') AS awaiting_external,
    (SELECT id FROM escalation_workflow_states WHERE definition_id = def.id AND state_name = 'resolved') AS resolved
  FROM def
)
INSERT INTO escalation_workflow_transitions (definition_id, from_state_id, to_state_id, transition_name)
SELECT def.id, s.received, s.acknowledged, 'acknowledge' FROM def, s
ON CONFLICT DO NOTHING;

WITH def AS (
  SELECT id FROM escalation_workflow_definitions WHERE name = 'Default Escalation Workflow' AND is_active = true LIMIT 1
), s AS (
  SELECT 
    (SELECT id FROM escalation_workflow_states WHERE definition_id = def.id AND state_name = 'acknowledged') AS acknowledged,
    (SELECT id FROM escalation_workflow_states WHERE definition_id = def.id AND state_name = 'investigating') AS investigating
  FROM def
)
INSERT INTO escalation_workflow_transitions (definition_id, from_state_id, to_state_id, transition_name)
SELECT def.id, s.acknowledged, s.investigating, 'start_investigation' FROM def, s
ON CONFLICT DO NOTHING;

WITH def AS (
  SELECT id FROM escalation_workflow_definitions WHERE name = 'Default Escalation Workflow' AND is_active = true LIMIT 1
), s AS (
  SELECT 
    (SELECT id FROM escalation_workflow_states WHERE definition_id = def.id AND state_name = 'investigating') AS investigating,
    (SELECT id FROM escalation_workflow_states WHERE definition_id = def.id AND state_name = 'awaiting_external') AS awaiting_external
  FROM def
)
INSERT INTO escalation_workflow_transitions (definition_id, from_state_id, to_state_id, transition_name)
SELECT def.id, s.investigating, s.awaiting_external, 'await_external' FROM def, s
ON CONFLICT DO NOTHING;

WITH def AS (
  SELECT id FROM escalation_workflow_definitions WHERE name = 'Default Escalation Workflow' AND is_active = true LIMIT 1
), s AS (
  SELECT 
    (SELECT id FROM escalation_workflow_states WHERE definition_id = def.id AND state_name = 'awaiting_external') AS awaiting_external,
    (SELECT id FROM escalation_workflow_states WHERE definition_id = def.id AND state_name = 'investigating') AS investigating
  FROM def
)
INSERT INTO escalation_workflow_transitions (definition_id, from_state_id, to_state_id, transition_name)
SELECT def.id, s.awaiting_external, s.investigating, 'resume_investigation' FROM def, s
ON CONFLICT DO NOTHING;

WITH def AS (
  SELECT id FROM escalation_workflow_definitions WHERE name = 'Default Escalation Workflow' AND is_active = true LIMIT 1
), s AS (
  SELECT 
    (SELECT id FROM escalation_workflow_states WHERE definition_id = def.id AND state_name = 'investigating') AS investigating,
    (SELECT id FROM escalation_workflow_states WHERE definition_id = def.id AND state_name = 'resolved') AS resolved
  FROM def
)
INSERT INTO escalation_workflow_transitions (definition_id, from_state_id, to_state_id, transition_name)
SELECT def.id, s.investigating, s.resolved, 'resolve' FROM def, s
ON CONFLICT DO NOTHING;


