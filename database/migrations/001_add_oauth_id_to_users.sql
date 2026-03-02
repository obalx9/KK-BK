-- Add oauth_id column to users table for OAuth authentication

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'oauth_id'
  ) THEN
    ALTER TABLE users ADD COLUMN oauth_id text;
  END IF;
END $$;
