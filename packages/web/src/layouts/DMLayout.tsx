import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { api } from '@/api';
import { ServerList } from '@/components/layout/ServerList';
import { DMPage } from '@/components/layout/DMPage';
import { useEmojiManifestStore } from '@/stores/emojiManifest';
import { TitleBar } from '@/components/ui/TitleBar';
import { UserSettingsModal } from '@/components/ui/UserSettingsModal';
import { CommandPalette } from '@/components/ui/CommandPalette';
import { FloatingUserPanel } from '@/components/layout/FloatingUserPanel';

interface ServerData {
  id: string;
  name: string;
  icon_url: string | null;
}

export function DMLayout() {
  const navigate = useNavigate();
  const [servers, setServers] = useState<ServerData[]>([]);
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [userTimezone, setUserTimezone] = useState<string | undefined>(undefined);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Fetch server info via REST (not socket events)
  useEffect(() => {
    const fetchServer = async () => {
      try {
        const server = await api.get<ServerData>('/server');
        setServers([server]);
        useEmojiManifestStore.getState().fetchManifest(server.id);
      } catch (err) {
        console.error('[DMLayout] Failed to fetch server:', err);
        setLoadError(err instanceof Error ? err.message : 'Failed to load server');
      }
    };
    fetchServer();
    // Fetch user timezone
    api.get<{ timezone?: string }>('/users/me/settings').then((settings) => {
      if (settings?.timezone) setUserTimezone(settings.timezone);
    }).catch(() => {});
  }, []);

  // Ctrl+K command palette shortcut
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette((prev) => !prev);
      }
    };
    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  const paletteActions = useMemo(() => [
    { id: 'settings', label: 'User Settings', sublabel: 'Open your settings', icon: 'settings' as const, action: () => setShowUserSettings(true) },
    { id: 'server', label: 'Back to Server', sublabel: 'Navigate to the server channels', icon: 'dm' as const, action: () => navigate('/channels') },
  ], [navigate]);

  const handleNavigateChannel = useCallback((id: string) => {
    navigate(`/channels/${id}`);
  }, [navigate]);

  return (
    <div className="flex flex-col h-screen bg-bg-primary text-text-primary overflow-hidden">
      <TitleBar />
      {loadError && (
        <div className="bg-danger/10 border-b border-danger/30 px-4 py-2 text-sm text-danger flex items-center justify-between">
          <span>Failed to load: {loadError}</span>
          <button onClick={() => window.location.reload()} className="text-xs underline">Reload</button>
        </div>
      )}
      <div
        className="flex flex-1 min-h-0"
        style={{ height: 'calc(100vh - var(--title-bar-height))' }}
      >
        {/* Mobile sidebar backdrop */}
        {isMobileSidebarOpen && (
          <div
            className="fixed inset-0 bg-black/60 z-40 md:hidden"
            onClick={() => setIsMobileSidebarOpen(false)}
          />
        )}

        {/* Server List — overlay on mobile, static on desktop */}
        <div
          className={`
            fixed inset-y-0 left-0 z-50 flex
            transition-transform duration-200 ease-in-out
            md:relative md:z-10 md:translate-x-0
            ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          `}
          style={{ height: '100%' }}
        >
          <ServerList servers={servers} />
        </div>

        <div className="flex flex-col h-full flex-1 min-w-0">
          <div className="flex-1 min-h-0">
            <DMPage
              serverId={servers[0]?.id}
              onMobileSidebarToggle={() => setIsMobileSidebarOpen((v) => !v)}
            />
          </div>
        </div>
      </div>

      <FloatingUserPanel
        onSettingsClick={() => setShowUserSettings(true)}
        onDMClick={() => {}}
        userTimezone={userTimezone}
      />

      {/* Command Palette (Ctrl+K) */}
      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        channels={[]}
        members={[]}
        onNavigateChannel={handleNavigateChannel}
        onJoinVoice={() => {}}
        onUserClick={() => {}}
        quickActions={paletteActions}
      />

      <UserSettingsModal
        isOpen={showUserSettings}
        onClose={() => setShowUserSettings(false)}
      />
    </div>
  );
}
