import { Show, createSignal } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { authStore } from '@/stores/auth';
import { networkStore } from '@/stores/network';
import { Avatar } from '@/components/ui';
import { socketService } from '@/lib/socket';

interface UserPanelProps {
  onSettingsClick?: () => void;
}

export function UserPanel(props: UserPanelProps) {
  const navigate = useNavigate();
  const user = () => authStore.state().user;
  const connectionState = socketService.connectionState;
  const [showLogoutMenu, setShowLogoutMenu] = createSignal(false);
  const [loggingOut, setLoggingOut] = createSignal(false);

  const handleLogout = async (forgetDevice: boolean) => {
    setLoggingOut(true);
    setShowLogoutMenu(false);
    
    try {
      await authStore.logout(forgetDevice);
      networkStore.clearConnection();
      navigate('/login', { replace: true });
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <div class="flex items-center gap-2 h-[52px] px-2 bg-bg-tertiary relative">
      <Show when={user()}>
        {(u) => (
          <>
            <button class="flex items-center gap-2 flex-1 min-w-0 p-1 rounded hover:bg-bg-modifier-hover transition-colors">
              <Avatar
                src={u().avatar_url}
                alt={u().display_name || u().username}
                size="sm"
                status={u().status}
              />
              <div class="flex-1 min-w-0 text-left">
                <div class="text-sm font-medium text-text-primary truncate">
                  {u().display_name || u().username}
                </div>
                <div class="text-xs text-text-muted truncate">
                  {u().custom_status || (connectionState() === 'connected' ? 'Online' : connectionState())}
                </div>
              </div>
            </button>

            {/* Action buttons */}
            <div class="flex items-center gap-0.5">
              {/* Mute button */}
              <button
                class="p-2 rounded hover:bg-bg-modifier-hover text-text-muted hover:text-text-primary transition-colors"
                aria-label="Mute"
              >
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </button>

              {/* Deafen button */}
              <button
                class="p-2 rounded hover:bg-bg-modifier-hover text-text-muted hover:text-text-primary transition-colors"
                aria-label="Deafen"
              >
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                </svg>
              </button>

              {/* Settings button with logout dropdown */}
              <div class="relative">
                <button
                  onClick={() => setShowLogoutMenu(!showLogoutMenu())}
                  class="p-2 rounded hover:bg-bg-modifier-hover text-text-muted hover:text-text-primary transition-colors"
                  aria-label="User Settings"
                  disabled={loggingOut()}
                >
                  <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>

                {/* Dropdown menu */}
                <Show when={showLogoutMenu()}>
                  <div class="absolute bottom-full right-0 mb-2 w-56 bg-bg-floating rounded-md shadow-high border border-border-subtle overflow-hidden z-50">
                    <div class="p-1">
                      <button
                        onClick={props.onSettingsClick}
                        class="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-primary rounded hover:bg-bg-modifier-hover transition-colors text-left"
                      >
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        Settings
                      </button>
                      
                      <div class="h-px bg-border-subtle my-1" />
                      
                      <button
                        onClick={() => handleLogout(false)}
                        class="w-full flex items-center gap-2 px-3 py-2 text-sm text-danger rounded hover:bg-danger/10 transition-colors text-left"
                      >
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                        Log Out
                      </button>
                      
                      <button
                        onClick={() => handleLogout(true)}
                        class="w-full flex items-center gap-2 px-3 py-2 text-sm text-danger rounded hover:bg-danger/10 transition-colors text-left"
                      >
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Log Out & Forget Device
                      </button>
                    </div>
                  </div>
                </Show>
              </div>
            </div>
          </>
        )}
      </Show>

      {/* Click outside to close dropdown */}
      <Show when={showLogoutMenu()}>
        <div 
          class="fixed inset-0 z-40" 
          onClick={() => setShowLogoutMenu(false)}
        />
      </Show>
    </div>
  );
}
