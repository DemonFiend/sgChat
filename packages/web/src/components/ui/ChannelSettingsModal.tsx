import { createSignal, Show, For, onMount } from 'solid-js';
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
  };
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

export function ChannelSettingsModal(props: ChannelSettingsModalProps) {
  const [activeTab, setActiveTab] = createSignal<'general' | 'permissions'>('general');
  const [channelName, setChannelName] = createSignal('');
  const [channelTopic, setChannelTopic] = createSignal('');
  const [bitrate, setBitrate] = createSignal(64000);
  const [userLimit, setUserLimit] = createSignal(0);
  const [saving, setSaving] = createSignal(false);
  const [overrides, setOverrides] = createSignal<PermissionOverride[]>([]);
  const [roles, setRoles] = createSignal<Role[]>([]);
  const [error, setError] = createSignal('');
  const [expandedOverrideId, setExpandedOverrideId] = createSignal<string | null>(null);

  const isVoice = () => props.channel.type === 'voice' || props.channel.type === 'temp_voice' || props.channel.type === 'music';

  onMount(async () => {
    setChannelName(props.channel.name);
    setChannelTopic(props.channel.topic || '');
    setBitrate(props.channel.bitrate || 64000);
    setUserLimit(props.channel.user_limit || 0);

    try {
      const [permsData, rolesData] = await Promise.all([
        api.get<{ overrides: PermissionOverride[] }>(`/channels/${props.channel.id}/permissions`),
        api.get<Role[]>(`/servers/${props.channel.server_id}/roles`),
      ]);
      setOverrides(permsData.overrides || []);
      setRoles(rolesData || []);
    } catch {
      // Non-critical, permissions tab just won't show data
    }
  });

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const updates: Record<string, any> = {};
      if (channelName() !== props.channel.name) updates.name = channelName();
      if (channelTopic() !== (props.channel.topic || '')) updates.topic = channelTopic();
      if (isVoice()) {
        if (bitrate() !== (props.channel.bitrate || 64000)) updates.bitrate = bitrate();
        if (userLimit() !== (props.channel.user_limit || 0)) updates.user_limit = userLimit();
      }

      if (Object.keys(updates).length > 0) {
        await api.patch(`/channels/${props.channel.id}`, updates);
      }
      props.onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const bitrateLabel = () => {
    const b = bitrate();
    if (b >= 1000) return `${Math.round(b / 1000)}kbps`;
    return `${b}bps`;
  };

  const handleAddRoleOverride = async (roleId: string) => {
    try {
      await api.put(`/channels/${props.channel.id}/permissions/roles/${roleId}`, {
        voice_allow: '0',
        voice_deny: '0',
        text_allow: '0',
        text_deny: '0',
      });
      const permsData = await api.get<{ overrides: PermissionOverride[] }>(`/channels/${props.channel.id}/permissions`);
      setOverrides(permsData.overrides || []);
    } catch (err: any) {
      setError(err.message || 'Failed to add role override');
    }
  };

  const handleRemoveOverride = async (overrideId: string, type: 'role' | 'user', targetId: string) => {
    try {
      await api.delete(`/channels/${props.channel.id}/permissions/${type === 'role' ? 'roles' : 'users'}/${targetId}`);
      setOverrides(prev => prev.filter(o => o.id !== overrideId));
    } catch (err: any) {
      setError(err.message || 'Failed to remove override');
    }
  };

  if (!props.isOpen) return null;

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/60" onClick={props.onClose} />
      <div class="relative bg-bg-primary rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col border border-border">
        {/* Header */}
        <div class="flex items-center justify-between p-4 border-b border-border">
          <h2 class="text-lg font-semibold text-text-primary">
            Channel Settings — #{props.channel.name}
          </h2>
          <button
            onClick={props.onClose}
            class="p-1 text-text-muted hover:text-text-primary transition-colors"
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div class="flex border-b border-border px-4">
          <button
            onClick={() => setActiveTab('general')}
            class={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab() === 'general'
                ? 'border-brand-primary text-brand-primary'
                : 'border-transparent text-text-muted hover:text-text-primary'
            }`}
          >
            General
          </button>
          <button
            onClick={() => setActiveTab('permissions')}
            class={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab() === 'permissions'
                ? 'border-brand-primary text-brand-primary'
                : 'border-transparent text-text-muted hover:text-text-primary'
            }`}
          >
            Permissions
          </button>
        </div>

        {/* Content */}
        <div class="flex-1 overflow-y-auto p-4 space-y-4">
          <Show when={error()}>
            <div class="p-3 bg-danger/10 border border-danger/30 rounded-lg text-sm text-danger">
              {error()}
            </div>
          </Show>

          <Show when={activeTab() === 'general'}>
            {/* Channel Name */}
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1">Channel Name</label>
              <input
                type="text"
                value={channelName()}
                onInput={(e) => setChannelName(e.currentTarget.value)}
                class="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary text-sm focus:outline-none focus:border-brand-primary"
              />
            </div>

            {/* Channel Topic */}
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1">Topic</label>
              <input
                type="text"
                value={channelTopic()}
                onInput={(e) => setChannelTopic(e.currentTarget.value)}
                placeholder="Set a topic for this channel"
                class="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary text-sm focus:outline-none focus:border-brand-primary placeholder:text-text-muted"
              />
            </div>

            {/* Voice-specific settings */}
            <Show when={isVoice()}>
              {/* Bitrate */}
              <div>
                <label class="block text-sm font-medium text-text-secondary mb-1">
                  Bitrate — {bitrateLabel()}
                </label>
                <input
                  type="range"
                  min="8000"
                  max="384000"
                  step="8000"
                  value={bitrate()}
                  onInput={(e) => setBitrate(parseInt(e.currentTarget.value))}
                  class="w-full accent-brand-primary"
                />
                <div class="flex justify-between text-xs text-text-muted mt-1">
                  <span>8kbps</span>
                  <span>384kbps</span>
                </div>
              </div>

              {/* User Limit */}
              <div>
                <label class="block text-sm font-medium text-text-secondary mb-1">
                  User Limit — {userLimit() === 0 ? 'Unlimited' : userLimit()}
                </label>
                <input
                  type="range"
                  min="0"
                  max="99"
                  step="1"
                  value={userLimit()}
                  onInput={(e) => setUserLimit(parseInt(e.currentTarget.value))}
                  class="w-full accent-brand-primary"
                />
                <div class="flex justify-between text-xs text-text-muted mt-1">
                  <span>No limit</span>
                  <span>99</span>
                </div>
              </div>

              {/* Region (placeholder for future feature) */}
              <div>
                <label class="block text-sm font-medium text-text-secondary mb-1">Region</label>
                <select
                  disabled
                  class="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-muted text-sm cursor-not-allowed"
                >
                  <option>Automatic (Coming Soon)</option>
                </select>
                <p class="text-xs text-text-muted mt-1">Region selection will be available in a future update.</p>
              </div>
            </Show>
          </Show>

          <Show when={activeTab() === 'permissions'}>
            {/* Current overrides */}
            <Show when={overrides().length > 0} fallback={
              <p class="text-sm text-text-muted text-center py-4">No permission overrides configured for this channel.</p>
            }>
              <div class="space-y-2">
                <For each={overrides()}>
                  {(override) => (
                    <div>
                      {/* Override header row */}
                      <div
                        class={`flex items-center justify-between p-3 bg-bg-secondary cursor-pointer hover:bg-bg-modifier-hover transition-colors ${
                          expandedOverrideId() === override.id ? 'rounded-t-lg' : 'rounded-lg'
                        }`}
                        onClick={() => setExpandedOverrideId(
                          expandedOverrideId() === override.id ? null : override.id
                        )}
                      >
                        <div class="flex items-center gap-2">
                          <div
                            class="w-3 h-3 rounded-full"
                            style={{ "background-color": override.target_color || 'var(--color-text-muted)' }}
                          />
                          <span class="text-sm text-text-primary">{override.target_name}</span>
                          <span class="text-xs text-text-muted px-1.5 py-0.5 bg-bg-tertiary rounded">
                            {override.type}
                          </span>
                        </div>
                        <div class="flex items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveOverride(override.id, override.type, override.target_id);
                            }}
                            class="p-1 text-text-muted hover:text-danger transition-colors"
                            title="Remove override"
                          >
                            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                          <svg
                            class={`w-4 h-4 text-text-muted transition-transform ${
                              expandedOverrideId() === override.id ? 'rotate-180' : ''
                            }`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>

                      {/* Permission editor (expanded) */}
                      <Show when={expandedOverrideId() === override.id}>
                        <PermissionEditor
                          channelType={props.channel.type}
                          textAllow={override.text_allow}
                          textDeny={override.text_deny}
                          voiceAllow={override.voice_allow}
                          voiceDeny={override.voice_deny}
                          onSave={async (values) => {
                            await api.put(
                              `/channels/${props.channel.id}/permissions/${override.type === 'role' ? 'roles' : 'users'}/${override.target_id}`,
                              values
                            );
                            const permsData = await api.get<{ overrides: PermissionOverride[] }>(
                              `/channels/${props.channel.id}/permissions`
                            );
                            setOverrides(permsData.overrides || []);
                            setExpandedOverrideId(null);
                          }}
                          onCancel={() => setExpandedOverrideId(null)}
                        />
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* Add role override */}
            <div class="pt-2">
              <label class="block text-sm font-medium text-text-secondary mb-2">Add Role Override</label>
              <div class="space-y-1">
                <For each={roles().filter(r => !overrides().some(o => o.type === 'role' && o.target_id === r.id))}>
                  {(role) => (
                    <button
                      onClick={() => handleAddRoleOverride(role.id)}
                      class="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-bg-modifier-hover rounded-lg transition-colors"
                    >
                      <div
                        class="w-3 h-3 rounded-full"
                        style={{ "background-color": role.color || 'var(--color-text-muted)' }}
                      />
                      <span>{role.name}</span>
                      <svg class="w-4 h-4 ml-auto text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </div>

        {/* Footer */}
        <div class="flex items-center justify-end gap-3 p-4 border-t border-border">
          <button
            onClick={props.onClose}
            class="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <Show when={activeTab() === 'general'}>
            <button
              onClick={handleSave}
              disabled={saving()}
              class="px-4 py-2 text-sm font-medium bg-brand-primary text-white rounded-lg hover:bg-brand-primary-hover transition-colors disabled:opacity-50"
            >
              {saving() ? 'Saving...' : 'Save Changes'}
            </button>
          </Show>
        </div>
      </div>
    </div>
  );
}
