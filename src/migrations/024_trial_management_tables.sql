-- Trial Management Tables Migration
-- Creates tables for trial customer tracking and campaign execution

-- Trial customers table
CREATE TABLE IF NOT EXISTS trial_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) NOT NULL UNIQUE,
  order_id UUID REFERENCES orders(id) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  trial_start_date TIMESTAMP NOT NULL,
  trial_end_date TIMESTAMP NOT NULL,
  days_remaining INTEGER NOT NULL DEFAULT 30,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  engagement_level VARCHAR(10) NOT NULL DEFAULT 'WARM',
  engagement_score INTEGER NOT NULL DEFAULT 50,
  last_login_date TIMESTAMP,
  total_data_usage_gb FLOAT NOT NULL DEFAULT 0,
  login_count INTEGER NOT NULL DEFAULT 0,
  converted_at TIMESTAMP,
  converted_plan_id VARCHAR(100),
  cancellation_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Campaign executions table
CREATE TABLE IF NOT EXISTS campaign_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trial_customer_id UUID REFERENCES trial_customers(id) ON DELETE CASCADE,
  campaign_day INTEGER NOT NULL,
  campaign_name VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  sent_at TIMESTAMP,
  channels TEXT[] NOT NULL,
  content JSONB NOT NULL,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_trial_customers_customer_id ON trial_customers(customer_id);
CREATE INDEX IF NOT EXISTS idx_trial_customers_status ON trial_customers(status);
CREATE INDEX IF NOT EXISTS idx_trial_customers_trial_end_date ON trial_customers(trial_end_date);
CREATE INDEX IF NOT EXISTS idx_trial_customers_engagement_level ON trial_customers(engagement_level);
CREATE INDEX IF NOT EXISTS idx_campaign_executions_trial_id ON campaign_executions(trial_customer_id);
CREATE INDEX IF NOT EXISTS idx_campaign_executions_campaign_day ON campaign_executions(campaign_day);
CREATE INDEX IF NOT EXISTS idx_campaign_executions_status ON campaign_executions(status);

-- Add comments for documentation
COMMENT ON TABLE trial_customers IS 'Tracks trial customer lifecycle and engagement metrics';
COMMENT ON TABLE campaign_executions IS 'Records automated campaign executions for trial customers';
COMMENT ON COLUMN trial_customers.status IS 'ACTIVE, EXPIRING, CONVERTED, EXPIRED, CANCELLED';
COMMENT ON COLUMN trial_customers.engagement_level IS 'HOT, WARM, COLD based on engagement score';
COMMENT ON COLUMN trial_customers.engagement_score IS '0-100 score based on usage, logins, and recency';
COMMENT ON COLUMN campaign_executions.campaign_day IS 'Day of trial when campaign was executed (7, 14, 21, 28)';
COMMENT ON COLUMN campaign_executions.status IS 'PENDING, SENT, FAILED, SKIPPED';

