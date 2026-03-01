import { useState, useEffect, useMemo } from 'react';
import { Link, useParams, useNavigate } from 'react-router';
import { clsx } from 'clsx';
import { authStore } from '@/stores/auth';
import { networkStore } from '@/stores/network';
import { useVoiceStore } from '@/stores/voice';
import { serverPopupStore } from '@/stores/serverPopup';
import { canManageChannels } from '@/stores/permissions';
import { ChannelList, type Channel, type Category, type ChannelType } from './ChannelList';

const MIN_WIDTH = 192;
const MAX_WIDTH = 384;
const DEFAULT_WIDTH = 240;
const STORAGE_KEY = 'serverSidebarWidth';

export interface ServerInfo {
  id: string;
  name: string;
  icon_url: string | null;
  motd?: string;
}

interface ServerSidebarProps {
  server: ServerInfo | null;
  channels: Channel[];
  categories: Category[];
  onServerSettingsClick?: () => void;
  onChannelSettingsClick?: (channel: Channel) => void;
  onLogout?: () => void;
}

export function ServerSidebar({ server, channels, categories, onServerSettingsClick, onChannelSettingsClick }: ServerSidebarProps) {
  const { channelId } = useParams<{ channelId?: string }>();
  const navigate = useNavigate();
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const voiceConnected = useVoiceStore((s) => s.connectionState === 'connected');

  const substituteMotdVariables = (text: string): string => {
    const user = authStore.state().user;
    return text
      .replace(/\{username\}/gi, user?.display_name || user?.username || 'User')
      .replace(/\{servername\}/gi, server?.name || '')
      .replace(/\{servericon\}/gi, server?.icon_url || '')
      .replace(/\{servertime\}/gi, '')
      .replace(/\{if:([^}]*)\}([\s\S]*?)\{\/if\}/gi, (_match, _cond, body) => body);
  };

  useEffect(() => {
    const savedWidth = localStorage.getItem(STORAGE_KEY);
    if (savedWidth) {
      const parsed = parseInt(savedWidth, 10);
      if (!isNaN(parsed) && parsed >= MIN_WIDTH && parsed <= MAX_WIDTH) setWidth(parsed);
    }
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);

    const startX = e.clientX;
    const startWidth = width;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startX;
      setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + deltaX)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      localStorage.setItem(STORAGE_KEY, width.toString());
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  };

  const handleLogout = async () => {
    await authStore.logout(false);
    networkStore.clearConnection();
    navigate('/login', { replace: true });
  };

  return (
    <div
      className="flex flex-col h-full bg-bg-secondary border-r border-bg-tertiary relative"
      style={{ width: `${width}px` }}
    >
      {/* Resize Handle - Right Edge */}
      <div
        className={clsx(
          'absolute right-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-brand-primary/50 transition-colors z-10 group',
          isResizing && 'bg-brand-primary'
        )}
        onMouseDown={handleMouseDown}
        title="Drag to resize sidebar"
      >
        <div className="absolute -left-1 -right-1 top-0 bottom-0" />
      </div>

      {/* Header with Server Info and Settings */}
      <div className="flex items-center gap-2 p-3 border-b border-bg-tertiary">
        {/* Logout Button */}
        <button
          onClick={handleLogout}
          className="p-2 rounded hover:bg-bg-modifier-hover text-text-muted hover:text-danger transition-colors"
          title="Log Out"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </button>

        {/* Server Icon & Name */}
        <button
          onClick={() => serverPopupStore.reopenPopup()}
          className="flex-1 flex items-center gap-3 p-2 rounded hover:bg-bg-modifier-hover transition-colors group"
          title="View Server Information"
        >
          <div className="w-10 h-10 rounded-2xl bg-brand-primary flex items-center justify-center overflow-hidden flex-shrink-0">
            {server?.icon_url ? (
              <img src={server.icon_url} alt={server?.name} className="w-full h-full object-cover" />
            ) : (
              <span className="text-white font-bold text-lg">
                {server?.name?.charAt(0)?.toUpperCase() || 'S'}
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0 text-left">
            <div className="font-semibold text-text-primary truncate text-sm">
              {server?.name || 'Server'}
            </div>
          </div>
        </button>

        {/* Server Settings Button */}
        {onServerSettingsClick && (
          <button
            onClick={onServerSettingsClick}
            className="p-2 rounded hover:bg-bg-modifier-hover text-text-muted hover:text-text-primary transition-colors"
            title="Server Settings"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        )}
      </div>

      {/* MOTD */}
      <div className="px-3 py-2 border-b border-bg-tertiary">
        <div className="text-xs font-semibold uppercase text-text-muted mb-1">MOTD</div>
        <p className="text-sm text-text-secondary line-clamp-2">
          {substituteMotdVariables(server?.motd || 'Welcome to the server!')}
        </p>
      </div>

      {/* Channel List */}
      <ChannelList channels={channels} categories={categories} serverId={server?.id || ''} onChannelSettingsClick={onChannelSettingsClick} />
    </div>
  );
}
