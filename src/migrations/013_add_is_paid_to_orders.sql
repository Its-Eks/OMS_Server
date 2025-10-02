-- Add isPaid column to orders table
-- This migration adds the isPaid column to track payment status

-- Add isPaid column if it doesn't exist
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_paid BOOLEAN DEFAULT false;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_orders_is_paid ON orders(is_paid);

-- Update existing orders to have the correct isPaid status based on payment_links
-- This is a one-time update for existing data
UPDATE orders 
SET is_paid = true 
WHERE id IN (
  SELECT DISTINCT pl.order_id 
  FROM payment_links pl 
  WHERE pl.status = 'paid' OR pl.status = 'completed'
);
