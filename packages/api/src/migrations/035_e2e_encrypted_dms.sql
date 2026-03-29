-- Migration 035: E2E Encrypted DMs
-- Adds device key management tables and encrypted message support.
-- The server stores public keys and relays encrypted blobs — it never decrypts E2E content.

-- ============================================================
-- E2E Device Key Bundles (X3DH public keys per device)
-- ============================================================

CREATE TABLE IF NOT EXISTS e2e_device_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Device identification
  device_id TEXT NOT NULL CHECK (length(device_id) >= 1 AND length(device_id) <= 128),
  device_label TEXT CHECK (length(device_label) <= 64),

  -- X3DH key bundle (base64-encoded public keys)
  identity_key TEXT NOT NULL CHECK (length(identity_key) >= 40 AND length(identity_key) <= 200),
  signed_pre_key TEXT NOT NULL CHECK (length(signed_pre_key) >= 40 AND length(signed_pre_key) <= 200),
  signed_pre_key_signature TEXT NOT NULL CHECK (length(signed_pre_key_signature) >= 40 AND length(signed_pre_key_signature) <= 200),
  signed_pre_key_id INTEGER NOT NULL,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT e2e_device_keys_unique UNIQUE (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_e2e_device_keys_user ON e2e_device_keys(user_id);

-- ============================================================
-- E2E One-Time Pre-Keys (consumed on first message to a device)
-- ============================================================

CREATE TABLE IF NOT EXISTS e2e_one_time_pre_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_key_id UUID NOT NULL REFERENCES e2e_device_keys(id) ON DELETE CASCADE,
  key_id INTEGER NOT NULL,
  public_key TEXT NOT NULL CHECK (length(public_key) >= 40 AND length(public_key) <= 200),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT e2e_otpk_unique UNIQUE (device_key_id, key_id)
);

CREATE INDEX IF NOT EXISTS idx_e2e_otpk_device ON e2e_one_time_pre_keys(device_key_id);

-- ============================================================
-- Messages table changes for E2E encrypted content
-- ============================================================

-- Allow content to be NULL for encrypted messages
ALTER TABLE messages ALTER COLUMN content DROP NOT NULL;

-- Encrypted content blob (opaque ciphertext from client)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS encrypted_content TEXT;

-- Flag for server-side logic (skip search indexing, skip sanitization)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_encrypted BOOLEAN DEFAULT false;

-- Drop the old inline CHECK constraint on content.
-- PostgreSQL auto-names inline constraints, so we find it dynamically.
DO $$
DECLARE
  _conname text;
BEGIN
  -- Find CHECK constraints on messages that reference 'content' length (the old 2000-char limit)
  FOR _conname IN
    SELECT c.conname FROM pg_constraint c
    WHERE c.conrelid = 'messages'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%length(content)%'
      AND c.conname != 'message_content_check'
  LOOP
    EXECUTE format('ALTER TABLE messages DROP CONSTRAINT %I', _conname);
    RAISE NOTICE 'Dropped old constraint: %', _conname;
  END LOOP;
END $$;

-- Also drop the named versions in case this migration ran partially before
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_content_check;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS message_content_check;

-- New constraint: either plaintext or encrypted content, not both
ALTER TABLE messages ADD CONSTRAINT message_content_check CHECK (
  (is_encrypted = false AND content IS NOT NULL AND length(content) >= 1 AND length(content) <= 2000) OR
  (is_encrypted = true AND encrypted_content IS NOT NULL AND length(encrypted_content) >= 1 AND length(encrypted_content) <= 32000)
);

-- Update search vector trigger to skip encrypted messages
CREATE OR REPLACE FUNCTION messages_search_vector_update() RETURNS trigger AS $$
BEGIN
  IF NEW.is_encrypted = true THEN
    NEW.search_vector := NULL;
  ELSE
    NEW.search_vector := to_tsvector('english', coalesce(NEW.content, ''));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
