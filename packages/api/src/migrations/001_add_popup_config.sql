-- Migration: Add popup_config to servers table
-- Date: 2026-02-16
-- Description: Adds JSONB column for storing server popup configuration

-- Add popup_config column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'servers' AND column_name = 'popup_config'
  ) THEN
    ALTER TABLE servers 
    ADD COLUMN popup_config JSONB DEFAULT jsonb_build_object(
      'timeFormat', '24h',
      'events', '[]'::jsonb
    );
    
    RAISE NOTICE 'Added popup_config column to servers table';
  ELSE
    RAISE NOTICE 'popup_config column already exists';
  END IF;
END $$;

-- Create index on popup_config for faster queries (optional, useful if querying config fields)
CREATE INDEX IF NOT EXISTS idx_servers_popup_config ON servers USING GIN (popup_config);
