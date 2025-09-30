-- Default SLA policies and escalation rules for OMS
-- This ensures the escalation system has baseline data to work with

-- Insert default SLA policies for common order types
INSERT INTO sla_policies (order_type, task_type, priority, sla_hours, warn_threshold_pct, reescalate_threshold_pct, is_active) VALUES
('new_install', NULL, 'normal', 48, 0.75, 1.50, true),
('new_install', NULL, 'high', 24, 0.75, 1.50, true),
('new_install', NULL, 'urgent', 12, 0.75, 1.50, true),
('service_change', NULL, 'normal', 24, 0.75, 1.50, true),
('service_change', NULL, 'high', 12, 0.75, 1.50, true),
('service_change', NULL, 'urgent', 6, 0.75, 1.50, true),
('troubleshooting', NULL, 'normal', 4, 0.75, 1.50, true),
('troubleshooting', NULL, 'high', 2, 0.75, 1.50, true),
('troubleshooting', NULL, 'urgent', 1, 0.75, 1.50, true)
ON CONFLICT (order_type, COALESCE(task_type, 'any'), COALESCE(priority, 'any')) DO NOTHING;

-- Insert default escalation rules
INSERT INTO escalation_rules (name, order_type, task_type, priority, time_threshold_hours, reescalate_after_hours, max_levels, target_role, is_active) VALUES
('Standard New Install Escalation', 'new_install', NULL, 'normal', 48, 72, 3, 'Operations Manager', true),
('High Priority New Install Escalation', 'new_install', NULL, 'high', 24, 36, 3, 'Operations Manager', true),
('Urgent New Install Escalation', 'new_install', NULL, 'urgent', 12, 18, 3, 'Operations Manager', true),
('Service Change Escalation', 'service_change', NULL, 'normal', 24, 36, 3, 'Operations Manager', true),
('High Priority Service Change Escalation', 'service_change', NULL, 'high', 12, 18, 3, 'Operations Manager', true),
('Urgent Service Change Escalation', 'service_change', NULL, 'urgent', 6, 9, 3, 'Operations Manager', true),
('Troubleshooting Escalation', 'troubleshooting', NULL, 'normal', 4, 6, 3, 'Technical Manager', true),
('High Priority Troubleshooting Escalation', 'troubleshooting', NULL, 'high', 2, 3, 3, 'Technical Manager', true),
('Urgent Troubleshooting Escalation', 'troubleshooting', NULL, 'urgent', 1, 1.5, 3, 'Technical Manager', true)
ON CONFLICT DO NOTHING;

-- Create automated_escalations table if it doesn't exist (completing the migration)
CREATE TABLE IF NOT EXISTS automated_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) NOT NULL,
  rule_id UUID REFERENCES escalation_rules(id),
  level INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(order_id, level)
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_automated_escalations_order_id ON automated_escalations(order_id);
CREATE INDEX IF NOT EXISTS idx_automated_escalations_rule_id ON automated_escalations(rule_id);
CREATE INDEX IF NOT EXISTS idx_automated_escalations_level ON automated_escalations(level);

-- Add escalation status tracking
ALTER TABLE escalations ADD COLUMN IF NOT EXISTS escalation_type VARCHAR(20) DEFAULT 'manual';
ALTER TABLE escalations ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id);
ALTER TABLE escalations ADD COLUMN IF NOT EXISTS due_date TIMESTAMP;
ALTER TABLE escalations ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'normal';

-- Add indexes for escalation queries
CREATE INDEX IF NOT EXISTS idx_escalations_status ON escalations(status);
CREATE INDEX IF NOT EXISTS idx_escalations_order_id ON escalations(order_id);
CREATE INDEX IF NOT EXISTS idx_escalations_escalated_to ON escalations(escalated_to);
CREATE INDEX IF NOT EXISTS idx_escalations_created_at ON escalations(created_at);
CREATE INDEX IF NOT EXISTS idx_escalations_escalation_level ON escalations(escalation_level);
