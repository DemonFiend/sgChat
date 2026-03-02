import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { api } from '@/api';
import { ServerList } from '@/components/layout/ServerList';
import { DMPage } from '@/components/layout/DMPage';
import { TitleBar } from '@/components/ui/TitleBar';
import { UserSettingsModal } from '@/components/ui/UserSettingsModal';
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [userTimezone, setUserTimezone] = useState<string | undefined>(undefined);

  // Fetch server info via REST (not socket events)
  useEffect(() => {
    const fetchServer = async () => {
      try {
        const server = await api.get<ServerData>('/server');
        setServers([server]);
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
        <ServerList servers={servers} />
        <div className="flex flex-col h-full">
          <div className="flex-1 min-h-0">
            <DMPage />
          </div>
        </div>
      </div>

      <FloatingUserPanel
        onSettingsClick={() => setShowUserSettings(true)}
        onDMClick={() => {}}
        userTimezone={userTimezone}
      />

      <UserSettingsModal
        isOpen={showUserSettings}
        onClose={() => setShowUserSettings(false)}
      />
    </div>
  );
}
