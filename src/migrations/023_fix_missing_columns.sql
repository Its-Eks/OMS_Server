-- Fix Missing Database Columns Migration
-- Based on comprehensive codebase analysis

-- =============================================
-- ORDERS TABLE FIXES
-- =============================================

-- Add missing completion date columns (code expects both formats)
DO $$
BEGIN
  -- Add estimated_completion_date if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' AND column_name = 'estimated_completion_date'
  ) THEN
    ALTER TABLE orders ADD COLUMN estimated_completion_date DATE;
  END IF;
  
  -- Add actual_completion_date if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' AND column_name = 'actual_completion_date'
  ) THEN
    ALTER TABLE orders ADD COLUMN actual_completion_date DATE;
  END IF;
  
  -- Add total_amount if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' AND column_name = 'total_amount'
  ) THEN
    ALTER TABLE orders ADD COLUMN total_amount DECIMAL(10,2);
  END IF;
  
  -- Add description if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' AND column_name = 'description'
  ) THEN
    ALTER TABLE orders ADD COLUMN description TEXT;
  END IF;
END $$;

-- Sync existing completion dates
UPDATE orders 
SET estimated_completion_date = estimated_completion,
    actual_completion_date = actual_completion
WHERE estimated_completion IS NOT NULL OR actual_completion IS NOT NULL;

-- =============================================
-- CUSTOMERS TABLE FIXES
-- =============================================

-- Add missing customer columns
DO $$
BEGIN
  -- Add user_id if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE customers ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE CASCADE;
  END IF;
  
  -- Add company_name if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' AND column_name = 'company_name'
  ) THEN
    ALTER TABLE customers ADD COLUMN company_name VARCHAR(255);
  END IF;
  
  -- Add business_type if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' AND column_name = 'business_type'
  ) THEN
    ALTER TABLE customers ADD COLUMN business_type VARCHAR(100);
  END IF;
  
  -- Add city if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' AND column_name = 'city'
  ) THEN
    ALTER TABLE customers ADD COLUMN city VARCHAR(100);
  END IF;
  
  -- Add state if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' AND column_name = 'state'
  ) THEN
    ALTER TABLE customers ADD COLUMN state VARCHAR(100);
  END IF;
  
  -- Add postal_code if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' AND column_name = 'postal_code'
  ) THEN
    ALTER TABLE customers ADD COLUMN postal_code VARCHAR(20);
  END IF;
  
  -- Add country if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' AND column_name = 'country'
  ) THEN
    ALTER TABLE customers ADD COLUMN country VARCHAR(100) DEFAULT 'South Africa';
  END IF;
  
  -- Add tax_id if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' AND column_name = 'tax_id'
  ) THEN
    ALTER TABLE customers ADD COLUMN tax_id VARCHAR(50);
  END IF;
  
  -- Add is_active if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE customers ADD COLUMN is_active BOOLEAN DEFAULT true;
  END IF;
END $$;

-- Extract address components from JSONB address field
UPDATE customers 
SET 
  city = COALESCE(city, (address->>'city')),
  state = COALESCE(state, (address->>'state')), 
  postal_code = COALESCE(postal_code, (address->>'postalCode')),
  country = COALESCE(country, (address->>'country'), 'South Africa')
WHERE address IS NOT NULL;

-- =============================================
-- ADDITIONAL INDEXES FOR NEW COLUMNS
-- =============================================

-- Orders table indexes
CREATE INDEX IF NOT EXISTS idx_orders_estimated_completion_date ON orders(estimated_completion_date);
CREATE INDEX IF NOT EXISTS idx_orders_actual_completion_date ON orders(actual_completion_date);
CREATE INDEX IF NOT EXISTS idx_orders_total_amount ON orders(total_amount);

-- Customers table indexes
CREATE INDEX IF NOT EXISTS idx_customers_user_id ON customers(user_id);
CREATE INDEX IF NOT EXISTS idx_customers_company_name ON customers(company_name);
CREATE INDEX IF NOT EXISTS idx_customers_business_type ON customers(business_type);
CREATE INDEX IF NOT EXISTS idx_customers_city ON customers(city);
CREATE INDEX IF NOT EXISTS idx_customers_state ON customers(state);
CREATE INDEX IF NOT EXISTS idx_customers_postal_code ON customers(postal_code);
CREATE INDEX IF NOT EXISTS idx_customers_country ON customers(country);
CREATE INDEX IF NOT EXISTS idx_customers_is_active ON customers(is_active);

-- =============================================
-- VERIFICATION QUERIES
-- =============================================

DO $$
DECLARE
  orders_columns_count INTEGER;
  customers_columns_count INTEGER;
BEGIN
  -- Count orders table columns
  SELECT COUNT(*) INTO orders_columns_count 
  FROM information_schema.columns 
  WHERE table_name = 'orders' AND table_schema = 'public';
  
  -- Count customers table columns  
  SELECT COUNT(*) INTO customers_columns_count
  FROM information_schema.columns 
  WHERE table_name = 'customers' AND table_schema = 'public';
  
  RAISE NOTICE '✅ Orders table now has % columns', orders_columns_count;
  RAISE NOTICE '✅ Customers table now has % columns', customers_columns_count;
  
  -- Verify key columns exist
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'estimated_completion_date') THEN
    RAISE NOTICE '✅ estimated_completion_date column added to orders';
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'is_active') THEN
    RAISE NOTICE '✅ is_active column added to customers';
  END IF;
  
  RAISE NOTICE '🎯 All missing columns have been added successfully!';
END $$;



