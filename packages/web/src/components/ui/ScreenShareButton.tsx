import { useState } from 'react';
import { clsx } from 'clsx';
import { useVoiceStore, type ScreenShareQuality } from '@/stores/voice';
import { voiceService } from '@/lib/voiceService';

interface ScreenShareButtonProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  showQualityMenu?: boolean;
}

export function ScreenShareButton({ size = 'md', className, showQualityMenu }: ScreenShareButtonProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const isScreenSharing = useVoiceStore((s) => s.isScreenSharing);
  const screenShareQuality = useVoiceStore((s) => s.screenShareQuality);
  const permissions = useVoiceStore((s) => s.permissions);

  const sizeClasses = size === 'sm' ? 'p-2' : size === 'lg' ? 'p-3' : 'p-2.5';
  const iconSize = size === 'sm' ? 'w-4 h-4' : size === 'lg' ? 'w-6 h-6' : 'w-5 h-5';
  const canStream = permissions?.canStream ?? true;

  const handleClick = async () => {
    if (isScreenSharing) {
      await voiceService.stopScreenShare();
    } else if (showQualityMenu) {
      setShowMenu(true);
    } else {
      await voiceService.startScreenShare();
    }
  };

  const handleQualitySelect = async (quality: ScreenShareQuality) => {
    setShowMenu(false);
    setShowSettingsMenu(false);
    await voiceService.stopScreenShare();
    await voiceService.startScreenShare(quality);
  };

  const qualityOptions = [
    { key: 'standard' as const, label: 'Standard', detail: '720p @ 30fps', badge: 'SD', badgeColor: 'bg-blue-500/20 text-blue-400' },
    { key: 'high' as const, label: 'High Quality', detail: '1080p @ 60fps', badge: 'HD', badgeColor: 'bg-purple-500/20 text-purple-400' },
    { key: 'native' as const, label: 'Native', detail: 'Full resolution', badge: '4K', badgeColor: 'bg-green-500/20 text-green-400' },
  ];

  return (
    <div className="relative flex items-center gap-1">
      <button
        onClick={handleClick}
        disabled={!canStream}
        className={clsx(
          'flex items-center justify-center rounded-md transition-colors',
          sizeClasses,
          !canStream
            ? 'bg-bg-secondary text-text-muted cursor-not-allowed'
            : isScreenSharing
              ? 'bg-status-online/20 text-status-online hover:bg-status-online/30'
              : 'bg-bg-secondary text-text-primary hover:bg-bg-modifier-hover',
          className
        )}
        title={!canStream ? 'You do not have permission to share your screen' : isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
      >
        {isScreenSharing ? (
          <svg className={iconSize} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className={iconSize} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        )}
      </button>

      {isScreenSharing && (
        <button
          onClick={() => setShowSettingsMenu(!showSettingsMenu)}
          className={clsx('flex items-center justify-center rounded-md transition-colors', sizeClasses, 'bg-bg-secondary text-text-primary hover:bg-bg-modifier-hover')}
          title="Screen Share Settings"
        >
          <svg className={iconSize} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      )}

      {/* Quality Selection Menu */}
      {showMenu && (
        <>
          <div className="absolute bottom-full left-1/2 mb-3 w-56 bg-bg-primary border-2 border-brand-primary/50 rounded-xl shadow-2xl overflow-hidden z-50">
            <div className="p-3 bg-brand-primary/10 border-b border-brand-primary/30">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-brand-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span className="text-sm font-semibold text-text-primary">Select Quality</span>
              </div>
            </div>
            <div className="p-2">
              {qualityOptions.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => handleQualitySelect(opt.key)}
                  className="w-full px-4 py-3 text-left text-sm text-text-primary hover:bg-brand-primary/20 rounded-lg flex items-center gap-3 transition-colors"
                >
                  <div className={`w-8 h-8 rounded-full ${opt.badgeColor} flex items-center justify-center`}>
                    <span className="font-bold text-xs">{opt.badge}</span>
                  </div>
                  <div>
                    <div className="font-medium">{opt.label}</div>
                    <div className="text-xs text-text-muted">{opt.detail}</div>
                  </div>
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowMenu(false)}
              className="w-full px-4 py-2.5 text-sm text-text-muted hover:text-text-primary hover:bg-bg-secondary border-t border-bg-tertiary transition-colors"
            >
              Cancel
            </button>
          </div>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setShowMenu(false)} />
        </>
      )}

      {/* Settings Menu - for changing quality while streaming */}
      {showSettingsMenu && (
        <>
          <div className="absolute bottom-full left-1/2 mb-3 w-56 bg-bg-primary border-2 border-status-online/50 rounded-xl shadow-2xl overflow-hidden z-50">
            <div className="p-3 bg-status-online/10 border-b border-status-online/30">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-status-online" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="text-sm font-semibold text-text-primary">Change Quality</span>
              </div>
            </div>
            <div className="p-2">
              {qualityOptions.map((opt) => {
                const isActive = screenShareQuality === opt.key;
                return (
                  <button
                    key={opt.key}
                    onClick={() => handleQualitySelect(opt.key)}
                    className={clsx(
                      'w-full px-4 py-3 text-left text-sm rounded-lg flex items-center gap-3 transition-colors',
                      isActive ? 'bg-status-online/20 text-status-online' : 'text-text-primary hover:bg-bg-modifier-hover'
                    )}
                  >
                    <div className={clsx('w-8 h-8 rounded-full flex items-center justify-center', isActive ? 'bg-status-online/30' : opt.badgeColor)}>
                      <span className={clsx('font-bold text-xs', isActive ? 'text-status-online' : '')}>{opt.badge}</span>
                    </div>
                    <div>
                      <div className="font-medium">{opt.label}</div>
                      <div className="text-xs text-text-muted">{opt.detail}</div>
                    </div>
                    {isActive && (
                      <svg className="w-5 h-5 ml-auto text-status-online" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setShowSettingsMenu(false)}
              className="w-full px-4 py-2.5 text-sm text-text-muted hover:text-text-primary hover:bg-bg-secondary border-t border-bg-tertiary transition-colors"
            >
              Close
            </button>
          </div>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setShowSettingsMenu(false)} />
        </>
      )}
    </div>
  );
}

interface ScreenShareQualityIndicatorProps {
  className?: string;
}

export function ScreenShareQualityIndicator({ className }: ScreenShareQualityIndicatorProps) {
  const isScreenSharing = useVoiceStore((s) => s.isScreenSharing);
  const screenShareQuality = useVoiceStore((s) => s.screenShareQuality);

  if (!isScreenSharing) return null;

  const qualityLabel = screenShareQuality === 'high' ? '1080p' : screenShareQuality === 'native' ? 'Native' : '720p';

  return (
    <div className={clsx('flex items-center gap-1 px-2 py-0.5 bg-status-online/20 text-status-online rounded text-xs font-medium', className)}>
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
      <span>{qualityLabel}</span>
    </div>
  );
}
