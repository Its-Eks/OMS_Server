-- Onboarding workflow configuration schema (idempotent)

-- NOTE: Extension creation can require superuser. Rely on existing installation.
-- If gen_random_uuid() is unavailable on your DB, create pgcrypto separately.

CREATE TABLE IF NOT EXISTS onboarding_workflow_definitions (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text))::uuid,
  name VARCHAR(150) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  definition JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Ensure columns exist if table pre-existed without them
ALTER TABLE onboarding_workflow_definitions
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS definition JSONB,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS ux_onb_wf_def_name_version
  ON onboarding_workflow_definitions (name, version);

CREATE TABLE IF NOT EXISTS onboarding_workflow_states (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text))::uuid,
  definition_id UUID NOT NULL REFERENCES onboarding_workflow_definitions(id) ON DELETE CASCADE,
  state_name VARCHAR(100) NOT NULL,
  state_type VARCHAR(20) NOT NULL DEFAULT 'normal', -- start | normal | end
  description TEXT,
  sla_hours INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_onb_wf_states_unique
  ON onboarding_workflow_states (definition_id, state_name);

CREATE TABLE IF NOT EXISTS onboarding_workflow_transitions (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text))::uuid,
  definition_id UUID NOT NULL REFERENCES onboarding_workflow_definitions(id) ON DELETE CASCADE,
  from_state_id UUID NOT NULL REFERENCES onboarding_workflow_states(id) ON DELETE CASCADE,
  to_state_id UUID NOT NULL REFERENCES onboarding_workflow_states(id) ON DELETE CASCADE,
  transition_name VARCHAR(120),
  conditions JSONB,
  actions JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_onb_wf_transitions_unique
  ON onboarding_workflow_transitions (definition_id, from_state_id, to_state_id);

CREATE TABLE IF NOT EXISTS onboarding_workflow_instances (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text))::uuid,
  definition_id UUID NOT NULL REFERENCES onboarding_workflow_definitions(id) ON DELETE CASCADE,
  onboarding_id UUID NOT NULL, -- references customer_onboarding(id)
  current_state_id UUID NOT NULL REFERENCES onboarding_workflow_states(id),
  context JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_onb_wf_instances_unique
  ON onboarding_workflow_instances (definition_id, onboarding_id);

CREATE TABLE IF NOT EXISTS onboarding_workflow_execution_history (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text))::uuid,
  instance_id UUID NOT NULL REFERENCES onboarding_workflow_instances(id) ON DELETE CASCADE,
  from_state_id UUID REFERENCES onboarding_workflow_states(id),
  to_state_id UUID REFERENCES onboarding_workflow_states(id),
  transition_name VARCHAR(120),
  actor_id UUID,
  actor_type VARCHAR(50), -- user | system | scheduler
  reason TEXT,
  context JSONB,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Seed minimal default definition if none exists
INSERT INTO onboarding_workflow_definitions (name, version, is_active)
VALUES ('Standard Onboarding', 1, true)
ON CONFLICT (name, version) DO NOTHING;

-- Ensure core states exist for the active definition
INSERT INTO onboarding_workflow_states (definition_id, state_name, state_type, description, sla_hours)
SELECT def.id, 'initiated', 'start', 'Onboarding initiated', NULL
FROM onboarding_workflow_definitions def
WHERE def.is_active = true AND def.name = 'Standard Onboarding'
ON CONFLICT (definition_id, state_name) DO NOTHING;

INSERT INTO onboarding_workflow_states (definition_id, state_name, state_type, description, sla_hours)
SELECT def.id, 'rep_contact_scheduled', 'normal', 'Representative will contact customer', 24
FROM onboarding_workflow_definitions def
WHERE def.is_active = true AND def.name = 'Standard Onboarding'
ON CONFLICT (definition_id, state_name) DO NOTHING;

INSERT INTO onboarding_workflow_states (definition_id, state_name, state_type, description, sla_hours)
SELECT def.id, 'installation_scheduled', 'normal', 'Installation scheduled', NULL
FROM onboarding_workflow_definitions def
WHERE def.is_active = true AND def.name = 'Standard Onboarding'
ON CONFLICT (definition_id, state_name) DO NOTHING;

INSERT INTO onboarding_workflow_states (definition_id, state_name, state_type, description, sla_hours)
SELECT def.id, 'activated', 'end', 'Service activated', NULL
FROM onboarding_workflow_definitions def
WHERE def.is_active = true AND def.name = 'Standard Onboarding'
ON CONFLICT (definition_id, state_name) DO NOTHING;

-- Seed transitions idempotently
INSERT INTO onboarding_workflow_transitions (definition_id, from_state_id, to_state_id, transition_name)
SELECT def.id,
       fs.id AS from_state_id,
       ts.id AS to_state_id,
       'initiate_contact' AS transition_name
FROM onboarding_workflow_definitions def
JOIN onboarding_workflow_states fs ON fs.definition_id = def.id AND fs.state_name = 'initiated'
JOIN onboarding_workflow_states ts ON ts.definition_id = def.id AND ts.state_name = 'rep_contact_scheduled'
WHERE def.is_active = true AND def.name = 'Standard Onboarding'
ON CONFLICT (definition_id, from_state_id, to_state_id) DO NOTHING;

INSERT INTO onboarding_workflow_transitions (definition_id, from_state_id, to_state_id, transition_name)
SELECT def.id,
       fs.id AS from_state_id,
       ts.id AS to_state_id,
       'schedule_installation' AS transition_name
FROM onboarding_workflow_definitions def
JOIN onboarding_workflow_states fs ON fs.definition_id = def.id AND fs.state_name = 'rep_contact_scheduled'
JOIN onboarding_workflow_states ts ON ts.definition_id = def.id AND ts.state_name = 'installation_scheduled'
WHERE def.is_active = true AND def.name = 'Standard Onboarding'
ON CONFLICT (definition_id, from_state_id, to_state_id) DO NOTHING;

INSERT INTO onboarding_workflow_transitions (definition_id, from_state_id, to_state_id, transition_name)
SELECT def.id,
       fs.id AS from_state_id,
       ts.id AS to_state_id,
       'activate_service' AS transition_name
FROM onboarding_workflow_definitions def
JOIN onboarding_workflow_states fs ON fs.definition_id = def.id AND fs.state_name = 'installation_scheduled'
JOIN onboarding_workflow_states ts ON ts.definition_id = def.id AND ts.state_name = 'activated'
WHERE def.is_active = true AND def.name = 'Standard Onboarding'
ON CONFLICT (definition_id, from_state_id, to_state_id) DO NOTHING;


