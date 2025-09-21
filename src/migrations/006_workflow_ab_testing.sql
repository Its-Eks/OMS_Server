-- Workflow A/B testing and metrics tables

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    CREATE EXTENSION pgcrypto;
  END IF;
END$$;

-- A/B tests definition
CREATE TABLE IF NOT EXISTS workflow_ab_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  description TEXT,
  order_type VARCHAR(50) NOT NULL,
  control_workflow_id UUID NOT NULL,
  variant_workflow_id UUID NOT NULL,
  traffic_split NUMERIC(4,3) NOT NULL DEFAULT 0.500, -- 0.000 - 1.000
  start_date TIMESTAMP NOT NULL DEFAULT NOW(),
  end_date TIMESTAMP,
  status VARCHAR(20) NOT NULL DEFAULT 'active', -- active | paused | completed | cancelled
  success_metrics JSONB NOT NULL DEFAULT '{}',
  results JSONB,
  created_by UUID,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ab_tests_order_type ON workflow_ab_tests(order_type);
CREATE INDEX IF NOT EXISTS idx_ab_tests_status ON workflow_ab_tests(status);
CREATE INDEX IF NOT EXISTS idx_ab_tests_created_at ON workflow_ab_tests(created_at);

-- A/B test assignments per order
CREATE TABLE IF NOT EXISTS workflow_ab_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES workflow_ab_tests(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  assigned_workflow_id UUID NOT NULL,
  assignment_reason VARCHAR(20) NOT NULL, -- control | variant | random | manual
  assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(test_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_ab_assignments_test ON workflow_ab_assignments(test_id);
CREATE INDEX IF NOT EXISTS idx_ab_assignments_order ON workflow_ab_assignments(order_id);

-- Workflow metrics per order
CREATE TABLE IF NOT EXISTS workflow_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  metric_name VARCHAR(100) NOT NULL,
  metric_value NUMERIC,
  metric_unit VARCHAR(20),
  context JSONB,
  recorded_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_metrics_order ON workflow_metrics(order_id);
CREATE INDEX IF NOT EXISTS idx_workflow_metrics_name ON workflow_metrics(metric_name);


