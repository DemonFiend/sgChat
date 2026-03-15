import { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { api } from '@/api';
import { toastStore } from '@/stores/toastNotifications';

interface NicknameModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetUser: { id: string; username: string; display_name?: string | null };
  serverId: string;
  isSelf: boolean;
  currentNickname: string | null;
  currentAdminNickname: string | null;
}

export function NicknameModal({
  isOpen,
  onClose,
  targetUser,
  serverId,
  isSelf,
  currentNickname,
  currentAdminNickname,
}: NicknameModalProps) {
  const [nickname, setNickname] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // Pre-fill with current value
      if (isSelf) {
        setNickname(currentNickname || '');
      } else {
        setNickname(currentAdminNickname || '');
      }
      setLoading(false);
    }
  }, [isOpen, isSelf, currentNickname, currentAdminNickname]);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      if (isSelf) {
        await api.patch(`/servers/${serverId}/members/@me/nickname`, {
          nickname: nickname.trim() || null,
        });
        toastStore.addToast({
          type: 'system',
          title: 'Nickname Updated',
          message: nickname.trim()
            ? `Nickname set to "${nickname.trim()}"`
            : 'Nickname cleared',
        });
      } else {
        await api.patch(`/servers/${serverId}/members/${targetUser.id}/admin-nickname`, {
          admin_nickname: nickname.trim() || null,
        });
        const name = targetUser.display_name || targetUser.username;
        toastStore.addToast({
          type: 'system',
          title: 'Nickname Override Set',
          message: nickname.trim()
            ? `Set ${name}'s nickname to "${nickname.trim()}"`
            : `Cleared nickname override for ${name}`,
        });
      }
      onClose();
    } catch (err: any) {
      toastStore.addToast({
        type: 'warning',
        title: 'Error',
        message: err?.message || 'Failed to update nickname',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    setNickname('');
    setLoading(true);
    try {
      if (isSelf) {
        await api.patch(`/servers/${serverId}/members/@me/nickname`, {
          nickname: null,
        });
      } else {
        await api.patch(`/servers/${serverId}/members/${targetUser.id}/admin-nickname`, {
          admin_nickname: null,
        });
      }
      const name = targetUser.display_name || targetUser.username;
      toastStore.addToast({
        type: 'system',
        title: 'Nickname Cleared',
        message: isSelf
          ? 'Your nickname has been cleared'
          : `Nickname override cleared for ${name}`,
      });
      onClose();
    } catch (err: any) {
      toastStore.addToast({
        type: 'warning',
        title: 'Error',
        message: err?.message || 'Failed to clear nickname',
      });
    } finally {
      setLoading(false);
    }
  };

  const displayName = targetUser.display_name || targetUser.username;
  const title = isSelf ? 'Change Nickname' : `Set Nickname for ${displayName}`;
  const hasCurrentValue = isSelf ? !!currentNickname : !!currentAdminNickname;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <div className="space-y-4">
        {/* Info text */}
        {isSelf ? (
          <p className="text-sm text-text-muted">
            Set a nickname that will be displayed instead of your username in this server.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-text-muted">
              Override this user's display name in the server. This takes priority over their
              self-set nickname.
            </p>
            <div className="px-3 py-2 rounded bg-warning/10 border border-warning/20">
              <p className="text-xs text-warning">
                The user will not be able to change this. Only someone with Manage Nicknames
                permission can modify or clear it.
              </p>
            </div>
          </div>
        )}

        {/* Current admin nickname notice (for self) */}
        {isSelf && currentAdminNickname && (
          <div className="px-3 py-2 rounded bg-danger/10 border border-danger/20">
            <p className="text-xs text-danger">
              An administrator has set your nickname to &quot;{currentAdminNickname}&quot;. You
              cannot change your nickname until this override is removed.
            </p>
          </div>
        )}

        {/* Input */}
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Nickname</label>
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value.slice(0, 32))}
            placeholder={targetUser.username}
            disabled={isSelf && !!currentAdminNickname}
            className="w-full px-3 py-2 text-sm bg-bg-secondary border border-divider rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-brand-primary focus:border-brand-primary disabled:opacity-50 disabled:cursor-not-allowed"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !loading && !(isSelf && !!currentAdminNickname)) {
                handleSubmit();
              }
            }}
          />
          <div className="flex justify-between mt-1">
            <span className="text-xs text-text-muted">{nickname.length}/32 characters</span>
            {isSelf && currentNickname && (
              <span className="text-xs text-text-muted">Current: {currentNickname}</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end">
          {hasCurrentValue && (
            <button
              onClick={handleClear}
              disabled={loading || (isSelf && !!currentAdminNickname)}
              className="px-4 py-2 text-sm text-danger hover:bg-danger/10 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Clear
            </button>
          )}
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-modifier-hover rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || (isSelf && !!currentAdminNickname)}
            className="px-4 py-2 text-sm font-medium text-white bg-brand-primary hover:bg-brand-primary/80 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
