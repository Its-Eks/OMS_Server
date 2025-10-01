-- Adds business_impact to escalations and supporting index
ALTER TABLE escalations
  ADD COLUMN IF NOT EXISTS business_impact text;

-- Optional: quick index if filtering/grouping by impact becomes common
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_escalations_business_impact ON escalations((coalesce(business_impact, '')));
EXCEPTION WHEN OTHERS THEN
  -- ignore
END $$;


