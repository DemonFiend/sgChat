import { create } from 'zustand';

// Stable empty array to prevent Zustand selectors from returning new [] on every call
// (new [] fails Object.is comparison → triggers re-render → infinite loop)
const EMPTY_PARTICIPANTS: VoiceParticipant[] = [];

export interface VoiceParticipant {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  isMuted: boolean;
  isDeafened: boolean;
  isSpeaking: boolean;
  isStreaming?: boolean;
  isServerMuted?: boolean;
  isServerDeafened?: boolean;
  voiceStatus?: string;
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

interface VoiceActions {
  // Derived state helpers
  isConnected: () => boolean;
  isConnecting: () => boolean;
  getParticipants: (channelId: string) => VoiceParticipant[];
  currentParticipants: () => VoiceParticipant[];
  // State setters
  setConnecting: (channelId: string, channelName: string) => void;
  setConnected: (permissions: VoicePermissions) => void;
  setDisconnected: () => void;
  setError: (error: string) => void;
  setReconnecting: () => void;
  setMuted: (muted: boolean) => void;
  setDeafened: (deafened: boolean) => void;
  setSpeaking: (speaking: boolean) => void;
  setScreenSharing: (isSharing: boolean) => void;
  setScreenShareQuality: (quality: ScreenShareQuality) => void;
  setConnectionQuality: (quality: ConnectionQualityState) => void;
  // Participant management
  addParticipant: (channelId: string, user: { id: string; username: string; display_name?: string | null; avatar_url?: string | null; is_streaming?: boolean }) => void;
  removeParticipant: (channelId: string, userId: string) => void;
  updateParticipantState: (channelId: string, userId: string, updates: { isMuted?: boolean; isDeafened?: boolean; isSpeaking?: boolean; isStreaming?: boolean; isServerMuted?: boolean; isServerDeafened?: boolean; voiceStatus?: string }) => void;
  setChannelParticipants: (channelId: string, participants: VoiceParticipant[]) => void;
  clearChannelParticipants: (channelId: string) => void;
}

export const useVoiceStore = create<VoiceState & VoiceActions>((set, get) => ({
  connectionState: 'idle',
  currentChannelId: null,
  currentChannelName: null,
  participants: {},
  permissions: null,
  localState: { isMuted: false, isDeafened: false, isSpeaking: false },
  screenShare: { isSharing: false, quality: 'standard' },
  connectionQuality: { level: 'unknown', ping: null, jitter: null, packetLoss: null },
  error: null,

  isConnected: () => get().connectionState === 'connected',
  isConnecting: () => get().connectionState === 'connecting',
  getParticipants: (channelId) => get().participants[channelId] || EMPTY_PARTICIPANTS,
  currentParticipants: () => {
    const { currentChannelId, participants } = get();
    return currentChannelId ? participants[currentChannelId] || EMPTY_PARTICIPANTS : EMPTY_PARTICIPANTS;
  },

  setConnecting: (channelId, channelName) => set({ connectionState: 'connecting', currentChannelId: channelId, currentChannelName: channelName, error: null }),
  setConnected: (permissions) => set({ connectionState: 'connected', permissions, error: null }),
  setDisconnected: () => set({
    connectionState: 'idle', currentChannelId: null, currentChannelName: null, permissions: null,
    localState: { isMuted: false, isDeafened: false, isSpeaking: false },
    screenShare: { isSharing: false, quality: 'standard' },
    connectionQuality: { level: 'unknown', ping: null, jitter: null, packetLoss: null },
    error: null,
  }),
  setError: (error) => set({ connectionState: 'error', error }),
  setReconnecting: () => set({ connectionState: 'reconnecting' }),

  setMuted: (muted) => set((s) => ({ localState: { ...s.localState, isMuted: muted } })),
  setDeafened: (deafened) => set((s) => ({ localState: { ...s.localState, isDeafened: deafened, isMuted: deafened ? true : s.localState.isMuted } })),
  setSpeaking: (speaking) => set((s) => ({ localState: { ...s.localState, isSpeaking: speaking } })),
  setScreenSharing: (isSharing) => set((s) => ({ screenShare: { ...s.screenShare, isSharing } })),
  setScreenShareQuality: (quality) => set((s) => ({ screenShare: { ...s.screenShare, quality } })),
  setConnectionQuality: (quality) => set({ connectionQuality: quality }),

  addParticipant: (channelId, user) => set((s) => {
    const channelParticipants = [...(s.participants[channelId] || [])];
    const existingIndex = channelParticipants.findIndex((p) => p.userId === user.id);
    if (existingIndex !== -1) {
      channelParticipants[existingIndex] = {
        ...channelParticipants[existingIndex],
        username: user.username,
        displayName: user.display_name || null,
        avatarUrl: user.avatar_url || null,
        isStreaming: user.is_streaming ?? channelParticipants[existingIndex].isStreaming,
      };
    } else {
      channelParticipants.push({
        userId: user.id, username: user.username,
        displayName: user.display_name || null, avatarUrl: user.avatar_url || null,
        isMuted: false, isDeafened: false, isSpeaking: false, isStreaming: user.is_streaming || false,
      });
    }
    return { participants: { ...s.participants, [channelId]: channelParticipants } };
  }),

  removeParticipant: (channelId, userId) => set((s) => {
    const existing = s.participants[channelId] || [];
    const filtered = existing.filter((p) => p.userId !== userId);
    if (filtered.length === existing.length) return s;
    const newParticipants = { ...s.participants };
    if (filtered.length > 0) newParticipants[channelId] = filtered;
    else delete newParticipants[channelId];
    return { participants: newParticipants };
  }),

  updateParticipantState: (channelId, userId, updates) => set((s) => {
    const channelParticipants = [...(s.participants[channelId] || [])];
    const index = channelParticipants.findIndex((p) => p.userId === userId);
    if (index === -1) return s;
    const filtered: Partial<VoiceParticipant> = {};
    if (updates.isMuted !== undefined) filtered.isMuted = updates.isMuted;
    if (updates.isDeafened !== undefined) filtered.isDeafened = updates.isDeafened;
    if (updates.isSpeaking !== undefined) filtered.isSpeaking = updates.isSpeaking;
    if (updates.isStreaming !== undefined) filtered.isStreaming = updates.isStreaming;
    if (updates.isServerMuted !== undefined) filtered.isServerMuted = updates.isServerMuted;
    if (updates.isServerDeafened !== undefined) filtered.isServerDeafened = updates.isServerDeafened;
    if (updates.voiceStatus !== undefined) filtered.voiceStatus = updates.voiceStatus;
    channelParticipants[index] = { ...channelParticipants[index], ...filtered };
    return { participants: { ...s.participants, [channelId]: channelParticipants } };
  }),

  setChannelParticipants: (channelId, participants) => set((s) => {
    const existing = s.participants[channelId] || [];
    const existingMap = new Map(existing.map((p) => [p.userId, p]));
    const merged: VoiceParticipant[] = [];
    const seenIds = new Set<string>();
    for (const p of participants) {
      const ep = existingMap.get(p.userId);
      merged.push(ep ? { ...p, isSpeaking: ep.isSpeaking, isStreaming: p.isStreaming || ep.isStreaming } : p);
      seenIds.add(p.userId);
    }
    for (const p of existing) {
      if (!seenIds.has(p.userId)) merged.push(p);
    }
    return { participants: { ...s.participants, [channelId]: merged } };
  }),

  clearChannelParticipants: (channelId) => set((s) => {
    const newParticipants = { ...s.participants };
    delete newParticipants[channelId];
    return { participants: newParticipants };
  }),
}));

// Convenience alias for non-hook contexts (voice service, socket handlers)
export const voiceStore = {
  getState: () => useVoiceStore.getState(),
  isConnected: () => useVoiceStore.getState().isConnected(),
  isConnecting: () => useVoiceStore.getState().isConnecting(),
  currentChannelId: () => useVoiceStore.getState().currentChannelId,
  currentChannelName: () => useVoiceStore.getState().currentChannelName,
  isMuted: () => useVoiceStore.getState().localState.isMuted,
  isDeafened: () => useVoiceStore.getState().localState.isDeafened,
  isSpeaking: () => useVoiceStore.getState().localState.isSpeaking,
  error: () => useVoiceStore.getState().error,
  permissions: () => useVoiceStore.getState().permissions,
  getParticipants: (channelId: string) => useVoiceStore.getState().getParticipants(channelId),
  currentParticipants: () => useVoiceStore.getState().currentParticipants(),
  isScreenSharing: () => useVoiceStore.getState().screenShare.isSharing,
  screenShareQuality: () => useVoiceStore.getState().screenShare.quality,
  connectionQuality: () => useVoiceStore.getState().connectionQuality,
  setConnecting: (channelId: string, channelName: string) => useVoiceStore.getState().setConnecting(channelId, channelName),
  setConnected: (permissions: VoicePermissions) => useVoiceStore.getState().setConnected(permissions),
  setDisconnected: () => useVoiceStore.getState().setDisconnected(),
  setError: (error: string) => useVoiceStore.getState().setError(error),
  setReconnecting: () => useVoiceStore.getState().setReconnecting(),
  setMuted: (muted: boolean) => useVoiceStore.getState().setMuted(muted),
  setDeafened: (deafened: boolean) => useVoiceStore.getState().setDeafened(deafened),
  setSpeaking: (speaking: boolean) => useVoiceStore.getState().setSpeaking(speaking),
  setScreenSharing: (isSharing: boolean) => useVoiceStore.getState().setScreenSharing(isSharing),
  setScreenShareQuality: (quality: ScreenShareQuality) => useVoiceStore.getState().setScreenShareQuality(quality),
  setConnectionQuality: (quality: ConnectionQualityState) => useVoiceStore.getState().setConnectionQuality(quality),
  addParticipant: (channelId: string, user: { id: string; username: string; display_name?: string | null; avatar_url?: string | null; is_streaming?: boolean }) => useVoiceStore.getState().addParticipant(channelId, user),
  removeParticipant: (channelId: string, userId: string) => useVoiceStore.getState().removeParticipant(channelId, userId),
  updateParticipantState: (channelId: string, userId: string, updates: { isMuted?: boolean; isDeafened?: boolean; isSpeaking?: boolean; isStreaming?: boolean; isServerMuted?: boolean; isServerDeafened?: boolean; voiceStatus?: string }) => useVoiceStore.getState().updateParticipantState(channelId, userId, updates),
  setChannelParticipants: (channelId: string, participants: VoiceParticipant[]) => useVoiceStore.getState().setChannelParticipants(channelId, participants),
  clearChannelParticipants: (channelId: string) => useVoiceStore.getState().clearChannelParticipants(channelId),
};
