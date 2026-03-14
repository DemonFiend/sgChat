import { useState, useEffect, useCallback } from 'react';
import { api } from '@/api';
import type { RolePickerGroup, RolePickerMapping } from '@sgchat/shared';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  serverId: string;
}

export function RolePickerModal({ isOpen, onClose, serverId }: Props) {
  const [groups, setGroups] = useState<RolePickerGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingRoles, setTogglingRoles] = useState<Set<string>>(new Set());

  const fetchGroups = useCallback(async () => {
    if (!serverId) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get<{ groups: RolePickerGroup[] }>(
        `/servers/${serverId}/role-picker`,
      );
      setGroups(res.groups);
    } catch (err: any) {
      setError(err.message || 'Failed to load roles');
    } finally {
      setIsLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    if (isOpen) fetchGroups();
  }, [isOpen, fetchGroups]);

  const handleToggle = async (group: RolePickerGroup, mapping: RolePickerMapping) => {
    const key = `${group.id}:${mapping.role_id}`;
    if (togglingRoles.has(key)) return;

    // Optimistic update
    setGroups((prev) =>
      prev.map((g) => {
        if (g.id !== group.id) return g;
        return {
          ...g,
          mappings: g.mappings.map((m) => {
            if (m.role_id === mapping.role_id) {
              return { ...m, has_role: !m.has_role };
            }
            // For exclusive groups, deselect others when selecting
            if (g.exclusive && !mapping.has_role && m.has_role) {
              return { ...m, has_role: false };
            }
            return m;
          }),
        };
      }),
    );

    setTogglingRoles((prev) => new Set(prev).add(key));

    try {
      await api.post(`/servers/${serverId}/role-picker/toggle`, {
        group_id: group.id,
        role_id: mapping.role_id,
      });
    } catch (err: any) {
      // Revert on error
      setError(err.message || 'Failed to toggle role');
      await fetchGroups();
    } finally {
      setTogglingRoles((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-bg-primary rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col border border-border-subtle shadow-2xl mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <h2 className="text-lg font-bold text-text-primary">Choose Your Roles</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-bg-modifier-hover text-text-muted hover:text-text-primary transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-brand-primary border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {error && (
            <div className="bg-danger/10 border border-danger/30 rounded-lg p-3">
              <p className="text-sm text-danger">{error}</p>
              <button onClick={() => setError(null)} className="text-xs text-danger/70 underline mt-1">
                Dismiss
              </button>
            </div>
          )}

          {!isLoading && groups.length === 0 && !error && (
            <div className="text-center py-12 text-text-muted text-sm">
              No roles available to pick.
            </div>
          )}

          {groups.map((group) => (
            <div key={group.id} className="space-y-2.5">
              {/* Group header */}
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-text-primary">{group.name}</h3>
                {group.exclusive && (
                  <span className="px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider bg-brand-primary/20 text-brand-primary rounded">
                    Pick one
                  </span>
                )}
              </div>
              {group.description && (
                <p className="text-xs text-text-muted -mt-1">{group.description}</p>
              )}

              {/* Role pills */}
              <div className="flex flex-wrap gap-2">
                {group.mappings.map((mapping) => {
                  const isToggling = togglingRoles.has(`${group.id}:${mapping.role_id}`);
                  return (
                    <button
                      key={mapping.role_id}
                      onClick={() => handleToggle(group, mapping)}
                      disabled={isToggling}
                      className={`
                        inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm
                        border transition-all duration-150 select-none
                        ${mapping.has_role
                          ? 'border-brand-primary/60 bg-brand-primary/15 text-text-primary shadow-sm'
                          : 'border-border-subtle bg-bg-secondary text-text-secondary hover:bg-bg-tertiary hover:border-border-subtle/80'
                        }
                        ${isToggling ? 'opacity-60 cursor-wait' : 'cursor-pointer'}
                      `}
                    >
                      {/* Role color dot */}
                      {mapping.role_color && (
                        <span
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: mapping.role_color }}
                        />
                      )}

                      {/* Emoji (decorative) */}
                      {mapping.emoji && mapping.emoji_type === 'custom' && mapping.custom_emoji_url ? (
                        <img
                          src={mapping.custom_emoji_url}
                          alt=""
                          className="w-4 h-4 object-contain"
                        />
                      ) : mapping.emoji ? (
                        <span className="text-sm">{mapping.emoji}</span>
                      ) : null}

                      {/* Label */}
                      <span className="truncate max-w-[120px]">
                        {mapping.label || mapping.role_name}
                      </span>

                      {/* Checkmark */}
                      {mapping.has_role && (
                        <svg className="w-3.5 h-3.5 text-brand-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
