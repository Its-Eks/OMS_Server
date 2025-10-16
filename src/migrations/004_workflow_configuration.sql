-- 004_workflow_configuration.sql (PostgreSQL 17 safe, JSONB casts fixed)

-- Ensure uniqueness constraints exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_constraint
        WHERE conname = 'unique_order_type'
    ) THEN
        ALTER TABLE workflow_definitions
        ADD CONSTRAINT unique_order_type UNIQUE (order_type);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_constraint
        WHERE conname = 'unique_workflow_state'
    ) THEN
        ALTER TABLE workflow_states
        ADD CONSTRAINT unique_workflow_state UNIQUE (workflow_id, state_name);
    END IF;
END $$;

-- Workflow definitions table
CREATE TABLE IF NOT EXISTS workflow_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  order_type VARCHAR(50) NOT NULL,
  version INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  description TEXT,
  definition JSONB NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Workflow states table
CREATE TABLE IF NOT EXISTS workflow_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  state_name VARCHAR(50) NOT NULL,
  state_type VARCHAR(20) NOT NULL,
  order_index INTEGER NOT NULL,
  display_name VARCHAR(100),
  description TEXT,
  config JSONB,
  is_required BOOLEAN DEFAULT true,
  estimated_duration_hours INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Workflow transitions table
CREATE TABLE IF NOT EXISTS workflow_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  from_state_id UUID REFERENCES workflow_states(id) ON DELETE CASCADE,
  to_state_id UUID REFERENCES workflow_states(id) ON DELETE CASCADE,
  transition_name VARCHAR(100),
  conditions JSONB,
  actions JSONB,
  is_automatic BOOLEAN DEFAULT false,
  requires_approval BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Workflow instances table
CREATE TABLE IF NOT EXISTS workflow_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  workflow_id UUID REFERENCES workflow_definitions(id),
  current_state_id UUID REFERENCES workflow_states(id),
  status VARCHAR(20) DEFAULT 'active',
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  last_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  context JSONB,
  error_message TEXT
);

-- Workflow execution history table
CREATE TABLE IF NOT EXISTS workflow_execution_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID REFERENCES workflow_instances(id) ON DELETE CASCADE,
  from_state_id UUID REFERENCES workflow_states(id),
  to_state_id UUID REFERENCES workflow_states(id),
  transition_id UUID REFERENCES workflow_transitions(id),
  executed_by UUID REFERENCES users(id),
  execution_reason TEXT,
  execution_data JSONB,
  executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  duration_seconds INTEGER
);

-- Workflow policies table
CREATE TABLE IF NOT EXISTS workflow_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  policy_name VARCHAR(100) NOT NULL,
  policy_type VARCHAR(50) NOT NULL,
  conditions JSONB NOT NULL,
  actions JSONB NOT NULL,
  priority INTEGER DEFAULT 100,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
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

-- Insert default workflow definitions with JSONB casts
INSERT INTO workflow_definitions (name, order_type, definition, created_by)
SELECT * FROM (
  VALUES
  ('Standard New Installation Workflow', 'new_install', '{"type": "standard", "description": "Standard workflow for new customer installations"}'::jsonb, (SELECT id FROM users WHERE email='admin@oms.com' LIMIT 1)),
  ('Service Change Workflow', 'service_change', '{"type": "service_change", "description": "Workflow for existing customer service changes"}'::jsonb, (SELECT id FROM users WHERE email='admin@oms.com' LIMIT 1)),
  ('Disconnect Workflow', 'disconnect', '{"type": "disconnect", "description": "Workflow for customer service disconnections"}'::jsonb, (SELECT id FROM users WHERE email='admin@oms.com' LIMIT 1))
) AS t(name, order_type, definition, created_by)
ON CONFLICT DO NOTHING;

-- Insert default states for new_install workflow
WITH new_install_workflow AS (
  SELECT id FROM workflow_definitions WHERE order_type = 'new_install' LIMIT 1
)
INSERT INTO workflow_states (workflow_id, state_name, state_type, order_index, display_name, description, config)
SELECT id, state_name, state_type, order_index, display_name, description, config
FROM (VALUES
  ('created', 'start', 1, 'Order Created', 'Order has been created and is ready for processing', '{"auto_transition": true}'::jsonb),
  ('validated', 'validation', 2, 'Order Validated', 'Order data has been validated', '{"validation_rules": ["address", "service_availability", "credit_check"]}'::jsonb),
  ('enriched', 'enrichment', 3, 'Order Enriched', 'Order has been enriched', '{"enrichment_rules": ["fno_determination", "network_params"]}'::jsonb),
  ('fno_submitted', 'task', 4, 'Submitted to FNO', 'Order has been submitted to the appropriate FNO', '{"requires_fno_id": true}'::jsonb),
  ('fno_accepted', 'gateway', 5, 'FNO Accepted', 'FNO has accepted the order', '{}'::jsonb),
  ('installation_scheduled', 'task', 6, 'Installation Scheduled', 'Installation has been scheduled', '{}'::jsonb),
  ('in_progress', 'task', 7, 'Installation In Progress', 'Installation is currently in progress', '{}'::jsonb),
  ('installed', 'task', 8, 'Installation Completed', 'Installation has been completed', '{}'::jsonb),
  ('activated', 'task', 9, 'Service Activated', 'Service has been activated', '{}'::jsonb),
  ('completed', 'end', 10, 'Order Completed', 'Order has been completed successfully', '{}'::jsonb)
) AS s(state_name, state_type, order_index, display_name, description, config)
CROSS JOIN new_install_workflow
ON CONFLICT DO NOTHING;

-- Insert default transitions for new_install workflow
WITH new_install_workflow AS (
  SELECT id FROM workflow_definitions WHERE order_type = 'new_install' LIMIT 1
),
states AS (
  SELECT ws.id, ws.state_name FROM workflow_states ws
  JOIN new_install_workflow wf ON ws.workflow_id = wf.id
)
INSERT INTO workflow_transitions (workflow_id, from_state_id, to_state_id, transition_name, is_automatic, conditions)
SELECT 
  (SELECT id FROM new_install_workflow),
  s_from.id,
  s_to.id,
  t.transition_name,
  t.is_automatic,
  t.conditions
FROM (VALUES
  ('created', 'validated', 'Validate Order', true, '{}'::jsonb),
  ('validated', 'enriched', 'Enrich Order', true, '{}'::jsonb),
  ('enriched', 'fno_submitted', 'Submit to FNO', false, '{"requires_fno_id": true}'::jsonb),
  ('fno_submitted', 'fno_accepted', 'FNO Accepts', false, '{}'::jsonb),
  ('fno_accepted', 'installation_scheduled', 'Schedule Installation', false, '{}'::jsonb),
  ('installation_scheduled', 'in_progress', 'Start Installation', false, '{}'::jsonb),
  ('in_progress', 'installed', 'Complete Installation', false, '{}'::jsonb),
  ('installed', 'activated', 'Activate Service', false, '{}'::jsonb),
  ('activated', 'completed', 'Complete Order', false, '{}'::jsonb)
) AS t(from_state, to_state, transition_name, is_automatic, conditions)
JOIN states s_from ON s_from.state_name = t.from_state
JOIN states s_to   ON s_to.state_name   = t.to_state;
