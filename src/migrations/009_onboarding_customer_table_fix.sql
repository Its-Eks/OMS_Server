-- Ensure customer_onboarding has required columns used by controllers

-- Some environments may have an older schema missing these columns
-- Make this idempotent and non-breaking

ALTER TABLE IF EXISTS customer_onboarding
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS completion_percentage INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_step VARCHAR(100) DEFAULT 'initiated',
  ADD COLUMN IF NOT EXISTS notes TEXT;


