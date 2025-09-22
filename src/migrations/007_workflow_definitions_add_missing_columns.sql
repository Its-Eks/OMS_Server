-- Ensure workflow_definitions has required columns used by the service

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='workflow_definitions' AND column_name='version') THEN
    ALTER TABLE workflow_definitions ADD COLUMN version INTEGER DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='workflow_definitions' AND column_name='is_active') THEN
    ALTER TABLE workflow_definitions ADD COLUMN is_active BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='workflow_definitions' AND column_name='definition') THEN
    ALTER TABLE workflow_definitions ADD COLUMN definition JSONB NOT NULL DEFAULT '{}'::jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='workflow_definitions' AND column_name='created_by') THEN
    ALTER TABLE workflow_definitions ADD COLUMN created_by UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='workflow_definitions' AND column_name='created_at') THEN
    ALTER TABLE workflow_definitions ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='workflow_definitions' AND column_name='updated_at') THEN
    ALTER TABLE workflow_definitions ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
  END IF;
END$$;

-- Helpful indexes (no-op if they exist)
CREATE INDEX IF NOT EXISTS idx_workflow_definitions_order_type ON workflow_definitions(order_type);
CREATE INDEX IF NOT EXISTS idx_workflow_definitions_active ON workflow_definitions(is_active);


