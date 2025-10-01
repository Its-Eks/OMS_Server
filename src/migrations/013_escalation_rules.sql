-- Escalation rules and SLA configuration per PRD
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    CREATE EXTENSION pgcrypto;
  END IF;
END$$;

-- Escalation rules
CREATE TABLE IF NOT EXISTS escalation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  order_type VARCHAR(50),
  fno_id UUID REFERENCES fnos(id),
  task_type VARCHAR(50),
  priority VARCHAR(20),
  time_threshold_hours INTEGER NOT NULL, -- when to escalate
  reescalate_after_hours INTEGER,        -- optional re-escalation
  max_levels INTEGER DEFAULT 2,          -- hierarchical depth
  target_role VARCHAR(100),              -- e.g., 'Operations Manager'
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_escalation_rules_active ON escalation_rules(is_active);
CREATE INDEX IF NOT EXISTS idx_escalation_rules_order_type ON escalation_rules(order_type);
CREATE INDEX IF NOT EXISTS idx_escalation_rules_fno_id ON escalation_rules(fno_id);

-- SLA policy per task/order type (optional granular)
CREATE TABLE IF NOT EXISTS sla_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_type VARCHAR(50) NOT NULL,
  task_type VARCHAR(50),
  priority VARCHAR(20),
  sla_hours INTEGER NOT NULL,
  warn_threshold_pct NUMERIC(5,2) DEFAULT 0.75,   -- send warning before breach
  reescalate_threshold_pct NUMERIC(5,2) DEFAULT 1.50,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_sla_policies_key ON sla_policies(order_type, COALESCE(task_type, 'any'), COALESCE(priority, 'any'));

-- Track automated escalations to avoid duplicates
CREATE TABLE IF NOT EXISTS automated_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) NOT NULL,
  rule_id UUID REFERENCES escalation_rules(id),
  level INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Use generated uuid_nil() when available; fallback to text compare to avoid ::uuid syntax issues
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'uuid_nil') THEN
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS ux_auto_escalations ON automated_escalations(order_id, COALESCE(rule_id, uuid_nil()), level)';
  ELSE
    -- Less strict uniqueness without cast if uuid_nil not available
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS ux_auto_escalations ON automated_escalations(order_id, level)';
  END IF;
END$$;


