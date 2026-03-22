import { useState } from 'react';
import { useImpersonationStore } from '@/stores/impersonation';

export function ImpersonationControlPanel() {
  const {
    isActive,
    selectedRoleIds,
    allRoles,
    serverPermissions,
    isLoading,
    hasAdministrator,
    toggleRole,
    fetchPreview,
    deactivate,
  } = useImpersonationStore();

  const [showAddDropdown, setShowAddDropdown] = useState(false);
  const [showPermissions, setShowPermissions] = useState(false);

  if (!isActive) return null;

  // Find @everyone role (always included, non-removable)
  const everyoneRole = allRoles.find((r) => r.name === '@everyone');
  const selectedRoles = selectedRoleIds
    .map((id) => allRoles.find((r) => r.id === id))
    .filter(Boolean) as typeof allRoles;

  const availableRoles = allRoles
    .filter((r) => r.name !== '@everyone' && !selectedRoleIds.includes(r.id))
    .sort((a, b) => b.position - a.position);

  // Key permissions to show in the summary
  const permissionLabels: { key: string; label: string }[] = [
    { key: 'administrator', label: 'Administrator' },
    { key: 'manage_server', label: 'Manage Server' },
    { key: 'manage_channels', label: 'Manage Channels' },
    { key: 'manage_roles', label: 'Manage Roles' },
    { key: 'kick_members', label: 'Kick' },
    { key: 'ban_members', label: 'Ban' },
    { key: 'timeout_members', label: 'Timeout' },
    { key: 'send_messages', label: 'Send Messages' },
    { key: 'add_reactions', label: 'Reactions' },
    { key: 'attach_files', label: 'Attach Files' },
    { key: 'manage_messages', label: 'Manage Messages' },
    { key: 'connect', label: 'Voice Connect' },
    { key: 'speak', label: 'Speak' },
    { key: 'video', label: 'Video' },
    { key: 'stream', label: 'Stream' },
    { key: 'mute_members', label: 'Mute Members' },
    { key: 'deafen_members', label: 'Deafen Members' },
    { key: 'move_members', label: 'Move Members' },
  ];

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 max-w-[90vw]">
      <div className="bg-bg-secondary border border-border rounded-xl shadow-2xl px-4 py-3">
        {/* Main controls row */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-text-secondary text-sm font-medium whitespace-nowrap">Viewing as:</span>

          {/* @everyone chip (always shown, non-removable) */}
          {everyoneRole && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-bg-tertiary text-text-primary text-xs font-medium">
              <span className="w-2.5 h-2.5 rounded-full bg-gray-500 flex-shrink-0" />
              @everyone
            </span>
          )}

          {/* Selected role chips */}
          {selectedRoles.map((role) => (
            <span
              key={role.id}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-bg-tertiary text-text-primary text-xs font-medium group"
            >
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: role.color || '#99aab5' }}
              />
              {role.name}
              <button
                onClick={() => toggleRole(role.id)}
                className="ml-0.5 text-text-tertiary hover:text-red-400 transition-colors"
                title={`Remove ${role.name}`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}

          {/* Add Role dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowAddDropdown(!showAddDropdown)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-bg-tertiary text-text-secondary text-xs font-medium hover:bg-bg-modifier-hover hover:text-text-primary transition-colors"
              disabled={availableRoles.length === 0}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Role
            </button>

            {showAddDropdown && availableRoles.length > 0 && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowAddDropdown(false)} />
                <div className="absolute bottom-full left-0 mb-2 w-48 max-h-48 overflow-y-auto rounded-lg bg-bg-floating border border-border shadow-xl z-20">
                  {availableRoles.map((role) => (
                    <button
                      key={role.id}
                      onClick={() => {
                        toggleRole(role.id);
                        setShowAddDropdown(false);
                      }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-primary hover:bg-bg-modifier-hover transition-colors"
                    >
                      <span
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: role.color || '#99aab5' }}
                      />
                      {role.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Divider */}
          <div className="w-px h-6 bg-border" />

          {/* Loading indicator */}
          {isLoading && (
            <div className="w-4 h-4 border-2 border-text-tertiary border-t-text-primary rounded-full animate-spin" />
          )}

          {/* Show Permissions toggle */}
          <button
            onClick={() => setShowPermissions(!showPermissions)}
            className="px-2.5 py-1 rounded text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-modifier-hover transition-colors"
          >
            {showPermissions ? 'Hide' : 'Show'} Permissions
          </button>

          {/* Refresh button */}
          <button
            onClick={() => fetchPreview()}
            disabled={isLoading}
            className="px-2.5 py-1 rounded text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-modifier-hover transition-colors disabled:opacity-50"
            title="Refresh preview"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>

          {/* Exit button */}
          <button
            onClick={deactivate}
            className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 text-xs font-semibold hover:bg-red-500/30 transition-colors"
          >
            Exit Impersonation
          </button>
        </div>

        {/* Permissions summary (expandable) */}
        {showPermissions && serverPermissions && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="flex flex-wrap gap-1.5">
              {permissionLabels.map(({ key, label }) => {
                const granted = hasAdministrator || serverPermissions[key] === true;
                return (
                  <span
                    key={key}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                      granted
                        ? 'bg-green-500/15 text-green-400'
                        : 'bg-red-500/10 text-red-400/70'
                    }`}
                  >
                    {granted ? (
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    ) : (
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                    {label}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
