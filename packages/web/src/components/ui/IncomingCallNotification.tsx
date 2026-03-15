import { useEffect, useRef } from 'react';
import { Avatar } from './Avatar';
import { soundService } from '@/lib/soundService';

interface IncomingCallNotificationProps {
  callerName: string;
  callerAvatar?: string | null;
  onAccept: () => void;
  onDecline: () => void;
}

export function IncomingCallNotification({
  callerName,
  callerAvatar,
  onAccept,
  onDecline,
}: IncomingCallNotificationProps) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    soundService.playRingtone();

    // Auto-dismiss after 30 seconds
    timeoutRef.current = setTimeout(() => {
      onDecline();
    }, 30000);

    return () => {
      soundService.stopRingtone();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className="fixed top-4 left-1/2 -translate-x-1/2 z-50"
      style={{ animation: 'slideDown 0.3s ease-out' }}
    >
      <div className="bg-bg-secondary rounded-xl shadow-2xl border border-bg-tertiary p-4 min-w-[280px]">
        <div className="flex items-center gap-3 mb-4">
          <div className="relative">
            <Avatar src={callerAvatar} alt={callerName} size="lg" />
            <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-status-online rounded-full border-2 border-bg-secondary animate-pulse" />
          </div>
          <div>
            <h4 className="text-text-primary font-semibold">{callerName}</h4>
            <p className="text-sm text-text-muted animate-pulse">Incoming Call...</p>
          </div>
          <div className="ml-auto">
            <svg className="w-6 h-6 text-status-online animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onDecline}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-danger/20 text-danger rounded-lg hover:bg-danger/30 transition-colors font-medium text-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
            </svg>
            Decline
          </button>
          <button
            onClick={onAccept}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-status-online/20 text-status-online rounded-lg hover:bg-status-online/30 transition-colors font-medium text-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
