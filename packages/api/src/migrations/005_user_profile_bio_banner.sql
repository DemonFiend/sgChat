-- Migration: Add bio and banner_url to users table
-- Run: docker exec -it sgchat-postgres-1 psql -U sgchat -d sgchat < migration.sql

ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT CHECK (length(bio) <= 500);
