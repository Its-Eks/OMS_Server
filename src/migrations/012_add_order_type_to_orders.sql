-- Migration 012: Add missing columns and indexes to orders table

-- Add order_type column if it doesn't exist
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS order_type VARCHAR(50) DEFAULT 'new_install';

-- Add service_details column if it doesn't exist (for storing service details as JSON)
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS service_details JSONB;

-- Add status column if it doesn't exist
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active';

-- Update existing orders to have default values if NULL
UPDATE orders
SET order_type = 'new_install'
WHERE order_type IS NULL;

UPDATE orders
SET status = 'active'
WHERE status IS NULL;

-- Add indexes safely
CREATE INDEX IF NOT EXISTS idx_orders_order_type ON orders(order_type);

-- Only create index on status if column exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name='orders' AND column_name='status'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
