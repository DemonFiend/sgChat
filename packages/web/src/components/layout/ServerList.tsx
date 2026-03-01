import { useState, useCallback } from 'react';
import { Link, useLocation } from 'react-router';
import { motion } from 'framer-motion';
import { clsx } from 'clsx';
import { Tooltip } from '@/components/ui/Tooltip';
import { useServerPopupStore } from '@/stores/serverPopup';
import { useAuthStore } from '@/stores/auth';

interface Server {
  id: string;
  name: string;
  icon_url: string | null;
}

interface ServerListProps {
  servers: Server[];
  onCreateServer: () => void;
}

export function ServerList({ servers, onCreateServer }: ServerListProps) {
  const location = useLocation();
  const [lastClickTime, setLastClickTime] = useState(0);
  const { reopenPopup } = useServerPopupStore();
  const { isAuthenticated } = useAuthStore();

  // Single-server mode: server is "active" when not on DMs
  const isActive = (_serverId: string) =>
    location.pathname.startsWith('/channels') && !location.pathname.startsWith('/channels/@me');

  const getInitials = (name: string) =>
    name.split(' ').map((w) => w[0]).join('').slice(0, 3).toUpperCase();

  const handleServerIconClick = useCallback((serverId: string, e: React.MouseEvent) => {
    if (e.button === 2) return;
    if (!isAuthenticated) return;

    const now = Date.now();
    if (now - lastClickTime < 300) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    setLastClickTime(now);

    if (isActive(serverId)) {
      e.preventDefault();
      e.stopPropagation();
      reopenPopup();
    }
  }, [lastClickTime, isAuthenticated, reopenPopup, isActive]);

  return (
    <nav
      className="flex flex-col items-center w-[72px] h-full py-3 bg-bg-tertiary overflow-y-auto scrollbar-hide"
      aria-label="Servers"
    >
      {/* Home / DMs Button */}
      <Tooltip content="Direct Messages" position="right">
        <Link
          to="/channels/@me"
          className={clsx(
            'relative flex items-center justify-center w-12 h-12 mb-2 rounded-2xl transition-all duration-200',
            'hover:rounded-xl hover:bg-accent',
            location.pathname.startsWith('/channels/@me')
              ? 'bg-accent rounded-xl'
              : 'bg-bg-primary'
          )}
        >
          <svg className="w-7 h-7 text-text-primary" fill="currentColor" viewBox="0 0 24 24">
            <path d="M21.79 18l-1.42-1.42a.996.996 0 111.41-1.41l1.42 1.42a.996.996 0 11-1.41 1.41zM19 17a.997.997 0 01-1-1v-1h-1a1 1 0 110-2h1v-1a1 1 0 112 0v1h1a1 1 0 110 2h-1v1c0 .55-.45 1-1 1zm-5-6c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zm-6 0c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zm6 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zM8 15c-2.33 0-7 1.17-7 3.5V19h6v-2.5c0-.85.33-2.34 2.37-3.47C8.5 13.01 8 13 8 13z" />
          </svg>

          {location.pathname.startsWith('/channels/@me') && (
            <span className="absolute left-0 w-1 h-10 bg-text-primary rounded-r-full" />
          )}
        </Link>
      </Tooltip>

      {/* Separator */}
      <div className="w-8 h-0.5 bg-divider mb-2" />

      {/* Server list */}
      {servers.map((server) => (
        <Tooltip key={server.id} content={server.name} position="right">
          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
          <Link
            to={`/channels/${server.id}`}
            aria-label={server.name}
            className={clsx(
              'relative flex items-center justify-center w-12 h-12 mb-2 transition-all duration-200',
              'hover:rounded-xl',
              isActive(server.id) ? 'rounded-xl' : 'rounded-2xl'
            )}
            onClick={(e) => handleServerIconClick(server.id, e)}
          >
            {server.icon_url ? (
              <img
                src={server.icon_url}
                alt={server.name}
                className={clsx(
                  'w-full h-full object-cover transition-all duration-200',
                  isActive(server.id) ? 'rounded-xl' : 'rounded-2xl hover:rounded-xl'
                )}
              />
            ) : (
              <div
                className={clsx(
                  'flex items-center justify-center w-full h-full text-text-primary font-semibold transition-all duration-200',
                  isActive(server.id)
                    ? 'bg-accent rounded-xl'
                    : 'bg-bg-primary rounded-2xl hover:rounded-xl hover:bg-accent'
                )}
              >
                {getInitials(server.name)}
              </div>
            )}

            {isActive(server.id) && (
              <span className="absolute left-0 w-1 h-10 bg-text-primary rounded-r-full" />
            )}
          </Link>
          </motion.div>
        </Tooltip>
      ))}

      {/* Add Server Button */}
      <Tooltip content="Add a Server" position="right">
        <button
          onClick={onCreateServer}
          className={clsx(
            'flex items-center justify-center w-12 h-12 mb-2 rounded-2xl',
            'bg-bg-primary text-success hover:rounded-xl hover:bg-success hover:text-white',
            'transition-all duration-200'
          )}
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </Tooltip>

      {/* Explore Public Servers */}
      <Tooltip content="Explore Public Servers" position="right">
        <button
          className={clsx(
            'flex items-center justify-center w-12 h-12 rounded-2xl',
            'bg-bg-primary text-success hover:rounded-xl hover:bg-success hover:text-white',
            'transition-all duration-200'
          )}
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </button>
      </Tooltip>
    </nav>
  );
}
