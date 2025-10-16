-- Create order_email_log table for tracking email notifications
CREATE TABLE IF NOT EXISTS order_email_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    email_type VARCHAR(100) NOT NULL,
    recipient_email VARCHAR(255) NOT NULL,
    subject TEXT NOT NULL,
    template_key VARCHAR(255),
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    status VARCHAR(50) DEFAULT 'sent',
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_order_email_log_order_id ON order_email_log(order_id);
CREATE INDEX IF NOT EXISTS idx_order_email_log_sent_at ON order_email_log(sent_at);
CREATE INDEX IF NOT EXISTS idx_order_email_log_email_type ON order_email_log(email_type);

-- Add comment
COMMENT ON TABLE order_email_log IS 'Logs all email notifications sent for orders';
COMMENT ON COLUMN order_email_log.email_type IS 'Type of email sent (e.g., order_created, status_change, etc.)';
COMMENT ON COLUMN order_email_log.template_key IS 'Template used for the email';
COMMENT ON COLUMN order_email_log.status IS 'Email status (sent, failed, pending)';
