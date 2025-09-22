-- Add order_type column to orders table
-- This migration adds the order_type column that was missing from the orders table

-- Add order_type column if it doesn't exist
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_type VARCHAR(50) DEFAULT 'new_install';

-- Add service_details column if it doesn't exist (for storing service details as JSON)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS service_details JSONB;

-- Update existing orders to have the correct order_type
UPDATE orders SET order_type = 'new_install' WHERE order_type IS NULL;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_orders_order_type ON orders(order_type);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
