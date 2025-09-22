-- Workflow Configuration Tables (PRD Compliant)
-- This migration creates tables for configurable workflows as required by the PRD

-- Workflow definitions for different order types
CREATE TABLE IF NOT EXISTS workflow_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  order_type VARCHAR(50) NOT NULL, -- 'new_install', 'disconnect', 'service_change', etc.
  version INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  description TEXT,
  definition JSONB NOT NULL, -- BPMN workflow definition or custom workflow config
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Workflow states/steps
CREATE TABLE IF NOT EXISTS workflow_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  state_name VARCHAR(50) NOT NULL,
  state_type VARCHAR(20) NOT NULL, -- 'start', 'end', 'task', 'gateway', 'validation', 'enrichment'
  order_index INTEGER NOT NULL,
  display_name VARCHAR(100),
  description TEXT,
  config JSONB, -- state-specific configuration (validation rules, enrichment params, etc.)
  is_required BOOLEAN DEFAULT true,
  estimated_duration_hours INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Valid transitions between states
CREATE TABLE IF NOT EXISTS workflow_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  from_state_id UUID REFERENCES workflow_states(id) ON DELETE CASCADE,
  to_state_id UUID REFERENCES workflow_states(id) ON DELETE CASCADE,
  transition_name VARCHAR(100),
  conditions JSONB, -- transition conditions (e.g., fno_id required, validation passed)
  actions JSONB, -- actions to perform on transition (e.g., send notification, update FNO)
  is_automatic BOOLEAN DEFAULT false, -- whether transition happens automatically
  requires_approval BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Workflow execution instances (for tracking order progress)
CREATE TABLE IF NOT EXISTS workflow_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  workflow_id UUID REFERENCES workflow_definitions(id),
  current_state_id UUID REFERENCES workflow_states(id),
  status VARCHAR(20) DEFAULT 'active', -- 'active', 'completed', 'cancelled', 'error'
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  last_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  context JSONB, -- execution context data
  error_message TEXT
);

-- Workflow execution history
CREATE TABLE IF NOT EXISTS workflow_execution_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID REFERENCES workflow_instances(id) ON DELETE CASCADE,
  from_state_id UUID REFERENCES workflow_states(id),
  to_state_id UUID REFERENCES workflow_states(id),
  transition_id UUID REFERENCES workflow_transitions(id),
  executed_by UUID REFERENCES users(id),
  execution_reason TEXT,
  execution_data JSONB, -- data passed during transition
  executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  duration_seconds INTEGER
);

-- Workflow policies and rules
CREATE TABLE IF NOT EXISTS workflow_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  policy_name VARCHAR(100) NOT NULL,
  policy_type VARCHAR(50) NOT NULL, -- 'validation', 'escalation', 'notification', 'enrichment'
  conditions JSONB NOT NULL, -- when this policy applies
  actions JSONB NOT NULL, -- what to do when conditions are met
  priority INTEGER DEFAULT 100,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_workflow_definitions_order_type ON workflow_definitions(order_type);
CREATE INDEX IF NOT EXISTS idx_workflow_definitions_active ON workflow_definitions(is_active);
CREATE INDEX IF NOT EXISTS idx_workflow_states_workflow_id ON workflow_states(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_states_order_index ON workflow_states(workflow_id, order_index);
CREATE INDEX IF NOT EXISTS idx_workflow_transitions_workflow_id ON workflow_transitions(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_transitions_from_state ON workflow_transitions(from_state_id);
CREATE INDEX IF NOT EXISTS idx_workflow_instances_order_id ON workflow_instances(order_id);
CREATE INDEX IF NOT EXISTS idx_workflow_instances_status ON workflow_instances(status);
CREATE INDEX IF NOT EXISTS idx_workflow_execution_history_instance_id ON workflow_execution_history(instance_id);
CREATE INDEX IF NOT EXISTS idx_workflow_policies_workflow_id ON workflow_policies(workflow_id);

-- Insert default workflow definitions for common order types
INSERT INTO workflow_definitions (name, order_type, definition, created_by) VALUES
(
  'Standard New Installation Workflow',
  'new_install',
  '{"type": "standard", "description": "Standard workflow for new customer installations"}',
  (SELECT id FROM users WHERE email = 'admin@oms.com' LIMIT 1)
),
(
  'Service Change Workflow',
  'service_change',
  '{"type": "service_change", "description": "Workflow for existing customer service changes"}',
  (SELECT id FROM users WHERE email = 'admin@oms.com' LIMIT 1)
),
(
  'Disconnect Workflow',
  'disconnect',
  '{"type": "disconnect", "description": "Workflow for customer service disconnections"}',
  (SELECT id FROM users WHERE email = 'admin@oms.com' LIMIT 1)
)
ON CONFLICT DO NOTHING;

-- Insert default states for new installation workflow
WITH new_install_workflow AS (
  SELECT id FROM workflow_definitions WHERE order_type = 'new_install' LIMIT 1
)
INSERT INTO workflow_states (workflow_id, state_name, state_type, order_index, display_name, description, config) VALUES
((SELECT id FROM new_install_workflow), 'created', 'start', 1, 'Order Created', 'Order has been created and is ready for processing', '{"auto_transition": true}'),
((SELECT id FROM new_install_workflow), 'validated', 'validation', 2, 'Order Validated', 'Order data has been validated for completeness and accuracy', '{"validation_rules": ["address", "service_availability", "credit_check"]}'),
((SELECT id FROM new_install_workflow), 'enriched', 'enrichment', 3, 'Order Enriched', 'Order has been enriched with network-specific parameters', '{"enrichment_rules": ["fno_determination", "network_params"]}'),
((SELECT id FROM new_install_workflow), 'fno_submitted', 'task', 4, 'Submitted to FNO', 'Order has been submitted to the appropriate FNO', '{"requires_fno_id": true}'),
((SELECT id FROM new_install_workflow), 'fno_accepted', 'gateway', 5, 'FNO Accepted', 'FNO has accepted the order for processing', '{}'),
((SELECT id FROM new_install_workflow), 'installation_scheduled', 'task', 6, 'Installation Scheduled', 'Installation has been scheduled with customer', '{}'),
((SELECT id FROM new_install_workflow), 'in_progress', 'task', 7, 'Installation In Progress', 'Installation is currently in progress', '{}'),
((SELECT id FROM new_install_workflow), 'installed', 'task', 8, 'Installation Completed', 'Installation has been completed successfully', '{}'),
((SELECT id FROM new_install_workflow), 'activated', 'task', 9, 'Service Activated', 'Service has been activated for customer', '{}'),
((SELECT id FROM new_install_workflow), 'completed', 'end', 10, 'Order Completed', 'Order has been completed successfully', '{}')
ON CONFLICT DO NOTHING;

-- Insert default transitions for new installation workflow
WITH 
  new_install_workflow AS (SELECT id FROM workflow_definitions WHERE order_type = 'new_install' LIMIT 1),
  states AS (
    SELECT ws.id, ws.state_name FROM workflow_states ws 
    JOIN new_install_workflow wf ON ws.workflow_id = wf.id
  )
INSERT INTO workflow_transitions (workflow_id, from_state_id, to_state_id, transition_name, is_automatic, conditions) VALUES
((SELECT id FROM new_install_workflow), (SELECT id FROM states WHERE state_name = 'created'), (SELECT id FROM states WHERE state_name = 'validated'), 'Validate Order', true, '{}'),
((SELECT id FROM new_install_workflow), (SELECT id FROM states WHERE state_name = 'validated'), (SELECT id FROM states WHERE state_name = 'enriched'), 'Enrich Order', true, '{}'),
((SELECT id FROM new_install_workflow), (SELECT id FROM states WHERE state_name = 'enriched'), (SELECT id FROM states WHERE state_name = 'fno_submitted'), 'Submit to FNO', false, '{"requires_fno_id": true}'),
((SELECT id FROM new_install_workflow), (SELECT id FROM states WHERE state_name = 'fno_submitted'), (SELECT id FROM states WHERE state_name = 'fno_accepted'), 'FNO Accepts', false, '{}'),
((SELECT id FROM new_install_workflow), (SELECT id FROM states WHERE state_name = 'fno_accepted'), (SELECT id FROM states WHERE state_name = 'installation_scheduled'), 'Schedule Installation', false, '{}'),
((SELECT id FROM new_install_workflow), (SELECT id FROM states WHERE state_name = 'installation_scheduled'), (SELECT id FROM states WHERE state_name = 'in_progress'), 'Start Installation', false, '{}'),
((SELECT id FROM new_install_workflow), (SELECT id FROM states WHERE state_name = 'in_progress'), (SELECT id FROM states WHERE state_name = 'installed'), 'Complete Installation', false, '{}'),
((SELECT id FROM new_install_workflow), (SELECT id FROM states WHERE state_name = 'installed'), (SELECT id FROM states WHERE state_name = 'activated'), 'Activate Service', false, '{}'),
((SELECT id FROM new_install_workflow), (SELECT id FROM states WHERE state_name = 'activated'), (SELECT id FROM states WHERE state_name = 'completed'), 'Complete Order', false, '{}')
ON CONFLICT DO NOTHING;
