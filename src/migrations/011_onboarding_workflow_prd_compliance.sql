-- Update onboarding workflow to match onboarding service and PRD requirements
-- This migration adds missing states and transitions to achieve full PRD compliance

-- Add missing states to the active onboarding workflow definition
INSERT INTO onboarding_workflow_states (definition_id, state_name, state_type, description, sla_hours)
SELECT def.id, 'welcome_sent', 'normal', 'Welcome email sent to customer', 2
FROM onboarding_workflow_definitions def 
WHERE def.is_active = true AND def.name = 'Standard Onboarding'
ON CONFLICT (definition_id, state_name) DO NOTHING;

INSERT INTO onboarding_workflow_states (definition_id, state_name, state_type, description, sla_hours)
SELECT def.id, 'service_setup', 'normal', 'Service configuration and account setup', 24
FROM onboarding_workflow_definitions def 
WHERE def.is_active = true AND def.name = 'Standard Onboarding'
ON CONFLICT (definition_id, state_name) DO NOTHING;

INSERT INTO onboarding_workflow_states (definition_id, state_name, state_type, description, sla_hours)
SELECT def.id, 'equipment_ordered', 'normal', 'Equipment ordered for installation', 48
FROM onboarding_workflow_definitions def 
WHERE def.is_active = true AND def.name = 'Standard Onboarding'
ON CONFLICT (definition_id, state_name) DO NOTHING;

INSERT INTO onboarding_workflow_states (definition_id, state_name, state_type, description, sla_hours)
SELECT def.id, 'equipment_shipped', 'normal', 'Equipment shipped to customer', 72
FROM onboarding_workflow_definitions def 
WHERE def.is_active = true AND def.name = 'Standard Onboarding'
ON CONFLICT (definition_id, state_name) DO NOTHING;

INSERT INTO onboarding_workflow_states (definition_id, state_name, state_type, description, sla_hours)
SELECT def.id, 'installation_completed', 'normal', 'Service installation completed', 24
FROM onboarding_workflow_definitions def 
WHERE def.is_active = true AND def.name = 'Standard Onboarding'
ON CONFLICT (definition_id, state_name) DO NOTHING;

INSERT INTO onboarding_workflow_states (definition_id, state_name, state_type, description, sla_hours)
SELECT def.id, 'service_activated', 'normal', 'Service activated and tested', 12
FROM onboarding_workflow_definitions def 
WHERE def.is_active = true AND def.name = 'Standard Onboarding'
ON CONFLICT (definition_id, state_name) DO NOTHING;

INSERT INTO onboarding_workflow_states (definition_id, state_name, state_type, description, sla_hours)
SELECT def.id, 'follow_up', 'normal', 'Post-activation follow-up and support', 168
FROM onboarding_workflow_definitions def 
WHERE def.is_active = true AND def.name = 'Standard Onboarding'
ON CONFLICT (definition_id, state_name) DO NOTHING;

INSERT INTO onboarding_workflow_states (definition_id, state_name, state_type, description, sla_hours)
SELECT def.id, 'completed', 'end', 'Onboarding process completed successfully', NULL
FROM onboarding_workflow_definitions def 
WHERE def.is_active = true AND def.name = 'Standard Onboarding'
ON CONFLICT (definition_id, state_name) DO NOTHING;

-- Update the existing 'activated' state to be 'normal' instead of 'end' since we now have 'completed' as the end state
UPDATE onboarding_workflow_states 
SET state_type = 'normal'
WHERE state_name = 'activated' 
AND definition_id = (SELECT id FROM onboarding_workflow_definitions WHERE is_active = true AND name = 'Standard Onboarding');

-- Add missing transitions to create the complete workflow flow
-- initiated → welcome_sent
INSERT INTO onboarding_workflow_transitions (definition_id, from_state_id, to_state_id, transition_name)
SELECT def.id,
       fs.id AS from_state_id,
       ts.id AS to_state_id,
       'send_welcome_email' AS transition_name
FROM onboarding_workflow_definitions def
JOIN onboarding_workflow_states fs ON fs.definition_id = def.id AND fs.state_name = 'initiated'
JOIN onboarding_workflow_states ts ON ts.definition_id = def.id AND ts.state_name = 'welcome_sent'
WHERE def.is_active = true AND def.name = 'Standard Onboarding'
ON CONFLICT (definition_id, from_state_id, to_state_id) DO NOTHING;

-- welcome_sent → service_setup
INSERT INTO onboarding_workflow_transitions (definition_id, from_state_id, to_state_id, transition_name)
SELECT def.id,
       fs.id AS from_state_id,
       ts.id AS to_state_id,
       'configure_service' AS transition_name
FROM onboarding_workflow_definitions def
JOIN onboarding_workflow_states fs ON fs.definition_id = def.id AND fs.state_name = 'welcome_sent'
JOIN onboarding_workflow_states ts ON ts.definition_id = def.id AND ts.state_name = 'service_setup'
WHERE def.is_active = true AND def.name = 'Standard Onboarding'
ON CONFLICT (definition_id, from_state_id, to_state_id) DO NOTHING;

-- service_setup → equipment_ordered
INSERT INTO onboarding_workflow_transitions (definition_id, from_state_id, to_state_id, transition_name)
SELECT def.id,
       fs.id AS from_state_id,
       ts.id AS to_state_id,
       'order_equipment' AS transition_name
FROM onboarding_workflow_definitions def
JOIN onboarding_workflow_states fs ON fs.definition_id = def.id AND fs.state_name = 'service_setup'
JOIN onboarding_workflow_states ts ON ts.definition_id = def.id AND ts.state_name = 'equipment_ordered'
WHERE def.is_active = true AND def.name = 'Standard Onboarding'
ON CONFLICT (definition_id, from_state_id, to_state_id) DO NOTHING;

-- equipment_ordered → equipment_shipped
INSERT INTO onboarding_workflow_transitions (definition_id, from_state_id, to_state_id, transition_name)
SELECT def.id,
       fs.id AS from_state_id,
       ts.id AS to_state_id,
       'ship_equipment' AS transition_name
FROM onboarding_workflow_definitions def
JOIN onboarding_workflow_states fs ON fs.definition_id = def.id AND fs.state_name = 'equipment_ordered'
JOIN onboarding_workflow_states ts ON ts.definition_id = def.id AND ts.state_name = 'equipment_shipped'
WHERE def.is_active = true AND def.name = 'Standard Onboarding'
ON CONFLICT (definition_id, from_state_id, to_state_id) DO NOTHING;

-- equipment_shipped → installation_scheduled
INSERT INTO onboarding_workflow_transitions (definition_id, from_state_id, to_state_id, transition_name)
SELECT def.id,
       fs.id AS from_state_id,
       ts.id AS to_state_id,
       'schedule_installation' AS transition_name
FROM onboarding_workflow_definitions def
JOIN onboarding_workflow_states fs ON fs.definition_id = def.id AND fs.state_name = 'equipment_shipped'
JOIN onboarding_workflow_states ts ON ts.definition_id = def.id AND ts.state_name = 'installation_scheduled'
WHERE def.is_active = true AND def.name = 'Standard Onboarding'
ON CONFLICT (definition_id, from_state_id, to_state_id) DO NOTHING;

-- installation_scheduled → installation_completed
INSERT INTO onboarding_workflow_transitions (definition_id, from_state_id, to_state_id, transition_name)
SELECT def.id,
       fs.id AS from_state_id,
       ts.id AS to_state_id,
       'complete_installation' AS transition_name
FROM onboarding_workflow_definitions def
JOIN onboarding_workflow_states fs ON fs.definition_id = def.id AND fs.state_name = 'installation_scheduled'
JOIN onboarding_workflow_states ts ON ts.definition_id = def.id AND ts.state_name = 'installation_completed'
WHERE def.is_active = true AND def.name = 'Standard Onboarding'
ON CONFLICT (definition_id, from_state_id, to_state_id) DO NOTHING;

-- installation_completed → service_activated
INSERT INTO onboarding_workflow_transitions (definition_id, from_state_id, to_state_id, transition_name)
SELECT def.id,
       fs.id AS from_state_id,
       ts.id AS to_state_id,
       'activate_service' AS transition_name
FROM onboarding_workflow_definitions def
JOIN onboarding_workflow_states fs ON fs.definition_id = def.id AND fs.state_name = 'installation_completed'
JOIN onboarding_workflow_states ts ON ts.definition_id = def.id AND ts.state_name = 'service_activated'
WHERE def.is_active = true AND def.name = 'Standard Onboarding'
ON CONFLICT (definition_id, from_state_id, to_state_id) DO NOTHING;

-- service_activated → follow_up
INSERT INTO onboarding_workflow_transitions (definition_id, from_state_id, to_state_id, transition_name)
SELECT def.id,
       fs.id AS from_state_id,
       ts.id AS to_state_id,
       'initiate_follow_up' AS transition_name
FROM onboarding_workflow_definitions def
JOIN onboarding_workflow_states fs ON fs.definition_id = def.id AND fs.state_name = 'service_activated'
JOIN onboarding_workflow_states ts ON ts.definition_id = def.id AND ts.state_name = 'follow_up'
WHERE def.is_active = true AND def.name = 'Standard Onboarding'
ON CONFLICT (definition_id, from_state_id, to_state_id) DO NOTHING;

-- follow_up → completed
INSERT INTO onboarding_workflow_transitions (definition_id, from_state_id, to_state_id, transition_name)
SELECT def.id,
       fs.id AS from_state_id,
       ts.id AS to_state_id,
       'complete_onboarding' AS transition_name
FROM onboarding_workflow_definitions def
JOIN onboarding_workflow_states fs ON fs.definition_id = def.id AND fs.state_name = 'follow_up'
JOIN onboarding_workflow_states ts ON ts.definition_id = def.id AND ts.state_name = 'completed'
WHERE def.is_active = true AND def.name = 'Standard Onboarding'
ON CONFLICT (definition_id, from_state_id, to_state_id) DO NOTHING;

-- Update the existing transition from rep_contact_scheduled to installation_scheduled
-- to go through the proper flow: rep_contact_scheduled → service_setup
-- Guard the update to avoid violating unique constraint if a row with the target to_state already exists
UPDATE onboarding_workflow_transitions tgt
SET to_state_id = (
    SELECT ts.id 
    FROM onboarding_workflow_states ts 
    JOIN onboarding_workflow_definitions def ON ts.definition_id = def.id
    WHERE ts.state_name = 'service_setup' 
    AND def.is_active = true AND def.name = 'Standard Onboarding'
),
transition_name = 'proceed_to_service_setup'
WHERE tgt.from_state_id = (
    SELECT fs.id 
    FROM onboarding_workflow_states fs 
    JOIN onboarding_workflow_definitions def ON fs.definition_id = def.id
    WHERE fs.state_name = 'rep_contact_scheduled' 
    AND def.is_active = true AND def.name = 'Standard Onboarding'
)
AND tgt.definition_id = (SELECT id FROM onboarding_workflow_definitions WHERE is_active = true AND name = 'Standard Onboarding')
AND NOT EXISTS (
  SELECT 1 FROM onboarding_workflow_transitions x
  WHERE x.definition_id = tgt.definition_id
    AND x.from_state_id = tgt.from_state_id
    AND x.to_state_id = (
      SELECT ts2.id
      FROM onboarding_workflow_states ts2
      JOIN onboarding_workflow_definitions def2 ON ts2.definition_id = def2.id
      WHERE ts2.state_name = 'service_setup'
      AND def2.is_active = true AND def2.name = 'Standard Onboarding'
    )
);

-- Remove the old transition from installation_scheduled to activated since we now have the proper flow
DELETE FROM onboarding_workflow_transitions 
WHERE from_state_id = (
    SELECT fs.id 
    FROM onboarding_workflow_states fs 
    JOIN onboarding_workflow_definitions def ON fs.definition_id = def.id
    WHERE fs.state_name = 'installation_scheduled' 
    AND def.is_active = true AND def.name = 'Standard Onboarding'
)
AND to_state_id = (
    SELECT ts.id 
    FROM onboarding_workflow_states ts 
    JOIN onboarding_workflow_definitions def ON ts.definition_id = def.id
    WHERE ts.state_name = 'activated' 
    AND def.is_active = true AND def.name = 'Standard Onboarding'
)
AND definition_id = (SELECT id FROM onboarding_workflow_definitions WHERE is_active = true AND name = 'Standard Onboarding');

-- Add transition from activated to service_activated for backward compatibility
INSERT INTO onboarding_workflow_transitions (definition_id, from_state_id, to_state_id, transition_name)
SELECT def.id,
       fs.id AS from_state_id,
       ts.id AS to_state_id,
       'migrate_to_service_activated' AS transition_name
FROM onboarding_workflow_definitions def
JOIN onboarding_workflow_states fs ON fs.definition_id = def.id AND fs.state_name = 'activated'
JOIN onboarding_workflow_states ts ON ts.definition_id = def.id AND ts.state_name = 'service_activated'
WHERE def.is_active = true AND def.name = 'Standard Onboarding'
ON CONFLICT (definition_id, from_state_id, to_state_id) DO NOTHING;
