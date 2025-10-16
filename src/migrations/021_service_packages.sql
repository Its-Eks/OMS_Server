-- Create service packages table for trial conversions
CREATE TABLE IF NOT EXISTS service_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  speed VARCHAR(50) NOT NULL,
  price_cents INTEGER NOT NULL,
  installation_fee_cents INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default South African ISP packages
INSERT INTO service_packages (name, speed, price_cents, installation_fee_cents) VALUES
-- Fiber Packages (Uncapped, Best-Effort)
('Fiber Basic', '20/10 Mbps', 39900, 0),
('Fiber Standard', '50/50 Mbps', 59900, 0),
('Fiber Premium', '100/50 Mbps', 74900, 99900),
('Fiber Pro', '200/100 Mbps', 99900, 119900),
('Fiber Business', '500/250 Mbps', 129900, 149900),
('Fiber Enterprise', '1000/500 Mbps', 159900, 169900),

-- Fixed Wireless (LTE/5G, Fair-Use 1-2TB)
('Wireless Basic', '25/5 Mbps', 29900, 69900),
('Wireless Standard', '50/10 Mbps', 44900, 89900),
('Wireless Premium', '100/20 Mbps', 69900, 109900)

ON CONFLICT (name) DO NOTHING;

-- Create index for active packages
CREATE INDEX IF NOT EXISTS idx_service_packages_active ON service_packages(is_active) WHERE is_active = true;

-- Add trigger for updated_at
CREATE OR REPLACE FUNCTION update_service_packages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Ensure idempotency for repeated runs
DROP TRIGGER IF EXISTS trigger_update_service_packages_updated_at ON service_packages;
CREATE TRIGGER trigger_update_service_packages_updated_at
  BEFORE UPDATE ON service_packages
  FOR EACH ROW
  EXECUTE FUNCTION update_service_packages_updated_at();
