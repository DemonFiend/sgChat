-- Add 'missed_call' to notifications type CHECK constraint
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'mention', 'reaction', 'role_change', 'invite',
  'announcement', 'friend_request', 'friend_accept',
  'dm_message', 'system', 'event_start', 'missed_call'
));
