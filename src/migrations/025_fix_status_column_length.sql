-- Fix status column length to accommodate trial state names
-- Trial states can be up to 30+ characters (e.g., 'trial_installation_pending')

DO $$
BEGIN
  -- Check if status column exists and has length limit
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' 
    AND column_name = 'status'
    AND character_maximum_length < 100
  ) THEN
    -- Alter the status column to allow longer values
    ALTER TABLE orders ALTER COLUMN status TYPE VARCHAR(100);
    RAISE NOTICE 'Updated orders.status column to VARCHAR(100)';
  ELSE
    RAISE NOTICE 'orders.status column already has sufficient length or does not exist';
  END IF;
END $$;

-- Also ensure current_state column has sufficient length
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' 
    AND column_name = 'current_state'
    AND character_maximum_length < 100
  ) THEN
    ALTER TABLE orders ALTER COLUMN current_state TYPE VARCHAR(100);
    RAISE NOTICE 'Updated orders.current_state column to VARCHAR(100)';
  ELSE
    RAISE NOTICE 'orders.current_state column already has sufficient length or does not exist';
  END IF;
END $$;

-- Update order_state_history columns as well
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'order_state_history' 
    AND column_name = 'from_state'
    AND character_maximum_length < 100
  ) THEN
    ALTER TABLE order_state_history ALTER COLUMN from_state TYPE VARCHAR(100);
    RAISE NOTICE 'Updated order_state_history.from_state column to VARCHAR(100)';
  END IF;
  
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'order_state_history' 
    AND column_name = 'to_state'
    AND character_maximum_length < 100
  ) THEN
    ALTER TABLE order_state_history ALTER COLUMN to_state TYPE VARCHAR(100);
    RAISE NOTICE 'Updated order_state_history.to_state column to VARCHAR(100)';
  END IF;
END $$;
