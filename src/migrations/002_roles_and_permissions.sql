-- Roles and permissions setup
-- Ensure required extension for UUID generation
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    CREATE EXTENSION pgcrypto;
  END IF;
END$$;

-- Create roles table if it does not exist
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ensure audit columns exist if table predated this migration
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'roles' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE roles ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'roles' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE roles ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
  END IF;
END$$;

-- Add role_id to users if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'role_id'
  ) THEN
    ALTER TABLE users ADD COLUMN role_id UUID NULL REFERENCES roles(id);
  END IF;
END$$;

-- Upsert base roles and permissions
WITH base_roles(name, description, permissions) AS (
  VALUES
    (
      'Super Administrator',
      'Full access to all system features',
      to_json(ARRAY[
        'orders:create','orders:read','orders:update','orders:delete','orders:assign','orders:escalate',
        'customers:create','customers:read','customers:update','customers:delete',
        'fno:configure','fno:submit_api','fno:submit_manual','fno:view_logs',
        'app_admin:view_inbox','app_admin:process_applications','app_admin:assign_applications',
        'escalations:view','escalations:resolve','escalations:escalate',
        'onboarding:initiate','onboarding:manage','onboarding:view_trials','onboarding:manage_campaigns',
        'admin:manage_users','admin:manage_roles','admin:system_config','admin:view_audit_logs','admin:system_monitoring'
      ]::text[])::jsonb
    ),
    (
      'System Administrator',
      'Manage users, roles and system configuration',
      to_json(ARRAY[
        'admin:manage_users','admin:manage_roles','admin:system_config','admin:view_audit_logs','admin:system_monitoring',
        'orders:read','customers:read'
      ]::text[])::jsonb
    ),
    (
      'Operations Manager',
      'Manage orders and escalations with FNO visibility',
      to_json(ARRAY[
        'orders:create','orders:read','orders:update','orders:delete','orders:assign','orders:escalate',
        'escalations:view','escalations:resolve','customers:read','fno:view_logs'
      ]::text[])::jsonb
    ),
    (
      'Application Administrator',
      'Handle manual FNO applications',
      to_json(ARRAY[
        'app_admin:view_inbox','app_admin:process_applications','app_admin:assign_applications',
        'orders:read','orders:update','fno:submit_manual'
      ]::text[])::jsonb
    ),
    (
      'Customer Success Manager',
      'Manage onboarding and trials',
      to_json(ARRAY[
        'onboarding:initiate','onboarding:manage','onboarding:view_trials','onboarding:manage_campaigns',
        'customers:read','customers:update','orders:read'
      ]::text[])::jsonb
    ),
    (
      'Sales Representative',
      'Create and manage customer orders',
      to_json(ARRAY[
        'orders:create','orders:read','orders:update',
        'customers:create','customers:read','customers:update'
      ]::text[])::jsonb
    )
)
INSERT INTO roles (name, description, permissions)
SELECT br.name, br.description, br.permissions
FROM base_roles br
ON CONFLICT (name) DO UPDATE
SET description = EXCLUDED.description,
    permissions = EXCLUDED.permissions,
    updated_at = CURRENT_TIMESTAMP;

-- Ensure existing users have a default role if none set
DO $$
DECLARE
  default_role_id UUID;
BEGIN
  SELECT id INTO default_role_id FROM roles WHERE name = 'Sales Representative' LIMIT 1;
  IF default_role_id IS NOT NULL THEN
    UPDATE users SET role_id = COALESCE(role_id, default_role_id);
  END IF;
END$$;


