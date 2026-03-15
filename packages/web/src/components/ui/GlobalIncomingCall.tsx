import { useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useAuthStore } from '@/stores/auth';
import { useVoiceStore } from '@/stores/voice';
import { socketService } from '@/lib/socket';
import { dmVoiceService } from '@/lib/dmVoiceService';
import { IncomingCallNotification } from './IncomingCallNotification';

export function GlobalIncomingCall() {
  const navigate = useNavigate();
  const incomingCall = useVoiceStore((s) => s.incomingDMCall);
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
      // Only suppress if already in a DM call (allow notification while in server voice)
      if (voiceConnectionStateRef.current === 'connected' && dmVoiceService.isActive()) return;

      useVoiceStore.getState().setIncomingDMCall({
        callerId: data.user.id,
        callerName: data.user.display_name || data.user.username,
        callerAvatar: data.user.avatar_url || null,
        dmChannelId: data.dm_channel_id,
      });
    };

    // Detect caller cancellation (caller hangs up before we answer)
    const handleVoiceLeave = (data: {
      dm_channel_id?: string;
      is_dm_call?: boolean;
      user?: { id: string };
    }) => {
      if (!data.is_dm_call || !data.dm_channel_id) return;
      const incoming = useVoiceStore.getState().incomingDMCall;
      if (incoming && incoming.dmChannelId === data.dm_channel_id) {
        useVoiceStore.getState().setIncomingDMCall(null);
      }
    };

    socketService.on('voice.join', handleVoiceJoin as (data: unknown) => void);
    socketService.on('voice.leave', handleVoiceLeave as (data: unknown) => void);
    return () => {
      socketService.off('voice.join', handleVoiceJoin as (data: unknown) => void);
      socketService.off('voice.leave', handleVoiceLeave as (data: unknown) => void);
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

    useVoiceStore.getState().setIncomingDMCall(null);
    navigate('/channels/@me');
  }, [incomingCall, navigate]);

  const handleDecline = useCallback(() => {
    useVoiceStore.getState().setIncomingDMCall(null);
  }, []);

  // Clear incoming call if user joins a call from elsewhere
  useEffect(() => {
    if (voiceConnectionState === 'connected' && incomingCall) {
      useVoiceStore.getState().setIncomingDMCall(null);
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
