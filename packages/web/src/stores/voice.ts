import { createSignal, createRoot } from 'solid-js';

export interface VoiceParticipant {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  isMuted: boolean;
  isDeafened: boolean;
  isSpeaking: boolean;
  isStreaming?: boolean;
}

export interface VoicePermissions {
  canSpeak: boolean;
  canVideo: boolean;
  canStream: boolean;
  canMuteMembers: boolean;
  canMoveMembers: boolean;
  canDisconnectMembers: boolean;
  canDeafenMembers: boolean;
}

export type ConnectionQualityLevel = 'excellent' | 'good' | 'poor' | 'lost' | 'unknown';

export type ScreenShareQuality = 'standard' | 'high' | 'native';

export interface ScreenShareState {
  isSharing: boolean;
  quality: ScreenShareQuality;
}

export interface ConnectionQualityState {
  level: ConnectionQualityLevel;
  ping: number | null;
  jitter: number | null;
  packetLoss: number | null;
}

export type VoiceConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface VoiceState {
  connectionState: VoiceConnectionState;
  currentChannelId: string | null;
  currentChannelName: string | null;
  participants: Record<string, VoiceParticipant[]>;
  permissions: VoicePermissions | null;
  localState: {
    isMuted: boolean;
    isDeafened: boolean;
    isSpeaking: boolean;
  };
  screenShare: ScreenShareState;
  connectionQuality: ConnectionQualityState;
  error: string | null;
}

function createVoiceStore() {
  const [state, setState] = createSignal<VoiceState>({
    connectionState: 'idle',
    currentChannelId: null,
    currentChannelName: null,
    participants: {},
    permissions: null,
    localState: {
      isMuted: false,
      isDeafened: false,
      isSpeaking: false,
    },
    screenShare: {
      isSharing: false,
      quality: 'standard',
    },
    connectionQuality: {
      level: 'unknown',
      ping: null,
      jitter: null,
      packetLoss: null,
    },
    error: null,
  });

  // Derived state helpers
  const isConnected = () => state().connectionState === 'connected';
  const isConnecting = () => state().connectionState === 'connecting';
  const currentChannelId = () => state().currentChannelId;
  const currentChannelName = () => state().currentChannelName;
  const isMuted = () => state().localState.isMuted;
  const isDeafened = () => state().localState.isDeafened;
  const isSpeaking = () => state().localState.isSpeaking;
  const error = () => state().error;
  const permissions = () => state().permissions;
  const isScreenSharing = () => state().screenShare.isSharing;
  const screenShareQuality = () => state().screenShare.quality;
  const connectionQuality = () => state().connectionQuality;

  // Get participants for a specific channel
  const getParticipants = (channelId: string): VoiceParticipant[] => {
    return state().participants[channelId] || [];
  };

  // Get participants for current channel
  const currentParticipants = (): VoiceParticipant[] => {
    const channelId = state().currentChannelId;
    if (!channelId) return [];
    return state().participants[channelId] || [];
  };

  // Set connecting state
  const setConnecting = (channelId: string, channelName: string) => {
    setState(prev => ({
      ...prev,
      connectionState: 'connecting',
      currentChannelId: channelId,
      currentChannelName: channelName,
      error: null,
    }));
  };

  // Set connected state
  const setConnected = (permissions: VoicePermissions) => {
    setState(prev => ({
      ...prev,
      connectionState: 'connected',
      permissions,
      error: null,
    }));
  };

  // Set disconnected state
  const setDisconnected = () => {
    setState(prev => ({
      ...prev,
      connectionState: 'idle',
      currentChannelId: null,
      currentChannelName: null,
      permissions: null,
      localState: {
        isMuted: false,
        isDeafened: false,
        isSpeaking: false,
      },
      screenShare: {
        isSharing: false,
        quality: 'standard',
      },
      connectionQuality: {
        level: 'unknown',
        ping: null,
        jitter: null,
        packetLoss: null,
      },
      error: null,
    }));
  };

  // Set error state
  const setError = (error: string) => {
    setState(prev => ({
      ...prev,
      connectionState: 'error',
      error,
    }));
  };

  // Set reconnecting state
  const setReconnecting = () => {
    setState(prev => ({
      ...prev,
      connectionState: 'reconnecting',
    }));
  };

  // Update local muted state
  const setMuted = (muted: boolean) => {
    setState(prev => ({
      ...prev,
      localState: {
        ...prev.localState,
        isMuted: muted,
      },
    }));
  };

  // Update local deafened state
  const setDeafened = (deafened: boolean) => {
    setState(prev => ({
      ...prev,
      localState: {
        ...prev.localState,
        isDeafened: deafened,
        // If deafening, also mute
        isMuted: deafened ? true : prev.localState.isMuted,
      },
    }));
  };

  // Update local speaking state
  const setSpeaking = (speaking: boolean) => {
    setState(prev => ({
      ...prev,
      localState: {
        ...prev.localState,
        isSpeaking: speaking,
      },
    }));
  };

  // Update screen sharing state
  const setScreenSharing = (isSharing: boolean) => {
    setState(prev => ({
      ...prev,
      screenShare: {
        ...prev.screenShare,
        isSharing,
      },
    }));
  };

  // Update screen share quality
  const setScreenShareQuality = (quality: ScreenShareQuality) => {
    setState(prev => ({
      ...prev,
      screenShare: {
        ...prev.screenShare,
        quality,
      },
    }));
  };

  // Update connection quality
  const setConnectionQuality = (quality: ConnectionQualityState) => {
    setState(prev => ({
      ...prev,
      connectionQuality: quality,
    }));
  };

  // Add a participant to a channel
  const addParticipant = (channelId: string, user: {
    id: string;
    username: string;
    display_name?: string | null;
    avatar_url?: string | null;
    is_streaming?: boolean;
  }) => {
    setState(prev => {
      const channelParticipants = [...(prev.participants[channelId] || [])];
      
      const existingIndex = channelParticipants.findIndex(p => p.userId === user.id);
      if (existingIndex !== -1) {
        const existing = channelParticipants[existingIndex];
        channelParticipants[existingIndex] = {
          ...existing,
          username: user.username,
          displayName: user.display_name || null,
          avatarUrl: user.avatar_url || null,
          isStreaming: user.is_streaming ?? existing.isStreaming,
        };
        return {
          ...prev,
          participants: { ...prev.participants, [channelId]: channelParticipants },
        };
      }
      
      console.log('[VoiceStore] Adding participant:', user.id, user.username, 'to channel:', channelId);
      channelParticipants.push({
        userId: user.id,
        username: user.username,
        displayName: user.display_name || null,
        avatarUrl: user.avatar_url || null,
        isMuted: false,
        isDeafened: false,
        isSpeaking: false,
        isStreaming: user.is_streaming || false,
      });
      
      console.log('[VoiceStore] Channel now has', channelParticipants.length, 'participants');
      
      return {
        ...prev,
        participants: { ...prev.participants, [channelId]: channelParticipants },
      };
    });
  };

  // Remove a participant from a channel
  const removeParticipant = (channelId: string, userId: string) => {
    setState(prev => {
      const existing = prev.participants[channelId] || [];
      const channelParticipants = existing.filter(p => p.userId !== userId);
      
      if (channelParticipants.length === existing.length) {
        console.log('[VoiceStore] Participant not found for removal:', userId, 'in channel:', channelId);
        return prev;
      }
      
      console.log('[VoiceStore] Removing participant:', userId, 'from channel:', channelId);
      console.log('[VoiceStore] Channel now has', channelParticipants.length, 'participants');
      
      const newParticipants = { ...prev.participants };
      if (channelParticipants.length > 0) {
        newParticipants[channelId] = channelParticipants;
      } else {
        delete newParticipants[channelId];
      }
      
      return {
        ...prev,
        participants: newParticipants,
      };
    });
  };

  // Update a participant's mute/deafen/streaming state
  // Only updates fields that are explicitly provided (not undefined)
  const updateParticipantState = (channelId: string, userId: string, updates: {
    isMuted?: boolean;
    isDeafened?: boolean;
    isSpeaking?: boolean;
    isStreaming?: boolean;
  }) => {
    setState(prev => {
      const channelParticipants = [...(prev.participants[channelId] || [])];
      
      const index = channelParticipants.findIndex(p => p.userId === userId);
      if (index === -1) return prev;
      
      // Filter out undefined values to avoid overwriting existing state
      const filteredUpdates: Partial<VoiceParticipant> = {};
      if (updates.isMuted !== undefined) filteredUpdates.isMuted = updates.isMuted;
      if (updates.isDeafened !== undefined) filteredUpdates.isDeafened = updates.isDeafened;
      if (updates.isSpeaking !== undefined) filteredUpdates.isSpeaking = updates.isSpeaking;
      if (updates.isStreaming !== undefined) filteredUpdates.isStreaming = updates.isStreaming;
      
      channelParticipants[index] = {
        ...channelParticipants[index],
        ...filteredUpdates,
      };
      
      return {
        ...prev,
        participants: { ...prev.participants, [channelId]: channelParticipants },
      };
    });
  };

  // Set participants for a channel (from initial fetch) - merges with existing to avoid race conditions
  const setChannelParticipants = (channelId: string, participants: VoiceParticipant[]) => {
    setState(prev => {
      const existing = prev.participants[channelId] || [];
      
      const existingMap = new Map(existing.map(p => [p.userId, p]));
      
      const merged: VoiceParticipant[] = [];
      const seenIds = new Set<string>();
      
      for (const p of participants) {
        const existingParticipant = existingMap.get(p.userId);
        if (existingParticipant) {
          merged.push({
            ...p,
            isSpeaking: existingParticipant.isSpeaking,
            isStreaming: p.isStreaming || existingParticipant.isStreaming,
          });
        } else {
          merged.push(p);
        }
        seenIds.add(p.userId);
      }
      
      for (const p of existing) {
        if (!seenIds.has(p.userId)) {
          console.log('[VoiceStore] Preserving participant added by socket event:', p.userId);
          merged.push(p);
        }
      }
      
      return {
        ...prev,
        participants: { ...prev.participants, [channelId]: merged },
      };
    });
  };

  // Clear all participants for a channel
  const clearChannelParticipants = (channelId: string) => {
    setState(prev => {
      const newParticipants = { ...prev.participants };
      delete newParticipants[channelId];
      
      return {
        ...prev,
        participants: newParticipants,
      };
    });
  };

  return {
    state,
    // Derived state
    isConnected,
    isConnecting,
    currentChannelId,
    currentChannelName,
    isMuted,
    isDeafened,
    isSpeaking,
    error,
    permissions,
    getParticipants,
    currentParticipants,
    isScreenSharing,
    screenShareQuality,
    connectionQuality,
    // State setters
    setConnecting,
    setConnected,
    setDisconnected,
    setError,
    setReconnecting,
    setMuted,
    setDeafened,
    setSpeaking,
    setScreenSharing,
    setScreenShareQuality,
    setConnectionQuality,
    // Participant management
    addParticipant,
    removeParticipant,
    updateParticipantState,
    setChannelParticipants,
    clearChannelParticipants,
  };
}

// Create singleton store
export const voiceStore = createRoot(createVoiceStore);
