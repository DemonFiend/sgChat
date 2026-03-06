import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { clsx } from 'clsx';
import { authStore } from '@/stores/auth';
import { networkStore } from '@/stores/network';
import { useThemeStore, themeNames, getAvailableThemes } from '@/stores/theme';
import { Avatar } from './Avatar';
import { AvatarPicker } from './AvatarPicker';
import { api } from '@/api';
import { USER_TIMEZONES } from '@/lib/timezones';

type SettingsTab = 'account' | 'profile' | 'appearance' | 'notifications' | 'voice';

interface UserSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const tabs: { id: SettingsTab; label: string; icon: ReactNode }[] = [
  {
    id: 'account',
    label: 'My Account',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  },
  {
    id: 'profile',
    label: 'Profile',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
      </svg>
    ),
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
    ),
  },
  {
    id: 'voice',
    label: 'Voice & Video',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
      </svg>
    ),
  },
];

export function UserSettingsModal({ isOpen, onClose }: UserSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('account');
  const user = authStore.getState().user;

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex bg-bg-primary animate-in fade-in duration-200"
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label="User Settings"
    >
      {/* Sidebar */}
      <div className="w-[218px] bg-bg-secondary flex flex-col">
        <div className="flex-1 overflow-y-auto py-[60px] px-[6px]">
          <div className="pr-2">
            <div className="px-2 pb-1.5">
              <span className="text-xs font-bold uppercase text-text-muted tracking-wide">
                User Settings
              </span>
            </div>
            {tabs.map((tab) => (
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

            <div className="px-2 pb-1.5 pt-2">
              <span className="text-xs font-bold uppercase text-text-muted tracking-wide">
                App Settings
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col bg-bg-primary">
        {/* Header bar with close button */}
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
            {activeTab === 'account' && (
              <AccountTab user={user} onClose={onClose} onSwitchTab={setActiveTab} />
            )}
            {activeTab === 'profile' && (
              <ProfileTab user={user} />
            )}
            {activeTab === 'appearance' && (
              <AppearanceTab />
            )}
            {activeTab === 'notifications' && (
              <NotificationsTab />
            )}
            {activeTab === 'voice' && (
              <VoiceTab />
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Account Tab
function AccountTab({ user, onClose, onSwitchTab }: { user: ReturnType<typeof authStore.getState>['user']; onClose: () => void; onSwitchTab: (tab: SettingsTab) => void }) {
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);

  // Inline editing state
  const [editingUsername, setEditingUsername] = useState(false);
  const [newUsername, setNewUsername] = useState(user?.username || '');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [savingUsername, setSavingUsername] = useState(false);

  const [editingEmail, setEditingEmail] = useState(false);
  const [newEmail, setNewEmail] = useState(user?.email || '');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [savingEmail, setSavingEmail] = useState(false);

  const [changingPassword, setChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const [showDisableConfirm, setShowDisableConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleLogout = async (forgetDevice: boolean) => {
    setLoggingOut(true);
    try {
      onClose();
      await authStore.logout(forgetDevice);
      networkStore.clearConnection();
      navigate('/login', { replace: true });
    } finally {
      setLoggingOut(false);
    }
  };

  const handleSaveUsername = async () => {
    if (!newUsername.trim() || newUsername === user?.username) {
      setEditingUsername(false);
      return;
    }
    setSavingUsername(true);
    setUsernameError(null);
    try {
      await api.patch('/users/me', { username: newUsername.trim() });
      authStore.getState().updateUser({ username: newUsername.trim() });
      setEditingUsername(false);
    } catch (err: any) {
      setUsernameError(err?.message || 'Failed to update username');
    } finally {
      setSavingUsername(false);
    }
  };

  const handleSaveEmail = async () => {
    if (!newEmail.trim() || !emailPassword) {
      setEmailError('Email and password are required');
      return;
    }
    setSavingEmail(true);
    setEmailError(null);
    try {
      await api.post('/users/me/email', { email: newEmail.trim(), password: emailPassword });
      authStore.getState().updateUser({ email: newEmail.trim() });
      setEditingEmail(false);
      setEmailPassword('');
    } catch (err: any) {
      setEmailError(err?.message || 'Failed to update email');
    } finally {
      setSavingEmail(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters');
      return;
    }
    setSavingPassword(true);
    setPasswordError(null);
    setPasswordSuccess(false);
    try {
      await api.post('/users/me/password', { currentPassword, newPassword });
      setPasswordSuccess(true);
      setChangingPassword(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPasswordError(err?.message || 'Failed to change password');
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-text-primary mb-5">My Account</h2>

      <div className="bg-bg-secondary rounded-lg overflow-hidden">
        {/* Banner area */}
        <div className="h-[100px] bg-brand-primary" />

        {/* User info */}
        <div className="px-4 pb-4">
          <div className="flex items-end gap-4 -mt-[38px]">
            <div className="relative">
              <Avatar
                src={user?.avatar_url}
                alt={user?.display_name || user?.username || 'User'}
                size="xl"
                className="ring-[6px] ring-bg-secondary"
              />
              <div className="absolute bottom-1 right-1 w-6 h-6 bg-success rounded-full border-[3px] border-bg-secondary" />
            </div>
            <div className="flex-1 pb-1">
              <h3 className="text-xl font-bold text-text-primary">
                {user?.display_name || user?.username}
              </h3>
              <p className="text-sm text-text-muted">@{user?.username}</p>
            </div>
            <button
              onClick={() => onSwitchTab('profile')}
              className="px-4 py-2 bg-brand-primary hover:bg-brand-primary-hover text-white text-sm font-medium rounded transition-colors"
            >
              Edit User Profile
            </button>
          </div>

          {/* Account details card */}
          <div className="mt-4 bg-bg-tertiary rounded-lg p-4 space-y-4">
            {/* Username */}
            <div className="flex justify-between items-center">
              <div className="flex-1">
                <div className="text-xs font-bold uppercase text-text-muted mb-1">Username</div>
                {editingUsername ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSaveUsername(); if (e.key === 'Escape') setEditingUsername(false); }}
                      className="bg-bg-primary border border-border rounded px-2 py-1 text-sm text-text-primary w-48 focus:outline-none focus:ring-1 focus:ring-brand-primary"
                      autoFocus
                    />
                    <button onClick={handleSaveUsername} disabled={savingUsername} className="px-3 py-1 bg-brand-primary hover:bg-brand-primary-hover text-white text-xs font-medium rounded disabled:opacity-50">
                      {savingUsername ? 'Saving...' : 'Save'}
                    </button>
                    <button onClick={() => { setEditingUsername(false); setNewUsername(user?.username || ''); setUsernameError(null); }} className="px-3 py-1 text-text-muted hover:text-text-primary text-xs">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="text-text-primary">{user?.username}</div>
                )}
                {usernameError && <p className="text-xs text-danger mt-1">{usernameError}</p>}
              </div>
              {!editingUsername && (
                <button onClick={() => { setEditingUsername(true); setNewUsername(user?.username || ''); }} className="px-4 py-1.5 bg-bg-secondary hover:bg-bg-modifier-hover text-text-primary text-sm font-medium rounded transition-colors">
                  Edit
                </button>
              )}
            </div>

            {/* Email */}
            <div className="flex justify-between items-center">
              <div className="flex-1">
                <div className="text-xs font-bold uppercase text-text-muted mb-1">Email</div>
                {editingEmail ? (
                  <div className="space-y-2">
                    <input
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      placeholder="New email"
                      className="bg-bg-primary border border-border rounded px-2 py-1 text-sm text-text-primary w-full focus:outline-none focus:ring-1 focus:ring-brand-primary"
                      autoFocus
                    />
                    <input
                      type="password"
                      value={emailPassword}
                      onChange={(e) => setEmailPassword(e.target.value)}
                      placeholder="Confirm with password"
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEmail(); }}
                      className="bg-bg-primary border border-border rounded px-2 py-1 text-sm text-text-primary w-full focus:outline-none focus:ring-1 focus:ring-brand-primary"
                    />
                    <div className="flex items-center gap-2">
                      <button onClick={handleSaveEmail} disabled={savingEmail} className="px-3 py-1 bg-brand-primary hover:bg-brand-primary-hover text-white text-xs font-medium rounded disabled:opacity-50">
                        {savingEmail ? 'Saving...' : 'Save'}
                      </button>
                      <button onClick={() => { setEditingEmail(false); setNewEmail(user?.email || ''); setEmailPassword(''); setEmailError(null); }} className="px-3 py-1 text-text-muted hover:text-text-primary text-xs">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-text-primary">{user?.email}</div>
                )}
                {emailError && <p className="text-xs text-danger mt-1">{emailError}</p>}
              </div>
              {!editingEmail && (
                <button onClick={() => { setEditingEmail(true); setNewEmail(user?.email || ''); }} className="px-4 py-1.5 bg-bg-secondary hover:bg-bg-modifier-hover text-text-primary text-sm font-medium rounded transition-colors">
                  Edit
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Password & Authentication */}
      <div className="mt-10">
        <h3 className="text-xs font-bold uppercase text-text-muted mb-4">Password and Authentication</h3>
        {changingPassword ? (
          <div className="bg-bg-secondary rounded-lg p-4 space-y-3 max-w-sm">
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Current password"
              className="bg-bg-primary border border-border rounded px-3 py-2 text-sm text-text-primary w-full focus:outline-none focus:ring-1 focus:ring-brand-primary"
              autoFocus
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password"
              className="bg-bg-primary border border-border rounded px-3 py-2 text-sm text-text-primary w-full focus:outline-none focus:ring-1 focus:ring-brand-primary"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              onKeyDown={(e) => { if (e.key === 'Enter') handleChangePassword(); }}
              className="bg-bg-primary border border-border rounded px-3 py-2 text-sm text-text-primary w-full focus:outline-none focus:ring-1 focus:ring-brand-primary"
            />
            {passwordError && <p className="text-xs text-danger">{passwordError}</p>}
            <div className="flex items-center gap-2">
              <button onClick={handleChangePassword} disabled={savingPassword} className="px-4 py-2 bg-brand-primary hover:bg-brand-primary-hover text-white text-sm font-medium rounded disabled:opacity-50">
                {savingPassword ? 'Changing...' : 'Change Password'}
              </button>
              <button onClick={() => { setChangingPassword(false); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setPasswordError(null); }} className="px-4 py-2 text-text-muted hover:text-text-primary text-sm">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div>
            <button onClick={() => setChangingPassword(true)} className="px-4 py-2 bg-brand-primary hover:bg-brand-primary-hover text-white text-sm font-medium rounded transition-colors">
              Change Password
            </button>
            {passwordSuccess && <p className="text-xs text-success mt-2">Password changed successfully!</p>}
          </div>
        )}
      </div>

      {/* Account Removal */}
      <div className="mt-10">
        <h3 className="text-xs font-bold uppercase text-text-muted mb-4">Account Removal</h3>
        <p className="text-sm text-text-muted mb-4">
          Disabling your account means you can recover it at any time after taking this action.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setShowDisableConfirm(true)}
            className="px-4 py-2 border border-danger text-danger hover:bg-danger/10 text-sm font-medium rounded transition-colors"
          >
            Disable Account
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="px-4 py-2 border border-danger text-danger hover:bg-danger/10 text-sm font-medium rounded transition-colors"
          >
            Delete Account
          </button>
        </div>
        {(showDisableConfirm || showDeleteConfirm) && (
          <div className="mt-3 bg-danger/10 border border-danger/30 rounded-lg p-4">
            <p className="text-sm text-text-primary font-medium mb-2">
              {showDeleteConfirm ? 'Delete Account' : 'Disable Account'}
            </p>
            <p className="text-sm text-text-muted mb-3">
              This feature is not yet available. Please contact a server administrator for account changes.
            </p>
            <button
              onClick={() => { setShowDisableConfirm(false); setShowDeleteConfirm(false); }}
              className="px-3 py-1.5 bg-bg-secondary hover:bg-bg-modifier-hover text-text-primary text-sm rounded"
            >
              OK
            </button>
          </div>
        )}
      </div>

      {/* Log Out */}
      <div className="mt-10">
        <h3 className="text-xs font-bold uppercase text-text-muted mb-4">Log Out</h3>
        <p className="text-sm text-text-muted mb-4">
          Log out of your account on this device.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => handleLogout(false)}
            disabled={loggingOut}
            className="px-4 py-2 bg-danger hover:bg-danger/90 text-white text-sm font-medium rounded transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            {loggingOut ? 'Logging out...' : 'Log Out'}
          </button>
          <button
            onClick={() => handleLogout(true)}
            disabled={loggingOut}
            className="px-4 py-2 border border-danger text-danger hover:bg-danger/10 text-sm font-medium rounded transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Log Out & Forget Device
          </button>
        </div>
      </div>
    </div>
  );
}

// Profile Tab


function ProfileTab({ user }: { user: ReturnType<typeof authStore.getState>['user'] }) {
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [customStatus, setCustomStatus] = useState(user?.custom_status || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url || null);
  const [bannerUrl, setBannerUrl] = useState(user?.banner_url || null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Banner upload state
  const bannerFileInputRef = useRef<HTMLInputElement>(null);
  const [bannerUploading, setBannerUploading] = useState(false);
  const [bannerDeleting, setBannerDeleting] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);

  // Privacy settings (from user_settings)
  const [timezone, setTimezone] = useState('');
  const [timezonePublic, setTimezonePublic] = useState(false);
  const [timezoneDstEnabled, setTimezoneDstEnabled] = useState(true);
  const [privacyLoaded, setPrivacyLoaded] = useState(false);
  const [savingPrivacy, setSavingPrivacy] = useState(false);

  // Load privacy settings on mount
  useEffect(() => {
    (async () => {
      try {
        const settings = await api.get<any>('/users/me/settings');
        setTimezone(settings.timezone || '');
        setTimezonePublic(settings.timezone_public || false);
        setTimezoneDstEnabled(settings.timezone_dst_enabled !== false); // Default true
        setPrivacyLoaded(true);
      } catch (err) {
        console.error('Failed to load privacy settings:', err);
        setPrivacyLoaded(true);
      }
    })();
  }, []);

  // Track if profile fields have changed (not avatar/banner - those save immediately)
  const hasChanges = displayName !== (user?.display_name || '') ||
    customStatus !== (user?.custom_status || '') ||
    bio !== (user?.bio || '');

  const handleSavePrivacy = async () => {
    setSavingPrivacy(true);
    try {
      await api.patch('/users/me/settings', {
        timezone: timezone || null,
        timezone_public: timezonePublic,
        timezone_dst_enabled: timezoneDstEnabled,
      });
    } catch (err) {
      console.error('Failed to save privacy settings:', err);
    } finally {
      setSavingPrivacy(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!hasChanges || saving) return;

    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      await api.patch('/users/me', {
        display_name: displayName || null,
        custom_status: customStatus || null,
        bio: bio || null,
      });

      // Update auth store immediately for responsive UI
      authStore.getState().updateUser({
        display_name: displayName || null,
        custom_status: customStatus || null,
        bio: bio || null,
      });

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      setSaveError(err.message || 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarChange = (newUrl: string | null) => {
    setAvatarUrl(newUrl);
    // Update auth store immediately for responsive UI
    authStore.getState().updateAvatarUrl(newUrl);
  };

  const handleBannerUpload = async (file: File) => {
    setBannerError(null);

    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setBannerError('Invalid file type. Allowed: JPEG, PNG, GIF, WebP');
      return;
    }

    const maxSize = 8 * 1024 * 1024; // 8MB
    if (file.size > maxSize) {
      setBannerError('File too large. Maximum size: 8 MB');
      return;
    }

    // Show local preview immediately
    const reader = new FileReader();
    reader.onload = (e) => setBannerPreview(e.target?.result as string);
    reader.readAsDataURL(file);

    setBannerUploading(true);
    try {
      const result = await api.upload<{ banner_url: string }>('/users/me/banner', file, 'banner');
      setBannerUrl(result.banner_url);
      setBannerPreview(null);
      authStore.getState().updateUser({ banner_url: result.banner_url });
    } catch (err: any) {
      setBannerError(err.message || 'Failed to upload banner');
      setBannerPreview(null);
    } finally {
      setBannerUploading(false);
    }
  };

  const handleBannerDelete = async () => {
    if (bannerDeleting) return;
    setBannerDeleting(true);
    setBannerError(null);
    try {
      await api.delete('/users/me/banner');
      setBannerUrl(null);
      setBannerPreview(null);
      authStore.getState().updateUser({ banner_url: null });
    } catch (err: any) {
      setBannerError(err.message || 'Failed to remove banner');
    } finally {
      setBannerDeleting(false);
    }
  };

  // We need a ref-based approach for handleSavePrivacy since toggles
  // call it immediately after setState, but React batches state updates.
  // Use a useEffect to trigger save when privacy settings change after initial load.
  const privacyInitialized = useRef(false);
  const prevTimezone = useRef(timezone);
  const prevTimezonePublic = useRef(timezonePublic);
  const prevTimezoneDstEnabled = useRef(timezoneDstEnabled);

  useEffect(() => {
    if (!privacyLoaded) return;
    if (!privacyInitialized.current) {
      // First time after load - just mark as initialized
      privacyInitialized.current = true;
      prevTimezone.current = timezone;
      prevTimezonePublic.current = timezonePublic;
      prevTimezoneDstEnabled.current = timezoneDstEnabled;
      return;
    }
    // Only save if something actually changed
    if (
      timezone !== prevTimezone.current ||
      timezonePublic !== prevTimezonePublic.current ||
      timezoneDstEnabled !== prevTimezoneDstEnabled.current
    ) {
      prevTimezone.current = timezone;
      prevTimezonePublic.current = timezonePublic;
      prevTimezoneDstEnabled.current = timezoneDstEnabled;
      handleSavePrivacy();
    }
  }, [timezone, timezonePublic, timezoneDstEnabled, privacyLoaded]);

  return (
    <div>
      <h2 className="text-xl font-bold text-text-primary mb-5">Profile</h2>

      <div className="flex gap-10">
        {/* Form */}
        <div className="flex-1 space-y-6">
          <div>
            <label className="block text-xs font-bold uppercase text-text-muted mb-2">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={user?.username}
              className="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-text-muted mb-2">
              Status
            </label>
            <input
              type="text"
              value={customStatus}
              onChange={(e) => setCustomStatus(e.target.value)}
              placeholder="What's on your mind?"
              className="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-text-muted mb-2">
              About Me
            </label>
            <textarea
              value={bio}
              onChange={(e) => {
                if (e.target.value.length <= 500) setBio(e.target.value);
              }}
              placeholder="Tell others about yourself..."
              rows={4}
              className="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-primary resize-none"
            />
            <div className="flex justify-end mt-1">
              <span
                className={clsx(
                  'text-xs',
                  bio.length > 450 ? 'text-warning' : 'text-text-muted',
                  bio.length >= 500 && 'text-danger'
                )}
              >
                {bio.length}/500
              </span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-text-muted mb-2">
              Avatar
            </label>
            <AvatarPicker
              currentAvatarUrl={avatarUrl}
              username={user?.username}
              displayName={displayName || user?.display_name || undefined}
              onAvatarChange={handleAvatarChange}
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-text-muted mb-2">
              Profile Banner
            </label>
            <div className="space-y-3">
              {/* Banner preview */}
              <div
                className={clsx(
                  'relative w-full h-[120px] rounded-lg overflow-hidden cursor-pointer group border border-border-subtle',
                  !bannerPreview && !bannerUrl && 'bg-bg-tertiary'
                )}
                onClick={() => bannerFileInputRef.current?.click()}
              >
                {(bannerPreview || bannerUrl) ? (
                  <img
                    src={bannerPreview || bannerUrl!}
                    alt="Profile banner"
                    className={clsx(
                      'w-full h-full object-cover transition-opacity',
                      bannerUploading && 'opacity-50'
                    )}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <div className="text-center">
                      <svg className="w-8 h-8 text-text-muted mx-auto mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span className="text-xs text-text-muted">Click to upload a banner</span>
                    </div>
                  </div>
                )}

                {/* Hover overlay */}
                <div className={clsx(
                  'absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity',
                  bannerUploading && 'opacity-100'
                )}>
                  {bannerUploading ? (
                    <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <span className="text-sm text-white font-medium">Change Banner</span>
                  )}
                </div>
              </div>

              {/* Hidden file input */}
              <input
                ref={bannerFileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleBannerUpload(file);
                  e.target.value = '';
                }}
              />

              {/* Banner action buttons */}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => bannerFileInputRef.current?.click()}
                  disabled={bannerUploading}
                  className="px-3 py-1.5 bg-brand-primary hover:bg-brand-primary-hover text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
                >
                  {bannerUploading ? 'Uploading...' : 'Upload Banner'}
                </button>

                {(bannerUrl || bannerPreview) && (
                  <button
                    onClick={handleBannerDelete}
                    disabled={bannerDeleting || bannerUploading}
                    className="px-3 py-1.5 bg-bg-secondary hover:bg-bg-modifier-hover text-text-primary text-sm font-medium rounded transition-colors disabled:opacity-50"
                  >
                    {bannerDeleting ? 'Removing...' : 'Remove Banner'}
                  </button>
                )}
              </div>

              <p className="text-xs text-text-muted">
                JPEG, PNG, GIF, or WebP. Max 8 MB. Recommended size: 680x240.
              </p>

              {/* Banner error */}
              {bannerError && (
                <div className="p-3 bg-danger/10 border border-danger/30 rounded text-sm text-danger">
                  {bannerError}
                </div>
              )}
            </div>
          </div>

          {/* Save button with status */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSaveProfile}
              disabled={!hasChanges || saving}
              className={clsx(
                "px-4 py-2 text-white text-sm font-medium rounded transition-colors",
                hasChanges
                  ? "bg-success hover:bg-success/90"
                  : "bg-bg-tertiary text-text-muted cursor-not-allowed"
              )}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>

            {saveSuccess && (
              <span className="text-sm text-success flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                </svg>
                Saved!
              </span>
            )}

            {saveError && (
              <span className="text-sm text-danger">{saveError}</span>
            )}
          </div>

          {/* Privacy Settings */}
          <div className="mt-8 pt-6 border-t border-border-subtle">
            <h3 className="text-sm font-bold uppercase text-text-muted mb-4">Privacy</h3>

            {privacyLoaded ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-text-muted mb-2">
                    Your Timezone
                  </label>
                  <select
                    value={timezone}
                    onChange={(e) => {
                      setTimezone(e.target.value);
                    }}
                    className="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary"
                  >
                    {USER_TIMEZONES.map((tz) => (
                      <option key={tz.value} value={tz.value}>{tz.label}</option>
                    ))}
                  </select>
                  <p className="text-xs text-text-muted mt-1">
                    Select "Hidden" to show "Hidden" to friends instead of your time
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-text-primary">
                      Show timezone publicly
                    </label>
                    <p className="text-xs text-text-muted">
                      Allow friends to see your local time
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setTimezonePublic(!timezonePublic);
                    }}
                    disabled={savingPrivacy}
                    className={clsx(
                      "relative w-11 h-6 rounded-full transition-colors",
                      timezonePublic ? "bg-brand-primary" : "bg-bg-tertiary"
                    )}
                  >
                    <span
                      className={clsx(
                        "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow-sm",
                        timezonePublic && "translate-x-5"
                      )}
                    />
                  </button>
                </div>

                {timezone && (
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-sm font-medium text-text-primary">
                        Adjust for daylight saving time
                      </label>
                      <p className="text-xs text-text-muted">
                        Automatically adjust displayed time for DST
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setTimezoneDstEnabled(!timezoneDstEnabled);
                      }}
                      disabled={savingPrivacy}
                      className={clsx(
                        "relative w-11 h-6 rounded-full transition-colors",
                        timezoneDstEnabled ? "bg-brand-primary" : "bg-bg-tertiary"
                      )}
                    >
                      <span
                        className={clsx(
                          "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow-sm",
                          timezoneDstEnabled && "translate-x-5"
                        )}
                      />
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-text-muted text-sm">Loading...</div>
            )}
          </div>
        </div>

        {/* Preview */}
        <div className="w-[300px]">
          <h3 className="text-xs font-bold uppercase text-text-muted mb-4">Preview</h3>
          <div className="bg-bg-secondary rounded-lg overflow-hidden">
            {(bannerPreview || bannerUrl) ? (
              <div className="h-[60px] overflow-hidden">
                <img
                  src={bannerPreview || bannerUrl!}
                  alt="Profile banner"
                  className="w-full h-full object-cover"
                />
              </div>
            ) : (
              <div className="h-[60px] bg-brand-primary" />
            )}
            <div className="px-4 pb-4">
              <div className="flex items-end gap-3 -mt-[30px]">
                <Avatar
                  src={avatarUrl}
                  alt={displayName || user?.username || 'User'}
                  size="lg"
                  className="ring-4 ring-bg-secondary"
                />
              </div>
              <div className="mt-3">
                <h4 className="font-bold text-text-primary">
                  {displayName || user?.display_name || user?.username}
                </h4>
                <p className="text-sm text-text-muted">@{user?.username}</p>
                {customStatus && (
                  <p className="text-sm text-text-muted mt-2">{customStatus}</p>
                )}
                {bio && (
                  <div className="mt-3 pt-3 border-t border-border-subtle">
                    <p className="text-xs font-bold uppercase text-text-muted mb-1">About Me</p>
                    <p className="text-sm text-text-primary whitespace-pre-wrap break-words">{bio}</p>
                  </div>
                )}
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
  const theme = useThemeStore(s => s.theme);
  const setTheme = useThemeStore(s => s.setTheme);
  const themes = getAvailableThemes();

  return (
    <div>
      <h2 className="text-xl font-bold text-text-primary mb-5">Appearance</h2>

      <div className="space-y-6">
        <div>
          <h3 className="text-xs font-bold uppercase text-text-muted mb-4">Theme</h3>
          <div className={clsx('grid gap-2', themes.length > 4 ? 'grid-cols-5' : 'grid-cols-4')}>
            {themes.map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={clsx(
                  'p-4 rounded-lg border-2 transition-colors',
                  theme === t
                    ? 'border-brand-primary bg-brand-primary/10'
                    : 'border-border-subtle hover:border-border-strong'
                )}
              >
                <div
                  className={clsx(
                    'w-full aspect-video rounded mb-2',
                    t === 'midnight' && 'bg-[#12131a]',
                    t === 'dark' && 'bg-[#313338]',
                    t === 'light' && 'bg-[#f2f3f5]',
                    t === 'oled' && 'bg-black',
                    t === 'nord' && 'bg-[#2e3440]'
                  )}
                />
                <span className="text-sm text-text-primary font-medium">{themeNames[t]}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-xs font-bold uppercase text-text-muted mb-4">Message Display</h3>
          <div className="flex gap-3">
            <button className="flex-1 p-4 rounded-lg border-2 border-brand-primary bg-brand-primary/10">
              <div className="text-sm text-text-primary font-medium mb-1">Cozy</div>
              <div className="text-xs text-text-muted">Display avatars and full timestamps</div>
            </button>
            <button className="flex-1 p-4 rounded-lg border-2 border-border-subtle hover:border-border-strong">
              <div className="text-sm text-text-primary font-medium mb-1">Compact</div>
              <div className="text-xs text-text-muted">Smaller text and tighter spacing</div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Notifications Tab
function NotificationsTab() {
  const [desktopNotifications, setDesktopNotifications] = useState(true);
  const [sounds, setSounds] = useState(true);

  return (
    <div>
      <h2 className="text-xl font-bold text-text-primary mb-5">Notifications</h2>

      <div className="space-y-6">
        <div className="flex items-center justify-between p-4 bg-bg-secondary rounded-lg">
          <div>
            <div className="text-text-primary font-medium">Enable Desktop Notifications</div>
            <div className="text-sm text-text-muted">Receive notifications even when sgChat is not focused</div>
          </div>
          <button
            onClick={() => setDesktopNotifications(!desktopNotifications)}
            className={clsx(
              'relative w-11 h-6 rounded-full transition-colors',
              desktopNotifications ? 'bg-success' : 'bg-bg-tertiary'
            )}
          >
            <div
              className={clsx(
                'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
                desktopNotifications ? 'left-6' : 'left-1'
              )}
            />
          </button>
        </div>

        <div className="flex items-center justify-between p-4 bg-bg-secondary rounded-lg">
          <div>
            <div className="text-text-primary font-medium">Enable Sounds</div>
            <div className="text-sm text-text-muted">Play sounds for messages and notifications</div>
          </div>
          <button
            onClick={() => setSounds(!sounds)}
            className={clsx(
              'relative w-11 h-6 rounded-full transition-colors',
              sounds ? 'bg-success' : 'bg-bg-tertiary'
            )}
          >
            <div
              className={clsx(
                'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
                sounds ? 'left-6' : 'left-1'
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
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedInputDevice, setSelectedInputDevice] = useState<string>('');
  const [selectedOutputDevice, setSelectedOutputDevice] = useState<string>('');
  const [inputVolume, setInputVolume] = useState(100);
  const [outputVolume, setOutputVolume] = useState(100);
  const [inputSensitivity, setInputSensitivity] = useState(50);
  const [autoGainControl, setAutoGainControl] = useState(true);
  const [echoCancellation, setEchoCancellation] = useState(true);
  const [noiseSuppression, setNoiseSuppression] = useState(true);
  const [voiceActivityDetection, setVoiceActivityDetection] = useState(true);
  const [enableVoiceJoinSounds, setEnableVoiceJoinSounds] = useState(true);
  const [isTesting, setIsTesting] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [saving, setSaving] = useState(false);

  const testStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const inputVolumeRef = useRef(inputVolume);

  // Keep inputVolumeRef in sync so the animation frame callback reads the latest value
  useEffect(() => {
    inputVolumeRef.current = inputVolume;
  }, [inputVolume]);

  const enumerateDevices = useCallback(async () => {
    try {
      // Request permission first to get device labels
      await navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        stream.getTracks().forEach(track => track.stop());
      }).catch(() => {
        // Permission denied, but we can still try to enumerate
      });

      const devices = await navigator.mediaDevices.enumerateDevices();
      setInputDevices(devices.filter(d => d.kind === 'audioinput'));
      setOutputDevices(devices.filter(d => d.kind === 'audiooutput'));
    } catch (err) {
      console.error('Failed to enumerate devices:', err);
    }
  }, []);

  const stopMicTest = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (testStreamRef.current) {
      testStreamRef.current.getTracks().forEach(track => track.stop());
      testStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setIsTesting(false);
    setMicLevel(0);
  }, []);

  // Load saved settings
  useEffect(() => {
    (async () => {
      try {
        const settings = await api.get<any>('/users/me/settings');
        if (settings) {
          setSelectedInputDevice(settings.audio_input_device_id || '');
          setSelectedOutputDevice(settings.audio_output_device_id || '');
          setInputVolume(settings.audio_input_volume ?? 100);
          setOutputVolume(settings.audio_output_volume ?? 100);
          setInputSensitivity(settings.audio_input_sensitivity ?? 50);
          setAutoGainControl(settings.audio_auto_gain_control ?? true);
          setEchoCancellation(settings.audio_echo_cancellation ?? true);
          setNoiseSuppression(settings.audio_noise_suppression ?? true);
          setVoiceActivityDetection(settings.voice_activity_detection ?? true);
          setEnableVoiceJoinSounds(settings.enable_voice_join_sounds ?? true);
        }
      } catch (err) {
        console.error('Failed to load voice settings:', err);
      }

      await enumerateDevices();
    })();

    return () => {
      stopMicTest();
    };
  }, [enumerateDevices, stopMicTest]);

  const saveSettings = useCallback(async (updates: Record<string, any>) => {
    setSaving(true);
    try {
      await api.patch('/users/me/settings', updates);
    } catch (err) {
      console.error('Failed to save voice settings:', err);
    } finally {
      setSaving(false);
    }
  }, []);

  const handleInputDeviceChange = useCallback((deviceId: string) => {
    setSelectedInputDevice(deviceId);
    saveSettings({ audio_input_device_id: deviceId || null });
  }, [saveSettings]);

  const handleOutputDeviceChange = useCallback((deviceId: string) => {
    setSelectedOutputDevice(deviceId);
    saveSettings({ audio_output_device_id: deviceId || null });
  }, [saveSettings]);

  const handleInputVolumeChange = useCallback((value: number) => {
    setInputVolume(value);
    saveSettings({ audio_input_volume: value });
  }, [saveSettings]);

  const handleOutputVolumeChange = useCallback((value: number) => {
    setOutputVolume(value);
    saveSettings({ audio_output_volume: value });
  }, [saveSettings]);

  const handleSensitivityChange = useCallback((value: number) => {
    setInputSensitivity(value);
    saveSettings({ audio_input_sensitivity: value });
  }, [saveSettings]);

  const toggleSetting = useCallback((
    currentValue: boolean,
    setter: (v: boolean) => void,
    settingKey: string
  ) => {
    const newValue = !currentValue;
    setter(newValue);
    saveSettings({ [settingKey]: newValue });
  }, [saveSettings]);

  const updateMicLevel = useCallback(() => {
    if (!analyserRef.current) return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);

    // Calculate average level
    const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
    const normalizedLevel = Math.min(100, (average / 128) * 100 * (inputVolumeRef.current / 100));
    setMicLevel(normalizedLevel);

    animationFrameRef.current = requestAnimationFrame(updateMicLevel);
  }, []);

  const startMicTest = useCallback(async () => {
    try {
      const constraints: MediaStreamConstraints = {
        audio: {
          deviceId: selectedInputDevice ? { exact: selectedInputDevice } : undefined,
          autoGainControl: autoGainControl,
          echoCancellation: echoCancellation,
          noiseSuppression: noiseSuppression,
        }
      };

      testStreamRef.current = await navigator.mediaDevices.getUserMedia(constraints);
      audioContextRef.current = new AudioContext();
      const source = audioContextRef.current.createMediaStreamSource(testStreamRef.current);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      source.connect(analyserRef.current);

      setIsTesting(true);
      updateMicLevel();
    } catch (err) {
      console.error('Failed to start mic test:', err);
    }
  }, [selectedInputDevice, autoGainControl, echoCancellation, noiseSuppression, updateMicLevel]);

  const testSpeakers = useCallback(async () => {
    try {
      // Create a test tone
      const ctx = new AudioContext();
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.value = 440; // A4 note
      gainNode.gain.value = (outputVolume / 100) * 0.3;

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.start();

      // Stop after 1 second
      setTimeout(() => {
        oscillator.stop();
        ctx.close();
      }, 1000);
    } catch (err) {
      console.error('Failed to test speakers:', err);
    }
  }, [outputVolume]);

  return (
    <div>
      <h2 className="text-xl font-bold text-text-primary mb-5">Voice & Video</h2>

      <div className="space-y-6">
        {/* Input Device Selection */}
        <div>
          <label className="block text-xs font-bold uppercase text-text-muted mb-2">
            Input Device
          </label>
          <select
            className="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary"
            value={selectedInputDevice}
            onChange={(e) => handleInputDeviceChange(e.target.value)}
          >
            <option value="">Default</option>
            {inputDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Microphone ${device.deviceId.slice(0, 8)}`}
              </option>
            ))}
          </select>
        </div>

        {/* Output Device Selection */}
        <div>
          <label className="block text-xs font-bold uppercase text-text-muted mb-2">
            Output Device
          </label>
          <select
            className="w-full px-3 py-2 bg-bg-tertiary border border-border-subtle rounded text-text-primary focus:outline-none focus:border-brand-primary"
            value={selectedOutputDevice}
            onChange={(e) => handleOutputDeviceChange(e.target.value)}
          >
            <option value="">Default</option>
            {outputDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Speaker ${device.deviceId.slice(0, 8)}`}
              </option>
            ))}
          </select>
        </div>

        {/* Input Volume */}
        <div>
          <label className="block text-xs font-bold uppercase text-text-muted mb-2">
            Input Volume - {inputVolume}%
          </label>
          <input
            type="range"
            min="0"
            max="200"
            value={inputVolume}
            onChange={(e) => handleInputVolumeChange(parseInt(e.target.value))}
            className="w-full accent-brand-primary"
          />
          {/* Mic level indicator */}
          {isTesting && (
            <div className="mt-2 h-2 bg-bg-tertiary rounded-full overflow-hidden">
              <div
                className="h-full bg-success transition-all duration-75"
                style={{ width: `${micLevel}%` }}
              />
            </div>
          )}
        </div>

        {/* Output Volume */}
        <div>
          <label className="block text-xs font-bold uppercase text-text-muted mb-2">
            Output Volume - {outputVolume}%
          </label>
          <input
            type="range"
            min="0"
            max="200"
            value={outputVolume}
            onChange={(e) => handleOutputVolumeChange(parseInt(e.target.value))}
            className="w-full accent-brand-primary"
          />
        </div>

        {/* Input Sensitivity */}
        <div>
          <label className="block text-xs font-bold uppercase text-text-muted mb-2">
            Input Sensitivity - {inputSensitivity}%
          </label>
          <input
            type="range"
            min="0"
            max="100"
            value={inputSensitivity}
            onChange={(e) => handleSensitivityChange(parseInt(e.target.value))}
            className="w-full accent-brand-primary"
          />
          <p className="text-xs text-text-muted mt-1">
            Adjusts the threshold for voice activity detection
          </p>
        </div>

        {/* Test Buttons */}
        <div className="flex gap-3">
          <button
            onClick={() => isTesting ? stopMicTest() : startMicTest()}
            className={clsx(
              "px-4 py-2 text-sm font-medium rounded transition-colors",
              isTesting
                ? "bg-danger hover:bg-danger/90 text-white"
                : "bg-bg-secondary hover:bg-bg-modifier-hover text-text-primary"
            )}
          >
            {isTesting ? 'Stop Testing' : 'Test Microphone'}
          </button>
          <button
            onClick={testSpeakers}
            className="px-4 py-2 bg-bg-secondary hover:bg-bg-modifier-hover text-text-primary text-sm font-medium rounded transition-colors"
          >
            Test Speakers
          </button>
        </div>

        {/* Audio Processing Toggles */}
        <div className="border-t border-border-subtle pt-6">
          <h3 className="text-sm font-bold text-text-primary mb-4">Audio Processing</h3>

          <div className="space-y-4">
            {/* Echo Cancellation */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-text-primary font-medium">Echo Cancellation</div>
                <div className="text-sm text-text-muted">Reduces echo from speakers</div>
              </div>
              <button
                onClick={() => toggleSetting(echoCancellation, setEchoCancellation, 'audio_echo_cancellation')}
                className={clsx(
                  "relative w-12 h-6 rounded-full transition-colors",
                  echoCancellation ? 'bg-success' : 'bg-bg-tertiary'
                )}
              >
                <div className={clsx(
                  "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                  echoCancellation ? 'left-7' : 'left-1'
                )} />
              </button>
            </div>

            {/* Noise Suppression */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-text-primary font-medium">Noise Suppression</div>
                <div className="text-sm text-text-muted">Reduces background noise</div>
              </div>
              <button
                onClick={() => toggleSetting(noiseSuppression, setNoiseSuppression, 'audio_noise_suppression')}
                className={clsx(
                  "relative w-12 h-6 rounded-full transition-colors",
                  noiseSuppression ? 'bg-success' : 'bg-bg-tertiary'
                )}
              >
                <div className={clsx(
                  "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                  noiseSuppression ? 'left-7' : 'left-1'
                )} />
              </button>
            </div>

            {/* Auto Gain Control */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-text-primary font-medium">Automatic Gain Control</div>
                <div className="text-sm text-text-muted">Automatically adjusts microphone volume</div>
              </div>
              <button
                onClick={() => toggleSetting(autoGainControl, setAutoGainControl, 'audio_auto_gain_control')}
                className={clsx(
                  "relative w-12 h-6 rounded-full transition-colors",
                  autoGainControl ? 'bg-success' : 'bg-bg-tertiary'
                )}
              >
                <div className={clsx(
                  "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                  autoGainControl ? 'left-7' : 'left-1'
                )} />
              </button>
            </div>

            {/* Voice Activity Detection */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-text-primary font-medium">Voice Activity Detection</div>
                <div className="text-sm text-text-muted">Automatically detect when you're speaking</div>
              </div>
              <button
                onClick={() => toggleSetting(voiceActivityDetection, setVoiceActivityDetection, 'voice_activity_detection')}
                className={clsx(
                  "relative w-12 h-6 rounded-full transition-colors",
                  voiceActivityDetection ? 'bg-success' : 'bg-bg-tertiary'
                )}
              >
                <div className={clsx(
                  "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                  voiceActivityDetection ? 'left-7' : 'left-1'
                )} />
              </button>
            </div>
          </div>
        </div>

        {/* Sound Settings */}
        <div className="border-t border-border-subtle pt-6">
          <h3 className="text-sm font-bold text-text-primary mb-4">Sounds</h3>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-text-primary font-medium">Voice Channel Sounds</div>
              <div className="text-sm text-text-muted">Play sounds when joining/leaving voice channels</div>
            </div>
            <button
              onClick={() => toggleSetting(enableVoiceJoinSounds, setEnableVoiceJoinSounds, 'enable_voice_join_sounds')}
              className={clsx(
                "relative w-12 h-6 rounded-full transition-colors",
                enableVoiceJoinSounds ? 'bg-success' : 'bg-bg-tertiary'
              )}
            >
              <div className={clsx(
                "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                enableVoiceJoinSounds ? 'left-7' : 'left-1'
              )} />
            </button>
          </div>
        </div>

        {/* Custom Join/Leave Sounds */}
        <div className="border-t border-border-subtle pt-6">
          <h3 className="text-sm font-bold text-text-primary mb-4">Custom Join/Leave Sounds</h3>
          <p className="text-sm text-text-muted mb-4">Upload custom sounds that play when you join or leave a voice channel.</p>
          <CustomVoiceSoundsSection />
        </div>

        {/* Saving indicator */}
        {saving && (
          <p className="text-xs text-text-muted">Saving...</p>
        )}
      </div>
    </div>
  );
}

function CustomVoiceSoundsSection() {
  const [joinSound, setJoinSound] = useState<any>(null);
  const [leaveSound, setLeaveSound] = useState<any>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serverId, setServerId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // Fetch the server ID (single-tenant)
        const serverData = await api.get<any>('/server');
        const sid = serverData?.id;
        if (!sid) return;
        setServerId(sid);

        const response = await api.get<{ join: any; leave: any }>(`/users/me/servers/${sid}/sounds`);
        setJoinSound(response.join);
        setLeaveSound(response.leave);
      } catch (err) {
        console.error('[CustomSounds] Failed to fetch sounds:', err);
      }
    })();
  }, []);

  const handleUpload = useCallback((type: 'join' | 'leave') => {
    const sid = serverId;
    if (!sid) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/mpeg,audio/wav,audio/ogg,.mp3,.wav,.ogg';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      setError(null);

      if (file.size > 1 * 1024 * 1024) {
        setError('File too large. Max 1MB');
        return;
      }

      // Measure duration
      let duration: number;
      try {
        const arrayBuffer = await file.arrayBuffer();
        const audioCtx = new AudioContext();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        duration = audioBuffer.duration;
        audioCtx.close();
      } catch {
        setError('Could not read audio file');
        return;
      }

      if (duration > 5) {
        setError(`Sound too long. Max 5s (got ${duration.toFixed(1)}s)`);
        return;
      }

      setUploading(type);
      try {
        const sound = await api.upload<any>(
          `/users/me/servers/${sid}/sounds/${type}`,
          file,
          'file',
          { duration: duration.toString() },
          'PUT',
        );
        if (type === 'join') setJoinSound(sound);
        else setLeaveSound(sound);
      } catch (err: any) {
        setError(err.message || 'Upload failed');
      } finally {
        setUploading(null);
      }
    };
    input.click();
  }, [serverId]);

  const handleDelete = useCallback(async (type: 'join' | 'leave') => {
    const sid = serverId;
    if (!sid) return;
    try {
      await api.delete(`/users/me/servers/${sid}/sounds/${type}`);
      if (type === 'join') setJoinSound(null);
      else setLeaveSound(null);
    } catch (err) {
      console.error('[CustomSounds] Failed to delete sound:', err);
    }
  }, [serverId]);

  const handlePreview = useCallback((url: string) => {
    const audio = new Audio(url);
    audio.volume = 0.5;
    audio.play().catch(() => {});
  }, []);

  if (!serverId) {
    return <p className="text-sm text-text-muted">Connect to a server to manage custom sounds.</p>;
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="text-xs text-red-400">{error}</div>
      )}

      {/* Join Sound */}
      <div className="flex items-center justify-between p-3 bg-bg-secondary rounded-lg">
        <div>
          <div className="text-sm font-medium text-text-primary">Join Sound</div>
          {joinSound ? (
            <div className="text-xs text-text-secondary">
              {joinSound?.duration_seconds?.toFixed(1)}s
              <button
                className="ml-2 text-accent-primary hover:underline"
                onClick={() => handlePreview(joinSound.sound_url)}
              >
                Preview
              </button>
            </div>
          ) : (
            <div className="text-xs text-text-muted">No custom sound set (default will play)</div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {joinSound && (
            <button
              className="text-xs px-2 py-1 text-red-400 hover:text-red-300 transition-colors"
              onClick={() => handleDelete('join')}
            >
              Remove
            </button>
          )}
          <button
            className="text-xs px-3 py-1 bg-accent-primary hover:bg-accent-primary/80 text-white rounded transition-colors disabled:opacity-50"
            onClick={() => handleUpload('join')}
            disabled={uploading === 'join'}
          >
            {uploading === 'join' ? 'Uploading...' : joinSound ? 'Replace' : 'Upload'}
          </button>
        </div>
      </div>

      {/* Leave Sound */}
      <div className="flex items-center justify-between p-3 bg-bg-secondary rounded-lg">
        <div>
          <div className="text-sm font-medium text-text-primary">Leave Sound</div>
          {leaveSound ? (
            <div className="text-xs text-text-secondary">
              {leaveSound?.duration_seconds?.toFixed(1)}s
              <button
                className="ml-2 text-accent-primary hover:underline"
                onClick={() => handlePreview(leaveSound.sound_url)}
              >
                Preview
              </button>
            </div>
          ) : (
            <div className="text-xs text-text-muted">No custom sound set (default will play)</div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {leaveSound && (
            <button
              className="text-xs px-2 py-1 text-red-400 hover:text-red-300 transition-colors"
              onClick={() => handleDelete('leave')}
            >
              Remove
            </button>
          )}
          <button
            className="text-xs px-3 py-1 bg-accent-primary hover:bg-accent-primary/80 text-white rounded transition-colors disabled:opacity-50"
            onClick={() => handleUpload('leave')}
            disabled={uploading === 'leave'}
          >
            {uploading === 'leave' ? 'Uploading...' : leaveSound ? 'Replace' : 'Upload'}
          </button>
        </div>
      </div>

      <p className="text-[11px] text-text-muted">
        Accepted formats: MP3, WAV, OGG. Max 1MB, max 5 seconds.
      </p>
    </div>
  );
}
