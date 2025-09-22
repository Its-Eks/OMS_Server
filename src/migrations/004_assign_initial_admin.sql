-- Assign System Administrator role to a specific bootstrap user
-- Safe to re-run: only updates if both user and role exist

DO $$
DECLARE
  v_role_id UUID;
  v_user_id UUID;
BEGIN
  -- Find System Administrator role id
  SELECT id INTO v_role_id FROM roles WHERE name = 'System Administrator' LIMIT 1;

  -- Find user by email
  SELECT id INTO v_user_id FROM users WHERE LOWER(email) = LOWER('xnxiweni@xnext.co.za') LIMIT 1;

  IF v_role_id IS NOT NULL AND v_user_id IS NOT NULL THEN
    UPDATE users
    SET role_id = v_role_id,
        is_active = true,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = v_user_id;
  END IF;
END$$;


