import { createSignal, createRoot } from 'solid-js';

export interface VoiceParticipant {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  isMuted: boolean;
  isDeafened: boolean;
  isSpeaking: boolean;
}

export interface VoicePermissions {
  canSpeak: boolean;
  canVideo: boolean;
  canStream: boolean;
  canMuteMembers: boolean;
  canMoveMembers: boolean;
}

export type VoiceConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface VoiceState {
  connectionState: VoiceConnectionState;
  currentChannelId: string | null;
  currentChannelName: string | null;
  participants: Map<string, VoiceParticipant[]>; // channelId -> participants
  permissions: VoicePermissions | null;
  localState: {
    isMuted: boolean;
    isDeafened: boolean;
    isSpeaking: boolean;
  };
  error: string | null;
}

function createVoiceStore() {
  const [state, setState] = createSignal<VoiceState>({
    connectionState: 'idle',
    currentChannelId: null,
    currentChannelName: null,
    participants: new Map(),
    permissions: null,
    localState: {
      isMuted: false,
      isDeafened: false,
      isSpeaking: false,
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

  // Get participants for a specific channel
  const getParticipants = (channelId: string): VoiceParticipant[] => {
    return state().participants.get(channelId) || [];
  };

  // Get participants for current channel
  const currentParticipants = (): VoiceParticipant[] => {
    const channelId = state().currentChannelId;
    if (!channelId) return [];
    return state().participants.get(channelId) || [];
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

  // Add a participant to a channel
  const addParticipant = (channelId: string, user: {
    id: string;
    username: string;
    display_name?: string | null;
    avatar_url?: string | null;
  }) => {
    setState(prev => {
      const newParticipants = new Map(prev.participants);
      const channelParticipants = [...(newParticipants.get(channelId) || [])];
      
      // Don't add if already exists
      if (channelParticipants.some(p => p.userId === user.id)) {
        return prev;
      }
      
      channelParticipants.push({
        userId: user.id,
        username: user.username,
        displayName: user.display_name || null,
        avatarUrl: user.avatar_url || null,
        isMuted: false,
        isDeafened: false,
        isSpeaking: false,
      });
      
      newParticipants.set(channelId, channelParticipants);
      
      return {
        ...prev,
        participants: newParticipants,
      };
    });
  };

  // Remove a participant from a channel
  const removeParticipant = (channelId: string, userId: string) => {
    setState(prev => {
      const newParticipants = new Map(prev.participants);
      const channelParticipants = (newParticipants.get(channelId) || [])
        .filter(p => p.userId !== userId);
      
      if (channelParticipants.length > 0) {
        newParticipants.set(channelId, channelParticipants);
      } else {
        newParticipants.delete(channelId);
      }
      
      return {
        ...prev,
        participants: newParticipants,
      };
    });
  };

  // Update a participant's mute/deafen state
  const updateParticipantState = (channelId: string, userId: string, updates: {
    isMuted?: boolean;
    isDeafened?: boolean;
    isSpeaking?: boolean;
  }) => {
    setState(prev => {
      const newParticipants = new Map(prev.participants);
      const channelParticipants = [...(newParticipants.get(channelId) || [])];
      
      const index = channelParticipants.findIndex(p => p.userId === userId);
      if (index === -1) return prev;
      
      channelParticipants[index] = {
        ...channelParticipants[index],
        ...updates,
      };
      
      newParticipants.set(channelId, channelParticipants);
      
      return {
        ...prev,
        participants: newParticipants,
      };
    });
  };

  // Set participants for a channel (from initial fetch)
  const setChannelParticipants = (channelId: string, participants: VoiceParticipant[]) => {
    setState(prev => {
      const newParticipants = new Map(prev.participants);
      newParticipants.set(channelId, participants);
      
      return {
        ...prev,
        participants: newParticipants,
      };
    });
  };

  // Clear all participants for a channel
  const clearChannelParticipants = (channelId: string) => {
    setState(prev => {
      const newParticipants = new Map(prev.participants);
      newParticipants.delete(channelId);
      
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
    // State setters
    setConnecting,
    setConnected,
    setDisconnected,
    setError,
    setReconnecting,
    setMuted,
    setDeafened,
    setSpeaking,
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
