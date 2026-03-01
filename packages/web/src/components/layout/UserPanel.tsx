import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { Avatar } from '@/components/ui/Avatar';
import { useAuthStore } from '@/stores/auth';
import { useNetworkStore } from '@/stores/network';

interface UserPanelProps {
  onSettingsClick?: () => void;
}

export function UserPanel({ onSettingsClick }: UserPanelProps) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const clearConnection = useNetworkStore((s) => s.clearConnection);
  const [showMenu, setShowMenu] = useState(false);

  const handleLogout = useCallback(async (clearSaved: boolean) => {
    await logout(clearSaved);
    clearConnection();
    navigate('/login', { replace: true });
  }, [logout, clearConnection, navigate]);

  if (!user) return null;

  return (
    <div className="flex items-center gap-2 px-2 py-2 bg-bg-tertiary/50 border-t border-bg-tertiary">
      {/* User info */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Avatar
          src={user.avatar_url}
          alt={user.display_name || user.username}
          size="sm"
          status="online"
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-text-primary truncate">
            {user.display_name || user.username}
          </div>
          <div className="text-xs text-text-muted truncate">Online</div>
        </div>
      </div>

      {/* Settings / Menu */}
      <div className="relative">
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="p-1.5 rounded hover:bg-bg-modifier-hover transition-colors text-text-muted"
          title="User Settings"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>

        {showMenu && (
          <div className="absolute bottom-full right-0 mb-2 w-48 py-1 bg-bg-tertiary rounded-md shadow-high border border-border z-50">
            {onSettingsClick && (
              <button
                onClick={() => { setShowMenu(false); onSettingsClick(); }}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-bg-modifier-hover hover:text-text-primary"
              >
                User Settings
              </button>
            )}
            <button
              onClick={() => { setShowMenu(false); handleLogout(false); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-bg-modifier-hover hover:text-text-primary"
            >
              Log Out
            </button>
            <button
              onClick={() => { setShowMenu(false); handleLogout(true); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-danger hover:bg-bg-modifier-hover"
            >
              Log Out &amp; Clear Saved Login
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
