-- Complete ISP Order Management System Database Schema - Missing Tables Only
-- Based on Technical Specification Document
-- This migration only adds tables that don't already exist

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- MISSING COLUMNS FOR EXISTING TABLES
-- =============================================

-- Add missing columns to existing orders table
DO $$
BEGIN
  -- Add order_type if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' AND column_name = 'order_type'
  ) THEN
    ALTER TABLE orders ADD COLUMN order_type VARCHAR(50) DEFAULT 'new_install';
  END IF;
  
  -- Add service_details if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' AND column_name = 'service_details'
  ) THEN
    ALTER TABLE orders ADD COLUMN service_details JSONB;
  END IF;
  
  -- Add status column if missing (some tables have current_state, others have status)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' AND column_name = 'status'
  ) THEN
    ALTER TABLE orders ADD COLUMN status VARCHAR(50) DEFAULT 'created';
  END IF;
END $$;

-- Add missing columns to existing trial_customers table (only if table exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'trial_customers'
  ) THEN
    -- Add first_name and last_name if missing
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'trial_customers' AND column_name = 'first_name'
    ) THEN
      ALTER TABLE trial_customers ADD COLUMN first_name VARCHAR(100);
    END IF;
    
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'trial_customers' AND column_name = 'last_name'
    ) THEN
      ALTER TABLE trial_customers ADD COLUMN last_name VARCHAR(100);
    END IF;
    
    -- Add address if missing
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'trial_customers' AND column_name = 'address'
    ) THEN
      ALTER TABLE trial_customers ADD COLUMN address JSONB;
    END IF;
    
    -- Add metadata if missing
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'trial_customers' AND column_name = 'metadata'
    ) THEN
      ALTER TABLE trial_customers ADD COLUMN metadata JSONB;
    END IF;
  END IF;
END $$;

-- =============================================
-- PAYMENT INTEGRATION (MISSING TABLES ONLY)
-- =============================================

-- Payment Links (for MicroServices-OMS integration)
CREATE TABLE IF NOT EXISTS payment_links (
    id VARCHAR(255) PRIMARY KEY,
    order_id UUID NOT NULL,
    customer_id UUID NOT NULL,
    peach_checkout_id VARCHAR(255),
    stripe_payment_link_id VARCHAR(255),
    url TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    currency VARCHAR(3) DEFAULT 'ZAR',
    status VARCHAR(50) DEFAULT 'pending', -- pending, paid, expired, cancelled, failed
    expires_at TIMESTAMP NOT NULL,
    paid_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Payment Notifications
CREATE TABLE IF NOT EXISTS payment_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_link_id VARCHAR(255) REFERENCES payment_links(id),
    order_id UUID REFERENCES orders(id),
    customer_id UUID REFERENCES customers(id),
    notification_type VARCHAR(50) NOT NULL, -- payment_request, payment_confirmation, payment_reminder
    email_sent BOOLEAN DEFAULT false,
    sms_sent BOOLEAN DEFAULT false,
    sent_at TIMESTAMP,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Payment Webhook Events
CREATE TABLE IF NOT EXISTS payment_webhook_events (
    id SERIAL PRIMARY KEY,
    peach_checkout_id VARCHAR(255),
    stripe_event_id VARCHAR(255),
    event_type VARCHAR(100) NOT NULL,
    payment_link_id VARCHAR(255),
    order_id UUID,
    processed BOOLEAN DEFAULT FALSE,
    event_data JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP NULL
);

-- =============================================
-- PERFORMANCE INDEXES (MISSING ONLY)
-- =============================================

-- Additional indexes for new columns and payment tables
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_assigned_to ON orders(assigned_to);
CREATE INDEX IF NOT EXISTS idx_orders_fno_id ON orders(fno_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_type ON orders(order_type);

-- Create trial_customers indexes only if table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'trial_customers'
  ) THEN
    PERFORM 1;
    -- These CREATE INDEX statements will still fail if run without the table,
    -- so we guard them in this block
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_trial_customers_order_id ON trial_customers(order_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_trial_customers_first_name ON trial_customers(first_name)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_trial_customers_last_name ON trial_customers(last_name)';
  END IF;
END $$;

-- Payment table indexes
CREATE INDEX IF NOT EXISTS idx_payment_links_order_id ON payment_links(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_links_customer_id ON payment_links(customer_id);
CREATE INDEX IF NOT EXISTS idx_payment_links_status ON payment_links(status);
CREATE INDEX IF NOT EXISTS idx_payment_links_expires_at ON payment_links(expires_at);
CREATE INDEX IF NOT EXISTS idx_payment_links_peach_checkout_id ON payment_links(peach_checkout_id);
CREATE INDEX IF NOT EXISTS idx_payment_links_stripe_payment_link_id ON payment_links(stripe_payment_link_id);

CREATE INDEX IF NOT EXISTS idx_payment_notifications_payment_link_id ON payment_notifications(payment_link_id);
CREATE INDEX IF NOT EXISTS idx_payment_notifications_order_id ON payment_notifications(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_notifications_customer_id ON payment_notifications(customer_id);
CREATE INDEX IF NOT EXISTS idx_payment_notifications_notification_type ON payment_notifications(notification_type);

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_peach_checkout_id ON payment_webhook_events(peach_checkout_id);
CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_stripe_event_id ON payment_webhook_events(stripe_event_id);
CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_order_id ON payment_webhook_events(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_processed ON payment_webhook_events(processed);
CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_event_type ON payment_webhook_events(event_type);

-- =============================================
-- TRIGGERS FOR UPDATED_AT (NEW TABLES ONLY)
-- =============================================

-- Function to update updated_at timestamp (reuse existing if available)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers to new payment tables
DROP TRIGGER IF EXISTS update_payment_links_updated_at ON payment_links;
CREATE TRIGGER update_payment_links_updated_at BEFORE UPDATE ON payment_links FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- DEFAULT DATA INSERTION (MISSING ONLY)
-- =============================================

-- Insert additional system configuration for payment integration
INSERT INTO system_config (config_key, config_value, description) VALUES
('payment.peach_payments_enabled', '"true"', 'Enable Peach Payments integration'),
('payment.stripe_enabled', '"true"', 'Enable Stripe integration'),
('payment.default_currency', '"ZAR"', 'Default payment currency'),
('payment.link_expiry_hours', '72', 'Payment link expiry in hours'),
('payment.webhook_retry_attempts', '3', 'Number of webhook retry attempts'),
('payment.conversion_email_template', '"conversion_confirmation"', 'Email template for trial conversions'),
('payment.payment_request_template', '"payment_request"', 'Email template for payment requests')
ON CONFLICT (config_key) DO NOTHING;

-- =============================================
-- COMMENTS FOR DOCUMENTATION
-- =============================================

COMMENT ON TABLE payment_links IS 'Payment processing integration with Peach Payments/Stripe for trial conversions';
COMMENT ON TABLE payment_notifications IS 'Payment notification tracking for email/SMS delivery';
COMMENT ON TABLE payment_webhook_events IS 'Payment webhook event logging from external payment providers';

-- =============================================
-- COMPLETION MESSAGE
-- =============================================

DO $$
BEGIN
    RAISE NOTICE '✅ ISP Order Management System - Missing Tables Migration Completed!';
    RAISE NOTICE '📊 New tables added: payment_links, payment_notifications, payment_webhook_events';
    RAISE NOTICE '🔧 Missing columns added to existing tables: orders (order_type, service_details, status), trial_customers (first_name, last_name, address, metadata)';
    RAISE NOTICE '🔍 Performance indexes created for new tables and columns';
    RAISE NOTICE '⚡ Updated_at triggers configured for new payment tables';
    RAISE NOTICE '📝 Additional system configuration added for payment integration';
    RAISE NOTICE '🎯 Database schema now complete and ready for trial customer payment conversion testing!';
END $$;
