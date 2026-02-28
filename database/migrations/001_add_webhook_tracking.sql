-- Add webhook tracking columns to telegram_bots table
-- This allows automatic webhook registration and status tracking

-- Add webhook_status column (pending, registered, failed)
ALTER TABLE telegram_bots
ADD COLUMN IF NOT EXISTS webhook_status TEXT DEFAULT 'pending';

-- Add timestamp when webhook was successfully registered
ALTER TABLE telegram_bots
ADD COLUMN IF NOT EXISTS webhook_registered_at TIMESTAMPTZ;

-- Add error message if webhook registration failed
ALTER TABLE telegram_bots
ADD COLUMN IF NOT EXISTS webhook_error TEXT;

-- Create index for querying bots by webhook status
CREATE INDEX IF NOT EXISTS idx_telegram_bots_webhook_status
ON telegram_bots(webhook_status);

-- Update existing bots to pending status
UPDATE telegram_bots
SET webhook_status = 'pending'
WHERE webhook_status IS NULL;
