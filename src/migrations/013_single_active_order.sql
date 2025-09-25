-- Ensure only one active order per customer
-- Active means status not in ('completed','cancelled')

CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_single_active_per_customer
ON orders (customer_id)
WHERE status NOT IN ('completed','cancelled');


