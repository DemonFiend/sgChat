-- Make default roles mentionable so they can be @tagged in chat
UPDATE roles SET is_mentionable = true WHERE name IN ('Admin', 'Moderator', 'Member');
