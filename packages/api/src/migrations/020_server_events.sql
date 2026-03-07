-- Migration 020: Server Events
-- Adds tables for server events with RSVP, visibility controls, and announcement tracking

-- Server Events
CREATE TABLE IF NOT EXISTS server_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),
  title VARCHAR(150) NOT NULL,
  description TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  announce_at_start BOOLEAN DEFAULT true,
  announcement_channel_id UUID REFERENCES channels(id) ON DELETE SET NULL,
  visibility VARCHAR(10) NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  status VARCHAR(15) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
  cancelled_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS idx_server_events_server_time ON server_events(server_id, start_time);
CREATE INDEX IF NOT EXISTS idx_server_events_server_status ON server_events(server_id, status, deleted_at);

-- Private event role visibility mapping
CREATE TABLE IF NOT EXISTS server_event_roles (
  event_id UUID NOT NULL REFERENCES server_events(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, role_id)
);

-- Event RSVPs
CREATE TABLE IF NOT EXISTS server_event_rsvps (
  event_id UUID NOT NULL REFERENCES server_events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL CHECK (status IN ('interested', 'tentative', 'not_interested')),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_server_event_rsvps_status ON server_event_rsvps(event_id, status);

-- Announcement idempotency tracking
CREATE TABLE IF NOT EXISTS server_event_announcements (
  event_id UUID UNIQUE NOT NULL REFERENCES server_events(id) ON DELETE CASCADE,
  announced_at TIMESTAMPTZ DEFAULT NOW(),
  result VARCHAR(10) NOT NULL CHECK (result IN ('success', 'failed')),
  error_message TEXT
);

-- Record migration
INSERT INTO _migrations (name) VALUES ('020_server_events') ON CONFLICT (name) DO NOTHING;
