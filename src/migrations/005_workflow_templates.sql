-- Workflow Templates Table (PRD Compliant)
-- This migration creates tables for workflow templates and A/B testing

-- Workflow templates for common scenarios
CREATE TABLE IF NOT EXISTS workflow_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  category VARCHAR(50) NOT NULL, -- 'standard', 'premium', 'enterprise', 'trial', 'custom'
  order_types TEXT[] NOT NULL, -- Array of order types this template supports
  estimated_duration INTEGER NOT NULL, -- Estimated duration in hours
  complexity VARCHAR(20) NOT NULL, -- 'simple', 'medium', 'complex'
  features TEXT[] NOT NULL, -- Array of features this template includes
  template JSONB NOT NULL, -- Complete template definition (states, transitions, policies)
  bpmn_definition TEXT, -- BPMN XML definition for Camunda
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- A/B Testing for workflows
CREATE TABLE IF NOT EXISTS workflow_ab_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  order_type VARCHAR(50) NOT NULL,
  control_workflow_id UUID REFERENCES workflow_definitions(id),
  variant_workflow_id UUID REFERENCES workflow_definitions(id),
  traffic_split DECIMAL(3,2) DEFAULT 0.50, -- Percentage of traffic to variant (0.00 to 1.00)
  start_date TIMESTAMP NOT NULL,
  end_date TIMESTAMP,
  status VARCHAR(20) DEFAULT 'active', -- 'active', 'paused', 'completed', 'cancelled'
  success_metrics JSONB, -- Metrics to track for success
  results JSONB, -- A/B test results
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- A/B Test assignments (which orders get which workflow)
CREATE TABLE IF NOT EXISTS workflow_ab_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID REFERENCES workflow_ab_tests(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  assigned_workflow_id UUID REFERENCES workflow_definitions(id),
  assignment_reason VARCHAR(100), -- 'control', 'variant', 'random', 'manual'
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(test_id, order_id)
);

-- Workflow performance metrics
CREATE TABLE IF NOT EXISTS workflow_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES workflow_definitions(id),
  order_id UUID REFERENCES orders(id),
  metric_name VARCHAR(100) NOT NULL, -- 'completion_time', 'error_rate', 'customer_satisfaction', etc.
  metric_value DECIMAL(10,4) NOT NULL,
  metric_unit VARCHAR(20), -- 'hours', 'percentage', 'score', etc.
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  context JSONB -- Additional context for the metric
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_workflow_templates_category ON workflow_templates(category);
CREATE INDEX IF NOT EXISTS idx_workflow_templates_order_types ON workflow_templates USING GIN(order_types);
CREATE INDEX IF NOT EXISTS idx_workflow_templates_complexity ON workflow_templates(complexity);
CREATE INDEX IF NOT EXISTS idx_workflow_ab_tests_order_type ON workflow_ab_tests(order_type);
CREATE INDEX IF NOT EXISTS idx_workflow_ab_tests_status ON workflow_ab_tests(status);
CREATE INDEX IF NOT EXISTS idx_workflow_ab_assignments_test_id ON workflow_ab_assignments(test_id);
CREATE INDEX IF NOT EXISTS idx_workflow_ab_assignments_order_id ON workflow_ab_assignments(order_id);
CREATE INDEX IF NOT EXISTS idx_workflow_metrics_workflow_id ON workflow_metrics(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_metrics_metric_name ON workflow_metrics(metric_name);
CREATE INDEX IF NOT EXISTS idx_workflow_metrics_recorded_at ON workflow_metrics(recorded_at);

-- Insert default workflow templates
INSERT INTO workflow_templates (name, description, category, order_types, estimated_duration, complexity, features, template, created_by) VALUES
(
  'Standard New Installation',
  'Standard workflow for new customer installations with basic validation and FNO integration',
  'standard',
  ARRAY['new_install'],
  24,
  'simple',
  ARRAY['validation', 'fno_integration', 'installation_tracking'],
  '{
    "states": [
      {"name": "created", "type": "start", "displayName": "Order Created", "description": "Order has been created", "config": {}, "isRequired": true, "estimatedDurationHours": 0},
      {"name": "validated", "type": "validation", "displayName": "Order Validated", "description": "Order data validated", "config": {"validation_rules": ["address", "service_availability"]}, "isRequired": true, "estimatedDurationHours": 1},
      {"name": "fno_submitted", "type": "task", "displayName": "Submitted to FNO", "description": "Order submitted to FNO", "config": {"requires_fno_id": true}, "isRequired": true, "estimatedDurationHours": 2},
      {"name": "fno_accepted", "type": "gateway", "displayName": "FNO Accepted", "description": "FNO accepted order", "config": {}, "isRequired": true, "estimatedDurationHours": 4},
      {"name": "installation_scheduled", "type": "task", "displayName": "Installation Scheduled", "description": "Installation scheduled", "config": {}, "isRequired": true, "estimatedDurationHours": 8},
      {"name": "in_progress", "type": "task", "displayName": "Installation In Progress", "description": "Installation in progress", "config": {}, "isRequired": true, "estimatedDurationHours": 4},
      {"name": "installed", "type": "task", "displayName": "Installation Completed", "description": "Installation completed", "config": {}, "isRequired": true, "estimatedDurationHours": 2},
      {"name": "activated", "type": "task", "displayName": "Service Activated", "description": "Service activated", "config": {}, "isRequired": true, "estimatedDurationHours": 1},
      {"name": "completed", "type": "end", "displayName": "Order Completed", "description": "Order completed", "config": {}, "isRequired": true, "estimatedDurationHours": 0}
    ],
    "transitions": [
      {"fromState": "created", "toState": "validated", "name": "Validate Order", "isAutomatic": true, "conditions": {}, "actions": {}},
      {"fromState": "validated", "toState": "fno_submitted", "name": "Submit to FNO", "isAutomatic": false, "conditions": {"requires_fno_id": true}, "actions": {}},
      {"fromState": "fno_submitted", "toState": "fno_accepted", "name": "FNO Accepts", "isAutomatic": false, "conditions": {}, "actions": {}},
      {"fromState": "fno_accepted", "toState": "installation_scheduled", "name": "Schedule Installation", "isAutomatic": false, "conditions": {}, "actions": {}},
      {"fromState": "installation_scheduled", "toState": "in_progress", "name": "Start Installation", "isAutomatic": false, "conditions": {}, "actions": {}},
      {"fromState": "in_progress", "toState": "installed", "name": "Complete Installation", "isAutomatic": false, "conditions": {}, "actions": {}},
      {"fromState": "installed", "toState": "activated", "name": "Activate Service", "isAutomatic": false, "conditions": {}, "actions": {}},
      {"fromState": "activated", "toState": "completed", "name": "Complete Order", "isAutomatic": false, "conditions": {}, "actions": {}}
    ],
    "policies": [
      {"name": "Address Validation", "type": "validation", "conditions": {"state": "validated"}, "actions": {"validate_address": true}},
      {"name": "FNO Notification", "type": "notification", "conditions": {"state": "fno_submitted"}, "actions": {"notify_fno": true}},
      {"name": "Customer Notification", "type": "notification", "conditions": {"state": "installation_scheduled"}, "actions": {"notify_customer": true}}
    ]
  }',
  (SELECT id FROM users WHERE email = 'admin@oms.com' LIMIT 1)
),
(
  'Premium New Installation',
  'Premium workflow for high-value customers with enhanced validation and priority processing',
  'premium',
  ARRAY['new_install'],
  12,
  'medium',
  ARRAY['enhanced_validation', 'priority_processing', 'dedicated_support', 'fno_integration', 'installation_tracking'],
  '{
    "states": [
      {"name": "created", "type": "start", "displayName": "Order Created", "description": "Premium order created", "config": {"priority": "high"}, "isRequired": true, "estimatedDurationHours": 0},
      {"name": "validated", "type": "validation", "displayName": "Enhanced Validation", "description": "Enhanced validation with credit check", "config": {"validation_rules": ["address", "service_availability", "credit_check", "premium_validation"]}, "isRequired": true, "estimatedDurationHours": 0.5},
      {"name": "enriched", "type": "enrichment", "displayName": "Order Enriched", "description": "Order enriched with premium features", "config": {"premium_features": true}, "isRequired": true, "estimatedDurationHours": 0.5},
      {"name": "fno_submitted", "type": "task", "displayName": "Priority FNO Submission", "description": "Priority submission to FNO", "config": {"priority": "high", "requires_fno_id": true}, "isRequired": true, "estimatedDurationHours": 1},
      {"name": "fno_accepted", "type": "gateway", "displayName": "FNO Accepted", "description": "FNO accepted priority order", "config": {}, "isRequired": true, "estimatedDurationHours": 2},
      {"name": "installation_scheduled", "type": "task", "displayName": "Priority Installation Scheduled", "description": "Priority installation scheduled", "config": {"priority": "high"}, "isRequired": true, "estimatedDurationHours": 4},
      {"name": "in_progress", "type": "task", "displayName": "Installation In Progress", "description": "Premium installation in progress", "config": {"dedicated_technician": true}, "isRequired": true, "estimatedDurationHours": 2},
      {"name": "installed", "type": "task", "displayName": "Installation Completed", "description": "Premium installation completed", "config": {}, "isRequired": true, "estimatedDurationHours": 1},
      {"name": "activated", "type": "task", "displayName": "Service Activated", "description": "Premium service activated", "config": {}, "isRequired": true, "estimatedDurationHours": 0.5},
      {"name": "completed", "type": "end", "displayName": "Order Completed", "description": "Premium order completed", "config": {}, "isRequired": true, "estimatedDurationHours": 0}
    ],
    "transitions": [
      {"fromState": "created", "toState": "validated", "name": "Enhanced Validation", "isAutomatic": true, "conditions": {}, "actions": {}},
      {"fromState": "validated", "toState": "enriched", "name": "Enrich Order", "isAutomatic": true, "conditions": {}, "actions": {}},
      {"fromState": "enriched", "toState": "fno_submitted", "name": "Priority FNO Submission", "isAutomatic": false, "conditions": {"requires_fno_id": true}, "actions": {"priority": "high"}},
      {"fromState": "fno_submitted", "toState": "fno_accepted", "name": "FNO Accepts", "isAutomatic": false, "conditions": {}, "actions": {}},
      {"fromState": "fno_accepted", "toState": "installation_scheduled", "name": "Priority Schedule", "isAutomatic": false, "conditions": {}, "actions": {"priority": "high"}},
      {"fromState": "installation_scheduled", "toState": "in_progress", "name": "Start Premium Installation", "isAutomatic": false, "conditions": {}, "actions": {"dedicated_technician": true}},
      {"fromState": "in_progress", "toState": "installed", "name": "Complete Installation", "isAutomatic": false, "conditions": {}, "actions": {}},
      {"fromState": "installed", "toState": "activated", "name": "Activate Premium Service", "isAutomatic": false, "conditions": {}, "actions": {}},
      {"fromState": "activated", "toState": "completed", "name": "Complete Premium Order", "isAutomatic": false, "conditions": {}, "actions": {}}
    ],
    "policies": [
      {"name": "Enhanced Validation", "type": "validation", "conditions": {"state": "validated"}, "actions": {"enhanced_validation": true, "credit_check": true}},
      {"name": "Priority Processing", "type": "escalation", "conditions": {"delay": ">2h"}, "actions": {"escalate": true, "priority": "high"}},
      {"name": "Dedicated Support", "type": "notification", "conditions": {"state": "fno_submitted"}, "actions": {"dedicated_support": true}},
      {"name": "Premium Customer Notification", "type": "notification", "conditions": {"state": "installation_scheduled"}, "actions": {"premium_notification": true}}
    ]
  }',
  (SELECT id FROM users WHERE email = 'admin@oms.com' LIMIT 1)
),
(
  'Trial Customer Onboarding',
  'Workflow for trial customers with conversion tracking and engagement monitoring',
  'trial',
  ARRAY['new_install'],
  168, -- 7 days
  'medium',
  ARRAY['trial_tracking', 'conversion_monitoring', 'engagement_metrics', 'automated_reminders'],
  '{
    "states": [
      {"name": "created", "type": "start", "displayName": "Trial Started", "description": "Trial customer created", "config": {"trial_days": 7}, "isRequired": true, "estimatedDurationHours": 0},
      {"name": "validated", "type": "validation", "displayName": "Trial Validation", "description": "Trial customer validated", "config": {"trial_validation": true}, "isRequired": true, "estimatedDurationHours": 1},
      {"name": "activated", "type": "task", "displayName": "Trial Service Activated", "description": "Trial service activated", "config": {"trial_service": true}, "isRequired": true, "estimatedDurationHours": 2},
      {"name": "monitoring", "type": "task", "displayName": "Trial Monitoring", "description": "Monitoring trial usage", "config": {"monitoring": true}, "isRequired": true, "estimatedDurationHours": 168},
      {"name": "conversion_attempt", "type": "task", "displayName": "Conversion Attempt", "description": "Attempting to convert trial", "config": {"conversion": true}, "isRequired": false, "estimatedDurationHours": 24},
      {"name": "converted", "type": "end", "displayName": "Trial Converted", "description": "Trial successfully converted", "config": {}, "isRequired": false, "estimatedDurationHours": 0},
      {"name": "expired", "type": "end", "displayName": "Trial Expired", "description": "Trial expired without conversion", "config": {}, "isRequired": false, "estimatedDurationHours": 0}
    ],
    "transitions": [
      {"fromState": "created", "toState": "validated", "name": "Validate Trial", "isAutomatic": true, "conditions": {}, "actions": {}},
      {"fromState": "validated", "toState": "activated", "name": "Activate Trial", "isAutomatic": true, "conditions": {}, "actions": {}},
      {"fromState": "activated", "toState": "monitoring", "name": "Start Monitoring", "isAutomatic": true, "conditions": {}, "actions": {}},
      {"fromState": "monitoring", "toState": "conversion_attempt", "name": "Attempt Conversion", "isAutomatic": false, "conditions": {"trial_days_remaining": "<3"}, "actions": {"send_conversion_reminder": true}},
      {"fromState": "conversion_attempt", "toState": "converted", "name": "Convert Trial", "isAutomatic": false, "conditions": {"conversion_successful": true}, "actions": {}},
      {"fromState": "monitoring", "toState": "expired", "name": "Trial Expired", "isAutomatic": true, "conditions": {"trial_days_remaining": "0"}, "actions": {"deactivate_trial": true}},
      {"fromState": "conversion_attempt", "toState": "expired", "name": "Conversion Failed", "isAutomatic": true, "conditions": {"trial_days_remaining": "0"}, "actions": {"deactivate_trial": true}}
    ],
    "policies": [
      {"name": "Trial Monitoring", "type": "validation", "conditions": {"state": "monitoring"}, "actions": {"track_usage": true, "monitor_engagement": true}},
      {"name": "Conversion Reminders", "type": "notification", "conditions": {"trial_days_remaining": "<3"}, "actions": {"send_reminder": true}},
      {"name": "Usage Analytics", "type": "validation", "conditions": {"state": "monitoring"}, "actions": {"collect_analytics": true}}
    ]
  }',
  (SELECT id FROM users WHERE email = 'admin@oms.com' LIMIT 1)
)
ON CONFLICT DO NOTHING;
