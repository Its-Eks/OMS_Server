-- Dashboard performance indexes

-- Orders: active counts and recents
CREATE INDEX IF NOT EXISTS idx_orders_state_created ON orders(current_state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);

-- Escalations: open list oldest first
CREATE INDEX IF NOT EXISTS idx_escalations_status_created ON escalations(status, created_at ASC);

-- Customers: trial counts
CREATE INDEX IF NOT EXISTS idx_customers_is_trial ON customers(is_trial);


