-- Create system user for automated actions
-- This user represents system-generated actions (not actual human users)

INSERT INTO users (
  id,
  email,
  password_hash,
  first_name,
  last_name,
  phone,
  role_id,
  is_active,
  email_verified,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'system@oms.internal',
  '$2b$10$dummy.hash.for.system.user.never.used.for.auth',
  'System',
  'User',
  '+0000000000',
  (SELECT id FROM roles WHERE name = 'System Administrator' LIMIT 1),
  true,
  true,
  NOW(),
  NOW()
) ON CONFLICT (id) DO NOTHING;

-- Add comment to identify this as a system user
COMMENT ON TABLE users IS 'Users table - includes system user (00000000-0000-0000-0000-000000000000) for automated actions';
