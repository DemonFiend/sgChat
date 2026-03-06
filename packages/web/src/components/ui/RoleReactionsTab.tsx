import { useState, useEffect, useCallback } from 'react';
import { api } from '@/api';
import type { RoleReactionGroup, RoleReactionMapping } from '@sgchat/shared';

interface Channel {
  id: string;
  name: string;
  type: string;
}

interface RoleOption {
  id: string;
  name: string;
  color: string | null;
  position: number;
}

interface Props {
  serverId: string;
  channels: Channel[];
}

export function RoleReactionsTab({ serverId, channels }: Props) {
  const [groups, setGroups] = useState<RoleReactionGroup[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Setup state
  const [setupChannelId, setSetupChannelId] = useState<string>('');
  const [isSettingUp, setIsSettingUp] = useState(false);

  // New group form
  const [showNewGroupForm, setShowNewGroupForm] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupChannelId, setNewGroupChannelId] = useState('');

  // New mapping form
  const [newMappingEmoji, setNewMappingEmoji] = useState('');
  const [newMappingRoleId, setNewMappingRoleId] = useState('');
  const [newMappingLabel, setNewMappingLabel] = useState('');

  // Edit state
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editChannelId, setEditChannelId] = useState('');
  const [editRemoveRolesOnDisable, setEditRemoveRolesOnDisable] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Confirmation modals
  const [showDisableConfirm, setShowDisableConfirm] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showFormatConfirm, setShowFormatConfirm] = useState(false);
  const [formatPreview, setFormatPreview] = useState<{
    messages_to_delete: number;
    groups_to_repost: number;
    channel_name: string;
  } | null>(null);
  const [formatChannelId, setFormatChannelId] = useState('');

  const textChannels = channels.filter(c => c.type === 'text');
  const selectedGroup = groups.find(g => g.id === selectedGroupId) || null;

  const fetchData = useCallback(async () => {
    if (!serverId) return;
    setIsLoading(true);
    setError(null);
    try {
      const [groupsRes, rolesRes] = await Promise.all([
        api.get<{ groups: RoleReactionGroup[] }>(`/servers/${serverId}/role-reactions`),
        api.get<RoleOption[]>('/roles'),
      ]);
      setGroups(groupsRes.groups);
      setRoles(rolesRes);

      // Default setup channel to #roles if it exists
      const rolesChannel = textChannels.find(c => c.name === 'roles');
      if (rolesChannel && !setupChannelId) {
        setSetupChannelId(rolesChannel.id);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load role reactions');
    } finally {
      setIsLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Update edit state when selected group changes
  useEffect(() => {
    if (selectedGroup) {
      setEditName(selectedGroup.name);
      setEditDescription(selectedGroup.description || '');
      setEditChannelId(selectedGroup.channel_id);
      setEditRemoveRolesOnDisable(selectedGroup.remove_roles_on_disable);
      setHasUnsavedChanges(false);
    }
  }, [selectedGroupId]);

  const handleSetup = async () => {
    if (!setupChannelId) return;
    setIsSettingUp(true);
    setError(null);
    try {
      await api.post(`/servers/${serverId}/role-reactions/setup`, {
        channel_id: setupChannelId,
      });
      await fetchData();
    } catch (err: any) {
      setError(err.message || 'Failed to set up role reactions');
    } finally {
      setIsSettingUp(false);
    }
  };

  const handleToggleGroup = async (groupId: string, enabled: boolean) => {
    if (!enabled) {
      setShowDisableConfirm(groupId);
      return;
    }
    try {
      await api.patch(`/servers/${serverId}/role-reactions/groups/${groupId}/toggle`, {
        enabled: true,
      });
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const confirmDisable = async (removeRoles: boolean) => {
    if (!showDisableConfirm) return;
    try {
      await api.patch(
        `/servers/${serverId}/role-reactions/groups/${showDisableConfirm}/toggle`,
        { enabled: false, remove_roles: removeRoles }
      );
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setShowDisableConfirm(null);
    }
  };

  const handleDeleteGroup = async () => {
    if (!showDeleteConfirm) return;
    try {
      await api.delete(`/servers/${serverId}/role-reactions/groups/${showDeleteConfirm}?remove_roles=true`);
      if (selectedGroupId === showDeleteConfirm) setSelectedGroupId(null);
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setShowDeleteConfirm(null);
    }
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim() || !newGroupChannelId) return;
    try {
      await api.post(`/servers/${serverId}/role-reactions/groups`, {
        name: newGroupName.trim(),
        channel_id: newGroupChannelId,
      });
      setNewGroupName('');
      setShowNewGroupForm(false);
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSaveGroup = async () => {
    if (!selectedGroup) return;
    setIsSaving(true);
    try {
      await api.patch(`/servers/${serverId}/role-reactions/groups/${selectedGroup.id}`, {
        name: editName.trim(),
        description: editDescription.trim() || null,
        channel_id: editChannelId,
        remove_roles_on_disable: editRemoveRolesOnDisable,
      });
      setHasUnsavedChanges(false);
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddMapping = async () => {
    if (!selectedGroup || !newMappingEmoji || !newMappingRoleId) return;
    try {
      await api.post(
        `/servers/${serverId}/role-reactions/groups/${selectedGroup.id}/mappings`,
        {
          emoji: newMappingEmoji,
          role_id: newMappingRoleId,
          label: newMappingLabel.trim() || null,
        }
      );
      setNewMappingEmoji('');
      setNewMappingRoleId('');
      setNewMappingLabel('');
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteMapping = async (mappingId: string) => {
    if (!selectedGroup) return;
    try {
      await api.delete(
        `/servers/${serverId}/role-reactions/groups/${selectedGroup.id}/mappings/${mappingId}`
      );
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleFormatChannel = async () => {
    if (!formatChannelId) return;

    if (!showFormatConfirm) {
      // First click: fetch preview
      try {
        const preview = await api.get<{
          messages_to_delete: number;
          groups_to_repost: number;
          channel_name: string;
        }>(`/servers/${serverId}/role-reactions/format-channel/preview?channel_id=${formatChannelId}`);
        setFormatPreview(preview);
        setShowFormatConfirm(true);
      } catch (err: any) {
        setError(err.message);
      }
      return;
    }

    // Confirmed: do the format
    try {
      await api.post(`/servers/${serverId}/role-reactions/format-channel`, {
        channel_id: formatChannelId,
      });
      setShowFormatConfirm(false);
      setFormatPreview(null);
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-brand-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Setup view (no groups yet)
  if (groups.length === 0) {
    return (
      <div>
        <h2 className="text-xl font-bold text-text-primary mb-2">Role Reactions</h2>
        <p className="text-sm text-text-secondary mb-6">
          Allow members to self-assign roles by reacting to messages with emojis.
          Setting up will create 7 default role groups with pre-configured roles and emojis
          in your selected channel.
        </p>

        {error && (
          <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 mb-4">
            <p className="text-sm text-danger">{error}</p>
          </div>
        )}

        <div className="bg-bg-secondary rounded-lg p-5 border border-border-subtle">
          <label className="text-xs font-semibold uppercase text-text-muted mb-1.5 tracking-wide block">
            Role Channel
          </label>
          <select
            value={setupChannelId}
            onChange={e => setSetupChannelId(e.target.value)}
            className="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary mb-4"
          >
            <option value="">Select a channel...</option>
            {textChannels.map(c => (
              <option key={c.id} value={c.id}>#{c.name}</option>
            ))}
          </select>

          <p className="text-xs text-text-muted mb-4">
            Tip: Use a read-only channel (like #roles) for the best experience.
            Members won't be able to send messages, only react.
          </p>

          <div className="mb-4">
            <h4 className="text-sm font-semibold text-text-primary mb-2">Default groups that will be created:</h4>
            <div className="space-y-1 text-sm text-text-secondary">
              <p>1. Color Roles — Choose a name color (8 colors)</p>
              <p>2. Pronoun Roles — Set your pronouns (5 options)</p>
              <p>3. Notification Roles — Subscribe to pings (5 types)</p>
              <p>4. Region Roles — Show your region (23 regions)</p>
              <p>5. Platform Roles — Show your platform (6 platforms)</p>
              <p>6. Server Access Roles — Unlock content (2 roles)</p>
              <p>7. Personality Roles — Show your vibe (5 roles)</p>
            </div>
          </div>

          <button
            onClick={handleSetup}
            disabled={!setupChannelId || isSettingUp}
            className="px-4 py-2 bg-brand-primary text-white rounded hover:bg-brand-primary/80 disabled:opacity-50 transition-colors"
          >
            {isSettingUp ? 'Setting up...' : 'Set Up Role Reactions'}
          </button>
        </div>
      </div>
    );
  }

  // Main view with groups
  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold text-text-primary">Role Reactions</h2>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 mb-4">
          <p className="text-sm text-danger">{error}</p>
          <button onClick={() => setError(null)} className="text-xs text-danger/70 underline mt-1">
            Dismiss
          </button>
        </div>
      )}

      <div className="flex gap-4">
        {/* Left panel: group list */}
        <div className="w-60 flex-shrink-0">
          <div className="bg-bg-secondary rounded-lg border border-border-subtle overflow-hidden">
            <div className="p-3 border-b border-border-subtle">
              <span className="text-xs font-semibold uppercase text-text-muted tracking-wide">
                Groups ({groups.length})
              </span>
            </div>
            <div className="max-h-[400px] overflow-y-auto">
              {groups.map(group => (
                <button
                  key={group.id}
                  onClick={() => setSelectedGroupId(group.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-bg-tertiary transition-colors ${
                    selectedGroupId === group.id ? 'bg-bg-tertiary' : ''
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    group.enabled ? 'bg-green-500' : 'bg-text-muted'
                  }`} />
                  <span className="text-sm text-text-primary truncate flex-1">{group.name}</span>
                  <span className="text-xs text-text-muted">{group.mappings.length}</span>
                </button>
              ))}
            </div>
            <div className="p-2 border-t border-border-subtle">
              {showNewGroupForm ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={newGroupName}
                    onChange={e => setNewGroupName(e.target.value)}
                    placeholder="Group name..."
                    className="w-full px-2 py-1.5 bg-bg-tertiary border border-border-subtle rounded text-sm text-text-primary focus:outline-none focus:border-brand-primary"
                  />
                  <select
                    value={newGroupChannelId}
                    onChange={e => setNewGroupChannelId(e.target.value)}
                    className="w-full px-2 py-1.5 bg-bg-tertiary border border-border-subtle rounded text-sm text-text-primary focus:outline-none focus:border-brand-primary"
                  >
                    <option value="">Channel...</option>
                    {textChannels.map(c => (
                      <option key={c.id} value={c.id}>#{c.name}</option>
                    ))}
                  </select>
                  <div className="flex gap-1">
                    <button
                      onClick={handleCreateGroup}
                      disabled={!newGroupName.trim() || !newGroupChannelId}
                      className="flex-1 px-2 py-1 bg-brand-primary text-white text-xs rounded disabled:opacity-50"
                    >
                      Create
                    </button>
                    <button
                      onClick={() => { setShowNewGroupForm(false); setNewGroupName(''); }}
                      className="px-2 py-1 bg-bg-tertiary text-text-secondary text-xs rounded"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowNewGroupForm(true)}
                  className="w-full px-2 py-1.5 text-sm text-brand-primary hover:bg-bg-tertiary rounded transition-colors"
                >
                  + Add Group
                </button>
              )}
            </div>
          </div>

          {/* Format Channel section */}
          <div className="mt-3 bg-bg-secondary rounded-lg border border-border-subtle p-3">
            <label className="text-xs font-semibold uppercase text-text-muted tracking-wide block mb-2">
              Format Channel
            </label>
            <select
              value={formatChannelId}
              onChange={e => { setFormatChannelId(e.target.value); setShowFormatConfirm(false); }}
              className="w-full px-2 py-1.5 bg-bg-tertiary border border-border-subtle rounded text-sm text-text-primary focus:outline-none focus:border-brand-primary mb-2"
            >
              <option value="">Select channel...</option>
              {textChannels.map(c => (
                <option key={c.id} value={c.id}>#{c.name}</option>
              ))}
            </select>
            <button
              onClick={handleFormatChannel}
              disabled={!formatChannelId}
              className="w-full px-2 py-1.5 bg-yellow-600/20 text-yellow-400 text-xs rounded hover:bg-yellow-600/30 disabled:opacity-50 transition-colors"
            >
              Format Channel
            </button>
            <p className="text-xs text-text-muted mt-1">
              Deletes all messages and reposts role groups in order.
            </p>
          </div>
        </div>

        {/* Right panel: group editor */}
        <div className="flex-1 min-w-0">
          {selectedGroup ? (
            <div className="space-y-4">
              {/* Group settings */}
              <div className="bg-bg-secondary rounded-lg p-5 border border-border-subtle">
                <h3 className="text-lg font-semibold text-text-primary mb-4">
                  {selectedGroup.name}
                </h3>

                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-semibold uppercase text-text-muted mb-1.5 tracking-wide block">
                      Group Name
                    </label>
                    <input
                      type="text"
                      value={editName}
                      onChange={e => { setEditName(e.target.value); setHasUnsavedChanges(true); }}
                      className="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold uppercase text-text-muted mb-1.5 tracking-wide block">
                      Description
                    </label>
                    <textarea
                      value={editDescription}
                      onChange={e => { setEditDescription(e.target.value); setHasUnsavedChanges(true); }}
                      placeholder="Shown in the role reaction message..."
                      rows={2}
                      className="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary resize-none"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold uppercase text-text-muted mb-1.5 tracking-wide block">
                      Channel
                    </label>
                    <select
                      value={editChannelId}
                      onChange={e => { setEditChannelId(e.target.value); setHasUnsavedChanges(true); }}
                      className="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary"
                    >
                      {textChannels.map(c => (
                        <option key={c.id} value={c.id}>#{c.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm text-text-primary">Enabled</span>
                      <p className="text-xs text-text-muted">
                        Disabling removes the message from the channel
                      </p>
                    </div>
                    <button
                      onClick={() => handleToggleGroup(selectedGroup.id, !selectedGroup.enabled)}
                      className={`relative w-11 h-6 rounded-full transition-colors ${
                        selectedGroup.enabled ? 'bg-brand-primary' : 'bg-bg-tertiary'
                      }`}
                    >
                      <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                        selectedGroup.enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
                      }`} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm text-text-primary">Remove roles when disabled</span>
                      <p className="text-xs text-text-muted">
                        Strip assigned roles from all members when this group is disabled
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setEditRemoveRolesOnDisable(!editRemoveRolesOnDisable);
                        setHasUnsavedChanges(true);
                      }}
                      className={`relative w-11 h-6 rounded-full transition-colors ${
                        editRemoveRolesOnDisable ? 'bg-brand-primary' : 'bg-bg-tertiary'
                      }`}
                    >
                      <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                        editRemoveRolesOnDisable ? 'translate-x-[22px]' : 'translate-x-0.5'
                      }`} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Mappings */}
              <div className="bg-bg-secondary rounded-lg p-5 border border-border-subtle">
                <h4 className="text-sm font-semibold uppercase text-text-muted mb-3 tracking-wide">
                  Emoji Mappings ({selectedGroup.mappings.length})
                </h4>

                {selectedGroup.mappings.length > 0 && (
                  <div className="space-y-2 mb-4">
                    {selectedGroup.mappings.map((mapping: RoleReactionMapping) => (
                      <div
                        key={mapping.id}
                        className="flex items-center gap-3 px-3 py-2 bg-bg-tertiary rounded"
                      >
                        <span className="text-lg w-8 text-center">{mapping.emoji}</span>
                        <span className="text-sm text-text-muted">→</span>
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          {mapping.role_color && (
                            <span
                              className="w-3 h-3 rounded-full flex-shrink-0"
                              style={{ backgroundColor: mapping.role_color }}
                            />
                          )}
                          <span className="text-sm text-text-primary truncate">
                            {mapping.label || mapping.role_name || 'Unknown'}
                          </span>
                        </div>
                        <button
                          onClick={() => handleDeleteMapping(mapping.id)}
                          className="text-text-muted hover:text-danger transition-colors p-1"
                          title="Remove mapping"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add mapping form */}
                <div className="flex items-end gap-2">
                  <div className="w-16">
                    <label className="text-xs text-text-muted block mb-1">Emoji</label>
                    <input
                      type="text"
                      value={newMappingEmoji}
                      onChange={e => setNewMappingEmoji(e.target.value)}
                      placeholder="🎮"
                      maxLength={8}
                      className="w-full px-2 py-1.5 bg-bg-tertiary border border-border-subtle rounded text-center text-lg focus:outline-none focus:border-brand-primary"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <label className="text-xs text-text-muted block mb-1">Role</label>
                    <select
                      value={newMappingRoleId}
                      onChange={e => setNewMappingRoleId(e.target.value)}
                      className="w-full px-2 py-1.5 bg-bg-tertiary border border-border-subtle rounded text-sm text-text-primary focus:outline-none focus:border-brand-primary"
                    >
                      <option value="">Select role...</option>
                      {roles
                        .filter(r => r.name !== '@everyone')
                        .sort((a, b) => b.position - a.position)
                        .map(r => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="w-28">
                    <label className="text-xs text-text-muted block mb-1">Label</label>
                    <input
                      type="text"
                      value={newMappingLabel}
                      onChange={e => setNewMappingLabel(e.target.value)}
                      placeholder="Optional"
                      className="w-full px-2 py-1.5 bg-bg-tertiary border border-border-subtle rounded text-sm text-text-primary focus:outline-none focus:border-brand-primary"
                    />
                  </div>
                  <button
                    onClick={handleAddMapping}
                    disabled={!newMappingEmoji || !newMappingRoleId}
                    className="px-3 py-1.5 bg-brand-primary text-white text-sm rounded disabled:opacity-50 hover:bg-brand-primary/80 transition-colors"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Danger zone */}
              <div className="bg-bg-secondary rounded-lg p-5 border border-danger/30">
                <h4 className="text-sm font-semibold text-danger mb-2">Danger Zone</h4>
                <p className="text-xs text-text-muted mb-3">
                  Deleting this group will remove its message and all mappings. Roles assigned
                  through this group will also be removed from all members.
                </p>
                <button
                  onClick={() => setShowDeleteConfirm(selectedGroup.id)}
                  className="px-3 py-1.5 bg-danger/10 text-danger text-sm rounded hover:bg-danger/20 transition-colors"
                >
                  Delete Group
                </button>
              </div>

              {/* Save bar */}
              {hasUnsavedChanges && (
                <div className="sticky bottom-0 bg-bg-secondary border-t border-border-subtle p-3 flex items-center justify-between rounded-lg">
                  <p className="text-sm text-text-secondary">You have unsaved changes</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        if (selectedGroup) {
                          setEditName(selectedGroup.name);
                          setEditDescription(selectedGroup.description || '');
                          setEditChannelId(selectedGroup.channel_id);
                          setEditRemoveRolesOnDisable(selectedGroup.remove_roles_on_disable);
                          setHasUnsavedChanges(false);
                        }
                      }}
                      className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
                    >
                      Reset
                    </button>
                    <button
                      onClick={handleSaveGroup}
                      disabled={isSaving}
                      className="px-4 py-1.5 bg-brand-primary text-white text-sm rounded hover:bg-brand-primary/80 disabled:opacity-50 transition-colors"
                    >
                      {isSaving ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-64 text-text-muted text-sm">
              Select a group from the list to edit it
            </div>
          )}
        </div>
      </div>

      {/* Disable confirmation modal */}
      {showDisableConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-bg-secondary rounded-lg p-6 max-w-md w-full mx-4 border border-border-subtle">
            <h3 className="text-lg font-semibold text-text-primary mb-2">Disable Group</h3>
            <p className="text-sm text-text-secondary mb-4">
              This will delete the role reaction message from the channel.
              {groups.find(g => g.id === showDisableConfirm)?.remove_roles_on_disable && (
                <span className="text-yellow-400 block mt-1">
                  Warning: All roles assigned through this group will be removed from members.
                </span>
              )}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowDisableConfirm(null)}
                className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => confirmDisable(
                  groups.find(g => g.id === showDisableConfirm)?.remove_roles_on_disable ?? true
                )}
                className="px-3 py-1.5 bg-yellow-600 text-white text-sm rounded hover:bg-yellow-700 transition-colors"
              >
                Disable
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-bg-secondary rounded-lg p-6 max-w-md w-full mx-4 border border-border-subtle">
            <h3 className="text-lg font-semibold text-text-primary mb-2">Delete Group</h3>
            <p className="text-sm text-text-secondary mb-4">
              This will permanently delete this role reaction group, its message, and remove
              all associated roles from members. This action cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteGroup}
                className="px-3 py-1.5 bg-danger text-white text-sm rounded hover:bg-danger/80 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Format channel confirmation modal */}
      {showFormatConfirm && formatPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-bg-secondary rounded-lg p-6 max-w-md w-full mx-4 border border-border-subtle">
            <h3 className="text-lg font-semibold text-text-primary mb-2">Format Channel</h3>
            <p className="text-sm text-text-secondary mb-2">
              This will delete <span className="text-text-primary font-semibold">
                {formatPreview.messages_to_delete} messages
              </span> from <span className="text-text-primary font-semibold">
                #{formatPreview.channel_name}
              </span> and repost {formatPreview.groups_to_repost} role reaction groups in order.
            </p>
            <p className="text-xs text-yellow-400 mb-4">
              Tip: Consider making role channels read-only for the best experience.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setShowFormatConfirm(false); setFormatPreview(null); }}
                className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleFormatChannel}
                className="px-3 py-1.5 bg-yellow-600 text-white text-sm rounded hover:bg-yellow-700 transition-colors"
              >
                Format
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
