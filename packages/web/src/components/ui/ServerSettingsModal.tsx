import { createSignal, For, Show, JSX, createEffect } from 'solid-js';
import { Portal } from 'solid-js/web';
import { clsx } from 'clsx';
import { api } from '@/api';
import { permissions } from '@/stores';
import { ServerPopupConfigForm } from './ServerPopupConfigForm';

type ServerSettingsTab = 'overview' | 'popup-config' | 'roles' | 'members' | 'channels' | 'invites' | 'bans' | 'audit-log';

interface ServerSettings {
  motd: string;
  motd_enabled: boolean;
  timezone: string;
  announce_joins: boolean;
  announce_leaves: boolean;
  announce_online: boolean;
  afk_timeout: number;
  welcome_channel_id: string | null;
  afk_channel_id: string | null;
}

interface ServerData {
  id: string;
  name: string;
  description: string | null;
  icon_url: string | null;
  banner_url: string | null;
  owner_id: string;
  member_count: number;
  admin_claimed: boolean;
  settings?: ServerSettings;
}

interface Channel {
  id: string;
  name: string;
  type: 'text' | 'voice' | 'announcement';
}

interface ServerSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  serverName: string;
  serverIcon?: string | null;
  serverOwnerId?: string;
  onTransferOwnership?: () => void;
}

const tabs: { id: ServerSettingsTab; label: string; icon: JSX.Element; permission?: string }[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: (
      <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    permission: 'manage_server',
  },
  {
    id: 'popup-config',
    label: 'Popup Config',
    icon: (
      <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    permission: 'manage_server',
  },
  {
    id: 'roles',
    label: 'Roles',
    icon: (
      <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
    permission: 'manage_roles',
  },
  {
    id: 'members',
    label: 'Members',
    icon: (
      <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    ),
    permission: 'manage_members',
  },
  {
    id: 'channels',
    label: 'Channels',
    icon: (
      <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
      </svg>
    ),
    permission: 'manage_channels',
  },
  {
    id: 'invites',
    label: 'Invites',
    icon: (
      <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
      </svg>
    ),
    permission: 'manage_invites',
  },
  {
    id: 'bans',
    label: 'Bans',
    icon: (
      <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
      </svg>
    ),
    permission: 'ban_members',
  },
  {
    id: 'audit-log',
    label: 'Audit Log',
    icon: (
      <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
      </svg>
    ),
    permission: 'view_audit_log',
  },
];

export function ServerSettingsModal(props: ServerSettingsModalProps) {
  const [activeTab, setActiveTab] = createSignal<ServerSettingsTab>('overview');
  const [serverData, setServerData] = createSignal<ServerData | null>(null);
  const [channels, setChannels] = createSignal<Channel[]>([]);
  const [isLoading, setIsLoading] = createSignal(false);

  // Check permissions using the new named boolean system
  const hasPermission = (permission?: string) => {
    if (!permission) return true;
    // Owner always has access
    if (permissions.isOwner(props.serverOwnerId)) return true;
    // Admin always has access
    if (permissions.isAdmin()) return true;
    // Check specific permission
    return permissions.hasPermission(permission as any);
  };

  const visibleTabs = () => tabs.filter((tab) => hasPermission(tab.permission));

  // Fetch server data when modal opens
  createEffect(() => {
    if (props.isOpen) {
      fetchServerData();
    }
  });

  const fetchServerData = async () => {
    setIsLoading(true);
    try {
      const [server, channelsData] = await Promise.all([
        api.get<ServerData>('/server'),
        api.get<{ channels: Channel[] }>('/channels')
      ]);
      setServerData(server);
      setChannels(channelsData.channels || []);
    } catch (err) {
      console.error('Failed to fetch server data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      props.onClose();
    }
  };

  return (
    <Show when={props.isOpen}>
      <Portal>
        <div
          class="fixed inset-0 z-50 flex bg-bg-primary animate-in fade-in duration-200"
          onKeyDown={handleKeyDown}
          role="dialog"
          aria-modal="true"
          aria-label="Server Settings"
        >
          {/* Sidebar */}
          <div class="w-[218px] bg-bg-secondary flex flex-col">
            <div class="flex-1 overflow-y-auto py-[60px] px-[6px]">
              <div class="pr-2">
                <div class="px-2 pb-1.5">
                  <span class="text-xs font-bold uppercase text-text-muted tracking-wide truncate" title={props.serverName}>
                    {props.serverName}
                  </span>
                </div>
                <For each={visibleTabs()}>
                  {(tab) => (
                    <button
                      onClick={() => setActiveTab(tab.id)}
                      class={clsx(
                        'w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-sm transition-colors',
                        activeTab() === tab.id
                          ? 'bg-bg-modifier-selected text-text-primary'
                          : 'text-text-muted hover:bg-bg-modifier-hover hover:text-text-primary'
                      )}
                    >
                      {tab.icon}
                      {tab.label}
                    </button>
                  )}
                </For>

                <div class="h-px bg-border-subtle my-2 mx-2" />

                {/* Danger Zone */}
                <div class="px-2 pb-1.5 pt-2">
                  <span class="text-xs font-bold uppercase text-danger tracking-wide">
                    Danger Zone
                  </span>
                </div>
                <button class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-sm text-danger hover:bg-danger/10 transition-colors">
                  <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Leave Server
                </button>
              </div>
            </div>
          </div>

          {/* Content */}
          <div class="flex-1 flex flex-col bg-bg-primary">
            {/* Close button */}
            <div class="absolute top-4 right-4 z-10">
              <button
                onClick={props.onClose}
                class="p-2 rounded-full border-2 border-text-muted text-text-muted hover:border-text-primary hover:text-text-primary transition-colors"
                aria-label="Close"
              >
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <div class="text-xs text-text-muted text-center mt-1">ESC</div>
            </div>

            {/* Tab content */}
            <div class="flex-1 overflow-y-auto py-[60px] px-10">
              <div class="max-w-[740px] mx-auto">
                <Show when={isLoading()} fallback={
                  <>
                    <Show when={activeTab() === 'popup-config'}>
                      <ServerPopupConfigForm
                        serverId={serverData()?.id || ''}
                        onSaveSuccess={fetchServerData}
                      />
                    </Show>
                    <Show when={activeTab() === 'overview'}>
                      <OverviewTab
                        serverData={serverData()}
                        channels={channels()}
                        isOwner={permissions.isOwner(props.serverOwnerId)}
                        onTransferOwnership={props.onTransferOwnership}
                        onRefresh={fetchServerData}
                      />
                    </Show>
                    <Show when={activeTab() === 'roles'}>
                      <RolesTab />
                    </Show>
                    <Show when={activeTab() === 'members'}>
                      <MembersTab />
                    </Show>
                    <Show when={activeTab() === 'channels'}>
                      <ChannelsTab />
                    </Show>
                    <Show when={activeTab() === 'invites'}>
                      <InvitesTab />
                    </Show>
                    <Show when={activeTab() === 'bans'}>
                      <BansTab />
                    </Show>
                    <Show when={activeTab() === 'audit-log'}>
                      <AuditLogTab />
                    </Show>
                  </>
                }>
                  <div class="flex items-center justify-center h-64">
                    <div class="text-text-muted">Loading...</div>
                  </div>
                </Show>
              </div>
            </div>
          </div>
        </div>
    </Portal>
    </Show >
  );
}

// Overview Tab
interface OverviewTabProps {
  serverData: ServerData | null;
  channels: Channel[];
  isOwner: boolean;
  onTransferOwnership?: () => void;
  onRefresh: () => void;
}

function OverviewTab(props: OverviewTabProps) {
  const [name, setName] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [motd, setMotd] = createSignal('');
  const [motdEnabled, setMotdEnabled] = createSignal(true);
  const [announceJoins, setAnnounceJoins] = createSignal(true);
  const [announceLeaves, setAnnounceLeaves] = createSignal(true);
  const [announceOnline, setAnnounceOnline] = createSignal(false);
  const [afkTimeout, setAfkTimeout] = createSignal(300);
  const [welcomeChannelId, setWelcomeChannelId] = createSignal<string>('');
  const [afkChannelId, setAfkChannelId] = createSignal<string>('');
  const [timezone, setTimezone] = createSignal('UTC');
  const [isSaving, setIsSaving] = createSignal(false);
  const [saveError, setSaveError] = createSignal<string | null>(null);
  const [saveSuccess, setSaveSuccess] = createSignal(false);

  // Populate form when server data loads
  createEffect(() => {
    const data = props.serverData;
    if (data) {
      setName(data.name || '');
      setDescription(data.description || '');
      if (data.settings) {
        setMotd(data.settings.motd || '');
        setMotdEnabled(data.settings.motd_enabled ?? true);
        setAnnounceJoins(data.settings.announce_joins ?? true);
        setAnnounceLeaves(data.settings.announce_leaves ?? true);
        setAnnounceOnline(data.settings.announce_online ?? false);
        setAfkTimeout(data.settings.afk_timeout ?? 300);
        setWelcomeChannelId(data.settings.welcome_channel_id || '');
        setAfkChannelId(data.settings.afk_channel_id || '');
        setTimezone(data.settings.timezone || 'UTC');
      }
    }
  });

  const textChannels = () => props.channels.filter(c => c.type === 'text');
  const voiceChannels = () => props.channels.filter(c => c.type === 'voice');

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      await api.patch('/server', {
        name: name(),
        description: description() || null,
        motd: motd() || null,
        motd_enabled: motdEnabled(),
        announce_joins: announceJoins(),
        announce_leaves: announceLeaves(),
        announce_online: announceOnline(),
        afk_timeout: afkTimeout(),
        welcome_channel_id: welcomeChannelId() || null,
        afk_channel_id: afkChannelId() || null,
        timezone: timezone(),
      });
      setSaveSuccess(true);
      props.onRefresh();
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const afkTimeoutOptions = [
    { value: 60, label: '1 minute' },
    { value: 300, label: '5 minutes' },
    { value: 600, label: '10 minutes' },
    { value: 900, label: '15 minutes' },
    { value: 1800, label: '30 minutes' },
    { value: 3600, label: '1 hour' },
  ];

  return (
    <div>
      <h2 class="text-xl font-bold text-text-primary mb-5">Server Overview</h2>

      <div class="flex gap-6 mb-8">
        {/* Server Icon */}
        <div class="flex flex-col items-center">
          <div class="w-24 h-24 rounded-full bg-brand-primary flex items-center justify-center text-white text-3xl font-bold mb-3">
            {props.serverData?.icon_url ? (
              <img src={props.serverData.icon_url} alt={props.serverData?.name} class="w-full h-full rounded-full object-cover" />
            ) : (
              (props.serverData?.name || 'S').charAt(0).toUpperCase()
            )}
          </div>
          <button class="text-sm text-brand-primary hover:underline">
            Upload Image
          </button>
          <p class="text-xs text-text-muted mt-1">Min. 128x128</p>
        </div>

        {/* Basic Info */}
        <div class="flex-1 space-y-4">
          <div>
            <label class="block text-xs font-bold uppercase text-text-muted mb-2">
              Server Name
            </label>
            <input
              type="text"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              class="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary"
            />
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-text-muted mb-2">
              Description
            </label>
            <textarea
              value={description()}
              onInput={(e) => setDescription(e.currentTarget.value)}
              rows={3}
              maxLength={500}
              class="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary resize-none"
              placeholder="Tell people about your server..."
            />
            <p class="text-xs text-text-muted mt-1">{description().length}/500</p>
          </div>
        </div>
      </div>

      {/* MOTD Section */}
      <div class="mb-8">
        <h3 class="text-sm font-bold uppercase text-text-muted mb-3">Message of the Day</h3>
        <div class="bg-bg-secondary rounded-lg p-4">
          <label class="flex items-center gap-3 mb-3 cursor-pointer">
            <input
              type="checkbox"
              checked={motdEnabled()}
              onChange={(e) => setMotdEnabled(e.currentTarget.checked)}
              class="w-4 h-4 rounded border-border-subtle bg-bg-tertiary"
            />
            <span class="text-sm text-text-primary">Enable MOTD</span>
          </label>
          <Show when={motdEnabled()}>
            <textarea
              value={motd()}
              onInput={(e) => setMotd(e.currentTarget.value)}
              rows={4}
              maxLength={2000}
              class="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary resize-none"
              placeholder="Welcome message shown to members..."
            />
            <p class="text-xs text-text-muted mt-1">{motd().length}/2000</p>
          </Show>
        </div>
      </div>

      {/* Channel Settings */}
      <div class="mb-8">
        <h3 class="text-sm font-bold uppercase text-text-muted mb-3">Channel Settings</h3>
        <div class="bg-bg-secondary rounded-lg p-4 space-y-4">
          <div>
            <label class="block text-xs font-bold uppercase text-text-muted mb-2">
              Welcome Channel
            </label>
            <select
              value={welcomeChannelId()}
              onChange={(e) => setWelcomeChannelId(e.currentTarget.value)}
              class="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary"
            >
              <option value="">No welcome channel</option>
              <For each={textChannels()}>
                {(channel) => (
                  <option value={channel.id}>#{channel.name}</option>
                )}
              </For>
            </select>
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-text-muted mb-2">
              AFK Channel
            </label>
            <select
              value={afkChannelId()}
              onChange={(e) => setAfkChannelId(e.currentTarget.value)}
              class="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary"
            >
              <option value="">No AFK channel</option>
              <For each={voiceChannels()}>
                {(channel) => (
                  <option value={channel.id}>🔊 {channel.name}</option>
                )}
              </For>
            </select>
          </div>
          <div>
            <label class="block text-xs font-bold uppercase text-text-muted mb-2">
              AFK Timeout
            </label>
            <select
              value={afkTimeout()}
              onChange={(e) => setAfkTimeout(parseInt(e.currentTarget.value))}
              class="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary"
            >
              <For each={afkTimeoutOptions}>
                {(option) => (
                  <option value={option.value}>{option.label}</option>
                )}
              </For>
            </select>
          </div>
        </div>
      </div>

      {/* Announcement Settings */}
      <div class="mb-8">
        <h3 class="text-sm font-bold uppercase text-text-muted mb-3">Announcements</h3>
        <div class="bg-bg-secondary rounded-lg p-4 space-y-3">
          <label class="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={announceJoins()}
              onChange={(e) => setAnnounceJoins(e.currentTarget.checked)}
              class="w-4 h-4 rounded border-border-subtle bg-bg-tertiary"
            />
            <span class="text-sm text-text-primary">Announce when members join</span>
          </label>
          <label class="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={announceLeaves()}
              onChange={(e) => setAnnounceLeaves(e.currentTarget.checked)}
              class="w-4 h-4 rounded border-border-subtle bg-bg-tertiary"
            />
            <span class="text-sm text-text-primary">Announce when members leave</span>
          </label>
          <label class="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={announceOnline()}
              onChange={(e) => setAnnounceOnline(e.currentTarget.checked)}
              class="w-4 h-4 rounded border-border-subtle bg-bg-tertiary"
            />
            <span class="text-sm text-text-primary">Announce when members come online</span>
          </label>
        </div>
      </div>

      {/* Timezone */}
      <div class="mb-8">
        <h3 class="text-sm font-bold uppercase text-text-muted mb-3">Server Timezone</h3>
        <div class="bg-bg-secondary rounded-lg p-4">
          <select
            value={timezone()}
            onChange={(e) => setTimezone(e.currentTarget.value)}
            class="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary"
          >
            <option value="UTC">UTC</option>
            <option value="America/New_York">America/New_York (EST/EDT)</option>
            <option value="America/Chicago">America/Chicago (CST/CDT)</option>
            <option value="America/Denver">America/Denver (MST/MDT)</option>
            <option value="America/Los_Angeles">America/Los_Angeles (PST/PDT)</option>
            <option value="Europe/London">Europe/London (GMT/BST)</option>
            <option value="Europe/Paris">Europe/Paris (CET/CEST)</option>
            <option value="Europe/Berlin">Europe/Berlin (CET/CEST)</option>
            <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
            <option value="Asia/Shanghai">Asia/Shanghai (CST)</option>
            <option value="Australia/Sydney">Australia/Sydney (AEST/AEDT)</option>
          </select>
        </div>
      </div>

      {/* Save Button */}
      <div class="flex items-center gap-4 mb-8">
        <button
          onClick={handleSave}
          disabled={isSaving()}
          class="px-4 py-2 bg-success hover:bg-success/90 text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
        >
          {isSaving() ? 'Saving...' : 'Save Changes'}
        </button>
        <Show when={saveSuccess()}>
          <span class="text-sm text-success">✓ Changes saved!</span>
        </Show>
        <Show when={saveError()}>
          <span class="text-sm text-danger">{saveError()}</span>
        </Show>
      </div>

      {/* Danger Zone */}
      <Show when={props.isOwner}>
        <div class="border-t border-danger/30 pt-6">
          <h3 class="text-sm font-bold uppercase text-danger mb-3">Danger Zone</h3>
          <div class="bg-danger/10 border border-danger/30 rounded-lg p-4">
            <div class="flex items-center justify-between">
              <div>
                <h4 class="font-medium text-text-primary">Transfer Ownership</h4>
                <p class="text-sm text-text-muted">Transfer this server to another member</p>
              </div>
              <button
                onClick={props.onTransferOwnership}
                class="px-4 py-2 bg-danger hover:bg-danger/90 text-white text-sm font-medium rounded transition-colors"
              >
                Transfer
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}

// Roles Tab
interface Role {
  id: string;
  name: string;
  color: string | null;
  position: number;
  permissions: Record<string, boolean>;
  member_count?: number;
  is_hoisted?: boolean;
}

function RolesTab() {
  const [roles, setRoles] = createSignal<Role[]>([]);
  const [selectedRole, setSelectedRole] = createSignal<Role | null>(null);
  const [isLoading, setIsLoading] = createSignal(true);
  const [isSaving, setIsSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [isCreating, setIsCreating] = createSignal(false);
  const [newRoleName, setNewRoleName] = createSignal('');

  // Editable role state
  const [editName, setEditName] = createSignal('');
  const [editColor, setEditColor] = createSignal('');
  const [editPermissions, setEditPermissions] = createSignal<Record<string, boolean>>({});
  const [editHoisted, setEditHoisted] = createSignal(false);

  const permissionGroups = [
    {
      name: 'General',
      permissions: [
        { key: 'administrator', label: 'Administrator', description: 'Full access to all server settings' },
        { key: 'manage_server', label: 'Manage Server', description: 'Edit server settings' },
        { key: 'manage_channels', label: 'Manage Channels', description: 'Create, edit, delete channels' },
        { key: 'manage_roles', label: 'Manage Roles', description: 'Create, edit, delete roles' },
        { key: 'view_audit_log', label: 'View Audit Log', description: 'View server audit log' },
      ]
    },
    {
      name: 'Membership',
      permissions: [
        { key: 'kick_members', label: 'Kick Members', description: 'Remove members from the server' },
        { key: 'ban_members', label: 'Ban Members', description: 'Permanently ban members' },
        { key: 'create_invites', label: 'Create Invites', description: 'Create invite links' },
        { key: 'change_nickname', label: 'Change Nickname', description: 'Change own nickname' },
        { key: 'manage_nicknames', label: 'Manage Nicknames', description: 'Change others\' nicknames' },
      ]
    },
    {
      name: 'Text Channels',
      permissions: [
        { key: 'send_messages', label: 'Send Messages', description: 'Send messages in text channels' },
        { key: 'embed_links', label: 'Embed Links', description: 'Links will show previews' },
        { key: 'attach_files', label: 'Attach Files', description: 'Upload files and images' },
        { key: 'add_reactions', label: 'Add Reactions', description: 'Add reactions to messages' },
        { key: 'mention_everyone', label: 'Mention Everyone', description: 'Use @everyone and @here' },
        { key: 'manage_messages', label: 'Manage Messages', description: 'Delete others\' messages' },
        { key: 'read_message_history', label: 'Read Message History', description: 'View older messages' },
      ]
    },
    {
      name: 'Voice Channels',
      permissions: [
        { key: 'connect', label: 'Connect', description: 'Join voice channels' },
        { key: 'speak', label: 'Speak', description: 'Talk in voice channels' },
        { key: 'video', label: 'Video', description: 'Share video' },
        { key: 'mute_members', label: 'Mute Members', description: 'Mute others in voice' },
        { key: 'deafen_members', label: 'Deafen Members', description: 'Deafen others in voice' },
        { key: 'move_members', label: 'Move Members', description: 'Move members between channels' },
      ]
    },
  ];

  const fetchRoles = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.get<Role[]>('/roles');
      setRoles(data || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load roles');
    } finally {
      setIsLoading(false);
    }
  };

  createEffect(() => {
    fetchRoles();
  });

  const selectRole = (role: Role) => {
    setSelectedRole(role);
    setEditName(role.name);
    setEditColor(role.color || '');
    setEditPermissions({ ...role.permissions });
    setEditHoisted(role.is_hoisted ?? false);
  };

  const handleCreateRole = async () => {
    if (!newRoleName().trim()) return;

    setIsCreating(true);
    try {
      const newRole = await api.post<Role>('/roles', { name: newRoleName() });
      setRoles(prev => [...prev, newRole]);
      setNewRoleName('');
      selectRole(newRole);
    } catch (err: any) {
      alert(err?.message || 'Failed to create role');
    } finally {
      setIsCreating(false);
    }
  };

  const handleSaveRole = async () => {
    const role = selectedRole();
    if (!role) return;

    setIsSaving(true);
    try {
      const updated = await api.patch<Role>(`/roles/${role.id}`, {
        name: editName(),
        color: editColor() || null,
        permissions: editPermissions(),
        is_hoisted: editHoisted(),
      });
      setRoles(prev => prev.map(r => r.id === role.id ? updated : r));
      setSelectedRole(updated);
    } catch (err: any) {
      alert(err?.message || 'Failed to save role');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteRole = async () => {
    const role = selectedRole();
    if (!role) return;
    if (!confirm(`Are you sure you want to delete the "${role.name}" role?`)) return;

    try {
      await api.delete(`/roles/${role.id}`);
      setRoles(prev => prev.filter(r => r.id !== role.id));
      setSelectedRole(null);
    } catch (err: any) {
      alert(err?.message || 'Failed to delete role');
    }
  };

  const togglePermission = (key: string) => {
    setEditPermissions(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div class="flex gap-6 h-[calc(100vh-120px)] min-h-[500px] ml-4">
      {/* Role List */}
      <div class="w-56 flex-shrink-0">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-semibold text-text-muted uppercase">Roles</h3>
        </div>

        <Show when={isLoading()}>
          <div class="text-sm text-text-muted">Loading...</div>
        </Show>

        <Show when={error()}>
          <div class="text-sm text-danger mb-2">{error()}</div>
        </Show>

        <Show when={!isLoading() && !error()}>
          <div class="space-y-1 mb-3">
            <For each={roles().sort((a, b) => b.position - a.position)}>
              {(role) => (
                <button
                  onClick={() => selectRole(role)}
                  class={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left transition-colors ${selectedRole()?.id === role.id
                    ? 'bg-bg-modifier-selected text-text-primary'
                    : 'text-text-muted hover:bg-bg-modifier-hover hover:text-text-secondary'
                    }`}
                >
                  <div
                    class="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ background: role.color || '#99aab5' }}
                  />
                  <span class="truncate">{role.name}</span>
                </button>
              )}
            </For>
          </div>

          <div class="flex gap-2">
            <input
              type="text"
              value={newRoleName()}
              onInput={(e) => setNewRoleName(e.currentTarget.value)}
              placeholder="New role..."
              class="flex-1 px-2 py-1 bg-bg-tertiary border border-border-subtle rounded text-sm text-text-primary focus:outline-none focus:border-brand-primary"
              onKeyDown={(e) => e.key === 'Enter' && handleCreateRole()}
            />
            <button
              onClick={handleCreateRole}
              disabled={isCreating() || !newRoleName().trim()}
              class="p-1 bg-brand-primary text-white rounded hover:bg-brand-primary-hover disabled:opacity-50"
            >
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
        </Show>
      </div>

      {/* Role Editor */}
      <div class="flex-1 overflow-y-auto">
        <Show
          when={selectedRole()}
          fallback={
            <div class="flex items-center justify-center h-full text-text-muted">
              Select a role to edit
            </div>
          }
        >
          <div class="space-y-6">
            <div class="flex items-center justify-between">
              <h2 class="text-xl font-bold text-text-primary">Edit Role</h2>
              <div class="flex gap-2">
                <button
                  onClick={handleDeleteRole}
                  class="px-3 py-1.5 bg-danger/20 text-danger text-sm font-medium rounded hover:bg-danger/30 transition-colors"
                >
                  Delete
                </button>
                <button
                  onClick={handleSaveRole}
                  disabled={isSaving()}
                  class="px-4 py-1.5 bg-success text-white text-sm font-medium rounded hover:bg-success/90 transition-colors disabled:opacity-50"
                >
                  {isSaving() ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>

            {/* Basic Info */}
            <div class="bg-bg-secondary rounded-lg p-4 space-y-4">
              <div class="flex gap-4">
                <div class="flex-1">
                  <label class="block text-xs font-semibold uppercase text-text-muted mb-2">Role Name</label>
                  <input
                    type="text"
                    value={editName()}
                    onInput={(e) => setEditName(e.currentTarget.value)}
                    class="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold uppercase text-text-muted mb-2">Color</label>
                  <div class="flex items-center gap-2">
                    <input
                      type="color"
                      value={editColor() || '#99aab5'}
                      onInput={(e) => setEditColor(e.currentTarget.value)}
                      class="w-10 h-10 rounded cursor-pointer"
                    />
                    <input
                      type="text"
                      value={editColor()}
                      onInput={(e) => setEditColor(e.currentTarget.value)}
                      placeholder="#000000"
                      class="w-24 px-2 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary text-sm focus:outline-none focus:border-brand-primary"
                    />
                  </div>
                </div>
              </div>

              {/* Display Settings */}
              <div class="border-t border-border-subtle pt-4">
                <label class="flex items-center justify-between cursor-pointer hover:bg-bg-modifier-hover p-2 rounded transition-colors">
                  <div>
                    <div class="text-sm font-medium text-text-primary">Display separately in member list</div>
                    <div class="text-xs text-text-muted">Show members with this role grouped separately</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={editHoisted()}
                    onChange={(e) => setEditHoisted(e.currentTarget.checked)}
                    class="w-5 h-5 rounded border-border-subtle bg-bg-tertiary"
                  />
                </label>
              </div>
            </div>

            {/* Permissions */}
            <div>
              <h3 class="text-sm font-semibold text-text-muted uppercase mb-3">Permissions</h3>

              <For each={permissionGroups}>
                {(group) => (
                  <div class="mb-4">
                    <h4 class="text-xs font-semibold text-text-muted uppercase mb-2">{group.name}</h4>
                    <div class="bg-bg-secondary rounded-lg divide-y divide-border-subtle">
                      <For each={group.permissions}>
                        {(perm) => (
                          <label class="flex items-center justify-between p-3 cursor-pointer hover:bg-bg-modifier-hover transition-colors">
                            <div>
                              <div class="text-sm font-medium text-text-primary">{perm.label}</div>
                              <div class="text-xs text-text-muted">{perm.description}</div>
                            </div>
                            <input
                              type="checkbox"
                              checked={editPermissions()[perm.key] ?? false}
                              onChange={() => togglePermission(perm.key)}
                              class="w-5 h-5 rounded border-border-subtle bg-bg-tertiary"
                            />
                          </label>
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}

// Members Tab
interface ServerMember {
  id: string;
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
  roles: string[];
  joined_at: string;
}

function MembersTab() {
  const [searchQuery, setSearchQuery] = createSignal('');
  const [members, setMembers] = createSignal<ServerMember[]>([]);
  const [roles, setRoles] = createSignal<{ id: string; name: string; color: string | null; position?: number }[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [selectedMember, setSelectedMember] = createSignal<ServerMember | null>(null);
  const [actionInProgress, setActionInProgress] = createSignal<string | null>(null);
  const [editingRoles, setEditingRoles] = createSignal<string[]>([]);
  const [isEditingRoles, setIsEditingRoles] = createSignal(false);
  const [savingRoles, setSavingRoles] = createSignal(false);

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [membersData, rolesData] = await Promise.all([
        api.get<ServerMember[]>('/members'),
        api.get<{ id: string; name: string; color: string | null }[]>('/roles')
      ]);
      setMembers(membersData || []);
      setRoles(rolesData || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load members');
    } finally {
      setIsLoading(false);
    }
  };

  createEffect(() => {
    fetchData();
  });

  const filteredMembers = () => {
    const query = searchQuery().toLowerCase();
    if (!query) return members();
    return members().filter(m =>
      m.username.toLowerCase().includes(query) ||
      m.display_name?.toLowerCase().includes(query)
    );
  };

  const handleKick = async (member: ServerMember) => {
    const reason = prompt(`Kick ${member.username}? Enter a reason (optional):`);
    if (reason === null) return; // Cancelled

    setActionInProgress(member.id);
    try {
      await api.delete(`/members/${member.id}${reason ? `?reason=${encodeURIComponent(reason)}` : ''}`);
      setMembers(prev => prev.filter(m => m.id !== member.id));
      setSelectedMember(null);
    } catch (err: any) {
      alert(err?.message || 'Failed to kick member');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleBan = async (member: ServerMember) => {
    const reason = prompt(`Ban ${member.username}? Enter a reason (optional):`);
    if (reason === null) return; // Cancelled

    setActionInProgress(member.id);
    try {
      await api.post(`/members/${member.id}/ban`, { reason: reason || undefined });
      setMembers(prev => prev.filter(m => m.id !== member.id));
      setSelectedMember(null);
    } catch (err: any) {
      alert(err?.message || 'Failed to ban member');
    } finally {
      setActionInProgress(null);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString();
  };

  const getRoleById = (roleId: string) => roles().find(r => r.id === roleId);

  const startEditingRoles = (member: ServerMember) => {
    setEditingRoles([...member.roles]);
    setIsEditingRoles(true);
  };

  const cancelEditingRoles = () => {
    setIsEditingRoles(false);
    setEditingRoles([]);
  };

  const toggleRole = (roleId: string) => {
    setEditingRoles(prev =>
      prev.includes(roleId)
        ? prev.filter(id => id !== roleId)
        : [...prev, roleId]
    );
  };

  const handleSaveRoles = async () => {
    const member = selectedMember();
    if (!member) return;

    setSavingRoles(true);
    try {
      await api.patch(`/members/${member.id}`, { roles: editingRoles() });
      // Update the member in local state
      setMembers(prev => prev.map(m =>
        m.id === member.id ? { ...m, roles: editingRoles() } : m
      ));
      setSelectedMember({ ...member, roles: editingRoles() });
      setIsEditingRoles(false);
    } catch (err: any) {
      alert(err?.message || 'Failed to update roles');
    } finally {
      setSavingRoles(false);
    }
  };

  // Get assignable roles (exclude @everyone which has position 0)
  const assignableRoles = () => roles().filter(r => (r.position ?? 0) > 0).sort((a, b) => (b.position ?? 0) - (a.position ?? 0));

  return (
    <div>
      <div class="flex items-center justify-between mb-5">
        <h2 class="text-xl font-bold text-text-primary">Server Members</h2>
        <span class="text-sm text-text-muted">{members().length} members</span>
      </div>

      <div class="mb-4">
        <input
          type="text"
          value={searchQuery()}
          onInput={(e) => setSearchQuery(e.currentTarget.value)}
          placeholder="Search members..."
          class="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-primary"
        />
      </div>

      <Show when={isLoading()}>
        <div class="text-center py-8">
          <div class="text-text-muted">Loading members...</div>
        </div>
      </Show>

      <Show when={error()}>
        <div class="bg-danger/10 border border-danger/30 rounded-lg p-4 mb-4">
          <p class="text-sm text-danger">{error()}</p>
        </div>
      </Show>

      <Show when={!isLoading() && !error()}>
        <div class="space-y-1">
          <For each={filteredMembers()}>
            {(member) => (
              <div
                class={`flex items-center justify-between p-3 rounded-lg transition-colors cursor-pointer ${selectedMember()?.id === member.id ? 'bg-bg-modifier-selected' : 'hover:bg-bg-modifier-hover'
                  }`}
                onClick={() => setSelectedMember(selectedMember()?.id === member.id ? null : member)}
              >
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-full bg-bg-tertiary flex items-center justify-center overflow-hidden">
                    <Show
                      when={member.avatar_url}
                      fallback={
                        <span class="text-text-muted font-medium">
                          {member.username.charAt(0).toUpperCase()}
                        </span>
                      }
                    >
                      <img src={member.avatar_url!} alt={member.username} class="w-full h-full object-cover" />
                    </Show>
                  </div>
                  <div>
                    <div class="font-medium text-text-primary">
                      {member.display_name || member.username}
                      <Show when={member.display_name}>
                        <span class="text-text-muted text-sm ml-2">@{member.username}</span>
                      </Show>
                    </div>
                    <div class="flex items-center gap-1.5 flex-wrap">
                      <For each={member.roles}>
                        {(roleId) => {
                          const role = getRoleById(roleId);
                          return role ? (
                            <span
                              class="text-xs px-1.5 py-0.5 rounded"
                              style={{
                                background: role.color ? `${role.color}20` : 'var(--color-bg-tertiary)',
                                color: role.color || 'var(--color-text-muted)'
                              }}
                            >
                              {role.name}
                            </span>
                          ) : null;
                        }}
                      </For>
                    </div>
                  </div>
                </div>
                <div class="text-xs text-text-muted">
                  Joined {formatDate(member.joined_at)}
                </div>
              </div>
            )}
          </For>
        </div>

        {/* Member Actions */}
        <Show when={selectedMember()}>
          <div class="mt-4 p-4 bg-bg-secondary rounded-lg space-y-4">
            {/* Role Management */}
            <div>
              <div class="flex items-center justify-between mb-3">
                <h4 class="text-sm font-semibold text-text-muted uppercase">Roles</h4>
                <Show when={!isEditingRoles()}>
                  <button
                    onClick={() => startEditingRoles(selectedMember()!)}
                    class="text-xs text-brand-primary hover:text-brand-primary-hover transition-colors"
                  >
                    Edit Roles
                  </button>
                </Show>
              </div>

              <Show when={isEditingRoles()}>
                <div class="space-y-2 mb-3">
                  <For each={assignableRoles()}>
                    {(role) => (
                      <label
                        class="flex items-center gap-3 p-2 rounded hover:bg-bg-modifier-hover cursor-pointer transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={editingRoles().includes(role.id)}
                          onChange={() => toggleRole(role.id)}
                          class="w-4 h-4 rounded border-border-subtle bg-bg-tertiary"
                        />
                        <div
                          class="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ background: role.color || '#99aab5' }}
                        />
                        <span class="text-sm text-text-primary">{role.name}</span>
                      </label>
                    )}
                  </For>
                </div>
                <div class="flex gap-2">
                  <button
                    onClick={handleSaveRoles}
                    disabled={savingRoles()}
                    class="px-3 py-1.5 bg-success text-white text-sm font-medium rounded hover:bg-success/90 transition-colors disabled:opacity-50"
                  >
                    {savingRoles() ? 'Saving...' : 'Save Roles'}
                  </button>
                  <button
                    onClick={cancelEditingRoles}
                    disabled={savingRoles()}
                    class="px-3 py-1.5 bg-bg-tertiary text-text-muted text-sm font-medium rounded hover:bg-bg-modifier-hover transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </Show>

              <Show when={!isEditingRoles()}>
                <div class="flex items-center gap-1.5 flex-wrap">
                  <Show when={selectedMember()!.roles.length === 0}>
                    <span class="text-sm text-text-muted">No roles assigned</span>
                  </Show>
                  <For each={selectedMember()!.roles}>
                    {(roleId) => {
                      const role = getRoleById(roleId);
                      return role ? (
                        <span
                          class="text-xs px-2 py-1 rounded"
                          style={{
                            background: role.color ? `${role.color}20` : 'var(--color-bg-tertiary)',
                            color: role.color || 'var(--color-text-muted)'
                          }}
                        >
                          {role.name}
                        </span>
                      ) : null;
                    }}
                  </For>
                </div>
              </Show>
            </div>

            {/* Moderation Actions */}
            <div class="border-t border-border-subtle pt-4">
              <h4 class="text-sm font-semibold text-text-muted uppercase mb-3">
                Moderation
              </h4>
              <div class="flex gap-2">
                <button
                  onClick={() => handleKick(selectedMember()!)}
                  disabled={actionInProgress() === selectedMember()!.id}
                  class="px-3 py-1.5 bg-warning/20 text-warning text-sm font-medium rounded hover:bg-warning/30 transition-colors disabled:opacity-50"
                >
                  {actionInProgress() === selectedMember()!.id ? 'Processing...' : 'Kick'}
                </button>
                <button
                  onClick={() => handleBan(selectedMember()!)}
                  disabled={actionInProgress() === selectedMember()!.id}
                  class="px-3 py-1.5 bg-danger/20 text-danger text-sm font-medium rounded hover:bg-danger/30 transition-colors disabled:opacity-50"
                >
                  {actionInProgress() === selectedMember()!.id ? 'Processing...' : 'Ban'}
                </button>
              </div>
            </div>
          </div>
        </Show>
      </Show>
    </div>
  );
}

// Channels Tab
// Channels Tab
interface ChannelCategory {
  id: string;
  name: string;
  position: number;
}

interface ChannelData {
  id: string;
  name: string;
  type: 'text' | 'voice' | 'announcement';
  category_id: string | null;
  position: number;
  topic?: string;
  slowmode_seconds?: number;
}

function ChannelsTab() {
  const [channels, setChannels] = createSignal<ChannelData[]>([]);
  const [categories, setCategories] = createSignal<ChannelCategory[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [showCreateChannel, setShowCreateChannel] = createSignal(false);
  const [showCreateCategory, setShowCreateCategory] = createSignal(false);

  // Form states
  const [newChannelName, setNewChannelName] = createSignal('');
  const [newChannelType, setNewChannelType] = createSignal<'text' | 'voice' | 'announcement'>('text');
  const [newChannelCategory, setNewChannelCategory] = createSignal<string | null>(null);
  const [newCategoryName, setNewCategoryName] = createSignal('');
  const [actionInProgress, setActionInProgress] = createSignal(false);

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Fetch channels first - this is required
      const channelsData = await api.get<ChannelData[]>('/channels');
      setChannels(channelsData || []);

      // Try to fetch categories, but don't fail if it errors
      try {
        const categoriesData = await api.get<ChannelCategory[]>('/categories');
        setCategories(categoriesData || []);
      } catch (catErr) {
        // Categories endpoint might not exist or return an error
        // This is not critical - continue without categories
        console.warn('[ServerSettingsModal] /categories endpoint failed, continuing without categories:', catErr);
        setCategories([]);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load channels');
    } finally {
      setIsLoading(false);
    }
  };

  createEffect(() => {
    fetchData();
  });

  const getChannelsByCategory = (categoryId: string | null) => {
    return channels()
      .filter(c => c.category_id === categoryId)
      .sort((a, b) => a.position - b.position);
  };

  const handleCreateChannel = async () => {
    if (!newChannelName().trim()) return;

    setActionInProgress(true);
    try {
      const newChannel = await api.post<ChannelData>('/channels', {
        name: newChannelName().trim(),
        type: newChannelType(),
        category_id: newChannelCategory()
      });
      setChannels(prev => [...prev, newChannel]);
      setShowCreateChannel(false);
      setNewChannelName('');
      setNewChannelType('text');
      setNewChannelCategory(null);
    } catch (err: any) {
      alert(err?.message || 'Failed to create channel');
    } finally {
      setActionInProgress(false);
    }
  };

  const handleCreateCategory = async () => {
    if (!newCategoryName().trim()) return;

    setActionInProgress(true);
    try {
      const newCategory = await api.post<ChannelCategory>('/categories', {
        name: newCategoryName().trim()
      });
      setCategories(prev => [...prev, newCategory]);
      setShowCreateCategory(false);
      setNewCategoryName('');
    } catch (err: any) {
      alert(err?.message || 'Failed to create category');
    } finally {
      setActionInProgress(false);
    }
  };

  const handleDeleteChannel = async (channel: ChannelData) => {
    if (!confirm(`Delete channel #${channel.name}? This cannot be undone.`)) return;

    try {
      await api.delete(`/channels/${channel.id}`);
      setChannels(prev => prev.filter(c => c.id !== channel.id));
    } catch (err: any) {
      alert(err?.message || 'Failed to delete channel');
    }
  };

  const handleDeleteCategory = async (category: ChannelCategory) => {
    const channelsInCategory = getChannelsByCategory(category.id);
    if (channelsInCategory.length > 0) {
      alert('Cannot delete category with channels. Move or delete channels first.');
      return;
    }
    if (!confirm(`Delete category "${category.name}"?`)) return;

    try {
      await api.delete(`/categories/${category.id}`);
      setCategories(prev => prev.filter(c => c.id !== category.id));
    } catch (err: any) {
      alert(err?.message || 'Failed to delete category');
    }
  };

  const getChannelIcon = (type: string) => {
    switch (type) {
      case 'voice':
        return (
          <svg class="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M9 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        );
      case 'announcement':
        return (
          <svg class="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
          </svg>
        );
      default:
        return (
          <svg class="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
          </svg>
        );
    }
  };

  return (
    <div>
      <div class="flex items-center justify-between mb-5">
        <h2 class="text-xl font-bold text-text-primary">Channels</h2>
        <div class="flex gap-2">
          <button
            onClick={() => setShowCreateCategory(true)}
            class="px-4 py-2 bg-bg-secondary hover:bg-bg-modifier-hover text-text-primary text-sm font-medium rounded transition-colors"
          >
            Create Category
          </button>
          <button
            onClick={() => setShowCreateChannel(true)}
            class="px-4 py-2 bg-brand-primary hover:bg-brand-primary-hover text-white text-sm font-medium rounded transition-colors"
          >
            Create Channel
          </button>
        </div>
      </div>

      <Show when={isLoading()}>
        <div class="text-center py-8">
          <div class="text-text-muted">Loading channels...</div>
        </div>
      </Show>

      <Show when={error()}>
        <div class="bg-danger/10 border border-danger/30 rounded-lg p-4 mb-4">
          <p class="text-sm text-danger">{error()}</p>
        </div>
      </Show>

      <Show when={!isLoading() && !error()}>
        {/* Uncategorized channels */}
        <Show when={getChannelsByCategory(null).length > 0}>
          <div class="mb-4">
            <h3 class="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
              Uncategorized
            </h3>
            <div class="space-y-1">
              <For each={getChannelsByCategory(null)}>
                {(channel) => (
                  <div class="flex items-center justify-between p-2 rounded hover:bg-bg-modifier-hover group">
                    <div class="flex items-center gap-2">
                      {getChannelIcon(channel.type)}
                      <span class="text-text-primary">{channel.name}</span>
                      <span class="text-xs text-text-muted capitalize">({channel.type})</span>
                    </div>
                    <button
                      onClick={() => handleDeleteChannel(channel)}
                      class="opacity-0 group-hover:opacity-100 p-1 text-danger hover:bg-danger/20 rounded transition-all"
                    >
                      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* Categories with channels */}
        <For each={categories().sort((a, b) => a.position - b.position)}>
          {(category) => (
            <div class="mb-4">
              <div class="flex items-center justify-between group">
                <h3 class="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
                  {category.name}
                </h3>
                <button
                  onClick={() => handleDeleteCategory(category)}
                  class="opacity-0 group-hover:opacity-100 p-1 text-danger hover:bg-danger/20 rounded transition-all"
                  title="Delete category"
                >
                  <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div class="space-y-1">
                <For each={getChannelsByCategory(category.id)}>
                  {(channel) => (
                    <div class="flex items-center justify-between p-2 rounded hover:bg-bg-modifier-hover group">
                      <div class="flex items-center gap-2">
                        {getChannelIcon(channel.type)}
                        <span class="text-text-primary">{channel.name}</span>
                        <span class="text-xs text-text-muted capitalize">({channel.type})</span>
                      </div>
                      <button
                        onClick={() => handleDeleteChannel(channel)}
                        class="opacity-0 group-hover:opacity-100 p-1 text-danger hover:bg-danger/20 rounded transition-all"
                      >
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  )}
                </For>
                <Show when={getChannelsByCategory(category.id).length === 0}>
                  <p class="text-sm text-text-muted italic px-2">No channels in this category</p>
                </Show>
              </div>
            </div>
          )}
        </For>

        <Show when={channels().length === 0 && categories().length === 0}>
          <div class="text-center py-8">
            <p class="text-text-muted">No channels yet. Create your first channel!</p>
          </div>
        </Show>
      </Show>

      {/* Create Channel Modal */}
      <Show when={showCreateChannel()}>
        <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div class="bg-bg-primary rounded-lg p-6 w-full max-w-md">
            <h3 class="text-lg font-bold text-text-primary mb-4">Create Channel</h3>

            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-text-secondary mb-1">Channel Name</label>
                <input
                  type="text"
                  value={newChannelName()}
                  onInput={(e) => setNewChannelName(e.currentTarget.value)}
                  placeholder="general"
                  class="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-primary"
                />
              </div>

              <div>
                <label class="block text-sm font-medium text-text-secondary mb-1">Channel Type</label>
                <select
                  value={newChannelType()}
                  onChange={(e) => setNewChannelType(e.currentTarget.value as any)}
                  class="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary"
                >
                  <option value="text">Text</option>
                  <option value="voice">Voice</option>
                  <option value="announcement">Announcement</option>
                </select>
              </div>

              <div>
                <label class="block text-sm font-medium text-text-secondary mb-1">Category (optional)</label>
                <select
                  value={newChannelCategory() || ''}
                  onChange={(e) => setNewChannelCategory(e.currentTarget.value || null)}
                  class="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary"
                >
                  <option value="">No category</option>
                  <For each={categories()}>
                    {(cat) => <option value={cat.id}>{cat.name}</option>}
                  </For>
                </select>
              </div>
            </div>

            <div class="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowCreateChannel(false)}
                class="px-4 py-2 bg-bg-secondary hover:bg-bg-modifier-hover text-text-primary text-sm font-medium rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateChannel}
                disabled={!newChannelName().trim() || actionInProgress()}
                class="px-4 py-2 bg-brand-primary hover:bg-brand-primary-hover text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
              >
                {actionInProgress() ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* Create Category Modal */}
      <Show when={showCreateCategory()}>
        <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div class="bg-bg-primary rounded-lg p-6 w-full max-w-md">
            <h3 class="text-lg font-bold text-text-primary mb-4">Create Category</h3>

            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1">Category Name</label>
              <input
                type="text"
                value={newCategoryName()}
                onInput={(e) => setNewCategoryName(e.currentTarget.value)}
                placeholder="TEXT CHANNELS"
                class="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-primary"
              />
            </div>

            <div class="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowCreateCategory(false)}
                class="px-4 py-2 bg-bg-secondary hover:bg-bg-modifier-hover text-text-primary text-sm font-medium rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateCategory}
                disabled={!newCategoryName().trim() || actionInProgress()}
                class="px-4 py-2 bg-brand-primary hover:bg-brand-primary-hover text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
              >
                {actionInProgress() ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}

// Invites Tab
interface Invite {
  code: string;
  created_by: string;
  created_by_username: string;
  created_at: string;
  expires_at: string | null;
  max_uses: number | null;
  uses: number;
}

function InvitesTab() {
  const [invites, setInvites] = createSignal<Invite[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [showCreateModal, setShowCreateModal] = createSignal(false);
  const [copiedCode, setCopiedCode] = createSignal<string | null>(null);

  // Create form states
  const [expiresIn, setExpiresIn] = createSignal<string>('1d');
  const [maxUses, setMaxUses] = createSignal<string>('');
  const [actionInProgress, setActionInProgress] = createSignal(false);

  const fetchInvites = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.get<Invite[]>('/invites');
      setInvites(data || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load invites');
    } finally {
      setIsLoading(false);
    }
  };

  createEffect(() => {
    fetchInvites();
  });

  const handleCreateInvite = async () => {
    setActionInProgress(true);
    try {
      const body: Record<string, any> = {};

      // Convert expiresIn to actual expiry
      if (expiresIn() !== 'never') {
        const hours = {
          '30m': 0.5,
          '1h': 1,
          '6h': 6,
          '12h': 12,
          '1d': 24,
          '7d': 168,
        }[expiresIn()] || 24;

        const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
        body.expires_at = expiresAt.toISOString();
      }

      if (maxUses() && parseInt(maxUses()) > 0) {
        body.max_uses = parseInt(maxUses());
      }

      const newInvite = await api.post<Invite>('/invites', body);
      setInvites(prev => [newInvite, ...prev]);
      setShowCreateModal(false);
      setExpiresIn('1d');
      setMaxUses('');
    } catch (err: any) {
      alert(err?.message || 'Failed to create invite');
    } finally {
      setActionInProgress(false);
    }
  };

  const handleDeleteInvite = async (code: string) => {
    if (!confirm('Delete this invite link?')) return;

    try {
      await api.delete(`/invites/${code}`);
      setInvites(prev => prev.filter(i => i.code !== code));
    } catch (err: any) {
      alert(err?.message || 'Failed to delete invite');
    }
  };

  const copyToClipboard = async (code: string) => {
    const inviteUrl = `${window.location.origin}/invite/${code}`;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch (err) {
      // Fallback
      prompt('Copy this invite link:', inviteUrl);
    }
  };

  const formatExpiry = (expiresAt: string | null) => {
    if (!expiresAt) return 'Never';
    const date = new Date(expiresAt);
    if (date < new Date()) return 'Expired';
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  const isExpired = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  };

  return (
    <div>
      <div class="flex items-center justify-between mb-5">
        <h2 class="text-xl font-bold text-text-primary">Invites</h2>
        <button
          onClick={() => setShowCreateModal(true)}
          class="px-4 py-2 bg-brand-primary hover:bg-brand-primary-hover text-white text-sm font-medium rounded transition-colors"
        >
          Create Invite
        </button>
      </div>

      <p class="text-sm text-text-muted mb-4">
        Create invite links to share with others. You can set expiration times and usage limits.
      </p>

      <Show when={isLoading()}>
        <div class="text-center py-8">
          <div class="text-text-muted">Loading invites...</div>
        </div>
      </Show>

      <Show when={error()}>
        <div class="bg-danger/10 border border-danger/30 rounded-lg p-4 mb-4">
          <p class="text-sm text-danger">{error()}</p>
        </div>
      </Show>

      <Show when={!isLoading() && !error()}>
        <Show when={invites().length === 0}>
          <div class="bg-bg-secondary rounded-lg p-4">
            <div class="text-sm text-text-muted">No active invites. Create one to invite people to your server!</div>
          </div>
        </Show>

        <Show when={invites().length > 0}>
          <div class="space-y-2">
            <For each={invites()}>
              {(invite) => (
                <div class={`flex items-center justify-between p-3 rounded-lg ${isExpired(invite.expires_at) ? 'bg-bg-secondary/50 opacity-60' : 'bg-bg-secondary'
                  }`}>
                  <div class="flex-1">
                    <div class="flex items-center gap-2">
                      <code class="text-brand-primary font-mono text-sm">{invite.code}</code>
                      <Show when={isExpired(invite.expires_at)}>
                        <span class="text-xs px-1.5 py-0.5 rounded bg-danger/20 text-danger">Expired</span>
                      </Show>
                    </div>
                    <div class="text-xs text-text-muted mt-1">
                      Created by {invite.created_by_username} •
                      Uses: {invite.uses}{invite.max_uses ? `/${invite.max_uses}` : ''} •
                      Expires: {formatExpiry(invite.expires_at)}
                    </div>
                  </div>
                  <div class="flex items-center gap-2">
                    <button
                      onClick={() => copyToClipboard(invite.code)}
                      class="p-2 text-text-secondary hover:text-text-primary hover:bg-bg-modifier-hover rounded transition-colors"
                      title="Copy invite link"
                    >
                      <Show
                        when={copiedCode() === invite.code}
                        fallback={
                          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        }
                      >
                        <svg class="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                        </svg>
                      </Show>
                    </button>
                    <button
                      onClick={() => handleDeleteInvite(invite.code)}
                      class="p-2 text-danger hover:bg-danger/20 rounded transition-colors"
                      title="Delete invite"
                    >
                      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>

      {/* Create Invite Modal */}
      <Show when={showCreateModal()}>
        <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div class="bg-bg-primary rounded-lg p-6 w-full max-w-md">
            <h3 class="text-lg font-bold text-text-primary mb-4">Create Invite Link</h3>

            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-text-secondary mb-1">Expire After</label>
                <select
                  value={expiresIn()}
                  onChange={(e) => setExpiresIn(e.currentTarget.value)}
                  class="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary"
                >
                  <option value="30m">30 minutes</option>
                  <option value="1h">1 hour</option>
                  <option value="6h">6 hours</option>
                  <option value="12h">12 hours</option>
                  <option value="1d">1 day</option>
                  <option value="7d">7 days</option>
                  <option value="never">Never</option>
                </select>
              </div>

              <div>
                <label class="block text-sm font-medium text-text-secondary mb-1">Max Number of Uses</label>
                <input
                  type="number"
                  value={maxUses()}
                  onInput={(e) => setMaxUses(e.currentTarget.value)}
                  placeholder="No limit"
                  min="1"
                  class="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-primary"
                />
                <p class="text-xs text-text-muted mt-1">Leave blank for unlimited uses</p>
              </div>
            </div>

            <div class="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowCreateModal(false)}
                class="px-4 py-2 bg-bg-secondary hover:bg-bg-modifier-hover text-text-primary text-sm font-medium rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateInvite}
                disabled={actionInProgress()}
                class="px-4 py-2 bg-brand-primary hover:bg-brand-primary-hover text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
              >
                {actionInProgress() ? 'Creating...' : 'Create Invite'}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}

// Bans Tab
interface BannedUser {
  user_id: string;
  username: string;
  avatar_url?: string | null;
  reason?: string;
  banned_by: string;
  banned_at: string;
}

function BansTab() {
  const [searchQuery, setSearchQuery] = createSignal('');
  const [bans, setBans] = createSignal<BannedUser[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [unbanningId, setUnbanningId] = createSignal<string | null>(null);

  const fetchBans = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.get<BannedUser[]>('/bans');
      setBans(data || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load bans');
    } finally {
      setIsLoading(false);
    }
  };

  createEffect(() => {
    fetchBans();
  });

  const handleUnban = async (userId: string) => {
    if (!confirm('Are you sure you want to unban this user?')) return;

    setUnbanningId(userId);
    try {
      await api.delete(`/bans/${userId}`);
      setBans(prev => prev.filter(b => b.user_id !== userId));
    } catch (err: any) {
      alert(err?.message || 'Failed to unban user');
    } finally {
      setUnbanningId(null);
    }
  };

  const filteredBans = () => {
    const query = searchQuery().toLowerCase();
    if (!query) return bans();
    return bans().filter(b => b.username.toLowerCase().includes(query));
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString();
  };

  return (
    <div>
      <h2 class="text-xl font-bold text-text-primary mb-5">Server Bans</h2>

      <div class="mb-4">
        <input
          type="text"
          value={searchQuery()}
          onInput={(e) => setSearchQuery(e.currentTarget.value)}
          placeholder="Search bans by username..."
          class="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-primary"
        />
      </div>

      <Show when={isLoading()}>
        <div class="text-center py-8">
          <div class="text-text-muted">Loading bans...</div>
        </div>
      </Show>

      <Show when={error()}>
        <div class="bg-danger/10 border border-danger/30 rounded-lg p-4 mb-4">
          <p class="text-sm text-danger">{error()}</p>
        </div>
      </Show>

      <Show when={!isLoading() && !error()}>
        <Show
          when={filteredBans().length > 0}
          fallback={
            <div class="bg-bg-secondary rounded-lg p-4">
              <div class="text-sm text-text-muted">
                {searchQuery() ? 'No bans match your search.' : 'No banned users.'}
              </div>
            </div>
          }
        >
          <div class="space-y-2">
            <For each={filteredBans()}>
              {(ban) => (
                <div class="flex items-center justify-between p-3 bg-bg-secondary rounded-lg">
                  <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full bg-bg-tertiary flex items-center justify-center overflow-hidden">
                      <Show
                        when={ban.avatar_url}
                        fallback={
                          <span class="text-text-muted font-medium">
                            {ban.username.charAt(0).toUpperCase()}
                          </span>
                        }
                      >
                        <img src={ban.avatar_url!} alt={ban.username} class="w-full h-full object-cover" />
                      </Show>
                    </div>
                    <div>
                      <div class="font-medium text-text-primary">{ban.username}</div>
                      <div class="text-xs text-text-muted">
                        Banned on {formatDate(ban.banned_at)}
                        <Show when={ban.reason}>
                          <span> • {ban.reason}</span>
                        </Show>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleUnban(ban.user_id)}
                    disabled={unbanningId() === ban.user_id}
                    class="px-3 py-1.5 bg-success/20 text-success text-sm font-medium rounded hover:bg-success/30 transition-colors disabled:opacity-50"
                  >
                    {unbanningId() === ban.user_id ? 'Unbanning...' : 'Unban'}
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}

// Audit Log Tab
interface AuditLogEntry {
  id: string;
  action: string;
  user: {
    id: string;
    username: string;
    avatar_url?: string | null;
  };
  target_type?: string;
  target_id?: string;
  target_name?: string;
  changes?: Record<string, { old: any; new: any }>;
  reason?: string;
  created_at: string;
}

function AuditLogTab() {
  const [entries, setEntries] = createSignal<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);
  const [actionFilter, setActionFilter] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);

  const actionTypes = [
    { value: '', label: 'All Actions' },
    { value: 'server_update', label: 'Server Update' },
    { value: 'channel_create', label: 'Channel Create' },
    { value: 'channel_update', label: 'Channel Update' },
    { value: 'channel_delete', label: 'Channel Delete' },
    { value: 'role_create', label: 'Role Create' },
    { value: 'role_update', label: 'Role Update' },
    { value: 'role_delete', label: 'Role Delete' },
    { value: 'member_kick', label: 'Member Kick' },
    { value: 'member_ban', label: 'Member Ban' },
    { value: 'member_unban', label: 'Member Unban' },
    { value: 'invite_create', label: 'Invite Create' },
    { value: 'invite_delete', label: 'Invite Delete' },
    { value: 'message_delete', label: 'Message Delete' },
  ];

  const fetchAuditLog = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (actionFilter()) params.append('action', actionFilter());
      params.append('limit', '50');

      const data = await api.get<{ entries: AuditLogEntry[] }>(`/audit-log?${params}`);
      setEntries(data.entries || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load audit log');
    } finally {
      setIsLoading(false);
    }
  };

  createEffect(() => {
    fetchAuditLog();
  });

  const formatAction = (action: string) => {
    return action.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  const getActionIcon = (action: string) => {
    if (action.includes('create')) return '➕';
    if (action.includes('delete')) return '🗑️';
    if (action.includes('update')) return '✏️';
    if (action.includes('ban')) return '🔨';
    if (action.includes('kick')) return '👢';
    if (action.includes('unban')) return '✅';
    return '📝';
  };

  return (
    <div>
      <h2 class="text-xl font-bold text-text-primary mb-5">Audit Log</h2>

      <p class="text-sm text-text-muted mb-4">
        View a record of all administrative actions taken in this server.
      </p>

      <div class="flex gap-2 mb-4">
        <select
          value={actionFilter()}
          onChange={(e) => { setActionFilter(e.currentTarget.value); fetchAuditLog(); }}
          class="px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary"
        >
          <For each={actionTypes}>
            {(type) => <option value={type.value}>{type.label}</option>}
          </For>
        </select>
        <button
          onClick={fetchAuditLog}
          class="px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary hover:bg-bg-modifier-hover transition-colors"
        >
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      <Show when={isLoading()}>
        <div class="text-center py-8">
          <div class="text-text-muted">Loading audit log...</div>
        </div>
      </Show>

      <Show when={error()}>
        <div class="bg-danger/10 border border-danger/30 rounded-lg p-4 mb-4">
          <p class="text-sm text-danger">{error()}</p>
        </div>
      </Show>

      <Show when={!isLoading() && !error()}>
        <Show
          when={entries().length > 0}
          fallback={
            <div class="text-center py-8">
              <p class="text-text-muted">No audit log entries found.</p>
            </div>
          }
        >
          <div class="space-y-2">
            <For each={entries()}>
              {(entry) => (
                <div class="p-3 bg-bg-secondary rounded-lg">
                  <div class="flex items-start gap-3">
                    <span class="text-lg">{getActionIcon(entry.action)}</span>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 mb-1">
                        <span class="font-medium text-text-primary">{entry.user.username}</span>
                        <span class="text-text-muted">{formatAction(entry.action)}</span>
                        <Show when={entry.target_name}>
                          <span class="text-text-secondary">{entry.target_name}</span>
                        </Show>
                      </div>
                      <Show when={entry.reason}>
                        <p class="text-sm text-text-muted mb-1">Reason: {entry.reason}</p>
                      </Show>
                      <Show when={entry.changes}>
                        <div class="text-xs text-text-muted">
                          <For each={Object.entries(entry.changes || {})}>
                            {([key, change]) => (
                              <div>{key}: {String(change.old)} → {String(change.new)}</div>
                            )}
                          </For>
                        </div>
                      </Show>
                      <div class="text-xs text-text-muted mt-1">{formatDate(entry.created_at)}</div>
                    </div>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}
