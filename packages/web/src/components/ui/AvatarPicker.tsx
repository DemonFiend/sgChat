import { useState, useEffect, useRef } from 'react';
import { clsx } from 'clsx';
import { api } from '@/api';
import { Avatar } from './Avatar';
import type { UserAvatar, AvatarLimits } from '@sgchat/shared';

interface AvatarPickerProps {
  currentAvatarUrl?: string | null;
  username?: string;
  displayName?: string;
  onAvatarChange?: (newUrl: string | null) => void;
}

interface AvatarHistory {
  current: UserAvatar | null;
  previous: UserAvatar | null;
}

interface AvatarUploadResponse {
  avatar_url: string;
  width: number;
  height: number;
  file_size: number;
}

export function AvatarPicker({ currentAvatarUrl, username, displayName, onAvatarChange }: AvatarPickerProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [isReverting, setIsReverting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [history, setHistory] = useState<AvatarHistory>({ current: null, previous: null });
  const [limits, setLimits] = useState<AvatarLimits | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load avatar history and limits on mount
  useEffect(() => {
    (async () => {
      try {
        const [historyData, limitsData] = await Promise.all([
          api.get<AvatarHistory>('/users/me/avatar/history'),
          api.get<AvatarLimits>('/users/me/avatar/limits'),
        ]);
        setHistory(historyData);
        setLimits(limitsData);
      } catch (err) {
        console.error('Failed to load avatar data:', err);
      }
    })();
  }, []);

  const handleFileSelect = async (file: File) => {
    setError(null);

    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setError('Invalid file type. Allowed: JPEG, PNG, GIF, WebP');
      return;
    }

    const maxSize = limits?.max_upload_size_bytes || 5 * 1024 * 1024;
    if (file.size > maxSize) {
      const maxMB = (maxSize / (1024 * 1024)).toFixed(1);
      setError(`File too large. Maximum size: ${maxMB}MB`);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      setPreviewUrl(e.target?.result as string);
    };
    reader.readAsDataURL(file);

    setIsUploading(true);
    try {
      const result = await api.upload<AvatarUploadResponse>('/users/me/avatar', file);

      const historyData = await api.get<AvatarHistory>('/users/me/avatar/history');
      setHistory(historyData);

      setPreviewUrl(null);
      onAvatarChange?.(result.avatar_url);
    } catch (err: any) {
      setError(err.message || 'Failed to upload avatar');
      setPreviewUrl(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleRevert = async () => {
    if (!history.previous || isReverting) return;

    setIsReverting(true);
    setError(null);

    try {
      const result = await api.post<{ avatar_url: string }>('/users/me/avatar/revert');

      const historyData = await api.get<AvatarHistory>('/users/me/avatar/history');
      setHistory(historyData);

      onAvatarChange?.(result.avatar_url);
    } catch (err: any) {
      setError(err.message || 'Failed to revert avatar');
    } finally {
      setIsReverting(false);
    }
  };

  const handleDelete = async () => {
    if (isDeleting) return;

    setIsDeleting(true);
    setError(null);

    try {
      const result = await api.delete<{ avatar_url: string | null }>('/users/me/avatar');

      const historyData = await api.get<AvatarHistory>('/users/me/avatar/history');
      setHistory(historyData);

      onAvatarChange?.(result.avatar_url);
    } catch (err: any) {
      setError(err.message || 'Failed to delete avatar');
    } finally {
      setIsDeleting(false);
    }
  };

  const displayUrl = previewUrl || currentAvatarUrl;
  const hasAvatar = !!displayUrl;
  const hasPrevious = !!history.previous;

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="space-y-4">
      {/* Main avatar display with upload zone */}
      <div className="flex items-start gap-6">
        {/* Avatar with drag-and-drop */}
        <div
          className={clsx(
            'relative cursor-pointer group',
            dragOver && 'ring-4 ring-brand-primary ring-offset-2 ring-offset-bg-primary rounded-full'
          )}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
        >
          <Avatar
            src={displayUrl}
            alt={displayName || username || 'User'}
            size="xl"
            className={clsx(
              'transition-opacity',
              (isUploading || dragOver) && 'opacity-50'
            )}
          />

          {/* Overlay on hover */}
          <div className={clsx(
            'absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity',
            (isUploading || dragOver) && 'opacity-100'
          )}>
            {isUploading ? (
              <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            )}
          </div>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            name="avatar-upload"
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="hidden"
            onChange={handleInputChange}
          />
        </div>

        {/* Upload instructions and actions */}
        <div className="flex-1 space-y-3">
          <div>
            <p className="text-sm text-text-primary font-medium">Click or drag to upload</p>
            <p className="text-xs text-text-muted mt-1">
              JPEG, PNG, GIF, or WebP. Max {limits ? formatFileSize(limits.max_upload_size_bytes) : '5 MB'}.
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="px-3 py-1.5 bg-brand-primary hover:bg-brand-primary-hover text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
            >
              {isUploading ? 'Uploading...' : 'Change Avatar'}
            </button>

            {hasAvatar && (
              <button
                onClick={handleDelete}
                disabled={isDeleting || isUploading}
                className="px-3 py-1.5 bg-bg-secondary hover:bg-bg-modifier-hover text-text-primary text-sm font-medium rounded transition-colors disabled:opacity-50"
              >
                {isDeleting ? 'Removing...' : 'Remove'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="p-3 bg-danger/10 border border-danger/30 rounded text-sm text-danger">
          {error}
        </div>
      )}

      {/* Previous avatar section */}
      {hasPrevious && (
        <div className="pt-4 border-t border-border-subtle">
          <div className="flex items-center gap-4">
            <div>
              <p className="text-xs font-bold uppercase text-text-muted mb-2">Previous Avatar</p>
              <Avatar
                src={history.previous!.url}
                alt="Previous avatar"
                size="lg"
                className="ring-2 ring-border-subtle"
              />
            </div>
            <div className="flex-1">
              <p className="text-sm text-text-muted mb-2">
                You can switch back to your previous avatar.
              </p>
              <button
                onClick={handleRevert}
                disabled={isReverting || isUploading}
                className="px-3 py-1.5 bg-bg-secondary hover:bg-bg-modifier-hover text-text-primary text-sm font-medium rounded transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                </svg>
                {isReverting ? 'Reverting...' : 'Revert to Previous'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Storage info */}
      {history.current && (
        <div className="text-xs text-text-muted">
          Current avatar: {formatFileSize(history.current.file_size)}{' '}
          ({history.current.width}x{history.current.height})
        </div>
      )}
    </div>
  );
}
