import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useAuthStore } from '@/stores/auth';
import { useVoiceStore } from '@/stores/voice';
import { socketService } from '@/lib/socket';
import { dmVoiceService } from '@/lib/dmVoiceService';
import { IncomingCallNotification } from './IncomingCallNotification';

interface IncomingCallState {
  callerId: string;
  callerName: string;
  callerAvatar: string | null;
  dmChannelId: string;
}

export function GlobalIncomingCall() {
  const navigate = useNavigate();
  const [incomingCall, setIncomingCall] = useState<IncomingCallState | null>(null);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const voiceConnectionState = useVoiceStore((s) => s.connectionState);
  const voiceConnectionStateRef = useRef(voiceConnectionState);
  voiceConnectionStateRef.current = voiceConnectionState;

  useEffect(() => {
    if (!currentUserId) return;

    const handleVoiceJoin = (data: {
      dm_channel_id?: string;
      is_dm_call?: boolean;
      user?: {
        id: string;
        username: string;
        display_name?: string | null;
        avatar_url?: string | null;
      };
    }) => {
      if (!data.is_dm_call || !data.dm_channel_id || !data.user) return;
      if (data.user.id === currentUserId) return;
      if (voiceConnectionStateRef.current === 'connected') return;

      setIncomingCall({
        callerId: data.user.id,
        callerName: data.user.display_name || data.user.username,
        callerAvatar: data.user.avatar_url || null,
        dmChannelId: data.dm_channel_id,
      });
    };

    socketService.on('voice.join', handleVoiceJoin as (data: unknown) => void);
    return () => {
      socketService.off('voice.join', handleVoiceJoin as (data: unknown) => void);
    };
  }, [currentUserId]);

  const handleAccept = useCallback(async () => {
    if (!incomingCall) return;

    // Store pending info so DMPage can auto-select the friend
    useVoiceStore.getState().setPendingDMCallInfo({
      friendId: incomingCall.callerId,
      friendName: incomingCall.callerName,
      dmChannelId: incomingCall.dmChannelId,
    });

    try {
      await dmVoiceService.join(incomingCall.dmChannelId, incomingCall.callerName, true);
    } catch (err) {
      console.error('[GlobalIncomingCall] Failed to accept call:', err);
    }

    setIncomingCall(null);
    navigate('/channels/@me');
  }, [incomingCall, navigate]);

  const handleDecline = useCallback(() => {
    setIncomingCall(null);
  }, []);

  // Clear incoming call if user joins a call from elsewhere
  useEffect(() => {
    if (voiceConnectionState === 'connected' && incomingCall) {
      setIncomingCall(null);
    }
  }, [voiceConnectionState, incomingCall]);

  if (!incomingCall) return null;

  return (
    <IncomingCallNotification
      callerName={incomingCall.callerName}
      callerAvatar={incomingCall.callerAvatar}
      onAccept={handleAccept}
      onDecline={handleDecline}
    />
  );
}
