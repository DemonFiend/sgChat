-- Migration 032: Role Band System
-- Assigns unique positions to all roles within defined bands.
-- Must be run BEFORE deploying the new API code that adds the UNIQUE constraint.
--
-- Band Layout:
--   999       Owner (reserved)
--   900-998   Admin
--   800-899   Moderator
--   600-799   Member
--   276-599   Free/Custom
--   226-275   Color Roles
--   201-225   Server Access
--   176-200   Notification Roles
--   151-175   Platform Roles
--   126-150   Personality Roles
--   101-125   Pronoun Roles
--   51-100    Region Roles
--   1-50      @everyone

BEGIN;

-- ============================================================
-- 1. Remap core roles by name
-- ============================================================
UPDATE roles SET position = 1   WHERE name = '@everyone';
UPDATE roles SET position = 900 WHERE name = 'Admin';
UPDATE roles SET position = 800 WHERE name = 'Moderator';
UPDATE roles SET position = 600 WHERE name = 'Member';

-- ============================================================
-- 2. Remap reaction roles using group name to determine band
-- ============================================================

-- Color Roles → band 226+
UPDATE roles r SET position = 226 + sub.rn - 1
FROM (
  SELECT rrm.role_id, ROW_NUMBER() OVER (PARTITION BY rrg.server_id ORDER BY rrm.position) as rn
  FROM role_reaction_mappings rrm
  JOIN role_reaction_groups rrg ON rrg.id = rrm.group_id
  WHERE rrg.name = 'Color Roles'
) sub
WHERE r.id = sub.role_id;

-- Pronoun Roles → band 101+
UPDATE roles r SET position = 101 + sub.rn - 1
FROM (
  SELECT rrm.role_id, ROW_NUMBER() OVER (PARTITION BY rrg.server_id ORDER BY rrm.position) as rn
  FROM role_reaction_mappings rrm
  JOIN role_reaction_groups rrg ON rrg.id = rrm.group_id
  WHERE rrg.name = 'Pronoun Roles'
) sub
WHERE r.id = sub.role_id;

-- Notification Roles → band 176+
UPDATE roles r SET position = 176 + sub.rn - 1
FROM (
  SELECT rrm.role_id, ROW_NUMBER() OVER (PARTITION BY rrg.server_id ORDER BY rrm.position) as rn
  FROM role_reaction_mappings rrm
  JOIN role_reaction_groups rrg ON rrg.id = rrm.group_id
  WHERE rrg.name = 'Notification Roles'
) sub
WHERE r.id = sub.role_id;

-- Region Roles → band 51+
UPDATE roles r SET position = 51 + sub.rn - 1
FROM (
  SELECT rrm.role_id, ROW_NUMBER() OVER (PARTITION BY rrg.server_id ORDER BY rrm.position) as rn
  FROM role_reaction_mappings rrm
  JOIN role_reaction_groups rrg ON rrg.id = rrm.group_id
  WHERE rrg.name = 'Region Roles'
) sub
WHERE r.id = sub.role_id;

-- Platform Roles → band 151+
UPDATE roles r SET position = 151 + sub.rn - 1
FROM (
  SELECT rrm.role_id, ROW_NUMBER() OVER (PARTITION BY rrg.server_id ORDER BY rrm.position) as rn
  FROM role_reaction_mappings rrm
  JOIN role_reaction_groups rrg ON rrg.id = rrm.group_id
  WHERE rrg.name = 'Platform Roles'
) sub
WHERE r.id = sub.role_id;

-- Server Access Roles → band 201+
UPDATE roles r SET position = 201 + sub.rn - 1
FROM (
  SELECT rrm.role_id, ROW_NUMBER() OVER (PARTITION BY rrg.server_id ORDER BY rrm.position) as rn
  FROM role_reaction_mappings rrm
  JOIN role_reaction_groups rrg ON rrg.id = rrm.group_id
  WHERE rrg.name = 'Server Access Roles'
) sub
WHERE r.id = sub.role_id;

-- Personality Roles → band 126+
UPDATE roles r SET position = 126 + sub.rn - 1
FROM (
  SELECT rrm.role_id, ROW_NUMBER() OVER (PARTITION BY rrg.server_id ORDER BY rrm.position) as rn
  FROM role_reaction_mappings rrm
  JOIN role_reaction_groups rrg ON rrg.id = rrm.group_id
  WHERE rrg.name = 'Personality Roles'
) sub
WHERE r.id = sub.role_id;

-- ============================================================
-- 3. Remap any remaining custom roles into FREE band (276+)
-- These are roles not named @everyone/Member/Moderator/Admin
-- AND not in any role_reaction_mappings
-- ============================================================
WITH custom_roles AS (
  SELECT r.id, r.server_id,
    ROW_NUMBER() OVER (PARTITION BY r.server_id ORDER BY r.position, r.created_at) as rn
  FROM roles r
  WHERE r.name NOT IN ('@everyone', 'Member', 'Moderator', 'Admin')
    AND r.id NOT IN (SELECT role_id FROM role_reaction_mappings)
)
UPDATE roles SET position = 276 + cr.rn - 1
FROM custom_roles cr
WHERE roles.id = cr.id;

-- ============================================================
-- 4. Add constraints
-- ============================================================

-- Add CHECK constraint for valid range
ALTER TABLE roles ADD CONSTRAINT roles_position_range CHECK (position >= 1 AND position <= 999);

-- Add UNIQUE constraint (will fail if any duplicates remain)
ALTER TABLE roles ADD CONSTRAINT roles_server_position_unique UNIQUE (server_id, position);

-- Update SQL functions to use position 1 as minimum
CREATE OR REPLACE FUNCTION get_user_highest_role_position(p_user_id UUID, p_server_id UUID)
RETURNS INTEGER AS $$
DECLARE
  max_position INTEGER;
BEGIN
  SELECT COALESCE(MAX(r.position), 1) INTO max_position
  FROM roles r
  INNER JOIN member_roles mr ON r.id = mr.role_id
  WHERE mr.member_user_id = p_user_id
    AND mr.member_server_id = p_server_id;

  RETURN max_position;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION can_manage_role(p_user_id UUID, p_server_id UUID, p_role_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  user_position INTEGER;
  target_position INTEGER;
  is_owner BOOLEAN;
BEGIN
  SELECT (owner_id = p_user_id) INTO is_owner FROM servers WHERE id = p_server_id;
  IF is_owner THEN
    RETURN TRUE;
  END IF;

  user_position := get_user_highest_role_position(p_user_id, p_server_id);
  SELECT position INTO target_position FROM roles WHERE id = p_role_id;

  RETURN user_position > COALESCE(target_position, 1);
END;
$$ LANGUAGE plpgsql;

COMMIT;
