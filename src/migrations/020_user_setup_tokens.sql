-- Create user_setup_tokens table for non-expiring onboarding tokens
CREATE TABLE IF NOT EXISTS user_setup_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(64) UNIQUE NOT NULL,
    email_verified BOOLEAN DEFAULT false,
    password_set BOOLEAN DEFAULT false,
    completed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP NULL,
    ip_address INET,
    user_agent TEXT
);

-- Add unique constraint on user_id (one active setup token per user)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'unique_user_setup_token' 
        AND table_name = 'user_setup_tokens'
    ) THEN
        ALTER TABLE user_setup_tokens ADD CONSTRAINT unique_user_setup_token UNIQUE (user_id);
    END IF;
END $$;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_setup_tokens_token ON user_setup_tokens(token);
CREATE INDEX IF NOT EXISTS idx_user_setup_tokens_completed ON user_setup_tokens(completed_at) WHERE completed_at IS NULL;

-- Add setup_completed flag to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS setup_completed BOOLEAN DEFAULT false;
