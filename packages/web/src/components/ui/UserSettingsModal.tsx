import { createSignal, For, Show, JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { clsx } from 'clsx';
import { authStore } from '@/stores/auth';
import { theme, setTheme, themeNames, type Theme } from '@/stores/theme';
import { Avatar } from './Avatar';

type SettingsTab = 'account' | 'profile' | 'appearance' | 'notifications' | 'voice';

interface UserSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const tabs: { id: SettingsTab; label: string; icon: JSX.Element }[] = [
  {
    id: 'account',
    label: 'My Account',
    icon: (
      <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  },
  {
    id: 'profile',
    label: 'Profile',
    icon: (
      <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: (
      <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
      </svg>
    ),
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: (
      <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
    ),
  },
  {
    id: 'voice',
    label: 'Voice & Video',
    icon: (
      <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
      </svg>
    ),
  },
];

export function UserSettingsModal(props: UserSettingsModalProps) {
  const [activeTab, setActiveTab] = createSignal<SettingsTab>('account');
  const user = () => authStore.state().user;

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
          aria-label="User Settings"
        >
          {/* Sidebar */}
          <div class="w-[218px] bg-bg-secondary flex flex-col">
            <div class="flex-1 overflow-y-auto py-[60px] px-[6px]">
              <div class="pr-2">
                <div class="px-2 pb-1.5">
                  <span class="text-xs font-bold uppercase text-text-muted tracking-wide">
                    User Settings
                  </span>
                </div>
                <For each={tabs}>
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

                <div class="px-2 pb-1.5 pt-2">
                  <span class="text-xs font-bold uppercase text-text-muted tracking-wide">
                    App Settings
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Content */}
          <div class="flex-1 flex flex-col bg-bg-primary">
            {/* Header bar with close button */}
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
            <div class="flex-1 overflow-y-auto py-[60px] px-10 max-w-[740px]">
              <Show when={activeTab() === 'account'}>
                <AccountTab user={user()} />
              </Show>
              <Show when={activeTab() === 'profile'}>
                <ProfileTab user={user()} />
              </Show>
              <Show when={activeTab() === 'appearance'}>
                <AppearanceTab />
              </Show>
              <Show when={activeTab() === 'notifications'}>
                <NotificationsTab />
              </Show>
              <Show when={activeTab() === 'voice'}>
                <VoiceTab />
              </Show>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}

// Account Tab
function AccountTab(props: { user: ReturnType<typeof authStore.state>['user'] }) {
  return (
    <div>
      <h2 class="text-xl font-bold text-text-primary mb-5">My Account</h2>
      
      <div class="bg-bg-secondary rounded-lg overflow-hidden">
        {/* Banner area */}
        <div class="h-[100px] bg-brand-primary" />
        
        {/* User info */}
        <div class="px-4 pb-4">
          <div class="flex items-end gap-4 -mt-[38px]">
            <div class="relative">
              <Avatar
                src={props.user?.avatar_url}
                alt={props.user?.display_name || props.user?.username || 'User'}
                size="xl"
                class="ring-[6px] ring-bg-secondary"
              />
              <div class="absolute bottom-1 right-1 w-6 h-6 bg-success rounded-full border-[3px] border-bg-secondary" />
            </div>
            <div class="flex-1 pb-1">
              <h3 class="text-xl font-bold text-text-primary">
                {props.user?.display_name || props.user?.username}
              </h3>
              <p class="text-sm text-text-muted">@{props.user?.username}</p>
            </div>
            <button class="px-4 py-2 bg-brand-primary hover:bg-brand-primary-hover text-white text-sm font-medium rounded transition-colors">
              Edit User Profile
            </button>
          </div>
          
          {/* Account details card */}
          <div class="mt-4 bg-bg-tertiary rounded-lg p-4 space-y-4">
            <div class="flex justify-between items-center">
              <div>
                <div class="text-xs font-bold uppercase text-text-muted mb-1">Username</div>
                <div class="text-text-primary">{props.user?.username}</div>
              </div>
              <button class="px-4 py-1.5 bg-bg-secondary hover:bg-bg-modifier-hover text-text-primary text-sm font-medium rounded transition-colors">
                Edit
              </button>
            </div>
            
            <div class="flex justify-between items-center">
              <div>
                <div class="text-xs font-bold uppercase text-text-muted mb-1">Email</div>
                <div class="text-text-primary">{props.user?.email}</div>
              </div>
              <button class="px-4 py-1.5 bg-bg-secondary hover:bg-bg-modifier-hover text-text-primary text-sm font-medium rounded transition-colors">
                Edit
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Password & Authentication */}
      <div class="mt-10">
        <h3 class="text-xs font-bold uppercase text-text-muted mb-4">Password and Authentication</h3>
        <button class="px-4 py-2 bg-brand-primary hover:bg-brand-primary-hover text-white text-sm font-medium rounded transition-colors">
          Change Password
        </button>
      </div>

      {/* Account Removal */}
      <div class="mt-10">
        <h3 class="text-xs font-bold uppercase text-text-muted mb-4">Account Removal</h3>
        <p class="text-sm text-text-muted mb-4">
          Disabling your account means you can recover it at any time after taking this action.
        </p>
        <div class="flex gap-2">
          <button class="px-4 py-2 border border-danger text-danger hover:bg-danger/10 text-sm font-medium rounded transition-colors">
            Disable Account
          </button>
          <button class="px-4 py-2 border border-danger text-danger hover:bg-danger/10 text-sm font-medium rounded transition-colors">
            Delete Account
          </button>
        </div>
      </div>
    </div>
  );
}

// Profile Tab
function ProfileTab(props: { user: ReturnType<typeof authStore.state>['user'] }) {
  const [displayName, setDisplayName] = createSignal(props.user?.display_name || '');
  const [customStatus, setCustomStatus] = createSignal(props.user?.custom_status || '');

  return (
    <div>
      <h2 class="text-xl font-bold text-text-primary mb-5">Profile</h2>
      
      <div class="flex gap-10">
        {/* Form */}
        <div class="flex-1 space-y-6">
          <div>
            <label class="block text-xs font-bold uppercase text-text-muted mb-2">
              Display Name
            </label>
            <input
              type="text"
              value={displayName()}
              onInput={(e) => setDisplayName(e.currentTarget.value)}
              placeholder={props.user?.username}
              class="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-primary"
            />
          </div>

          <div>
            <label class="block text-xs font-bold uppercase text-text-muted mb-2">
              Status
            </label>
            <input
              type="text"
              value={customStatus()}
              onInput={(e) => setCustomStatus(e.currentTarget.value)}
              placeholder="What's on your mind?"
              class="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-primary"
            />
          </div>

          <div>
            <label class="block text-xs font-bold uppercase text-text-muted mb-2">
              Avatar
            </label>
            <div class="flex items-center gap-4">
              <Avatar
                src={props.user?.avatar_url}
                alt={props.user?.display_name || props.user?.username || 'User'}
                size="lg"
              />
              <div class="flex gap-2">
                <button class="px-4 py-2 bg-brand-primary hover:bg-brand-primary-hover text-white text-sm font-medium rounded transition-colors">
                  Change Avatar
                </button>
                <button class="px-4 py-2 bg-bg-secondary hover:bg-bg-modifier-hover text-text-primary text-sm font-medium rounded transition-colors">
                  Remove
                </button>
              </div>
            </div>
          </div>

          <button class="px-4 py-2 bg-success hover:bg-success/90 text-white text-sm font-medium rounded transition-colors">
            Save Changes
          </button>
        </div>

        {/* Preview */}
        <div class="w-[300px]">
          <h3 class="text-xs font-bold uppercase text-text-muted mb-4">Preview</h3>
          <div class="bg-bg-secondary rounded-lg overflow-hidden">
            <div class="h-[60px] bg-brand-primary" />
            <div class="px-4 pb-4">
              <div class="flex items-end gap-3 -mt-[30px]">
                <Avatar
                  src={props.user?.avatar_url}
                  alt={displayName() || props.user?.username || 'User'}
                  size="lg"
                  class="ring-4 ring-bg-secondary"
                />
              </div>
              <div class="mt-3">
                <h4 class="font-bold text-text-primary">
                  {displayName() || props.user?.display_name || props.user?.username}
                </h4>
                <p class="text-sm text-text-muted">@{props.user?.username}</p>
                <Show when={customStatus()}>
                  <p class="text-sm text-text-muted mt-2">{customStatus()}</p>
                </Show>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Appearance Tab
function AppearanceTab() {
  const themes: Theme[] = ['dark', 'light', 'oled', 'nord'];

  return (
    <div>
      <h2 class="text-xl font-bold text-text-primary mb-5">Appearance</h2>
      
      <div class="space-y-6">
        <div>
          <h3 class="text-xs font-bold uppercase text-text-muted mb-4">Theme</h3>
          <div class="grid grid-cols-4 gap-3">
            <For each={themes}>
              {(t) => (
                <button
                  onClick={() => setTheme(t)}
                  class={clsx(
                    'p-4 rounded-lg border-2 transition-colors',
                    theme() === t
                      ? 'border-brand-primary bg-brand-primary/10'
                      : 'border-border-subtle hover:border-border-strong'
                  )}
                >
                  <div
                    class={clsx(
                      'w-full aspect-video rounded mb-2',
                      t === 'dark' && 'bg-[#313338]',
                      t === 'light' && 'bg-[#f2f3f5]',
                      t === 'oled' && 'bg-black',
                      t === 'nord' && 'bg-[#2e3440]'
                    )}
                  />
                  <span class="text-sm text-text-primary font-medium">{themeNames[t]}</span>
                </button>
              )}
            </For>
          </div>
        </div>

        <div>
          <h3 class="text-xs font-bold uppercase text-text-muted mb-4">Message Display</h3>
          <div class="flex gap-3">
            <button class="flex-1 p-4 rounded-lg border-2 border-brand-primary bg-brand-primary/10">
              <div class="text-sm text-text-primary font-medium mb-1">Cozy</div>
              <div class="text-xs text-text-muted">Display avatars and full timestamps</div>
            </button>
            <button class="flex-1 p-4 rounded-lg border-2 border-border-subtle hover:border-border-strong">
              <div class="text-sm text-text-primary font-medium mb-1">Compact</div>
              <div class="text-xs text-text-muted">Smaller text and tighter spacing</div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Notifications Tab
function NotificationsTab() {
  const [desktopNotifications, setDesktopNotifications] = createSignal(true);
  const [sounds, setSounds] = createSignal(true);

  return (
    <div>
      <h2 class="text-xl font-bold text-text-primary mb-5">Notifications</h2>
      
      <div class="space-y-6">
        <div class="flex items-center justify-between p-4 bg-bg-secondary rounded-lg">
          <div>
            <div class="text-text-primary font-medium">Enable Desktop Notifications</div>
            <div class="text-sm text-text-muted">Receive notifications even when sgChat is not focused</div>
          </div>
          <button
            onClick={() => setDesktopNotifications(!desktopNotifications())}
            class={clsx(
              'relative w-11 h-6 rounded-full transition-colors',
              desktopNotifications() ? 'bg-success' : 'bg-bg-tertiary'
            )}
          >
            <div
              class={clsx(
                'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
                desktopNotifications() ? 'left-6' : 'left-1'
              )}
            />
          </button>
        </div>

        <div class="flex items-center justify-between p-4 bg-bg-secondary rounded-lg">
          <div>
            <div class="text-text-primary font-medium">Enable Sounds</div>
            <div class="text-sm text-text-muted">Play sounds for messages and notifications</div>
          </div>
          <button
            onClick={() => setSounds(!sounds())}
            class={clsx(
              'relative w-11 h-6 rounded-full transition-colors',
              sounds() ? 'bg-success' : 'bg-bg-tertiary'
            )}
          >
            <div
              class={clsx(
                'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
                sounds() ? 'left-6' : 'left-1'
              )}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

// Voice & Video Tab
function VoiceTab() {
  return (
    <div>
      <h2 class="text-xl font-bold text-text-primary mb-5">Voice & Video</h2>
      
      <div class="space-y-6">
        <div>
          <label class="block text-xs font-bold uppercase text-text-muted mb-2">
            Input Device
          </label>
          <select class="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary">
            <option>Default</option>
          </select>
        </div>

        <div>
          <label class="block text-xs font-bold uppercase text-text-muted mb-2">
            Output Device
          </label>
          <select class="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary">
            <option>Default</option>
          </select>
        </div>

        <div>
          <label class="block text-xs font-bold uppercase text-text-muted mb-2">
            Input Volume
          </label>
          <input
            type="range"
            min="0"
            max="100"
            value="100"
            class="w-full"
          />
        </div>

        <div>
          <label class="block text-xs font-bold uppercase text-text-muted mb-2">
            Output Volume
          </label>
          <input
            type="range"
            min="0"
            max="100"
            value="100"
            class="w-full"
          />
        </div>

        <div class="flex gap-3">
          <button class="px-4 py-2 bg-bg-secondary hover:bg-bg-modifier-hover text-text-primary text-sm font-medium rounded transition-colors">
            Test Microphone
          </button>
          <button class="px-4 py-2 bg-bg-secondary hover:bg-bg-modifier-hover text-text-primary text-sm font-medium rounded transition-colors">
            Test Speakers
          </button>
        </div>
      </div>
    </div>
  );
}
