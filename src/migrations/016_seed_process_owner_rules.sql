-- Seed default escalation rules including Process Owner final tier
DO $$
DECLARE
  om_rule UUID;
  po_rule UUID;
BEGIN
  -- Operations Manager rule for generic orders at 24h, up to 3 levels
  INSERT INTO escalation_rules (name, order_type, priority, time_threshold_hours, reescalate_after_hours, max_levels, target_role, is_active)
  VALUES ('Default OM Escalation', NULL, 'normal', 24, 24, 3, 'Operations Manager', true)
  ON CONFLICT DO NOTHING;

  -- Process Owner rule as final fallback at 48h
  INSERT INTO escalation_rules (name, order_type, priority, time_threshold_hours, reescalate_after_hours, max_levels, target_role, is_active)
  VALUES ('Default Process Owner Escalation', NULL, 'normal', 48, 24, 1, 'Process Owner', true)
  ON CONFLICT DO NOTHING;
END$$;


