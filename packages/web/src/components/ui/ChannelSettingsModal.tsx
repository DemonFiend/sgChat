import { useState, useEffect } from 'react';
import { api } from '@/api';
import { PermissionEditor } from './PermissionEditor';

interface ChannelSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  channel: {
    id: string;
    name: string;
    type: string;
    topic?: string;
    bitrate?: number;
    user_limit?: number;
    server_id: string;
    voice_relay_policy?: string;
    preferred_relay_id?: string | null;
  };
}

interface TrustedRelay {
  id: string;
  name: string;
  region: string;
  status: string;
  last_health_status: string | null;
}

interface PermissionOverride {
  id: string;
  channel_id: string;
  type: 'role' | 'user';
  target_id: string;
  target_name: string;
  target_color: string | null;
  text_allow: string;
  text_deny: string;
  voice_allow: string;
  voice_deny: string;
}

interface Role {
  id: string;
  name: string;
  color: string | null;
  position: number;
}

export function ChannelSettingsModal({ isOpen, onClose, channel }: ChannelSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<'general' | 'permissions'>('general');
  const [channelName, setChannelName] = useState('');
  const [channelTopic, setChannelTopic] = useState('');
  const [bitrate, setBitrate] = useState(64000);
  const [userLimit, setUserLimit] = useState(0);
  const [saving, setSaving] = useState(false);
  const [overrides, setOverrides] = useState<PermissionOverride[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [relays, setRelays] = useState<TrustedRelay[]>([]);
  const [relayPolicy, setRelayPolicy] = useState<string>('master');
  const [preferredRelayId, setPreferredRelayId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [expandedOverrideId, setExpandedOverrideId] = useState<string | null>(null);

  const isVoice = channel.type === 'voice' || channel.type === 'temp_voice' || channel.type === 'music';

  useEffect(() => {
    setChannelName(channel.name);
    setChannelTopic(channel.topic || '');
    setBitrate(channel.bitrate || 64000);
    setUserLimit(channel.user_limit || 0);
    setRelayPolicy(channel.voice_relay_policy || 'master');
    setPreferredRelayId(channel.preferred_relay_id || null);

    (async () => {
      try {
        const [permsData, rolesData] = await Promise.all([
          api.get<{ overrides: PermissionOverride[] }>(`/channels/${channel.id}/permissions`),
          api.get<Role[]>(`/servers/${channel.server_id}/roles`),
        ]);
        setOverrides(permsData.overrides || []);
        setRoles(rolesData || []);
      } catch {
        // Non-critical, permissions tab just won't show data
      }

      // Fetch trusted relays for voice region selector
      if (isVoice) {
        try {
          const relayList = await api.get<TrustedRelay[]>('/relays');
          setRelays(relayList || []);
        } catch {
          // No relays available, that's fine
        }
      }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const updates: Record<string, any> = {};
      if (channelName !== channel.name) updates.name = channelName;
      if (channelTopic !== (channel.topic || '')) updates.topic = channelTopic;
      if (isVoice) {
        if (bitrate !== (channel.bitrate || 64000)) updates.bitrate = bitrate;
        if (userLimit !== (channel.user_limit || 0)) updates.user_limit = userLimit;
        if (relayPolicy !== (channel.voice_relay_policy || 'master')) {
          updates.voice_relay_policy = relayPolicy;
        }
        if (relayPolicy === 'specific' && preferredRelayId !== (channel.preferred_relay_id || null)) {
          updates.preferred_relay_id = preferredRelayId;
        }
      }

      if (Object.keys(updates).length > 0) {
        await api.patch(`/channels/${channel.id}`, updates);
      }
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const bitrateLabel = (() => {
    if (bitrate >= 1000) return `${Math.round(bitrate / 1000)}kbps`;
    return `${bitrate}bps`;
  })();

  const handleAddRoleOverride = async (roleId: string) => {
    try {
      await api.put(`/channels/${channel.id}/permissions/roles/${roleId}`, {
        voice_allow: '0',
        voice_deny: '0',
        text_allow: '0',
        text_deny: '0',
      });
      const permsData = await api.get<{ overrides: PermissionOverride[] }>(`/channels/${channel.id}/permissions`);
      setOverrides(permsData.overrides || []);
    } catch (err: any) {
      setError(err.message || 'Failed to add role override');
    }
  };

  const handleRemoveOverride = async (overrideId: string, type: 'role' | 'user', targetId: string) => {
    try {
      await api.delete(`/channels/${channel.id}/permissions/${type === 'role' ? 'roles' : 'users'}/${targetId}`);
      setOverrides(prev => prev.filter(o => o.id !== overrideId));
    } catch (err: any) {
      setError(err.message || 'Failed to remove override');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-bg-primary rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col border border-border">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary">
            Channel Settings — #{channel.name}
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-text-muted hover:text-text-primary transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border px-4">
          <button
            onClick={() => setActiveTab('general')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'general'
                ? 'border-brand-primary text-brand-primary'
                : 'border-transparent text-text-muted hover:text-text-primary'
            }`}
          >
            General
          </button>
          <button
            onClick={() => setActiveTab('permissions')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'permissions'
                ? 'border-brand-primary text-brand-primary'
                : 'border-transparent text-text-muted hover:text-text-primary'
            }`}
          >
            Permissions
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && (
            <div className="p-3 bg-danger/10 border border-danger/30 rounded-lg text-sm text-danger">
              {error}
            </div>
          )}

          {activeTab === 'general' && (
            <>
              {/* Channel Name */}
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Channel Name</label>
                <input
                  type="text"
                  name="channel-name"
                  value={channelName}
                  onChange={(e) => setChannelName(e.target.value)}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary text-sm focus:outline-none focus:border-brand-primary"
                />
              </div>

              {/* Channel Topic */}
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Topic</label>
                <input
                  type="text"
                  name="channel-topic"
                  value={channelTopic}
                  onChange={(e) => setChannelTopic(e.target.value)}
                  placeholder="Set a topic for this channel"
                  className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary text-sm focus:outline-none focus:border-brand-primary placeholder:text-text-muted"
                />
              </div>

              {/* Voice-specific settings */}
              {isVoice && (
                <>
                  {/* Bitrate */}
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-1">
                      Bitrate — {bitrateLabel}
                    </label>
                    <input
                      type="range"
                      name="channel-bitrate"
                      min="8000"
                      max="384000"
                      step="8000"
                      value={bitrate}
                      onChange={(e) => setBitrate(parseInt(e.target.value))}
                      className="w-full accent-brand-primary"
                    />
                    <div className="flex justify-between text-xs text-text-muted mt-1">
                      <span>8kbps</span>
                      <span>384kbps</span>
                    </div>
                  </div>

                  {/* User Limit */}
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-1">
                      User Limit — {userLimit === 0 ? 'Unlimited' : userLimit}
                    </label>
                    <input
                      type="range"
                      name="channel-user-limit"
                      min="0"
                      max="99"
                      step="1"
                      value={userLimit}
                      onChange={(e) => setUserLimit(parseInt(e.target.value))}
                      className="w-full accent-brand-primary"
                    />
                    <div className="flex justify-between text-xs text-text-muted mt-1">
                      <span>No limit</span>
                      <span>99</span>
                    </div>
                  </div>

                  {/* Voice Region / Relay Policy */}
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-1">Region</label>
                    <select
                      value={relayPolicy === 'specific' ? `specific:${preferredRelayId || ''}` : relayPolicy}
                      className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary"
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === 'master') {
                          setRelayPolicy('master');
                          setPreferredRelayId(null);
                        } else if (val === 'auto') {
                          setRelayPolicy('auto');
                          setPreferredRelayId(null);
                        } else if (val.startsWith('specific:')) {
                          setRelayPolicy('specific');
                          setPreferredRelayId(val.replace('specific:', ''));
                        }
                      }}
                    >
                      <option value="master">Main Server</option>
                      {relays.length > 0 && <option value="auto">Automatic (best relay)</option>}
                      {relays.map((relay) => (
                        <option key={relay.id} value={`specific:${relay.id}`}>
                          {relay.name} ({relay.region}){relay.last_health_status === 'unreachable' ? ' — offline' : ''}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-text-muted mt-1">
                      {relayPolicy === 'master' && 'Voice traffic routes through the main server.'}
                      {relayPolicy === 'auto' && 'Automatically selects the lowest-latency relay server.'}
                      {relayPolicy === 'specific' && 'Voice traffic routes through the selected relay server.'}
                    </p>
                  </div>
                </>
              )}
            </>
          )}

          {activeTab === 'permissions' && (
            <>
              {/* Current overrides */}
              {overrides.length > 0 ? (
                <div className="space-y-2">
                  {overrides.map((override) => (
                    <div key={override.id}>
                      {/* Override header row */}
                      <div
                        className={`flex items-center justify-between p-3 bg-bg-secondary cursor-pointer hover:bg-bg-modifier-hover transition-colors ${
                          expandedOverrideId === override.id ? 'rounded-t-lg' : 'rounded-lg'
                        }`}
                        onClick={() => setExpandedOverrideId(
                          expandedOverrideId === override.id ? null : override.id
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: override.target_color || 'var(--color-text-muted)' }}
                          />
                          <span className="text-sm text-text-primary">{override.target_name}</span>
                          <span className="text-xs text-text-muted px-1.5 py-0.5 bg-bg-tertiary rounded">
                            {override.type}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveOverride(override.id, override.type, override.target_id);
                            }}
                            className="p-1 text-text-muted hover:text-danger transition-colors"
                            title="Remove override"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                          <svg
                            className={`w-4 h-4 text-text-muted transition-transform ${
                              expandedOverrideId === override.id ? 'rotate-180' : ''
                            }`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>

                      {/* Permission editor (expanded) */}
                      {expandedOverrideId === override.id && (
                        <PermissionEditor
                          channelType={channel.type}
                          textAllow={override.text_allow}
                          textDeny={override.text_deny}
                          voiceAllow={override.voice_allow}
                          voiceDeny={override.voice_deny}
                          onSave={async (values) => {
                            await api.put(
                              `/channels/${channel.id}/permissions/${override.type === 'role' ? 'roles' : 'users'}/${override.target_id}`,
                              values
                            );
                            const permsData = await api.get<{ overrides: PermissionOverride[] }>(
                              `/channels/${channel.id}/permissions`
                            );
                            setOverrides(permsData.overrides || []);
                          }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-text-muted text-center py-4">No permission overrides configured for this channel.</p>
              )}

              {/* Add role override */}
              <div className="pt-2">
                <label className="block text-sm font-medium text-text-secondary mb-2">Add Role Override</label>
                <div className="space-y-1">
                  {roles.filter(r => !overrides.some(o => o.type === 'role' && o.target_id === r.id)).map((role) => (
                    <button
                      key={role.id}
                      onClick={() => handleAddRoleOverride(role.id)}
                      className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-bg-modifier-hover rounded-lg transition-colors"
                    >
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: role.color || 'var(--color-text-muted)' }}
                      />
                      <span>{role.name}</span>
                      <svg className="w-4 h-4 ml-auto text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          {activeTab === 'general' && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium bg-brand-primary text-white rounded-lg hover:bg-brand-primary-hover transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
