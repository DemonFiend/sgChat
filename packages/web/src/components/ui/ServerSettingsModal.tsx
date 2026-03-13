import { useState, useEffect, useMemo, useCallback, useRef, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { api } from '@/api';
import { permissions } from '@/stores';
import { toastStore } from '@/stores/toastNotifications';
import { ServerPopupConfigForm } from './ServerPopupConfigForm';
import { RoleReactionsTab } from './RoleReactionsTab';
import { StorageTab } from './StorageTab';
import {
  ServerPermissionMetadata,
  TextPermissionMetadata,
  VoicePermissionMetadata,
  type PermissionState,
} from '@sgchat/shared';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// ── Permission groups built from shared metadata ─────────────────────

interface PermGroupItem {
  key: string;       // Named permission key (lowercase) matching NamedPermissions
  label: string;
  description: string;
  dangerous?: boolean;
}

interface PermGroup {
  name: string;
  category: string;
  permissions: PermGroupItem[];
}

// Maps UPPERCASE metadata keys → lowercase NamedPermissions keys
const TEXT_PERM_KEY_MAP: Record<string, string> = {
  VIEW_CHANNEL: 'view_channel',
  SEND_MESSAGES: 'send_messages',
  SEND_TTS_MESSAGES: 'send_tts_messages',
  READ_MESSAGE_HISTORY: 'read_message_history',
  EMBED_LINKS: 'embed_links',
  ATTACH_FILES: 'attach_files',
  USE_EXTERNAL_EMOJIS: 'use_external_emojis',
  USE_EXTERNAL_STICKERS: 'use_external_stickers',
  ADD_REACTIONS: 'add_reactions',
  MENTION_EVERYONE: 'mention_everyone',
  MENTION_ROLES: 'mention_roles',
  MANAGE_MESSAGES: 'manage_messages',
  DELETE_OWN_MESSAGES: 'delete_own_messages',
  EDIT_OWN_MESSAGES: 'edit_own_messages',
  CREATE_PUBLIC_THREADS: 'create_public_threads_text',
  CREATE_PRIVATE_THREADS: 'create_private_threads_text',
  SEND_MESSAGES_IN_THREADS: 'send_messages_in_threads',
  MANAGE_THREADS: 'manage_threads_text',
  USE_APPLICATION_COMMANDS: 'use_application_commands',
  MANAGE_WEBHOOKS: 'manage_webhooks_text',
  BYPASS_SLOWMODE: 'bypass_slowmode',
};

const VOICE_PERM_KEY_MAP: Record<string, string> = {
  CONNECT: 'connect',
  VIEW_CHANNEL: 'view_voice_channel',
  SPEAK: 'speak',
  VIDEO: 'video',
  STREAM: 'stream',
  USE_VOICE_ACTIVITY: 'use_voice_activity',
  PRIORITY_SPEAKER: 'priority_speaker',
  USE_SOUNDBOARD: 'use_soundboard',
  USE_EXTERNAL_SOUNDS: 'use_external_sounds',
  MUTE_MEMBERS: 'mute_members',
  DEAFEN_MEMBERS: 'deafen_members',
  MOVE_MEMBERS: 'move_members',
  DISCONNECT_MEMBERS: 'disconnect_members',
  REQUEST_TO_SPEAK: 'request_to_speak',
  MANAGE_STAGE: 'manage_stage',
  MANAGE_VOICE_CHANNEL: 'manage_voice_channel',
  SET_VOICE_STATUS: 'set_voice_status',
};

function buildPermissionGroups(): PermGroup[] {
  const groups: Record<string, PermGroupItem[]> = {
    general: [],
    membership: [],
    text: [],
    voice: [],
    advanced: [],
  };

  // Server permissions (simple lowercase)
  for (const [metaKey, meta] of Object.entries(ServerPermissionMetadata)) {
    const namedKey = metaKey.toLowerCase();
    (groups[meta.category] ?? groups.advanced).push({
      key: namedKey,
      label: meta.name,
      description: meta.description,
      dangerous: meta.dangerous,
    });
  }

  // Text permissions
  for (const [metaKey, meta] of Object.entries(TextPermissionMetadata)) {
    const namedKey = TEXT_PERM_KEY_MAP[metaKey];
    if (!namedKey) continue;
    const cat = meta.category === 'advanced' ? 'advanced' : 'text';
    (groups[cat] ?? groups.advanced).push({
      key: namedKey,
      label: meta.name,
      description: meta.description,
      dangerous: meta.dangerous,
    });
  }

  // Voice permissions
  for (const [metaKey, meta] of Object.entries(VoicePermissionMetadata)) {
    const namedKey = VOICE_PERM_KEY_MAP[metaKey];
    if (!namedKey) continue;
    groups.voice.push({
      key: namedKey,
      label: meta.name,
      description: meta.description,
      dangerous: meta.dangerous,
    });
  }

  return [
    { name: 'General', category: 'general', permissions: groups.general },
    { name: 'Membership', category: 'membership', permissions: groups.membership },
    { name: 'Text Channels', category: 'text', permissions: groups.text },
    { name: 'Voice Channels', category: 'voice', permissions: groups.voice },
    { name: 'Advanced', category: 'advanced', permissions: groups.advanced },
  ].filter((g) => g.permissions.length > 0);
}

const PERMISSION_GROUPS = buildPermissionGroups();

// Dangerous permissions set (from metadata)
const DANGEROUS_PERMS = new Set<string>();
for (const [metaKey, meta] of Object.entries(ServerPermissionMetadata)) {
  if (meta.dangerous) DANGEROUS_PERMS.add(metaKey.toLowerCase());
}
for (const [metaKey, meta] of Object.entries(TextPermissionMetadata)) {
  if (meta.dangerous) DANGEROUS_PERMS.add(TEXT_PERM_KEY_MAP[metaKey]);
}
for (const [metaKey, meta] of Object.entries(VoicePermissionMetadata)) {
  if (meta.dangerous) DANGEROUS_PERMS.add(VOICE_PERM_KEY_MAP[metaKey]);
}

// ── End permission groups ────────────────────────────────────────────

type ServerSettingsTab = 'general' | 'roles' | 'role-reactions' | 'members' | 'channels' | 'soundboard' | 'stickers' | 'emoji-packs' | 'webhooks' | 'afk' | 'invites' | 'bans' | 'audit-log' | 'storage' | 'relays' | 'crash-reports' | 'releases';

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
  afk_timeout?: number;
  afk_channel_id?: string | null;
  settings?: ServerSettings;
}

interface Channel {
  id: string;
  name: string;
  type: 'text' | 'voice' | 'announcement' | 'music' | 'temp_voice_generator' | 'temp_voice';
}

interface ServerSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  serverName: string;
  serverIcon?: string | null;
  serverOwnerId?: string;
  onTransferOwnership?: () => void;
  initialTab?: ServerSettingsTab;
}

const tabs: { id: ServerSettingsTab; label: string; icon: ReactNode; permission?: string }[] = [
  {
    id: 'general',
    label: 'General',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    permission: 'manage_server',
  },
  {
    id: 'roles',
    label: 'Roles',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
    permission: 'manage_roles',
  },
  {
    id: 'role-reactions',
    label: 'Role Reactions',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    permission: 'manage_roles',
  },
  {
    id: 'members',
    label: 'Members',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    ),
    permission: 'manage_members',
  },
  {
    id: 'channels',
    label: 'Channels',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
      </svg>
    ),
    permission: 'manage_channels',
  },
  {
    id: 'soundboard',
    label: 'Soundboard',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
      </svg>
    ),
    permission: 'manage_server',
  },
  {
    id: 'stickers',
    label: 'Stickers',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
    permission: 'manage_stickers',
  },
  {
    id: 'emoji-packs',
    label: 'Emoji Packs',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    permission: 'manage_emojis',
  },
  {
    id: 'webhooks',
    label: 'Webhooks',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
      </svg>
    ),
    permission: 'manage_webhooks',
  },
  {
    id: 'afk',
    label: 'AFK',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
      </svg>
    ),
    permission: 'manage_server',
  },
  {
    id: 'invites',
    label: 'Invites',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
      </svg>
    ),
    permission: 'manage_invites',
  },
  {
    id: 'bans',
    label: 'Bans',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
      </svg>
    ),
    permission: 'ban_members',
  },
  {
    id: 'audit-log',
    label: 'Audit Log',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
      </svg>
    ),
    permission: 'view_audit_log',
  },
  {
    id: 'storage',
    label: 'Storage',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
      </svg>
    ),
    permission: 'manage_server',
  },
  {
    id: 'relays',
    label: 'Relay Servers',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
      </svg>
    ),
    permission: 'administrator',
  },
  {
    id: 'crash-reports',
    label: 'Crash Reports',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
      </svg>
    ),
    permission: 'manage_server',
  },
  {
    id: 'releases',
    label: 'Releases',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
      </svg>
    ),
    permission: 'manage_server',
  },
];

export function ServerSettingsModal({ isOpen, onClose, serverName, serverIcon: _serverIcon, serverOwnerId, onTransferOwnership, initialTab }: ServerSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<ServerSettingsTab>(initialTab || 'general');
  const [serverData, setServerData] = useState<ServerData | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Check permissions using the new named boolean system
  const hasPermission = (permission?: string) => {
    if (!permission) return true;
    // Owner always has access
    if (permissions.isOwner(serverOwnerId)) return true;
    // Admin always has access
    if (permissions.isAdmin()) return true;
    // Check specific permission
    return permissions.hasPermission(permission as any);
  };

  const visibleTabs = tabs.filter((tab) => hasPermission(tab.permission));

  // Set initial tab when modal opens
  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    } else if (isOpen) {
      setActiveTab('general');
    }
  }, [isOpen, initialTab]);

  // Fetch server data when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchServerData();
    }
  }, [isOpen]);

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex bg-bg-primary animate-in fade-in duration-200"
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label="Server Settings"
    >
      {/* Sidebar */}
      <div className="w-[218px] bg-bg-secondary flex flex-col">
        <div className="flex-1 overflow-y-auto py-[60px] px-[6px]">
          <div className="pr-2">
            <div className="px-2 pb-1.5">
              <span className="text-xs font-bold uppercase text-text-muted tracking-wide truncate" title={serverName}>
                {serverName}
              </span>
            </div>
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={clsx(
                  'w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-sm transition-colors',
                  activeTab === tab.id
                    ? 'bg-bg-modifier-selected text-text-primary'
                    : 'text-text-muted hover:bg-bg-modifier-hover hover:text-text-primary'
                )}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}

            <div className="h-px bg-border-subtle my-2 mx-2" />

            {/* Danger Zone */}
            <div className="px-2 pb-1.5 pt-2">
              <span className="text-xs font-bold uppercase text-danger tracking-wide">
                Danger Zone
              </span>
            </div>
            <button className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-sm text-danger hover:bg-danger/10 transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Leave Server
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col bg-bg-primary">
        {/* Close button */}
        <div className="absolute top-4 right-4 z-10">
          <button
            onClick={onClose}
            className="p-2 rounded-full border-2 border-text-muted text-text-muted hover:border-text-primary hover:text-text-primary transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div className="text-xs text-text-muted text-center mt-1">ESC</div>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto py-[60px] px-10">
          <div className="max-w-[740px] mx-auto">
            {isLoading ? (
              <div className="flex items-center justify-center h-64">
                <div className="text-text-muted">Loading...</div>
              </div>
            ) : (
              <>
                {activeTab === 'general' && (
                  <ServerPopupConfigForm
                    serverId={serverData?.id || ''}
                    isOwner={permissions.isOwner(serverOwnerId)}
                    onTransferOwnership={onTransferOwnership}
                    onSaveSuccess={fetchServerData}
                  />
                )}
                {activeTab === 'roles' && <RolesTab />}
                {activeTab === 'role-reactions' && (
                  <RoleReactionsTab serverId={serverData?.id || ''} channels={channels} />
                )}
                {activeTab === 'members' && <MembersTab />}
                {activeTab === 'channels' && (
                  <ChannelsTab serverData={serverData} onRefresh={fetchServerData} />
                )}
                {activeTab === 'invites' && <InvitesTab />}
                {activeTab === 'bans' && <BansTab />}
                {activeTab === 'soundboard' && (
                  <SoundboardSettingsTab serverId={serverData?.id || ''} />
                )}
                {activeTab === 'stickers' && (
                  <StickersTab serverId={serverData?.id || ''} />
                )}
                {activeTab === 'emoji-packs' && (
                  <EmojiPacksTab serverId={serverData?.id || ''} />
                )}
                {activeTab === 'webhooks' && (
                  <WebhooksTab serverId={serverData?.id || ''} channels={channels} />
                )}
                {activeTab === 'afk' && (
                  <AfkSettingsTab
                    serverId={serverData?.id || ''}
                    afkTimeout={serverData?.settings?.afk_timeout || 300}
                    afkChannelId={serverData?.settings?.afk_channel_id || null}
                    voiceChannels={channels.filter(c => c.type === 'voice')}
                    onSave={fetchServerData}
                  />
                )}
                {activeTab === 'audit-log' && <AuditLogTab />}
                {activeTab === 'storage' && <StorageTab />}
                {activeTab === 'relays' && <RelayServersTab />}
                {activeTab === 'crash-reports' && <CrashReportsTab />}
                {activeTab === 'releases' && <ReleasesTab />}
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Drag handle icon (shared by roles + channels) ────────────────────
function DragHandleIcon({ className }: { className?: string }) {
  return (
    <svg className={clsx('w-3.5 h-3.5', className)} fill="currentColor" viewBox="0 0 20 20">
      <path d="M7 2a2 2 0 10.001 4.001A2 2 0 007 2zm0 6a2 2 0 10.001 4.001A2 2 0 007 8zm0 6a2 2 0 10.001 4.001A2 2 0 007 14zm6-8a2 2 0 10-.001-4.001A2 2 0 0013 6zm0 2a2 2 0 10.001 4.001A2 2 0 0013 8zm0 6a2 2 0 10.001 4.001A2 2 0 0013 14z" />
    </svg>
  );
}

// ── Roles Tab ────────────────────────────────────────────────────────
interface Role {
  id: string;
  name: string;
  color: string | null;
  position: number;
  permissions: Record<string, PermissionState>;
  member_count?: number;
  is_hoisted?: boolean;
  is_mentionable?: boolean;
}

function SortableRoleItem({
  role,
  isSelected,
  onSelect,
  isDragDisabled,
}: {
  role: Role;
  isSelected: boolean;
  onSelect: () => void;
  isDragDisabled: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: role.id, disabled: isDragDisabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-1">
      {!isDragDisabled && (
        <button
          className="flex-shrink-0 cursor-grab active:cursor-grabbing text-text-muted hover:text-text-primary p-0.5"
          {...attributes}
          {...listeners}
        >
          <DragHandleIcon />
        </button>
      )}
      {isDragDisabled && <div className="w-[22px]" />}
      <button
        onClick={onSelect}
        className={clsx(
          'flex-1 flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-left transition-all',
          isSelected
            ? 'bg-bg-modifier-selected text-text-primary ring-1 ring-brand-primary/30'
            : 'text-text-secondary hover:bg-bg-modifier-hover'
        )}
      >
        <div
          className="w-3 h-3 rounded-full flex-shrink-0 ring-1 ring-white/10"
          style={{ background: role.color || '#99aab5' }}
        />
        <span className="truncate font-medium">{role.name}</span>
      </button>
    </div>
  );
}

function RolesTab() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [createError, setCreateError] = useState('');
  const [roleSearch, setRoleSearch] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Editable role state
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editPermissions, setEditPermissions] = useState<Record<string, PermissionState>>({});
  const [editHoisted, setEditHoisted] = useState(false);
  const [editMentionable, setEditMentionable] = useState(false);

  // Preset colors for quick selection
  const PRESET_COLORS = [
    '#e74c3c', '#e91e63', '#9b59b6', '#673ab7',
    '#3498db', '#2196f3', '#1abc9c', '#2ecc71',
    '#f1c40f', '#ff9800', '#e67e22', '#795548',
    '#607d8b', '#99aab5', '#ffffff', '#000000',
  ];

  // DnD sensors for role reordering
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleRoleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = filteredRoles.findIndex((r) => r.id === active.id);
    const newIndex = filteredRoles.findIndex((r) => r.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(filteredRoles, oldIndex, newIndex);

    // Optimistically update local state with new positions
    const withNewPositions = reordered.map((r, i) => ({
      ...r,
      position: reordered.length - i,
    }));
    setRoles(withNewPositions);

    // Send to backend (exclude @everyone from reorder array)
    const roleIds = reordered
      .filter((r) => r.name !== '@everyone')
      .map((r) => r.id);

    try {
      await api.patch('/roles/reorder', { role_ids: roleIds });
    } catch (err: any) {
      setError(err?.message || 'Failed to reorder roles');
      fetchRoles(); // Revert on failure
    }
  };

  // Collapsible permission group state
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['general']));

  const toggleGroup = (category: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  // Track unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    if (!selectedRole) return false;
    if (editName !== selectedRole.name) return true;
    if (editColor !== (selectedRole.color || '')) return true;
    if (editHoisted !== (selectedRole.is_hoisted ?? false)) return true;
    if (editMentionable !== (selectedRole.is_mentionable ?? false)) return true;
    const savedPerms = selectedRole.permissions;
    for (const key of Object.keys(editPermissions)) {
      if (editPermissions[key] !== (savedPerms[key] ?? 'default')) return true;
    }
    for (const key of Object.keys(savedPerms)) {
      if (savedPerms[key] !== (editPermissions[key] ?? 'default')) return true;
    }
    return false;
  }, [selectedRole, editName, editColor, editHoisted, editMentionable, editPermissions]);

  const filteredRoles = useMemo(() => {
    const search = roleSearch.toLowerCase();
    const sorted = [...roles].sort((a, b) => b.position - a.position);
    if (!search) return sorted;
    return sorted.filter(r => r.name.toLowerCase().includes(search));
  }, [roles, roleSearch]);

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

  useEffect(() => {
    fetchRoles();
  }, []);

  const selectRole = (role: Role) => {
    setSelectedRole(role);
    setEditName(role.name);
    setEditColor(role.color || '');
    setEditPermissions({ ...role.permissions });
    setEditHoisted(role.is_hoisted ?? false);
    setEditMentionable(role.is_mentionable ?? false);
    setShowDeleteConfirm(false);
    setSaveSuccess(false);
  };

  const handleCreateRole = async () => {
    if (!newRoleName.trim()) {
      setCreateError('Role name is required');
      return;
    }

    setCreateError('');
    setIsCreating(true);
    try {
      const newRole = await api.post<Role>('/roles', { name: newRoleName });
      setRoles(prev => [...prev, newRole]);
      setNewRoleName('');
      selectRole(newRole);
    } catch (err: any) {
      setCreateError(err?.message || 'Failed to create role');
    } finally {
      setIsCreating(false);
    }
  };

  const handleSaveRole = async () => {
    if (!selectedRole) return;

    setIsSaving(true);
    setSaveSuccess(false);
    try {
      const updated = await api.patch<Role>(`/roles/${selectedRole.id}`, {
        name: editName,
        color: editColor || null,
        permissions: editPermissions,
        is_hoisted: editHoisted,
        is_mentionable: editMentionable,
      });
      setRoles(prev => prev.map(r => r.id === selectedRole.id ? updated : r));
      setSelectedRole(updated);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err: any) {
      setError(err?.message || 'Failed to save role');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteRole = async () => {
    if (!selectedRole) return;

    try {
      await api.delete(`/roles/${selectedRole.id}`);
      setRoles(prev => prev.filter(r => r.id !== selectedRole.id));
      setSelectedRole(null);
      setShowDeleteConfirm(false);
    } catch (err: any) {
      setError(err?.message || 'Failed to delete role');
    }
  };

  const togglePermission = (key: string) => {
    setEditPermissions(prev => {
      const current = prev[key] || 'default';
      // Cycle: default -> allow -> deny -> default
      const next: PermissionState = current === 'default' ? 'allow' : current === 'allow' ? 'deny' : 'default';
      return { ...prev, [key]: next };
    });
  };

  return (
    <div className="flex gap-0 h-[calc(100vh-120px)] min-h-[500px]">
      {/* Role List Sidebar */}
      <div className="w-60 flex-shrink-0 border-r border-border-subtle pr-4 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-text-muted uppercase">Roles</h3>
            <span className="text-xs bg-bg-tertiary text-text-muted px-1.5 py-0.5 rounded-full font-medium">
              {roles.length}
            </span>
          </div>
        </div>

        {/* Search roles */}
        <div className="mb-3">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              name="search-roles"
              value={roleSearch}
              onChange={(e) => setRoleSearch(e.target.value)}
              placeholder="Search roles..."
              className="w-full pl-8 pr-2 py-1.5 bg-bg-tertiary border border-border-subtle rounded-md text-xs text-text-primary focus:outline-none focus:border-brand-primary placeholder-text-muted"
            />
          </div>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-brand-primary" />
          </div>
        )}

        {error && !selectedRole && (
          <div className="text-sm text-danger mb-2 bg-danger/10 rounded-md p-2">{error}</div>
        )}

        {!isLoading && (
          <>
            {/* Role list with drag-to-reorder */}
            {roleSearch ? (
              /* When searching, disable DnD (partial list can't be reordered) */
              <div className="flex-1 overflow-y-auto space-y-0.5 mb-3">
                {filteredRoles.map((role) => (
                  <div key={role.id} className="flex items-center gap-1">
                    <div className="w-[22px]" />
                    <button
                      onClick={() => selectRole(role)}
                      className={clsx(
                        'flex-1 flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-left transition-all',
                        selectedRole?.id === role.id
                          ? 'bg-bg-modifier-selected text-text-primary ring-1 ring-brand-primary/30'
                          : 'text-text-secondary hover:bg-bg-modifier-hover'
                      )}
                    >
                      <div
                        className="w-3 h-3 rounded-full flex-shrink-0 ring-1 ring-white/10"
                        style={{ background: role.color || '#99aab5' }}
                      />
                      <span className="truncate font-medium">{role.name}</span>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleRoleDragEnd}
              >
                <SortableContext
                  items={filteredRoles.map((r) => r.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="flex-1 overflow-y-auto space-y-0.5 mb-3">
                    {filteredRoles.map((role) => (
                      <SortableRoleItem
                        key={role.id}
                        role={role}
                        isSelected={selectedRole?.id === role.id}
                        onSelect={() => selectRole(role)}
                        isDragDisabled={role.name === '@everyone'}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}

            {/* Create role input */}
            <div className="border-t border-border-subtle pt-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  name="new-role-name"
                  value={newRoleName}
                  onChange={(e) => {
                    setNewRoleName(e.target.value);
                    if (createError) setCreateError('');
                  }}
                  placeholder="New role name..."
                  className={`flex-1 px-2.5 py-1.5 bg-bg-tertiary border rounded-md text-sm text-text-primary focus:outline-none focus:border-brand-primary ${createError ? 'border-danger' : 'border-border-subtle'
                    }`}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateRole()}
                />
                <button
                  onClick={handleCreateRole}
                  disabled={isCreating}
                  className="p-1.5 bg-brand-primary text-white rounded-md hover:bg-brand-hover transition-colors disabled:opacity-50"
                  title="Create role"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              </div>
              {createError && (
                <p className="text-xs text-danger mt-1">{createError}</p>
              )}
            </div>
          </>
        )}
      </div>

      {/* Role Editor */}
      <div className="flex-1 overflow-y-auto pl-6 relative pb-16">
        {selectedRole ? (
          <>
            {/* Header with role color preview */}
            <div className="flex items-center gap-3 mb-6">
              <div
                className="w-5 h-5 rounded-full ring-2 ring-white/10"
                style={{ background: editColor || '#99aab5' }}
              />
              <h2 className="text-lg font-bold text-text-primary flex-1">{editName || 'Untitled Role'}</h2>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(selectedRole.id);
                  toastStore.addToast({ type: 'system', title: 'Copied!', message: 'Role ID copied to clipboard' });
                }}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-text-muted hover:text-text-primary hover:bg-bg-modifier-hover transition-colors"
                title="Copy Role ID"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                </svg>
                Copy ID
              </button>
            </div>

            {/* Basic Info Card */}
            <div className="bg-bg-secondary rounded-lg p-5 mb-4 border border-border-subtle">
              <h3 className="text-xs font-semibold uppercase text-text-muted mb-4 tracking-wide">Role Settings</h3>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-xs font-semibold uppercase text-text-muted mb-1.5" htmlFor="edit-role-name">Role Name</label>
                  <input
                    type="text"
                    id="edit-role-name"
                    name="edit-role-name"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded-md text-text-primary focus:outline-none focus:border-brand-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase text-text-muted mb-1.5">Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      name="role-color-picker"
                      value={editColor || '#99aab5'}
                      onChange={(e) => setEditColor(e.target.value)}
                      className="w-9 h-9 rounded-md cursor-pointer border border-border-subtle"
                    />
                    <input
                      type="text"
                      name="role-color-hex"
                      value={editColor}
                      onChange={(e) => setEditColor(e.target.value)}
                      placeholder="#99aab5"
                      className="w-24 px-2 py-2 bg-bg-tertiary border border-border-subtle rounded-md text-text-primary text-sm focus:outline-none focus:border-brand-primary font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Color presets */}
              <div className="mt-3">
                <div className="flex flex-wrap gap-1.5">
                  {PRESET_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => setEditColor(color)}
                      className={`w-6 h-6 rounded-md transition-all hover:scale-110 border ${editColor === color ? 'ring-2 ring-brand-primary ring-offset-1 ring-offset-bg-secondary' : 'border-white/10'
                        }`}
                      style={{ background: color }}
                      title={color}
                    />
                  ))}
                </div>
              </div>

              {/* Display Settings */}
              <div className="border-t border-border-subtle mt-4 pt-4">
                <button
                  onClick={() => setEditHoisted(!editHoisted)}
                  className="flex items-center justify-between w-full cursor-pointer hover:bg-bg-modifier-hover p-2 rounded-md transition-colors"
                >
                  <div>
                    <div className="text-sm font-medium text-text-primary text-left">Display separately in member list</div>
                    <div className="text-xs text-text-muted text-left">Show members with this role grouped separately</div>
                  </div>
                  {/* Toggle switch */}
                  <div className={`relative w-11 h-6 rounded-full transition-colors ${editHoisted ? 'bg-brand-primary' : 'bg-bg-tertiary'}`}>
                    <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${editHoisted ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
                  </div>
                </button>
                <button
                  onClick={() => setEditMentionable(!editMentionable)}
                  className="flex items-center justify-between w-full cursor-pointer hover:bg-bg-modifier-hover p-2 rounded-md transition-colors"
                >
                  <div>
                    <div className="text-sm font-medium text-text-primary text-left">Allow anyone to @mention this role</div>
                    <div className="text-xs text-text-muted text-left">Members can mention this role in messages to notify all role members</div>
                  </div>
                  {/* Toggle switch */}
                  <div className={`relative w-11 h-6 rounded-full transition-colors ${editMentionable ? 'bg-brand-primary' : 'bg-bg-tertiary'}`}>
                    <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${editMentionable ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
                  </div>
                </button>
              </div>
            </div>

            {/* Permissions */}
            <div className="mb-4">
              <h3 className="text-xs font-semibold text-text-muted uppercase mb-3 tracking-wide">Permissions</h3>

              {PERMISSION_GROUPS.map((group) => {
                const isExpanded = expandedGroups.has(group.category);
                const allowCount = group.permissions.filter((p) => editPermissions[p.key] === 'allow').length;
                const denyCount = group.permissions.filter((p) => editPermissions[p.key] === 'deny').length;

                return (
                  <div key={group.category} className="mb-3">
                    {/* Collapsible header */}
                    <button
                      onClick={() => toggleGroup(group.category)}
                      className="flex items-center justify-between w-full px-1 py-1.5 text-left group"
                    >
                      <div className="flex items-center gap-2">
                        <svg
                          className={clsx('w-3.5 h-3.5 text-text-muted transition-transform', isExpanded && 'rotate-90')}
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                        </svg>
                        <h4 className="text-xs font-semibold text-text-muted uppercase">{group.name}</h4>
                      </div>
                      <span className="text-xs text-text-muted">
                        {allowCount > 0 && <span className="text-green-400">{allowCount}</span>}
                        {allowCount > 0 && denyCount > 0 && ' / '}
                        {denyCount > 0 && <span className="text-danger">{denyCount}</span>}
                        {allowCount === 0 && denyCount === 0 && `0/${group.permissions.length}`}
                        {(allowCount > 0 || denyCount > 0) && <span className="text-text-muted"> / {group.permissions.length}</span>}
                      </span>
                    </button>

                    {/* Collapsible body */}
                    {isExpanded && (
                      <div className="bg-bg-secondary rounded-lg border border-border-subtle divide-y divide-border-subtle overflow-hidden">
                        {group.permissions.map((perm) => {
                          const state = editPermissions[perm.key] || 'default';
                          return (
                            <button
                              key={perm.key}
                              onClick={() => togglePermission(perm.key)}
                              className={clsx(
                                'flex items-center justify-between p-3 w-full text-left cursor-pointer transition-colors',
                                state === 'allow' && DANGEROUS_PERMS.has(perm.key)
                                  ? 'bg-danger/5 hover:bg-danger/10'
                                  : state === 'deny'
                                    ? 'bg-danger/5 hover:bg-danger/10'
                                    : 'hover:bg-bg-modifier-hover'
                              )}
                            >
                              <div className="pr-4">
                                <div className={clsx('text-sm font-medium', DANGEROUS_PERMS.has(perm.key) ? 'text-danger' : 'text-text-primary')}>
                                  {perm.label}
                                </div>
                                <div className="text-xs text-text-muted">{perm.description}</div>
                              </div>
                              {/* 3-state toggle: Deny (X) | Default (-) | Allow (check) */}
                              <div className={clsx(
                                'relative w-16 h-6 rounded-full flex-shrink-0 transition-colors',
                                state === 'allow'
                                  ? DANGEROUS_PERMS.has(perm.key) ? 'bg-danger' : 'bg-green-500'
                                  : state === 'deny'
                                    ? 'bg-danger'
                                    : 'bg-bg-tertiary'
                              )}>
                                {/* Track labels */}
                                <div className="absolute inset-0 flex items-center justify-between px-1.5 text-[9px] font-bold text-white/40 select-none pointer-events-none">
                                  <span>X</span>
                                  <span>-</span>
                                  <span className="text-[10px]">&#10003;</span>
                                </div>
                                {/* Knob */}
                                <div className={clsx(
                                  'absolute top-0.5 w-5 h-5 rounded-full shadow transition-transform flex items-center justify-center text-[10px] font-bold',
                                  state === 'deny'
                                    ? 'translate-x-0.5 bg-white text-danger'
                                    : state === 'default'
                                      ? 'translate-x-[22px] bg-white text-text-muted'
                                      : 'translate-x-[42px] bg-white text-green-600'
                                )}>
                                  {state === 'deny' ? 'X' : state === 'allow' ? '\u2713' : '\u2014'}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Delete Role Section */}
            <div className="bg-bg-secondary rounded-lg border border-danger/20 p-4 mb-4">
              <h3 className="text-xs font-semibold uppercase text-danger mb-2 tracking-wide">Danger Zone</h3>
              {showDeleteConfirm ? (
                <div className="flex items-center gap-3">
                  <p className="text-sm text-text-secondary flex-1">
                    Delete <span className="font-semibold text-text-primary">{selectedRole?.name}</span>? This cannot be undone.
                  </p>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-3 py-1.5 text-sm text-text-secondary bg-bg-tertiary rounded-md hover:bg-bg-modifier-hover transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteRole}
                    className="px-3 py-1.5 text-sm text-white bg-danger rounded-md hover:bg-danger/80 transition-colors"
                  >
                    Confirm Delete
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="px-4 py-2 bg-danger/10 text-danger text-sm font-medium rounded-md hover:bg-danger/20 transition-colors border border-danger/20"
                >
                  Delete Role
                </button>
              )}
            </div>

            {/* Sticky save bar */}
            {hasUnsavedChanges && (
              <div className="fixed bottom-0 left-0 right-0 z-10 bg-bg-secondary border-t border-border-subtle px-6 py-3 flex items-center justify-between shadow-lg">
                <p className="text-sm text-text-secondary">You have unsaved changes</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      if (selectedRole) selectRole(selectedRole);
                    }}
                    className="px-4 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
                  >
                    Reset
                  </button>
                  <button
                    onClick={handleSaveRole}
                    disabled={isSaving}
                    className="px-4 py-1.5 bg-brand-primary text-white text-sm font-medium rounded-md hover:bg-brand-hover transition-colors disabled:opacity-50"
                  >
                    {isSaving ? 'Saving...' : saveSuccess ? 'Saved!' : 'Save Changes'}
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-text-muted gap-3">
            <svg className="w-12 h-12 text-text-muted/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <p className="text-sm">Select a role to edit its settings</p>
          </div>
        )}
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
  const [searchQuery, setSearchQuery] = useState('');
  const [members, setMembers] = useState<ServerMember[]>([]);
  const [roles, setRoles] = useState<{ id: string; name: string; color: string | null; position?: number }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMember, setSelectedMember] = useState<ServerMember | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [editingRoles, setEditingRoles] = useState<string[]>([]);
  const [isEditingRoles, setIsEditingRoles] = useState(false);
  const [savingRoles, setSavingRoles] = useState(false);

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [membersResponse, rolesData] = await Promise.all([
        api.get<{ members: ServerMember[] } | ServerMember[]>('/members'),
        api.get<{ id: string; name: string; color: string | null }[]>('/roles')
      ]);
      const membersData = Array.isArray(membersResponse)
        ? membersResponse
        : membersResponse?.members || [];
      setMembers(membersData);
      setRoles(rolesData || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load members');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const filteredMembers = useMemo(() => {
    const query = searchQuery.toLowerCase();
    if (!query) return members;
    return members.filter(m =>
      m.username.toLowerCase().includes(query) ||
      m.display_name?.toLowerCase().includes(query)
    );
  }, [searchQuery, members]);

  const handleKick = async (member: ServerMember) => {
    const reason = prompt(`Kick ${member.username}? Enter a reason (optional):`);
    if (reason === null) return; // Cancelled

    setActionInProgress(member.id);
    try {
      await api.post(`/members/${member.id}/kick`, { reason: reason || undefined });
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

  const getRoleById = (roleId: string) => roles.find(r => r.id === roleId);

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
    if (!selectedMember) return;

    setSavingRoles(true);
    try {
      await api.patch(`/members/${selectedMember.id}`, { roles: editingRoles });
      // Update the member in local state
      setMembers(prev => prev.map(m =>
        m.id === selectedMember.id ? { ...m, roles: editingRoles } : m
      ));
      setSelectedMember({ ...selectedMember, roles: editingRoles });
      setIsEditingRoles(false);
    } catch (err: any) {
      alert(err?.message || 'Failed to update roles');
    } finally {
      setSavingRoles(false);
    }
  };

  // Get assignable roles (exclude @everyone which has position 0)
  const assignableRoles = useMemo(() =>
    roles.filter(r => (r.position ?? 0) > 0).sort((a, b) => (b.position ?? 0) - (a.position ?? 0)),
    [roles]
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold text-text-primary">Server Members</h2>
        <span className="text-sm text-text-muted">{members.length} members</span>
      </div>

      <div className="mb-4">
        <input
          type="text"
          name="search-members"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search members..."
          className="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-primary"
        />
      </div>

      {isLoading && (
        <div className="text-center py-8">
          <div className="text-text-muted">Loading members...</div>
        </div>
      )}

      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 mb-4">
          <p className="text-sm text-danger">{error}</p>
        </div>
      )}

      {!isLoading && !error && (
        <>
          <div className="space-y-1">
            {filteredMembers.map((member) => (
              <div
                key={member.id}
                className={`flex items-center justify-between p-3 rounded-lg transition-colors cursor-pointer ${selectedMember?.id === member.id ? 'bg-bg-modifier-selected' : 'hover:bg-bg-modifier-hover'
                  }`}
                onClick={() => setSelectedMember(selectedMember?.id === member.id ? null : member)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-bg-tertiary flex items-center justify-center overflow-hidden">
                    {member.avatar_url ? (
                      <img src={member.avatar_url} alt={member.username} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-text-muted font-medium">
                        {member.username.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div>
                    <div className="font-medium text-text-primary">
                      {member.display_name || member.username}
                      {member.display_name && (
                        <span className="text-text-muted text-sm ml-2">@{member.username}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {member.roles.map((roleId) => {
                        const role = getRoleById(roleId);
                        return role ? (
                          <span
                            key={roleId}
                            className="text-xs px-1.5 py-0.5 rounded"
                            style={{
                              background: role.color ? `${role.color}20` : 'var(--color-bg-tertiary)',
                              color: role.color || 'var(--color-text-muted)'
                            }}
                          >
                            {role.name}
                          </span>
                        ) : null;
                      })}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-text-muted">
                  Joined {formatDate(member.joined_at)}
                </div>
              </div>
            ))}
          </div>

          {/* Member Actions */}
          {selectedMember && (
            <div className="mt-4 p-4 bg-bg-secondary rounded-lg space-y-4">
              {/* Role Management */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-text-muted uppercase">Roles</h4>
                  {!isEditingRoles && (
                    <button
                      onClick={() => startEditingRoles(selectedMember)}
                      className="text-xs text-brand-primary hover:text-brand-primary-hover transition-colors"
                    >
                      Edit Roles
                    </button>
                  )}
                </div>

                {isEditingRoles ? (
                  <>
                    <div className="space-y-2 mb-3">
                      {assignableRoles.map((role) => (
                        <label
                          key={role.id}
                          className="flex items-center gap-3 p-2 rounded hover:bg-bg-modifier-hover cursor-pointer transition-colors"
                        >
                          <input
                            type="checkbox"
                            name={`member-role-${role.id}`}
                            checked={editingRoles.includes(role.id)}
                            onChange={() => toggleRole(role.id)}
                            className="w-4 h-4 rounded border-border-subtle bg-bg-tertiary"
                          />
                          <div
                            className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{ background: role.color || '#99aab5' }}
                          />
                          <span className="text-sm text-text-primary">{role.name}</span>
                        </label>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleSaveRoles}
                        disabled={savingRoles}
                        className="px-3 py-1.5 bg-success text-white text-sm font-medium rounded hover:bg-success/90 transition-colors disabled:opacity-50"
                      >
                        {savingRoles ? 'Saving...' : 'Save Roles'}
                      </button>
                      <button
                        onClick={cancelEditingRoles}
                        disabled={savingRoles}
                        className="px-3 py-1.5 bg-bg-tertiary text-text-muted text-sm font-medium rounded hover:bg-bg-modifier-hover transition-colors disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {selectedMember.roles.length === 0 && (
                      <span className="text-sm text-text-muted">No roles assigned</span>
                    )}
                    {selectedMember.roles.map((roleId) => {
                      const role = getRoleById(roleId);
                      return role ? (
                        <span
                          key={roleId}
                          className="text-xs px-2 py-1 rounded"
                          style={{
                            background: role.color ? `${role.color}20` : 'var(--color-bg-tertiary)',
                            color: role.color || 'var(--color-text-muted)'
                          }}
                        >
                          {role.name}
                        </span>
                      ) : null;
                    })}
                  </div>
                )}
              </div>

              {/* Moderation Actions */}
              <div className="border-t border-border-subtle pt-4">
                <h4 className="text-sm font-semibold text-text-muted uppercase mb-3">
                  Moderation
                </h4>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleKick(selectedMember)}
                    disabled={actionInProgress === selectedMember.id}
                    className="px-3 py-1.5 bg-warning/20 text-warning text-sm font-medium rounded hover:bg-warning/30 transition-colors disabled:opacity-50"
                  >
                    {actionInProgress === selectedMember.id ? 'Processing...' : 'Kick'}
                  </button>
                  <button
                    onClick={() => handleBan(selectedMember)}
                    disabled={actionInProgress === selectedMember.id}
                    className="px-3 py-1.5 bg-danger/20 text-danger text-sm font-medium rounded hover:bg-danger/30 transition-colors disabled:opacity-50"
                  >
                    {actionInProgress === selectedMember.id ? 'Processing...' : 'Ban'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Channels Tab
interface ChannelCategory {
  id: string;
  name: string;
  position: number;
}

interface ChannelData {
  id: string;
  name: string;
  type: 'text' | 'voice' | 'announcement' | 'music' | 'temp_voice_generator' | 'temp_voice';
  category_id: string | null;
  position: number;
  topic?: string;
  slowmode_seconds?: number;
  is_temp_channel?: boolean;
}

function SortableChannelItem({
  channel,
  icon,
  onDelete,
}: {
  channel: ChannelData;
  icon: ReactNode;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: channel.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center justify-between p-2 rounded hover:bg-bg-modifier-hover group"
    >
      <div className="flex items-center gap-2">
        <button
          className="flex-shrink-0 cursor-grab active:cursor-grabbing text-text-muted hover:text-text-primary p-0.5"
          {...attributes}
          {...listeners}
        >
          <DragHandleIcon />
        </button>
        {icon}
        <span className="text-text-primary">{channel.name}</span>
        <span className="text-xs text-text-muted capitalize">({channel.type.replace('_', ' ')})</span>
      </div>
      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 p-1 text-danger hover:bg-danger/20 rounded transition-all"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    </div>
  );
}

function SortableCategoryHeader({
  category,
  onDelete,
}: {
  category: ChannelCategory;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: category.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center justify-between group">
      <div className="flex items-center gap-1.5">
        <button
          className="flex-shrink-0 cursor-grab active:cursor-grabbing text-text-muted hover:text-text-primary p-0.5"
          {...attributes}
          {...listeners}
        >
          <DragHandleIcon />
        </button>
        <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-0">
          {category.name}
        </h3>
      </div>
      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 p-1 text-danger hover:bg-danger/20 rounded transition-all"
        title="Delete category"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

function ChannelsTab({ serverData, onRefresh }: { serverData: ServerData | null; onRefresh: () => void }) {
  const [channels, setChannels] = useState<ChannelData[]>([]);
  const [categories, setCategories] = useState<ChannelCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showCreateCategory, setShowCreateCategory] = useState(false);

  // Announcement settings
  const [announceJoins, setAnnounceJoins] = useState(true);
  const [announceLeaves, setAnnounceLeaves] = useState(true);
  const [announceOnline, setAnnounceOnline] = useState(false);
  const [announceSaving, setAnnounceSaving] = useState(false);
  const [announceSuccess, setAnnounceSuccess] = useState(false);

  // Populate announcement settings from server data
  useEffect(() => {
    if (serverData?.settings) {
      setAnnounceJoins(serverData.settings.announce_joins ?? true);
      setAnnounceLeaves(serverData.settings.announce_leaves ?? true);
      setAnnounceOnline(serverData.settings.announce_online ?? false);
    }
  }, [serverData]);

  const handleSaveAnnouncements = async () => {
    setAnnounceSaving(true);
    try {
      await api.patch('/server', {
        announce_joins: announceJoins,
        announce_leaves: announceLeaves,
        announce_online: announceOnline,
      });
      setAnnounceSuccess(true);
      onRefresh();
      setTimeout(() => setAnnounceSuccess(false), 3000);
    } catch (err: any) {
      alert(err?.message || 'Failed to save announcement settings');
    } finally {
      setAnnounceSaving(false);
    }
  };

  // Form states
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelType, setNewChannelType] = useState<'text' | 'voice' | 'announcement' | 'music' | 'temp_voice_generator'>('text');
  const [newChannelCategory, setNewChannelCategory] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [actionInProgress, setActionInProgress] = useState(false);

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // /channels returns { channels: [...], categories: [...] }
      const response = await api.get<{ channels: ChannelData[]; categories: ChannelCategory[] } | ChannelData[]>('/channels');

      if (Array.isArray(response)) {
        // Legacy: plain array of channels
        setChannels(response);
        setCategories([]);
      } else {
        setChannels(response.channels || []);
        setCategories(response.categories || []);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load channels');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const getChannelsByCategory = (categoryId: string | null) => {
    return channels
      .filter(c => c.category_id === categoryId)
      .sort((a, b) => a.position - b.position);
  };

  // DnD sensors for channel/category reordering
  const channelSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleCategoryDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const sorted = [...categories].sort((a, b) => a.position - b.position);
    const oldIndex = sorted.findIndex((c) => c.id === active.id);
    const newIndex = sorted.findIndex((c) => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(sorted, oldIndex, newIndex);
    const withPositions = reordered.map((c, i) => ({ ...c, position: i }));
    setCategories(withPositions);

    try {
      await api.post('/categories/reorder', {
        categories: withPositions.map((c) => ({ id: c.id, position: c.position })),
      });
    } catch (err: any) {
      setError(err?.message || 'Failed to reorder categories');
      fetchData();
    }
  };

  const handleChannelDragEnd = (categoryId: string | null) => async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !serverData) return;

    const categoryChannels = getChannelsByCategory(categoryId);
    const oldIndex = categoryChannels.findIndex((c) => c.id === active.id);
    const newIndex = categoryChannels.findIndex((c) => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(categoryChannels, oldIndex, newIndex);
    const withPositions = reordered.map((c, i) => ({ ...c, position: i }));

    // Optimistically update
    setChannels((prev) => {
      const otherChannels = prev.filter((c) => c.category_id !== categoryId);
      return [...otherChannels, ...withPositions];
    });

    try {
      await api.patch(`/channels/${serverData.id}/reorder`, {
        channels: withPositions.map((c) => ({ id: c.id, position: c.position })),
      });
    } catch (err: any) {
      setError(err?.message || 'Failed to reorder channels');
      fetchData();
    }
  };

  const handleCreateChannel = async () => {
    if (!newChannelName.trim()) return;

    setActionInProgress(true);
    try {
      const newChannel = await api.post<ChannelData>('/channels', {
        name: newChannelName.trim(),
        type: newChannelType,
        category_id: newChannelCategory
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
    if (!newCategoryName.trim()) return;

    setActionInProgress(true);
    try {
      const newCategory = await api.post<ChannelCategory>('/categories', {
        name: newCategoryName.trim()
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
          <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M9 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        );
      case 'music':
        return (
          <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
        );
      case 'announcement':
        return (
          <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
          </svg>
        );
      case 'temp_voice_generator':
        return (
          <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        );
      case 'temp_voice':
        return (
          <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M9 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <circle cx="18" cy="6" r="2" fill="currentColor" />
          </svg>
        );
      default:
        return (
          <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
          </svg>
        );
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold text-text-primary">Channels</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCreateCategory(true)}
            className="px-4 py-2 bg-bg-secondary hover:bg-bg-modifier-hover text-text-primary text-sm font-medium rounded transition-colors"
          >
            Create Category
          </button>
          <button
            onClick={() => setShowCreateChannel(true)}
            className="px-4 py-2 bg-brand-primary hover:bg-brand-primary-hover text-white text-sm font-medium rounded transition-colors"
          >
            Create Channel
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="text-center py-8">
          <div className="text-text-muted">Loading channels...</div>
        </div>
      )}

      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 mb-4">
          <p className="text-sm text-danger">{error}</p>
        </div>
      )}

      {!isLoading && !error && (
        <>
          {/* Uncategorized channels (with DnD) */}
          {getChannelsByCategory(null).length > 0 && (
            <div className="mb-4">
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
                Uncategorized
              </h3>
              <DndContext
                sensors={channelSensors}
                collisionDetection={closestCenter}
                onDragEnd={handleChannelDragEnd(null)}
              >
                <SortableContext
                  items={getChannelsByCategory(null).map((c) => c.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-1">
                    {getChannelsByCategory(null).map((channel) => (
                      <SortableChannelItem
                        key={channel.id}
                        channel={channel}
                        icon={getChannelIcon(channel.type)}
                        onDelete={() => handleDeleteChannel(channel)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          )}

          {/* Categories with channels (both draggable) */}
          <DndContext
            sensors={channelSensors}
            collisionDetection={closestCenter}
            onDragEnd={handleCategoryDragEnd}
          >
            <SortableContext
              items={[...categories].sort((a, b) => a.position - b.position).map((c) => c.id)}
              strategy={verticalListSortingStrategy}
            >
              {[...categories].sort((a, b) => a.position - b.position).map((category) => {
                const categoryChannels = getChannelsByCategory(category.id);
                return (
                  <div key={category.id} className="mb-4">
                    <SortableCategoryHeader
                      category={category}
                      onDelete={() => handleDeleteCategory(category)}
                    />
                    <DndContext
                      sensors={channelSensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleChannelDragEnd(category.id)}
                    >
                      <SortableContext
                        items={categoryChannels.map((c) => c.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        <div className="space-y-1 mt-2">
                          {categoryChannels.map((channel) => (
                            <SortableChannelItem
                              key={channel.id}
                              channel={channel}
                              icon={getChannelIcon(channel.type)}
                              onDelete={() => handleDeleteChannel(channel)}
                            />
                          ))}
                        </div>
                      </SortableContext>
                    </DndContext>
                    {categoryChannels.length === 0 && (
                      <p className="text-sm text-text-muted italic px-2 mt-2">No channels in this category</p>
                    )}
                  </div>
                );
              })}
            </SortableContext>
          </DndContext>

          {channels.length === 0 && categories.length === 0 && (
            <div className="text-center py-8">
              <p className="text-text-muted">No channels yet. Create your first channel!</p>
            </div>
          )}
        </>
      )}

      {/* Create Channel Modal */}
      {showCreateChannel && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-bg-primary rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-text-primary mb-4">Create Channel</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1" htmlFor="new-channel-name">Channel Name</label>
                <input
                  type="text"
                  id="new-channel-name"
                  name="new-channel-name"
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                  placeholder="general"
                  className="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-primary"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Channel Type</label>
                <select
                  value={newChannelType}
                  onChange={(e) => setNewChannelType(e.target.value as any)}
                  className="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary"
                >
                  <option value="text">Text</option>
                  <option value="voice">Voice</option>
                  <option value="announcement">Announcement</option>
                  <option value="music">Music / Stage</option>
                  <option value="temp_voice_generator">Temp Voice Generator (Create-on-Join)</option>
                </select>
                <p className="text-xs text-text-muted mt-1">
                  {newChannelType === 'temp_voice_generator' &&
                    'Users joining this channel will automatically get their own temporary voice channel.'
                  }
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Category (optional)</label>
                <select
                  value={newChannelCategory || ''}
                  onChange={(e) => setNewChannelCategory(e.target.value || null)}
                  className="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary"
                >
                  <option value="">No category</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowCreateChannel(false)}
                className="px-4 py-2 bg-bg-secondary hover:bg-bg-modifier-hover text-text-primary text-sm font-medium rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateChannel}
                disabled={!newChannelName.trim() || actionInProgress}
                className="px-4 py-2 bg-brand-primary hover:bg-brand-primary-hover text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
              >
                {actionInProgress ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Category Modal */}
      {showCreateCategory && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-bg-primary rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-text-primary mb-4">Create Category</h3>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1" htmlFor="new-category-name">Category Name</label>
              <input
                type="text"
                id="new-category-name"
                name="new-category-name"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="TEXT CHANNELS"
                className="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-primary"
              />
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowCreateCategory(false)}
                className="px-4 py-2 bg-bg-secondary hover:bg-bg-modifier-hover text-text-primary text-sm font-medium rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateCategory}
                disabled={!newCategoryName.trim() || actionInProgress}
                className="px-4 py-2 bg-brand-primary hover:bg-brand-primary-hover text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
              >
                {actionInProgress ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Announcement Settings */}
      <div className="mt-8 pt-6 border-t border-border-subtle">
        <h3 className="text-lg font-bold text-text-primary mb-4">Announcement Settings</h3>
        <p className="text-sm text-text-muted mb-4">
          Configure automatic announcements posted in the welcome channel.
        </p>
        <div className="bg-bg-secondary rounded-lg p-4 space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              name="announce-joins"
              checked={announceJoins}
              onChange={(e) => setAnnounceJoins(e.target.checked)}
              className="w-4 h-4 rounded border-border-subtle bg-bg-tertiary"
            />
            <span className="text-sm text-text-primary">Announce when members join</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              name="announce-leaves"
              checked={announceLeaves}
              onChange={(e) => setAnnounceLeaves(e.target.checked)}
              className="w-4 h-4 rounded border-border-subtle bg-bg-tertiary"
            />
            <span className="text-sm text-text-primary">Announce when members leave</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              name="announce-online"
              checked={announceOnline}
              onChange={(e) => setAnnounceOnline(e.target.checked)}
              className="w-4 h-4 rounded border-border-subtle bg-bg-tertiary"
            />
            <span className="text-sm text-text-primary">Announce when members come online</span>
          </label>
          <div className="pt-2 flex items-center gap-3">
            <button
              onClick={handleSaveAnnouncements}
              disabled={announceSaving}
              className="px-4 py-2 bg-brand-primary hover:bg-brand-primary-hover text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
            >
              {announceSaving ? 'Saving...' : 'Save Announcements'}
            </button>
            {announceSuccess && (
              <span className="text-sm text-success">Saved!</span>
            )}
          </div>
        </div>
      </div>

      {/* Temp Channel Settings Section */}
      <TempChannelSettings />
    </div>
  );
}

// Temp Channel Settings Component
function TempChannelSettings() {
  const [_settings, setSettings] = useState<{
    empty_timeout_seconds: number;
    max_temp_channels_per_user: number;
    inherit_generator_permissions: boolean;
    default_user_limit: number;
    default_bitrate: number;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [timeoutMinutes, setTimeoutMinutes] = useState(5);

  const fetchSettings = async () => {
    try {
      const data = await api.get<any>('/voice/temp-settings');
      setSettings(data);
      setTimeoutMinutes(Math.round((data?.empty_timeout_seconds || 300) / 60));
    } catch (err) {
      console.error('Failed to fetch temp settings:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const updated = await api.patch<any>('/voice/temp-settings', {
        empty_timeout_seconds: timeoutMinutes * 60,
      });
      setSettings(updated);
      alert('Temp channel settings saved!');
    } catch (err: any) {
      alert(err?.message || 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mt-8 pt-6 border-t border-border-subtle">
      <h3 className="text-lg font-bold text-text-primary mb-4">Temp Voice Channel Settings</h3>
      <p className="text-sm text-text-muted mb-4">
        Configure how temporary voice channels behave when users join a "Create Channel" voice channel.
      </p>

      {isLoading ? (
        <div className="text-text-muted">Loading settings...</div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1" htmlFor="voice-timeout-minutes">
              Empty Channel Timeout (minutes)
            </label>
            <input
              type="number"
              id="voice-timeout-minutes"
              name="voice-timeout-minutes"
              min="1"
              max="60"
              value={timeoutMinutes}
              onChange={(e) => setTimeoutMinutes(parseInt(e.target.value) || 5)}
              className="w-32 px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary"
            />
            <p className="text-xs text-text-muted mt-1">
              Time before an empty temp channel is automatically deleted.
            </p>
          </div>

          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 bg-brand-primary hover:bg-brand-primary-hover text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      )}
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
  const [invites, setInvites] = useState<Invite[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Create form states
  const [expiresIn, setExpiresIn] = useState<string>('1d');
  const [maxUses, setMaxUses] = useState<string>('');
  const [actionInProgress, setActionInProgress] = useState(false);

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

  useEffect(() => {
    fetchInvites();
  }, []);

  const handleCreateInvite = async () => {
    setActionInProgress(true);
    try {
      const body: Record<string, any> = {};

      // Convert expiresIn to actual expiry
      if (expiresIn !== 'never') {
        const hours = {
          '30m': 0.5,
          '1h': 1,
          '6h': 6,
          '12h': 12,
          '1d': 24,
          '7d': 168,
        }[expiresIn] || 24;

        const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
        body.expires_at = expiresAt.toISOString();
      }

      if (maxUses && parseInt(maxUses) > 0) {
        body.max_uses = parseInt(maxUses);
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
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold text-text-primary">Invites</h2>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-brand-primary hover:bg-brand-primary-hover text-white text-sm font-medium rounded transition-colors"
        >
          Create Invite
        </button>
      </div>

      <p className="text-sm text-text-muted mb-4">
        Create invite links to share with others. You can set expiration times and usage limits.
      </p>

      {isLoading && (
        <div className="text-center py-8">
          <div className="text-text-muted">Loading invites...</div>
        </div>
      )}

      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 mb-4">
          <p className="text-sm text-danger">{error}</p>
        </div>
      )}

      {!isLoading && !error && (
        <>
          {invites.length === 0 && (
            <div className="bg-bg-secondary rounded-lg p-4">
              <div className="text-sm text-text-muted">No active invites. Create one to invite people to your server!</div>
            </div>
          )}

          {invites.length > 0 && (
            <div className="space-y-2">
              {invites.map((invite) => (
                <div key={invite.code} className={`flex items-center justify-between p-3 rounded-lg ${isExpired(invite.expires_at) ? 'bg-bg-secondary/50 opacity-60' : 'bg-bg-secondary'
                  }`}>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <code className="text-brand-primary font-mono text-sm">{invite.code}</code>
                      {isExpired(invite.expires_at) && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-danger/20 text-danger">Expired</span>
                      )}
                    </div>
                    <div className="text-xs text-text-muted mt-1">
                      Created by {invite.created_by_username} •
                      Uses: {invite.uses}{invite.max_uses ? `/${invite.max_uses}` : ''} •
                      Expires: {formatExpiry(invite.expires_at)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => copyToClipboard(invite.code)}
                      className="p-2 text-text-secondary hover:text-text-primary hover:bg-bg-modifier-hover rounded transition-colors"
                      title="Copy invite link"
                    >
                      {copiedCode === invite.code ? (
                        <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      )}
                    </button>
                    <button
                      onClick={() => handleDeleteInvite(invite.code)}
                      className="p-2 text-danger hover:bg-danger/20 rounded transition-colors"
                      title="Delete invite"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Create Invite Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-bg-primary rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-text-primary mb-4">Create Invite Link</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Expire After</label>
                <select
                  value={expiresIn}
                  onChange={(e) => setExpiresIn(e.target.value)}
                  className="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary"
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
                <label className="block text-sm font-medium text-text-secondary mb-1" htmlFor="invite-max-uses">Max Number of Uses</label>
                <input
                  type="number"
                  id="invite-max-uses"
                  name="invite-max-uses"
                  value={maxUses}
                  onChange={(e) => setMaxUses(e.target.value)}
                  placeholder="No limit"
                  min="1"
                  className="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-primary"
                />
                <p className="text-xs text-text-muted mt-1">Leave blank for unlimited uses</p>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 bg-bg-secondary hover:bg-bg-modifier-hover text-text-primary text-sm font-medium rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateInvite}
                disabled={actionInProgress}
                className="px-4 py-2 bg-brand-primary hover:bg-brand-primary-hover text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
              >
                {actionInProgress ? 'Creating...' : 'Create Invite'}
              </button>
            </div>
          </div>
        </div>
      )}
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
  const [searchQuery, setSearchQuery] = useState('');
  const [bans, setBans] = useState<BannedUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unbanningId, setUnbanningId] = useState<string | null>(null);

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

  useEffect(() => {
    fetchBans();
  }, []);

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

  const filteredBans = useMemo(() => {
    const query = searchQuery.toLowerCase();
    if (!query) return bans;
    return bans.filter(b => b.username.toLowerCase().includes(query));
  }, [searchQuery, bans]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString();
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-text-primary mb-5">Server Bans</h2>

      <div className="mb-4">
        <input
          type="text"
          name="search-bans"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search bans by username..."
          className="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-primary"
        />
      </div>

      {isLoading && (
        <div className="text-center py-8">
          <div className="text-text-muted">Loading bans...</div>
        </div>
      )}

      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 mb-4">
          <p className="text-sm text-danger">{error}</p>
        </div>
      )}

      {!isLoading && !error && (
        <>
          {filteredBans.length > 0 ? (
            <div className="space-y-2">
              {filteredBans.map((ban) => (
                <div key={ban.user_id} className="flex items-center justify-between p-3 bg-bg-secondary rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-bg-tertiary flex items-center justify-center overflow-hidden">
                      {ban.avatar_url ? (
                        <img src={ban.avatar_url} alt={ban.username} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-text-muted font-medium">
                          {ban.username.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div>
                      <div className="font-medium text-text-primary">{ban.username}</div>
                      <div className="text-xs text-text-muted">
                        Banned on {formatDate(ban.banned_at)}
                        {ban.reason && (
                          <span> • {ban.reason}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleUnban(ban.user_id)}
                    disabled={unbanningId === ban.user_id}
                    className="px-3 py-1.5 bg-success/20 text-success text-sm font-medium rounded hover:bg-success/30 transition-colors disabled:opacity-50"
                  >
                    {unbanningId === ban.user_id ? 'Unbanning...' : 'Unban'}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-bg-secondary rounded-lg p-4">
              <div className="text-sm text-text-muted">
                {searchQuery ? 'No bans match your search.' : 'No banned users.'}
              </div>
            </div>
          )}
        </>
      )}
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
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

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

  const fetchAuditLog = async (filter?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      const filterValue = filter !== undefined ? filter : actionFilter;
      if (filterValue) params.append('action_type', filterValue);
      params.append('limit', '50');

      const data = await api.get<{ entries: AuditLogEntry[] }>(`/audit-log?${params}`);
      setEntries(data.entries || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load audit log');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAuditLog();
  }, []);

  const formatAction = (action: string) => {
    return action.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  const getActionIcon = (action: string) => {
    if (action.includes('create')) return '+';
    if (action.includes('delete')) return 'x';
    if (action.includes('update')) return '~';
    if (action.includes('ban')) return '!';
    if (action.includes('kick')) return '>';
    if (action.includes('unban')) return 'o';
    return '*';
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-text-primary mb-5">Audit Log</h2>

      <p className="text-sm text-text-muted mb-4">
        View a record of all administrative actions taken in this server.
      </p>

      <div className="flex gap-2 mb-4">
        <select
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); fetchAuditLog(e.target.value); }}
          className="px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary"
        >
          {actionTypes.map((type) => (
            <option key={type.value} value={type.value}>{type.label}</option>
          ))}
        </select>
        <button
          onClick={() => fetchAuditLog()}
          className="px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary hover:bg-bg-modifier-hover transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {isLoading && (
        <div className="text-center py-8">
          <div className="text-text-muted">Loading audit log...</div>
        </div>
      )}

      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 mb-4">
          <p className="text-sm text-danger">{error}</p>
        </div>
      )}

      {!isLoading && !error && (
        <>
          {entries.length > 0 ? (
            <div className="space-y-2">
              {entries.map((entry) => (
                <div key={entry.id} className="p-3 bg-bg-secondary rounded-lg">
                  <div className="flex items-start gap-3">
                    <span className="text-lg font-mono">{getActionIcon(entry.action)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-text-primary">{entry.user.username}</span>
                        <span className="text-text-muted">{formatAction(entry.action)}</span>
                        {entry.target_name && (
                          <span className="text-text-secondary">{entry.target_name}</span>
                        )}
                      </div>
                      {entry.reason && (
                        <p className="text-sm text-text-muted mb-1">Reason: {entry.reason}</p>
                      )}
                      {entry.changes && (
                        <div className="text-xs text-text-muted">
                          {Object.entries(entry.changes).map(([key, change]) => (
                            <div key={key}>{key}: {String(change.old)} → {String(change.new)}</div>
                          ))}
                        </div>
                      )}
                      <div className="text-xs text-text-muted mt-1">{formatDate(entry.created_at)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-text-muted">No audit log entries found.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Soundboard Settings Tab
interface SoundboardSettingsTabProps {
  serverId: string;
}

function SoundboardSettingsTab({ serverId }: SoundboardSettingsTabProps) {
  const [config, setConfig] = useState({
    enabled: true,
    max_sounds_per_user: 3,
    max_sound_duration_seconds: 5,
    max_sound_size_bytes: 1048576,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const response = await api.get<any>(`/servers/${serverId}/soundboard/settings`);
      setConfig(response);
    } catch (err) {
      console.error('[SoundboardSettings] Failed to fetch config:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (serverId) {
      fetchConfig();
    }
  }, [serverId]);

  const handleSave = async () => {
    try {
      setSaving(true);
      const updated = await api.patch<any>(`/servers/${serverId}/soundboard/settings`, config);
      setConfig(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('[SoundboardSettings] Failed to save config:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-text-primary mb-1">Soundboard Settings</h3>
        <p className="text-sm text-text-secondary">Configure the soundboard for this server.</p>
      </div>

      {loading ? (
        <div className="text-text-muted">Loading...</div>
      ) : (
        <div className="space-y-4">
          {/* Enable toggle */}
          <label className="flex items-center justify-between p-3 bg-bg-secondary rounded-lg">
            <div>
              <div className="text-sm font-medium text-text-primary">Enable Soundboard</div>
              <div className="text-xs text-text-secondary">Allow members to upload and play sounds</div>
            </div>
            <input
              type="checkbox"
              name="soundboard-enabled"
              checked={config.enabled}
              onChange={(e) => setConfig(prev => ({ ...prev, enabled: e.target.checked }))}
              className="w-5 h-5 rounded"
            />
          </label>

          {/* Max sounds per user */}
          <div className="p-3 bg-bg-secondary rounded-lg">
            <label className="block text-sm font-medium text-text-primary mb-1" htmlFor="max-sounds-per-user">
              Max Sounds Per User
            </label>
            <input
              type="number"
              id="max-sounds-per-user"
              name="max-sounds-per-user"
              min="1"
              max="10"
              value={config.max_sounds_per_user}
              onChange={(e) => setConfig(prev => ({ ...prev, max_sounds_per_user: parseInt(e.target.value) || 3 }))}
              className="w-20 px-2 py-1 bg-bg-primary border border-border-primary rounded text-sm text-text-primary"
            />
            <span className="text-xs text-text-muted ml-2">(1-10)</span>
          </div>

          {/* Max duration */}
          <div className="p-3 bg-bg-secondary rounded-lg">
            <label className="block text-sm font-medium text-text-primary mb-1" htmlFor="max-sound-duration">
              Max Sound Duration (seconds)
            </label>
            <input
              type="number"
              id="max-sound-duration"
              name="max-sound-duration"
              min="1"
              max="10"
              value={config.max_sound_duration_seconds}
              onChange={(e) => setConfig(prev => ({ ...prev, max_sound_duration_seconds: parseInt(e.target.value) || 5 }))}
              className="w-20 px-2 py-1 bg-bg-primary border border-border-primary rounded text-sm text-text-primary"
            />
            <span className="text-xs text-text-muted ml-2">(1-10 seconds)</span>
          </div>

          {/* Max file size */}
          <div className="p-3 bg-bg-secondary rounded-lg">
            <label className="block text-sm font-medium text-text-primary mb-1" htmlFor="max-sound-size">
              Max Sound File Size (MB)
            </label>
            <input
              type="number"
              id="max-sound-size"
              name="max-sound-size"
              min="0.1"
              max="10"
              step="0.1"
              value={Math.round(config.max_sound_size_bytes / 1024 / 1024 * 10) / 10}
              onChange={(e) => setConfig(prev => ({ ...prev, max_sound_size_bytes: Math.round((parseFloat(e.target.value) || 1) * 1024 * 1024) }))}
              className="w-20 px-2 py-1 bg-bg-primary border border-border-primary rounded text-sm text-text-primary"
            />
            <span className="text-xs text-text-muted ml-2">(0.1-10 MB)</span>
          </div>

          {/* Save button */}
          <div className="flex items-center gap-3">
            <button
              className="px-4 py-2 bg-accent-primary hover:bg-accent-primary/80 text-white rounded text-sm font-medium disabled:opacity-50 transition-colors"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            {saved && (
              <span className="text-sm text-green-400">Saved!</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Stickers Tab
interface StickersTabProps {
  serverId: string;
}

interface StickerItem {
  id: string;
  server_id: string;
  name: string;
  description: string | null;
  file_url: string;
  file_type: string;
  uploaded_by: string | null;
  uploader_username?: string;
  created_at: string;
}

function StickersTab({ serverId }: StickersTabProps) {
  const [stickers, setStickers] = useState<StickerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchStickers = async () => {
    try {
      setLoading(true);
      const response = await api.get<{ stickers: StickerItem[] }>(`/servers/${serverId}/stickers`);
      setStickers(response.stickers || []);
    } catch (err) {
      console.error('[Stickers] Failed to fetch stickers:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (serverId) fetchStickers();
  }, [serverId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      const reader = new FileReader();
      reader.onload = () => setPreview(reader.result as string);
      reader.readAsDataURL(file);
      if (!name) {
        setName(file.name.replace(/\.[^/.]+$/, '').slice(0, 30));
      }
    }
  };

  const handleUpload = async () => {
    if (!selectedFile || !name || name.length < 2) return;
    try {
      setUploading(true);
      await api.upload<StickerItem>(
        `/servers/${serverId}/stickers`,
        selectedFile,
        'file',
        { name, ...(description ? { description } : {}) },
      );
      setName('');
      setDescription('');
      setSelectedFile(null);
      setPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await fetchStickers();
      toastStore.addToast({ type: 'system', title: 'Success', message: 'Sticker uploaded!' });
    } catch (err: any) {
      toastStore.addToast({ type: 'system', title: 'Error', message: err?.message || 'Failed to upload sticker' });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (stickerId: string) => {
    if (!confirm('Delete this sticker?')) return;
    try {
      await api.delete(`/servers/${serverId}/stickers/${stickerId}`);
      await fetchStickers();
      toastStore.addToast({ type: 'system', title: 'Success', message: 'Sticker deleted' });
    } catch (err: any) {
      toastStore.addToast({ type: 'system', title: 'Error', message: err?.message || 'Failed to delete sticker' });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-text-primary mb-1">Stickers</h3>
        <p className="text-sm text-text-secondary">Manage custom stickers for this server. Members can use these in messages.</p>
      </div>

      {/* Upload form */}
      <div className="p-4 bg-bg-secondary rounded-lg space-y-3">
        <h4 className="text-sm font-semibold text-text-primary">Upload Sticker</h4>

        <div className="flex gap-4">
          {/* Preview */}
          <div
            className="w-24 h-24 bg-bg-primary rounded-lg border-2 border-dashed border-border-primary flex items-center justify-center cursor-pointer hover:border-brand-primary transition-colors flex-shrink-0"
            onClick={() => fileInputRef.current?.click()}
          >
            {preview ? (
              <img src={preview} alt="Preview" className="w-full h-full object-contain rounded-lg" />
            ) : (
              <div className="text-center text-text-muted text-xs">
                <svg className="w-6 h-6 mx-auto mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                </svg>
                Click to select
              </div>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            name="sticker-file-upload"
            accept="image/png,image/gif,image/webp"
            className="hidden"
            onChange={handleFileChange}
          />

          <div className="flex-1 space-y-2">
            <input
              type="text"
              name="sticker-name"
              placeholder="Sticker name (2-30 chars)"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 30))}
              className="w-full px-3 py-1.5 bg-bg-primary border border-border-primary rounded text-sm text-text-primary"
            />
            <input
              type="text"
              name="sticker-description"
              placeholder="Description (optional, max 100)"
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 100))}
              className="w-full px-3 py-1.5 bg-bg-primary border border-border-primary rounded text-sm text-text-primary"
            />
            <div className="flex items-center gap-2">
              <button
                className="px-3 py-1.5 bg-accent-primary hover:bg-accent-primary/80 text-white rounded text-sm font-medium disabled:opacity-50 transition-colors"
                onClick={handleUpload}
                disabled={uploading || !selectedFile || !name || name.length < 2}
              >
                {uploading ? 'Uploading...' : 'Upload'}
              </button>
              <span className="text-xs text-text-muted">PNG, GIF, or WebP. Max 512KB.</span>
            </div>
          </div>
        </div>
      </div>

      {/* Sticker list */}
      {loading ? (
        <div className="text-text-muted">Loading...</div>
      ) : stickers.length === 0 ? (
        <div className="text-center py-8 text-text-muted">
          <p>No stickers yet. Upload one above!</p>
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-3">
          {stickers.map((sticker) => (
            <div
              key={sticker.id}
              className="group relative bg-bg-secondary rounded-lg p-2 flex flex-col items-center"
            >
              <img
                src={sticker.file_url}
                alt={sticker.name}
                className="w-20 h-20 object-contain"
              />
              <div className="mt-1 text-xs text-text-primary truncate w-full text-center" title={sticker.name}>
                {sticker.name}
              </div>
              {sticker.description && (
                <div className="text-xs text-text-muted truncate w-full text-center" title={sticker.description}>
                  {sticker.description}
                </div>
              )}
              <button
                onClick={() => handleDelete(sticker.id)}
                className="absolute top-1 right-1 p-1 bg-danger/80 hover:bg-danger text-white rounded opacity-0 group-hover:opacity-100 transition-opacity"
                title="Delete sticker"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="text-xs text-text-muted">
        {stickers.length}/50 stickers used
      </div>
    </div>
  );
}

// AFK Settings Tab
interface AfkSettingsTabProps {
  serverId: string;
  afkTimeout: number;
  afkChannelId: string | null;
  voiceChannels: Channel[];
  onSave: () => void;
}

const AFK_TIMEOUT_OPTIONS = [
  { value: 60, label: '1 minute' },
  { value: 300, label: '5 minutes' },
  { value: 600, label: '10 minutes' },
  { value: 900, label: '15 minutes' },
  { value: 1800, label: '30 minutes' },
  { value: 3600, label: '1 hour' },
];

function AfkSettingsTab({ serverId: _serverId, afkTimeout: initialAfkTimeout, afkChannelId: initialAfkChannelId, voiceChannels, onSave }: AfkSettingsTabProps) {
  const [afkTimeout, setAfkTimeout] = useState(initialAfkTimeout);
  const [afkChannelId, setAfkChannelId] = useState<string | null>(initialAfkChannelId);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await api.patch('/server', {
        afk_timeout: afkTimeout,
        afk_channel_id: afkChannelId || null,
      });
      setSaved(true);
      onSave();
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error('Failed to save AFK settings:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-text-primary mb-1">AFK Settings</h3>
        <p className="text-sm text-text-muted">
          Configure when idle users are automatically moved to the AFK channel.
          Users who are streaming are exempt from the AFK timer.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            AFK Channel
          </label>
          <select
            value={afkChannelId || ''}
            onChange={(e) => setAfkChannelId(e.target.value || null)}
            className="w-full bg-bg-tertiary border border-bg-modifier-accent rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-primary"
          >
            <option value="">No AFK Channel</option>
            {voiceChannels.map((channel) => (
              <option key={channel.id} value={channel.id}>{channel.name}</option>
            ))}
          </select>
          <p className="text-xs text-text-muted mt-1">
            Idle users in voice channels will be moved to this channel.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            AFK Timeout
          </label>
          <select
            value={afkTimeout}
            onChange={(e) => setAfkTimeout(parseInt(e.target.value))}
            className="w-full bg-bg-tertiary border border-bg-modifier-accent rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-primary"
          >
            {AFK_TIMEOUT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <p className="text-xs text-text-muted mt-1">
            How long a user must be idle before being moved to the AFK channel.
          </p>
        </div>

        <div className="bg-bg-tertiary rounded-md p-4">
          <h4 className="text-sm font-medium text-text-primary mb-2">What counts as activity?</h4>
          <ul className="text-xs text-text-muted space-y-1">
            <li>Speaking into the microphone</li>
            <li>Sending messages or typing</li>
            <li>Toggling mute, deafen, or screen share</li>
            <li>Any mouse, keyboard, or touch interaction</li>
          </ul>
          <p className="text-xs text-text-muted mt-2">
            Users who are screen sharing are never moved to AFK.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          className="px-4 py-2 bg-brand-primary hover:bg-brand-primary-hover text-white rounded-md text-sm font-medium transition-colors disabled:opacity-50"
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
        {saved && (
          <span className="text-sm text-green-400">Saved!</span>
        )}
      </div>
    </div>
  );
}

// ── Storage Tab ──────────────────────────────────────────────────────
// ── Crash Reports Tab ────────────────────────────────────────────────
function CrashReportsTab() {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [platformFilter, setPlatformFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (platformFilter) params.set('platform', platformFilter);
      const data = await api.get<any>(`/crash-reports?${params.toString()}`);
      setReports(data.reports || []);
    } catch (err) {
      console.error('Failed to fetch crash reports:', err);
    } finally {
      setLoading(false);
    }
  }, [platformFilter]);

  useEffect(() => { fetchReports(); }, [fetchReports]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-text-primary mb-1">Crash Reports</h3>
        <p className="text-sm text-text-muted">View crash reports submitted by desktop clients.</p>
      </div>

      <div className="flex gap-2">
        {['', 'windows', 'mac', 'linux', 'web'].map((p) => (
          <button
            key={p}
            onClick={() => setPlatformFilter(p)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${platformFilter === p ? 'bg-brand-primary text-white' : 'bg-bg-tertiary text-text-secondary hover:bg-bg-modifier-hover'}`}
          >
            {p || 'All'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-text-muted text-center py-8">Loading crash reports...</div>
      ) : reports.length === 0 ? (
        <div className="text-text-muted text-center py-8">No crash reports found.</div>
      ) : (
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {reports.map((r: any) => (
            <div key={r.id} className="bg-bg-secondary rounded-lg p-3">
              <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono bg-bg-tertiary px-2 py-0.5 rounded text-text-muted">{r.platform}</span>
                  <span className="text-xs text-text-muted">v{r.version}</span>
                  <span className="text-sm text-text-primary truncate max-w-[300px]">{r.error_type || r.error_message || 'Unknown error'}</span>
                </div>
                <span className="text-xs text-text-muted">{new Date(r.created_at).toLocaleString()}</span>
              </div>
              {expandedId === r.id && (
                <div className="mt-2 space-y-2">
                  {r.error_message && <p className="text-sm text-text-secondary">{r.error_message}</p>}
                  {r.stack_trace && (
                    <pre className="text-xs bg-bg-tertiary rounded p-2 overflow-x-auto text-text-muted max-h-48 overflow-y-auto">{r.stack_trace}</pre>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Releases Tab ─────────────────────────────────────────────────────
function ReleasesTab() {
  const [releases, setReleases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ version: '', platform: 'windows', download_url: '', changelog: '', required: false });
  const [submitting, setSubmitting] = useState(false);

  const fetchReleases = useCallback(async () => {
    try {
      const data = await api.get<any>('/releases');
      setReleases(data.releases || []);
    } catch (err) {
      console.error('Failed to fetch releases:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchReleases(); }, [fetchReleases]);

  const handleCreate = async () => {
    if (!formData.version || !formData.download_url) return;
    setSubmitting(true);
    try {
      await api.post('/releases', formData);
      setShowForm(false);
      setFormData({ version: '', platform: 'windows', download_url: '', changelog: '', required: false });
      await fetchReleases();
    } catch (err) {
      console.error('Failed to create release:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/releases/${id}`);
      setReleases(releases.filter((r) => r.id !== id));
    } catch (err) {
      console.error('Failed to delete release:', err);
    }
  };

  if (loading) return <div className="text-text-muted text-center py-8">Loading releases...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-text-primary mb-1">Desktop Releases</h3>
          <p className="text-sm text-text-muted">Manage desktop app release entries.</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="px-3 py-1.5 bg-brand-primary hover:bg-brand-primary-hover text-white rounded-md text-sm font-medium transition-colors">
          {showForm ? 'Cancel' : 'New Release'}
        </button>
      </div>

      {showForm && (
        <div className="bg-bg-secondary rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1" htmlFor="release-version">Version</label>
              <input type="text" id="release-version" name="release-version" placeholder="1.2.3" value={formData.version} onChange={(e) => setFormData({ ...formData, version: e.target.value })}
                className="w-full bg-bg-tertiary border border-bg-modifier-accent rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-primary" />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Platform</label>
              <select value={formData.platform} onChange={(e) => setFormData({ ...formData, platform: e.target.value })}
                className="w-full bg-bg-tertiary border border-bg-modifier-accent rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-primary">
                <option value="windows">Windows</option>
                <option value="mac">Mac</option>
                <option value="linux">Linux</option>
                <option value="all">All</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1" htmlFor="release-download-url">Download URL</label>
            <input type="url" id="release-download-url" name="release-download-url" placeholder="https://..." value={formData.download_url} onChange={(e) => setFormData({ ...formData, download_url: e.target.value })}
              className="w-full bg-bg-tertiary border border-bg-modifier-accent rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-primary" />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Changelog</label>
            <textarea rows={3} placeholder="What's new..." value={formData.changelog} onChange={(e) => setFormData({ ...formData, changelog: e.target.value })}
              className="w-full bg-bg-tertiary border border-bg-modifier-accent rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-primary resize-none" />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="release-required" name="release-required" checked={formData.required} onChange={(e) => setFormData({ ...formData, required: e.target.checked })} className="rounded" />
            <label htmlFor="release-required" className="text-sm text-text-secondary">Required update</label>
          </div>
          <button onClick={handleCreate} disabled={submitting || !formData.version || !formData.download_url}
            className="px-4 py-2 bg-brand-primary hover:bg-brand-primary-hover text-white rounded-md text-sm font-medium transition-colors disabled:opacity-50">
            {submitting ? 'Creating...' : 'Create Release'}
          </button>
        </div>
      )}

      {releases.length === 0 ? (
        <div className="text-text-muted text-center py-8">No releases yet.</div>
      ) : (
        <div className="space-y-2">
          {releases.map((r: any) => (
            <div key={r.id} className="bg-bg-secondary rounded-lg p-3 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-text-primary">v{r.version}</span>
                  <span className="text-xs bg-bg-tertiary px-2 py-0.5 rounded text-text-muted">{r.platform}</span>
                  {r.required && <span className="text-xs bg-danger/20 text-danger px-2 py-0.5 rounded">Required</span>}
                </div>
                {r.changelog && <p className="text-xs text-text-muted mt-1 line-clamp-2">{r.changelog}</p>}
                <span className="text-xs text-text-muted">{new Date(r.published_at).toLocaleDateString()}</span>
              </div>
              <button onClick={() => handleDelete(r.id)} className="p-1.5 text-text-muted hover:text-danger transition-colors" title="Delete release">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Emoji Packs Tab ────────────────────────────────────────────────
interface EmojiPackItem {
  id: string;
  server_id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  created_by_user_id: string | null;
  creator_username?: string;
  created_at: string;
}

interface EmojiItem {
  id: string;
  server_id: string;
  pack_id: string;
  shortcode: string;
  content_type: string;
  is_animated: boolean;
  asset_key: string;
  url?: string;
  width: number | null;
  height: number | null;
  size_bytes: number | null;
  creator_username?: string;
  created_at: string;
}

interface DefaultPackCategoryData {
  name: string;
  packs: {
    key: string;
    category: string;
    name: string;
    emojiCount: number;
    installed: boolean;
    installedPackId?: string;
  }[];
}

function EmojiPacksTab({ serverId }: { serverId: string }) {
  const [packs, setPacks] = useState<EmojiPackItem[]>([]);
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [packEmojis, setPackEmojis] = useState<EmojiItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newPackName, setNewPackName] = useState('');
  const [newPackDescription, setNewPackDescription] = useState('');
  const [uploading, setUploading] = useState(false);
  const [defaultCategories, setDefaultCategories] = useState<DefaultPackCategoryData[]>([]);
  const [installingKey, setInstallingKey] = useState<string | null>(null);
  const [emojiPacksEnabled, setEmojiPacksEnabled] = useState(true);

  // Fetch packs
  useEffect(() => {
    const fetchPacks = async () => {
      try {
        const response = await api.get<{ packs: EmojiPackItem[]; emoji_packs_enabled?: boolean }>(`/servers/${serverId}/emoji-packs`);
        setPacks(response.packs || []);
        setEmojiPacksEnabled(response.emoji_packs_enabled ?? true);
      } catch (err: any) {
        console.error('[EmojiPacks] Failed to fetch:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchPacks();
  }, [serverId]);

  // Fetch default packs catalog
  const fetchDefaults = useCallback(async () => {
    try {
      const response = await api.get<{ categories: DefaultPackCategoryData[] }>(
        `/servers/${serverId}/emoji-packs/defaults`
      );
      setDefaultCategories(response.categories || []);
    } catch {
      // Default packs not available - that's fine
    }
  }, [serverId]);

  useEffect(() => {
    fetchDefaults();
  }, [fetchDefaults]);

  // Fetch emojis for selected pack via manifest
  useEffect(() => {
    if (!selectedPackId) { setPackEmojis([]); return; }
    const fetchEmojis = async () => {
      try {
        const manifest = await api.get<{ packs: any[]; emojis: EmojiItem[] }>(`/servers/${serverId}/emojis/manifest`);
        setPackEmojis((manifest.emojis || []).filter((e: EmojiItem) => e.pack_id === selectedPackId));
      } catch { setPackEmojis([]); }
    };
    fetchEmojis();
  }, [serverId, selectedPackId]);

  const handleCreatePack = async () => {
    if (!newPackName.trim()) return;
    try {
      const pack = await api.post<EmojiPackItem>(`/servers/${serverId}/emoji-packs`, {
        name: newPackName.trim(),
        description: newPackDescription.trim() || undefined,
      });
      setPacks((prev) => [...prev, pack]);
      setNewPackName('');
      setNewPackDescription('');
    } catch (err: any) {
      toastStore.addToast({ type: 'system', title: 'Error', message: err?.message || 'Failed to create pack' });
    }
  };

  const handleToggleMaster = async (enabled: boolean) => {
    try {
      await api.patch(`/servers/${serverId}/emoji-packs/settings`, { emoji_packs_enabled: enabled });
      setEmojiPacksEnabled(enabled);
    } catch (err: any) {
      toastStore.addToast({ type: 'system', title: 'Error', message: err?.message || 'Failed to update setting' });
    }
  };

  const handleTogglePack = async (packId: string, enabled: boolean) => {
    try {
      await api.patch(`/servers/${serverId}/emoji-packs/${packId}`, { enabled });
      setPacks((prev) => prev.map((p) => (p.id === packId ? { ...p, enabled } : p)));
    } catch (err: any) {
      toastStore.addToast({ type: 'system', title: 'Error', message: err?.message || 'Failed to update pack' });
    }
  };

  const handleDeletePack = async (packId: string) => {
    if (!confirm('Delete this emoji pack and all its emojis?')) return;
    try {
      await api.delete(`/servers/${serverId}/emoji-packs/${packId}`);
      setPacks((prev) => prev.filter((p) => p.id !== packId));
      if (selectedPackId === packId) setSelectedPackId(null);
    } catch (err: any) {
      toastStore.addToast({ type: 'system', title: 'Error', message: err?.message || 'Failed to delete pack' });
    }
  };

  const handleUploadEmoji = async (file: File) => {
    if (!selectedPackId) return;
    setUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
      const shortcode = file.name.replace(/\.[^/.]+$/, '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const result = await api.post<{ emoji: EmojiItem; conflict?: { requested: string; assigned: string } }>(
        `/servers/${serverId}/emoji-packs/${selectedPackId}/emojis`,
        {
          _fileUpload: true,
          data: base64,
          filename: file.name,
          mimetype: file.type || 'image/png',
          fields: { shortcode },
        },
      );
      setPackEmojis((prev) => [...prev, result.emoji]);
      if (result.conflict) {
        toastStore.addToast({ type: 'system', title: 'Shortcode conflict', message: `"${result.conflict.requested}" was renamed to "${result.conflict.assigned}"` });
      }
    } catch (err: any) {
      toastStore.addToast({ type: 'system', title: 'Error', message: err?.message || 'Failed to upload emoji' });
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteEmoji = async (emojiId: string) => {
    if (!confirm('Delete this emoji?')) return;
    try {
      await api.delete(`/servers/${serverId}/emojis/${emojiId}`);
      setPackEmojis((prev) => prev.filter((e) => e.id !== emojiId));
    } catch (err: any) {
      toastStore.addToast({ type: 'system', title: 'Error', message: err?.message || 'Failed to delete emoji' });
    }
  };

  const handleZipImport = async (file: File) => {
    if (!selectedPackId) return;
    setUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
      const result = await api.post<{ importedCount: number; conflicts: any[]; errors: any[] }>(
        `/servers/${serverId}/emoji-packs/${selectedPackId}/emojis/import-zip`,
        {
          _fileUpload: true,
          data: base64,
          filename: file.name,
          mimetype: 'application/zip',
          fields: {},
        },
      );
      toastStore.addToast({
        type: 'system',
        title: 'Import complete',
        message: `Imported ${result.importedCount} emojis${result.errors.length ? `, ${result.errors.length} errors` : ''}`,
      });
      // Refresh emojis
      setSelectedPackId((id) => { setSelectedPackId(null); setTimeout(() => setSelectedPackId(id), 100); return id; });
    } catch (err: any) {
      toastStore.addToast({ type: 'system', title: 'Error', message: err?.message || 'Failed to import ZIP' });
    } finally {
      setUploading(false);
    }
  };

  const handleInstallDefault = async (key: string) => {
    setInstallingKey(key);
    try {
      const result = await api.post<{
        pack: EmojiPackItem;
        importedCount: number;
        conflicts: any[];
        errors: any[];
      }>(`/servers/${serverId}/emoji-packs/install-default`, { key });
      setPacks((prev) => [...prev, result.pack]);
      toastStore.addToast({
        type: 'system',
        title: 'Pack installed',
        message: `Installed ${result.importedCount} emojis${result.errors.length ? `, ${result.errors.length} errors` : ''}`,
      });
      fetchDefaults();
    } catch (err: any) {
      toastStore.addToast({
        type: 'system',
        title: 'Error',
        message: err?.message || 'Failed to install pack',
      });
    } finally {
      setInstallingKey(null);
    }
  };

  const handleUninstallDefault = async (packId: string) => {
    if (!confirm('Uninstall this default pack and remove all its emojis?')) return;
    try {
      await api.delete(`/servers/${serverId}/emoji-packs/${packId}`);
      setPacks((prev) => prev.filter((p) => p.id !== packId));
      if (selectedPackId === packId) setSelectedPackId(null);
      fetchDefaults();
    } catch (err: any) {
      toastStore.addToast({
        type: 'system',
        title: 'Error',
        message: err?.message || 'Failed to uninstall pack',
      });
    }
  };

  if (loading) {
    return <div className="p-4 text-text-secondary">Loading emoji packs...</div>;
  }

  // Pack list view
  if (!selectedPackId) {
    return (
      <div className="p-4 space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-text-primary mb-2">Emoji Packs</h3>
          <p className="text-sm text-text-secondary">Manage custom emoji packs for this server.</p>
        </div>

        {/* Master toggle */}
        <div className="flex items-center justify-between p-3 bg-bg-secondary rounded border border-border-subtle">
          <div>
            <div className="font-medium text-text-primary">Enable Custom Emoji Packs</div>
            <div className="text-xs text-text-secondary">When disabled, only Unicode emojis are available for all members.</div>
          </div>
          <button
            onClick={() => handleToggleMaster(!emojiPacksEnabled)}
            className={clsx(
              'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
              emojiPacksEnabled ? 'bg-brand-primary' : 'bg-bg-tertiary'
            )}
          >
            <span
              className={clsx(
                'inline-block h-4 w-4 rounded-full bg-white transition-transform',
                emojiPacksEnabled ? 'translate-x-6' : 'translate-x-1'
              )}
            />
          </button>
        </div>

        {/* Create pack form */}
        <div className={clsx("flex gap-2 items-end", !emojiPacksEnabled && "opacity-50 pointer-events-none")}>
          <div className="flex-1">
            <label className="block text-xs text-text-secondary mb-1" htmlFor="emoji-pack-name">Pack Name</label>
            <input
              id="emoji-pack-name"
              name="emoji-pack-name"
              value={newPackName}
              onChange={(e) => setNewPackName(e.target.value)}
              placeholder="My Emoji Pack"
              maxLength={50}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-subtle rounded text-text-primary text-sm"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-text-secondary mb-1" htmlFor="emoji-pack-description">Description (optional)</label>
            <input
              id="emoji-pack-description"
              name="emoji-pack-description"
              value={newPackDescription}
              onChange={(e) => setNewPackDescription(e.target.value)}
              placeholder="Pack description"
              maxLength={200}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-subtle rounded text-text-primary text-sm"
            />
          </div>
          <button
            onClick={handleCreatePack}
            disabled={!newPackName.trim()}
            className="px-4 py-2 bg-brand-primary text-white rounded text-sm font-medium hover:bg-brand-primary-hover disabled:opacity-50"
          >
            Create
          </button>
        </div>

        {/* Pack list */}
        <div className={clsx("space-y-2", !emojiPacksEnabled && "opacity-50 pointer-events-none")}>
          {packs.length === 0 ? (
            <p className="text-text-muted text-sm py-4 text-center">No emoji packs yet. Create one above!</p>
          ) : (
            packs.map((pack) => (
              <div key={pack.id} className="flex items-center justify-between p-3 bg-bg-secondary rounded border border-border-subtle">
                <div className="flex-1 cursor-pointer" onClick={() => setSelectedPackId(pack.id)}>
                  <div className="font-medium text-text-primary">{pack.name}</div>
                  {pack.description && <div className="text-xs text-text-secondary">{pack.description}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-xs text-text-secondary">
                    <input
                      type="checkbox"
                      name={`emoji-pack-enabled-${pack.id}`}
                      checked={pack.enabled}
                      onChange={(e) => handleTogglePack(pack.id, e.target.checked)}
                      className="rounded"
                    />
                    Enabled
                  </label>
                  <button
                    onClick={() => handleDeletePack(pack.id)}
                    className="p-1 text-text-muted hover:text-status-error transition-colors"
                    title="Delete pack"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Default Packs Catalog */}
        {defaultCategories.length > 0 && (
          <div className={clsx("mt-6", !emojiPacksEnabled && "opacity-50 pointer-events-none")}>
            <h3 className="text-lg font-semibold text-text-primary mb-2">Default Packs</h3>
            <p className="text-sm text-text-secondary mb-4">
              Pre-loaded emoji packs you can install into your server.
            </p>
            {defaultCategories.map((category) => (
              <div key={category.name} className="mb-4">
                <h4 className="text-sm font-medium text-text-secondary mb-2">{category.name}</h4>
                <div className="grid grid-cols-2 gap-2">
                  {category.packs.map((pack) => (
                    <div
                      key={pack.key}
                      className="flex items-center justify-between p-3 bg-bg-secondary rounded border border-border-subtle"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-text-primary text-sm truncate">{pack.name}</div>
                        <div className="text-xs text-text-muted">{pack.emojiCount} emojis</div>
                      </div>
                      {pack.installed ? (
                        <button
                          onClick={() => pack.installedPackId && handleUninstallDefault(pack.installedPackId)}
                          className="ml-2 px-3 py-1 text-xs rounded border border-status-error/30 text-status-error hover:bg-status-error/10 transition-colors shrink-0"
                        >
                          Uninstall
                        </button>
                      ) : (
                        <button
                          onClick={() => handleInstallDefault(pack.key)}
                          disabled={installingKey !== null}
                          className="ml-2 px-3 py-1 text-xs rounded bg-brand-primary text-white hover:bg-brand-primary-hover disabled:opacity-50 transition-colors shrink-0"
                        >
                          {installingKey === pack.key ? 'Installing...' : 'Install'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Pack editor view (selected pack)
  const selectedPack = packs.find((p) => p.id === selectedPackId);
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={() => setSelectedPackId(null)} className="text-text-secondary hover:text-text-primary">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h3 className="text-lg font-semibold text-text-primary">{selectedPack?.name || 'Pack'}</h3>
        <span className="text-xs text-text-muted">{packEmojis.length} emojis</span>
      </div>

      {/* Upload buttons */}
      <div className="flex gap-2">
        <label className={`px-3 py-1.5 bg-brand-primary text-white rounded text-sm cursor-pointer hover:bg-brand-primary-hover ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
          {uploading ? 'Uploading...' : 'Upload Emoji'}
          <input type="file" name="emoji-upload" accept="image/png,image/gif,image/webp,image/jpeg" className="hidden" onChange={(e) => { if (e.target.files?.[0]) handleUploadEmoji(e.target.files[0]); e.target.value = ''; }} disabled={uploading} />
        </label>
        <label className={`px-3 py-1.5 bg-bg-tertiary text-text-primary rounded text-sm cursor-pointer border border-border-subtle hover:bg-bg-modifier-hover ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
          Import ZIP
          <input type="file" name="emoji-zip-import" accept=".zip" className="hidden" onChange={(e) => { if (e.target.files?.[0]) handleZipImport(e.target.files[0]); e.target.value = ''; }} disabled={uploading} />
        </label>
      </div>

      {/* Emoji grid */}
      <div className="grid grid-cols-6 gap-2">
        {packEmojis.map((emoji) => (
          <div key={emoji.id} className="group relative flex flex-col items-center p-2 bg-bg-secondary rounded border border-border-subtle hover:border-brand-primary transition-colors">
            <img
              src={emoji.url || emoji.asset_key}
              alt={`:${emoji.shortcode}:`}
              className="w-10 h-10 object-contain"
              loading="lazy"
            />
            <span className="text-xs text-text-secondary mt-1 truncate w-full text-center" title={`:${emoji.shortcode}:`}>:{emoji.shortcode}:</span>
            <button
              onClick={() => handleDeleteEmoji(emoji.id)}
              className="absolute top-0.5 right-0.5 p-0.5 rounded bg-bg-primary/80 text-text-muted hover:text-status-error opacity-0 group-hover:opacity-100 transition-opacity"
              title="Delete"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
      {packEmojis.length === 0 && (
        <p className="text-text-muted text-sm text-center py-4">No emojis in this pack yet. Upload one above!</p>
      )}
    </div>
  );
}

// ── Webhooks Tab ──────────────────────────────────────────────

interface WebhookData {
  id: string;
  server_id: string;
  channel_id: string;
  name: string;
  avatar_url: string | null;
  token: string;
  created_by: string | null;
  created_by_username: string | null;
  channel_name: string | null;
  created_at: string;
}

function WebhooksTab({ serverId, channels }: { serverId: string; channels: Channel[] }) {
  const [webhooks, setWebhooks] = useState<WebhookData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  // Create form state
  const [newName, setNewName] = useState('');
  const [newChannelId, setNewChannelId] = useState('');
  const [actionInProgress, setActionInProgress] = useState(false);

  const textChannels = useMemo(
    () => channels.filter((c) => c.type === 'text' || c.type === 'announcement'),
    [channels]
  );

  const fetchWebhooks = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.get<{ webhooks: WebhookData[] }>(`/webhooks?server_id=${serverId}`);
      setWebhooks(data.webhooks || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load webhooks');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (serverId) fetchWebhooks();
  }, [serverId]);

  const handleCreate = async () => {
    if (!newName.trim() || !newChannelId) return;
    setActionInProgress(true);
    try {
      await api.post('/webhooks', {
        name: newName.trim(),
        channel_id: newChannelId,
      });
      setNewName('');
      setNewChannelId('');
      setShowCreateForm(false);
      await fetchWebhooks();
    } catch (err: any) {
      alert(err?.message || 'Failed to create webhook');
    } finally {
      setActionInProgress(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this webhook? Any services using it will stop working.')) return;
    try {
      await api.delete(`/webhooks/${id}`);
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
    } catch (err: any) {
      alert(err?.message || 'Failed to delete webhook');
    }
  };

  const copyToken = async (webhook: WebhookData) => {
    const url = `${window.location.origin}/api/webhooks/${webhook.id}/${webhook.token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(webhook.id);
      setTimeout(() => setCopiedToken(null), 2000);
    } catch {
      // Fallback
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopiedToken(webhook.id);
      setTimeout(() => setCopiedToken(null), 2000);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-text-primary">Webhooks</h2>
          <p className="text-sm text-text-muted mt-1">
            Webhooks allow external services to send messages to your channels.
          </p>
        </div>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded text-sm font-medium transition-colors"
        >
          Create Webhook
        </button>
      </div>

      {/* Create form */}
      {showCreateForm && (
        <div className="bg-bg-secondary rounded-lg p-4 space-y-4 border border-border-subtle">
          <h3 className="text-sm font-semibold text-text-primary">New Webhook</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1" htmlFor="webhook-name">Name</label>
              <input
                type="text"
                id="webhook-name"
                name="webhook-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. GitHub Notifications"
                maxLength={80}
                className="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Channel</label>
              <select
                value={newChannelId}
                onChange={(e) => setNewChannelId(e.target.value)}
                className="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-sm text-text-primary focus:outline-none focus:border-accent"
              >
                <option value="">Select a channel...</option>
                {textChannels.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    #{ch.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => {
                setShowCreateForm(false);
                setNewName('');
                setNewChannelId('');
              }}
              className="px-3 py-1.5 text-sm text-text-muted hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={actionInProgress || !newName.trim() || !newChannelId}
              className="px-4 py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded text-sm font-medium transition-colors"
            >
              {actionInProgress ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-danger/10 text-danger text-sm p-3 rounded">{error}</div>
      )}

      {/* Loading */}
      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <div className="text-text-muted text-sm">Loading webhooks...</div>
        </div>
      ) : webhooks.length === 0 ? (
        <div className="text-center py-12 text-text-muted">
          <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          <p className="text-sm">No webhooks yet</p>
          <p className="text-xs mt-1">Create a webhook to let external services post messages.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {webhooks.map((wh) => (
            <div
              key={wh.id}
              className="bg-bg-secondary rounded-lg p-4 border border-border-subtle"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-bg-tertiary flex items-center justify-center shrink-0">
                    {wh.avatar_url ? (
                      <img
                        src={wh.avatar_url}
                        alt={wh.name}
                        className="w-10 h-10 rounded-full object-cover"
                      />
                    ) : (
                      <svg className="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                    )}
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-sm font-semibold text-text-primary truncate">{wh.name}</h4>
                    <p className="text-xs text-text-muted">
                      #{wh.channel_name || 'unknown'}
                      {wh.created_by_username && (
                        <span> &middot; Created by {wh.created_by_username}</span>
                      )}
                      <span> &middot; {new Date(wh.created_at).toLocaleDateString()}</span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => copyToken(wh)}
                    className="px-3 py-1.5 text-xs bg-bg-tertiary hover:bg-bg-modifier-hover text-text-muted hover:text-text-primary rounded transition-colors"
                    title="Copy webhook URL"
                  >
                    {copiedToken === wh.id ? 'Copied!' : 'Copy URL'}
                  </button>
                  <button
                    onClick={() => handleDelete(wh.id)}
                    className="p-1.5 text-text-muted hover:text-danger transition-colors"
                    title="Delete webhook"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Relay Servers Tab ───────────────────────────────────────────────────── */

interface RelayServerRow {
  id: string;
  name: string;
  region: string;
  status: string;
  health_url: string | null;
  livekit_url: string | null;
  max_participants: number;
  current_participants: number;
  allow_master_fallback: boolean;
  last_health_status: string | null;
  created_at: string;
}

const RELAY_REGIONS = [
  { value: 'us-east', label: 'US East' },
  { value: 'us-west', label: 'US West' },
  { value: 'us-central', label: 'US Central' },
  { value: 'eu-west', label: 'EU West' },
  { value: 'eu-central', label: 'EU Central' },
  { value: 'eu-north', label: 'EU North' },
  { value: 'asia-east', label: 'Asia East' },
  { value: 'asia-southeast', label: 'Asia Southeast' },
  { value: 'oceania', label: 'Oceania' },
  { value: 'south-america', label: 'South America' },
  { value: 'africa', label: 'Africa' },
  { value: 'middle-east', label: 'Middle East' },
] as const;

function RelayServersTab() {
  const [relays, setRelays] = useState<RelayServerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pairingToken, setPairingToken] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);
  const [newRelay, setNewRelay] = useState({
    name: '',
    region: 'us-east',
    max_participants: 100,
    allow_master_fallback: true,
  });

  const fetchRelays = useCallback(async () => {
    try {
      const data = await api.get<{ relays: RelayServerRow[] }>('/admin/relays');
      setRelays(data.relays || []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRelays();
  }, [fetchRelays]);

  const handleCreate = async () => {
    if (!newRelay.name.trim()) return;
    setCreating(true);
    try {
      const data = await api.post<{ pairing_token: string }>('/admin/relays', newRelay);
      setPairingToken(data.pairing_token);
      setShowCreate(false);
      setNewRelay({ name: '', region: 'us-east', max_participants: 100, allow_master_fallback: true });
      fetchRelays();
    } catch (err: any) {
      toastStore.addToast({ type: 'system', title: 'Error', message: err?.message || 'Failed to create relay' });
    } finally {
      setCreating(false);
    }
  };

  const handleSuspend = async (id: string) => {
    try {
      await api.post(`/admin/relays/${id}/suspend`);
      fetchRelays();
    } catch (err: any) {
      toastStore.addToast({ type: 'system', title: 'Error', message: err?.message || 'Failed to suspend relay' });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this relay server? This cannot be undone.')) return;
    try {
      await api.delete(`/admin/relays/${id}`);
      fetchRelays();
    } catch (err: any) {
      toastStore.addToast({ type: 'system', title: 'Error', message: err?.message || 'Failed to delete relay' });
    }
  };

  const handleRegenerate = async (id: string) => {
    try {
      const data = await api.post<{ pairing_token: string }>(`/admin/relays/${id}/regenerate`);
      setPairingToken(data.pairing_token);
      fetchRelays();
    } catch (err: any) {
      toastStore.addToast({ type: 'system', title: 'Error', message: err?.message || 'Failed to regenerate token' });
    }
  };

  const copyPairingToken = () => {
    if (!pairingToken) return;
    navigator.clipboard.writeText(pairingToken);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'trusted': return 'text-green-400';
      case 'pending': return 'text-yellow-400';
      case 'suspended': return 'text-red-400';
      case 'offline': return 'text-text-muted';
      default: return 'text-text-muted';
    }
  };

  const healthColor = (health: string | null) => {
    switch (health) {
      case 'healthy': return 'bg-green-400';
      case 'degraded': return 'bg-yellow-400';
      case 'unreachable': return 'bg-red-400';
      default: return 'bg-gray-500';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-text-muted">
        Loading relay servers...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Pairing token banner */}
      {pairingToken && (
        <div className="p-4 rounded-lg bg-accent/10 border border-accent/30">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-accent">Pairing Token Generated</h4>
            <button
              onClick={() => setPairingToken(null)}
              className="text-text-muted hover:text-text-primary text-xs"
            >
              Dismiss
            </button>
          </div>
          <p className="text-xs text-text-secondary mb-2">
            Give this token to the relay operator. It expires in 24 hours and can only be used once.
          </p>
          <div className="flex gap-2">
            <code className="flex-1 text-xs bg-bg-primary p-2 rounded font-mono break-all select-all max-h-20 overflow-y-auto">
              {pairingToken}
            </code>
            <button
              onClick={copyPairingToken}
              className="px-3 py-1 text-xs bg-accent hover:bg-accent/80 text-white rounded transition-colors whitespace-nowrap"
            >
              {copiedToken ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-text-primary">Relay Servers</h3>
          <p className="text-xs text-text-muted mt-0.5">
            Regional voice relays for lower latency. Relays handle voice only.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-3 py-1.5 text-sm bg-accent hover:bg-accent/80 text-white rounded-md transition-colors"
        >
          {showCreate ? 'Cancel' : 'Add Relay'}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="p-4 rounded-lg bg-bg-tertiary border border-divider space-y-3">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Name</label>
            <input
              type="text"
              value={newRelay.name}
              onChange={(e) => setNewRelay({ ...newRelay, name: e.target.value })}
              placeholder="EU West Relay"
              className="w-full px-3 py-1.5 text-sm bg-bg-primary border border-divider rounded text-text-primary placeholder-text-muted focus:outline-none focus:border-accent"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Region</label>
              <select
                value={newRelay.region}
                onChange={(e) => setNewRelay({ ...newRelay, region: e.target.value })}
                className="w-full px-3 py-1.5 text-sm bg-bg-primary border border-divider rounded text-text-primary focus:outline-none focus:border-accent"
              >
                {RELAY_REGIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                Max Participants
              </label>
              <input
                type="number"
                value={newRelay.max_participants}
                onChange={(e) =>
                  setNewRelay({ ...newRelay, max_participants: parseInt(e.target.value) || 100 })
                }
                min={1}
                className="w-full px-3 py-1.5 text-sm bg-bg-primary border border-divider rounded text-text-primary focus:outline-none focus:border-accent"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={newRelay.allow_master_fallback}
              onChange={(e) =>
                setNewRelay({ ...newRelay, allow_master_fallback: e.target.checked })
              }
              className="rounded"
            />
            Allow as master fallback
          </label>
          <button
            onClick={handleCreate}
            disabled={creating || !newRelay.name.trim()}
            className="px-4 py-1.5 text-sm bg-accent hover:bg-accent/80 disabled:opacity-50 text-white rounded transition-colors"
          >
            {creating ? 'Creating...' : 'Create & Generate Pairing Token'}
          </button>
        </div>
      )}

      {/* Relay list */}
      {relays.length === 0 ? (
        <div className="text-center py-8 text-text-muted text-sm">
          No relay servers configured. Click "Add Relay" to register one.
        </div>
      ) : (
        <div className="space-y-2">
          {relays.map((relay) => (
            <div
              key={relay.id}
              className="p-3 rounded-lg bg-bg-tertiary border border-divider hover:border-divider/80 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-2.5 h-2.5 rounded-full ${healthColor(relay.last_health_status)}`} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-primary truncate">
                        {relay.name}
                      </span>
                      <span className={`text-xs font-mono ${statusColor(relay.status)}`}>
                        {relay.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-text-muted">
                      <span>{relay.region}</span>
                      <span>-</span>
                      <span>
                        {relay.current_participants}/{relay.max_participants} users
                      </span>
                      {relay.last_health_status && (
                        <>
                          <span>-</span>
                          <span>{relay.last_health_status}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {relay.status === 'pending' && (
                    <button
                      onClick={() => handleRegenerate(relay.id)}
                      className="px-2 py-1 text-xs bg-bg-modifier-hover hover:bg-bg-modifier-active text-text-secondary rounded transition-colors"
                      title="Regenerate pairing token"
                    >
                      Re-pair
                    </button>
                  )}
                  {relay.status === 'trusted' && (
                    <button
                      onClick={() => handleSuspend(relay.id)}
                      className="px-2 py-1 text-xs text-yellow-400 hover:bg-yellow-400/10 rounded transition-colors"
                      title="Suspend relay"
                    >
                      Suspend
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(relay.id)}
                    className="p-1 text-text-muted hover:text-danger transition-colors"
                    title="Delete relay"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
