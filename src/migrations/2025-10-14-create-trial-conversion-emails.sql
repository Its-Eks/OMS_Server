-- Create trial_conversion_emails table
CREATE TABLE IF NOT EXISTS trial_conversion_emails (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    customer_email VARCHAR(255) NOT NULL,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'sent',
    email_type VARCHAR(50) DEFAULT 'conversion_reminder',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_trial_conversion_emails_order_id ON trial_conversion_emails(order_id);
CREATE INDEX IF NOT EXISTS idx_trial_conversion_emails_sent_at ON trial_conversion_emails(sent_at);
CREATE INDEX IF NOT EXISTS idx_trial_conversion_emails_status ON trial_conversion_emails(status);

-- Add trial_start_date to orders table if it doesn't exist
ALTER TABLE orders ADD COLUMN IF NOT EXISTS trial_start_date TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS trial_end_date TIMESTAMP;

-- Update existing trial orders to have proper trial dates
UPDATE orders 
SET 
    trial_start_date = created_at,
    trial_end_date = created_at + INTERVAL '30 days'
WHERE 
    service_details->>'serviceType' = 'Trial' 
    AND trial_start_date IS NULL;
