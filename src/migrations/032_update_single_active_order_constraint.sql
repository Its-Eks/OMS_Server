-- Update the single active order constraint to include trial-specific statuses
-- This allows customers with cancelled or expired trial orders to create new orders

-- Drop the existing constraint
DROP INDEX IF EXISTS ux_orders_single_active_per_customer;

-- Recreate with updated status list
CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_single_active_per_customer
ON orders (customer_id)
WHERE status NOT IN ('completed','cancelled','trial_cancelled','trial_expired');
