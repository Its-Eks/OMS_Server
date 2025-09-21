-- Add snapshot fields to customer_onboarding to guarantee email personalization

ALTER TABLE customer_onboarding
  ADD COLUMN IF NOT EXISTS customer_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS customer_first_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS customer_last_name VARCHAR(120);

-- Best-effort backfill from customers table where possible
UPDATE customer_onboarding co
SET 
  customer_email = COALESCE(co.customer_email, c.email),
  customer_first_name = COALESCE(co.customer_first_name, c.first_name),
  customer_last_name = COALESCE(co.customer_last_name, c.last_name)
FROM customers c
WHERE c.id = co.customer_id;


