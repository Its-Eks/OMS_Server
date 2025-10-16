-- Fix workflow system actions by allowing NULL for executed_by
-- This allows system actions to be recorded without requiring a fake user

-- First, drop the existing constraint
ALTER TABLE workflow_execution_history
DROP CONSTRAINT IF EXISTS workflow_execution_history_executed_by_fkey;

-- Modify the column to allow NULL
ALTER TABLE workflow_execution_history
ALTER COLUMN executed_by DROP NOT NULL;

-- Add a new constraint that allows NULL but validates non-NULL values
ALTER TABLE workflow_execution_history
ADD CONSTRAINT workflow_execution_history_executed_by_fkey
FOREIGN KEY (executed_by) REFERENCES users(id) ON DELETE SET NULL;

-- Add a comment explaining the NULL usage
COMMENT ON COLUMN workflow_execution_history.executed_by IS 'User who executed the transition (NULL for system actions)';

-- Fix order_state_history as well
ALTER TABLE order_state_history
DROP CONSTRAINT IF EXISTS order_state_history_changed_by_fkey;

ALTER TABLE order_state_history
ALTER COLUMN changed_by DROP NOT NULL;

ALTER TABLE order_state_history
ADD CONSTRAINT order_state_history_changed_by_fkey
FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN order_state_history.changed_by IS 'User who made the change (NULL for system actions)';
