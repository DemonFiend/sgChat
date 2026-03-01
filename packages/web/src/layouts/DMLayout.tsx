import { useState, useEffect } from 'react';
import { api } from '@/api';
import { ServerList } from '@/components/layout/ServerList';
import { DMPage } from '@/components/layout/DMPage';
import { UserPanel } from '@/components/layout/UserPanel';
import { TitleBar } from '@/components/ui/TitleBar';
import { VoiceConnectedBar } from '@/components/ui/VoiceConnectedBar';

interface ServerData {
  id: string;
  name: string;
  icon_url: string | null;
}

export function DMLayout() {
  const [servers, setServers] = useState<ServerData[]>([]);

  // Fetch server info via REST (not socket events)
  useEffect(() => {
    const fetchServer = async () => {
      try {
        const server = await api.get<ServerData>('/server');
        setServers([server]);
      } catch (err) {
        console.error('[DMLayout] Failed to fetch server:', err);
      }
    };
    fetchServer();
  }, []);

  return (
    <div className="flex flex-col h-screen bg-bg-primary text-text-primary overflow-hidden">
      <TitleBar />
      <div
        className="flex flex-1 min-h-0"
        style={{ height: 'calc(100vh - var(--title-bar-height))' }}
      >
        <ServerList servers={servers} onCreateServer={() => {}} />
        <div className="flex flex-col h-full">
          <div className="flex-1 min-h-0">
            <DMPage />
          </div>
          <VoiceConnectedBar />
          <UserPanel />
        </div>
      </div>
    </div>
  );
}
