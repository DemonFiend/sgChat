import { useState, useEffect } from 'react';
import { socketService, useSocketStore } from '@/lib/socket';
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

  useEffect(() => {
    let cleanupConnect: (() => void) | undefined;

    const handleServerList = (data: { servers: ServerData[] }) => {
      setServers(data.servers);
    };

    socketService.on('server.list', handleServerList as (data: unknown) => void);

    const emitServerList = () => {
      socketService.emit('server.list').catch(() => {});
    };

    const { connectionState } = useSocketStore.getState();
    if (connectionState === 'connected') {
      emitServerList();
    } else {
      const onConnect = () => {
        emitServerList();
        socketService.off('connect', onConnect as (data: unknown) => void);
      };
      socketService.on('connect', onConnect as (data: unknown) => void);
      cleanupConnect = () => socketService.off('connect', onConnect as (data: unknown) => void);
    }

    return () => {
      socketService.off('server.list', handleServerList as (data: unknown) => void);
      cleanupConnect?.();
    };
  }, []);

  return (
    <div className="flex flex-col h-screen bg-bg-primary text-text-primary overflow-hidden">
      <TitleBar />
      <div className="flex flex-1 min-h-0" style={{ height: 'calc(100vh - var(--title-bar-height))' }}>
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
