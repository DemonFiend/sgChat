import { authStore, type UserPermissions } from './auth';

/**
 * Permission checking utilities for sgChat.
 * Uses named boolean permissions (not bitmasks).
 */

/**
 * Get the current user's permissions
 */
export function getPermissions(): UserPermissions | null {
  const user = authStore.state().user;
  return user?.permissions ?? null;
}

/**
 * Check if current user has a specific permission
 */
export function hasPermission(permission: keyof UserPermissions): boolean {
  const perms = getPermissions();
  if (!perms) return false;
  return perms[permission] === true;
}

/**
 * Check if current user is an administrator
 */
export function isAdmin(): boolean {
  return hasPermission('administrator');
}

/**
 * Check if current user is the server owner
 */
export function isOwner(serverOwnerId: string | null | undefined): boolean {
  const user = authStore.state().user;
  if (!user || !serverOwnerId) return false;
  return user.id === serverOwnerId;
}

/**
 * Check if current user has admin-level access (admin or owner)
 */
export function hasAdminAccess(serverOwnerId: string | null | undefined): boolean {
  return isAdmin() || isOwner(serverOwnerId);
}

/**
 * Check if current user can manage server settings
 */
export function canManageServer(serverOwnerId: string | null | undefined): boolean {
  return hasAdminAccess(serverOwnerId) || hasPermission('manage_server');
}

/**
 * Check if current user can manage channels
 */
export function canManageChannels(): boolean {
  return isAdmin() || hasPermission('manage_channels');
}

/**
 * Check if current user can manage roles
 */
export function canManageRoles(): boolean {
  return isAdmin() || hasPermission('manage_roles');
}

/**
 * Check if current user can kick members
 */
export function canKickMembers(): boolean {
  return isAdmin() || hasPermission('kick_members');
}

/**
 * Check if current user can ban members
 */
export function canBanMembers(): boolean {
  return isAdmin() || hasPermission('ban_members');
}

/**
 * Check if current user can view audit log
 */
export function canViewAuditLog(): boolean {
  return isAdmin() || hasPermission('view_audit_log');
}

/**
 * Check if current user can create invites
 */
export function canCreateInvites(): boolean {
  return isAdmin() || hasPermission('create_invites');
}

/**
 * Check if current user can manage messages (delete others' messages)
 */
export function canManageMessages(): boolean {
  return isAdmin() || hasPermission('manage_messages');
}

/**
 * Check if current user can manage nicknames
 */
export function canManageNicknames(): boolean {
  return isAdmin() || hasPermission('manage_nicknames');
}

/**
 * Check if current user can send messages
 */
export function canSendMessages(): boolean {
  return hasPermission('send_messages');
}

/**
 * Check if current user can attach files
 */
export function canAttachFiles(): boolean {
  return hasPermission('attach_files');
}

/**
 * Check if current user can add reactions
 */
export function canAddReactions(): boolean {
  return hasPermission('add_reactions');
}

/**
 * Permission gate helper - returns true if user has ANY of the given permissions
 */
export function hasAnyPermission(permissions: (keyof UserPermissions)[]): boolean {
  return permissions.some(p => hasPermission(p));
}

/**
 * Permission gate helper - returns true if user has ALL of the given permissions
 */
export function hasAllPermissions(permissions: (keyof UserPermissions)[]): boolean {
  return permissions.every(p => hasPermission(p));
}
