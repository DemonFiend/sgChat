import { Room, RoomEvent, Track, RemoteTrack, RemoteParticipant, LocalParticipant, ConnectionState } from 'livekit-client';
import { api } from '@/api';
import { voiceStore, type VoicePermissions, type VoiceParticipant } from '@/stores/voice';
import { socketService } from './socket';

interface JoinVoiceResponse {
  token: string;
  url: string;
  room_name?: string;
  permissions?: {
    canSpeak: boolean;
    canVideo: boolean;
    canStream: boolean;
    canMuteMembers: boolean;
    canMoveMembers: boolean;
  };
}

interface VoiceParticipantResponse {
  participants: Array<{
    user_id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
    is_muted: boolean;
    is_deafened: boolean;
    joined_at: string;
  }>;
}

class VoiceServiceClass {
  private room: Room | null = null;
  private audioElements: Map<string, HTMLAudioElement> = new Map();
  private audioContainer: HTMLElement | null = null;

  /**
   * Set the container element for audio elements
   */
  setAudioContainer(container: HTMLElement) {
    this.audioContainer = container;
  }

  /**
   * Join a voice channel
   */
  async join(channelId: string, channelName: string): Promise<void> {
    // If already connected to a channel, leave first
    if (voiceStore.isConnected()) {
      await this.leave();
    }

    try {
      // Set connecting state
      voiceStore.setConnecting(channelId, channelName);
      console.log('[VoiceService] Joining voice channel:', channelId, channelName);

      // 1. Get token from server
      const response = await api.post<JoinVoiceResponse>(`/voice/join/${channelId}`, {});
      const { token, url, permissions } = response;
      
      console.log('[VoiceService] Got token, connecting to LiveKit at:', url);

      // 2. Fetch current participants
      try {
        const participantsResponse = await api.get<VoiceParticipantResponse>(
          `/channels/${channelId}/voice-participants`
        );
        
        if (participantsResponse.participants) {
          const participants: VoiceParticipant[] = participantsResponse.participants.map(p => ({
            userId: p.user_id,
            username: p.username,
            displayName: p.display_name,
            avatarUrl: p.avatar_url,
            isMuted: p.is_muted,
            isDeafened: p.is_deafened,
            isSpeaking: false,
          }));
          voiceStore.setChannelParticipants(channelId, participants);
        }
      } catch (err) {
        console.warn('[VoiceService] Could not fetch participants:', err);
      }

      // 3. Create and configure Room
      this.room = new Room({
        adaptiveStream: true,
        dynacast: true,
        // Audio settings
        audioCaptureDefaults: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      // 4. Set up event listeners
      this.setupRoomEventListeners();

      // 5. Connect to LiveKit
      await this.room.connect(url, token);
      console.log('[VoiceService] Connected to LiveKit room');

      // 6. Set connected state with permissions
      const voicePermissions: VoicePermissions = permissions || {
        canSpeak: true,
        canVideo: false,
        canStream: false,
        canMuteMembers: false,
        canMoveMembers: false,
      };
      voiceStore.setConnected(voicePermissions);

      // 7. Enable microphone if we have speak permission and not muted
      if (voicePermissions.canSpeak && !voiceStore.isMuted()) {
        await this.room.localParticipant.setMicrophoneEnabled(true);
        console.log('[VoiceService] Microphone enabled');
      }

      // 8. Emit socket event to notify server
      socketService.emit('voice:join', { channel_id: channelId });

    } catch (err: any) {
      console.error('[VoiceService] Failed to join voice channel:', err);
      voiceStore.setError(err?.message || 'Failed to join voice channel');
      throw err;
    }
  }

  /**
   * Leave the current voice channel
   */
  async leave(): Promise<void> {
    const channelId = voiceStore.currentChannelId();
    
    if (!this.room) {
      voiceStore.setDisconnected();
      return;
    }

    try {
      console.log('[VoiceService] Leaving voice channel:', channelId);

      // Emit socket event before disconnecting
      if (channelId) {
        socketService.emit('voice:leave', { channel_id: channelId });
      }

      // Disconnect from LiveKit
      await this.room.disconnect();
      this.room = null;

      // Clean up audio elements
      this.cleanupAudioElements();

      // Update store
      voiceStore.setDisconnected();
      
      console.log('[VoiceService] Disconnected from voice channel');
    } catch (err) {
      console.error('[VoiceService] Error leaving voice channel:', err);
      // Force disconnect state even on error
      this.room = null;
      voiceStore.setDisconnected();
    }
  }

  /**
   * Toggle mute state
   */
  async toggleMute(): Promise<void> {
    const currentMuted = voiceStore.isMuted();
    await this.setMuted(!currentMuted);
  }

  /**
   * Set muted state
   */
  async setMuted(muted: boolean): Promise<void> {
    if (!this.room) return;

    try {
      await this.room.localParticipant.setMicrophoneEnabled(!muted);
      voiceStore.setMuted(muted);
      
      // Notify server
      const channelId = voiceStore.currentChannelId();
      if (channelId) {
        socketService.emit('voice:mute', {
          channel_id: channelId,
          is_muted: muted,
          is_deafened: voiceStore.isDeafened(),
        });
      }
      
      console.log('[VoiceService] Mute state:', muted);
    } catch (err) {
      console.error('[VoiceService] Failed to toggle mute:', err);
    }
  }

  /**
   * Toggle deafen state
   */
  async toggleDeafen(): Promise<void> {
    const currentDeafened = voiceStore.isDeafened();
    await this.setDeafened(!currentDeafened);
  }

  /**
   * Set deafened state
   */
  async setDeafened(deafened: boolean): Promise<void> {
    if (!this.room) return;

    try {
      // When deafening, also mute and disable all audio
      if (deafened) {
        await this.room.localParticipant.setMicrophoneEnabled(false);
        // Mute all audio elements
        this.audioElements.forEach(audio => {
          audio.muted = true;
        });
      } else {
        // When undeafening, restore audio but keep mic muted if it was muted before
        this.audioElements.forEach(audio => {
          audio.muted = false;
        });
        // Only enable mic if not previously muted
        if (!voiceStore.isMuted()) {
          await this.room.localParticipant.setMicrophoneEnabled(true);
        }
      }

      voiceStore.setDeafened(deafened);
      
      // Notify server
      const channelId = voiceStore.currentChannelId();
      if (channelId) {
        socketService.emit('voice:mute', {
          channel_id: channelId,
          is_muted: voiceStore.isMuted(),
          is_deafened: deafened,
        });
      }
      
      console.log('[VoiceService] Deafen state:', deafened);
    } catch (err) {
      console.error('[VoiceService] Failed to toggle deafen:', err);
    }
  }

  /**
   * Handle force move from moderator
   */
  async handleForceMove(toChannelId: string, toChannelName: string): Promise<void> {
    console.log('[VoiceService] Force moved to channel:', toChannelId);
    await this.leave();
    await this.join(toChannelId, toChannelName);
  }

  /**
   * Check if connected to a specific channel
   */
  isConnectedToChannel(channelId: string): boolean {
    return voiceStore.isConnected() && voiceStore.currentChannelId() === channelId;
  }

  /**
   * Get the current Room instance (for advanced usage)
   */
  getRoom(): Room | null {
    return this.room;
  }

  // Private methods

  private setupRoomEventListeners(): void {
    if (!this.room) return;

    // Track subscribed - attach audio
    this.room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      console.log('[VoiceService] Track subscribed:', track.kind, 'from', participant.identity);
      
      if (track.kind === Track.Kind.Audio) {
        this.attachAudioTrack(track as RemoteTrack, participant);
      }
    });

    // Track unsubscribed - detach audio
    this.room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
      console.log('[VoiceService] Track unsubscribed:', track.kind, 'from', participant.identity);
      
      if (track.kind === Track.Kind.Audio) {
        this.detachAudioTrack(participant.identity);
      }
    });

    // Participant connected
    this.room.on(RoomEvent.ParticipantConnected, (participant) => {
      console.log('[VoiceService] Participant connected:', participant.identity);
      // Server will emit voice:user-joined socket event
    });

    // Participant disconnected
    this.room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      console.log('[VoiceService] Participant disconnected:', participant.identity);
      this.detachAudioTrack(participant.identity);
      // Server will emit voice:user-left socket event
    });

    // Track muted
    this.room.on(RoomEvent.TrackMuted, (publication, participant) => {
      if (publication.kind === Track.Kind.Audio) {
        console.log('[VoiceService] Participant muted:', participant.identity);
        const channelId = voiceStore.currentChannelId();
        if (channelId) {
          voiceStore.updateParticipantState(channelId, participant.identity, { isMuted: true });
        }
      }
    });

    // Track unmuted
    this.room.on(RoomEvent.TrackUnmuted, (publication, participant) => {
      if (publication.kind === Track.Kind.Audio) {
        console.log('[VoiceService] Participant unmuted:', participant.identity);
        const channelId = voiceStore.currentChannelId();
        if (channelId) {
          voiceStore.updateParticipantState(channelId, participant.identity, { isMuted: false });
        }
      }
    });

    // Active speakers changed (for speaking indicators)
    this.room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      const channelId = voiceStore.currentChannelId();
      if (!channelId) return;

      const speakerIds = new Set(speakers.map(s => s.identity));
      
      // Update speaking state for all participants
      const participants = voiceStore.getParticipants(channelId);
      participants.forEach(p => {
        const isSpeaking = speakerIds.has(p.userId);
        if (p.isSpeaking !== isSpeaking) {
          voiceStore.updateParticipantState(channelId, p.userId, { isSpeaking });
        }
      });

      // Update local speaking state
      if (this.room?.localParticipant) {
        const localIsSpeaking = speakerIds.has(this.room.localParticipant.identity);
        voiceStore.setSpeaking(localIsSpeaking);
      }
    });

    // Connection state changed
    this.room.on(RoomEvent.ConnectionStateChanged, (state) => {
      console.log('[VoiceService] Connection state changed:', state);
      
      if (state === ConnectionState.Reconnecting) {
        voiceStore.setReconnecting();
      } else if (state === ConnectionState.Disconnected) {
        voiceStore.setDisconnected();
        this.cleanupAudioElements();
      }
    });

    // Disconnected
    this.room.on(RoomEvent.Disconnected, (reason) => {
      console.log('[VoiceService] Disconnected:', reason);
      voiceStore.setDisconnected();
      this.cleanupAudioElements();
    });
  }

  private attachAudioTrack(track: RemoteTrack, participant: RemoteParticipant): void {
    // Create audio element
    const audio = document.createElement('audio');
    audio.autoplay = true;
    
    // Apply deafen state
    if (voiceStore.isDeafened()) {
      audio.muted = true;
    }

    // Attach track to audio element
    track.attach(audio);

    // Add to container
    if (this.audioContainer) {
      this.audioContainer.appendChild(audio);
    } else {
      // Fallback to document body
      document.body.appendChild(audio);
    }

    // Store reference
    this.audioElements.set(participant.identity, audio);
    
    console.log('[VoiceService] Audio track attached for:', participant.identity);
  }

  private detachAudioTrack(participantIdentity: string): void {
    const audio = this.audioElements.get(participantIdentity);
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
      this.audioElements.delete(participantIdentity);
      console.log('[VoiceService] Audio track detached for:', participantIdentity);
    }
  }

  private cleanupAudioElements(): void {
    this.audioElements.forEach((audio, identity) => {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
    });
    this.audioElements.clear();
    console.log('[VoiceService] All audio elements cleaned up');
  }
}

// Create singleton instance
export const voiceService = new VoiceServiceClass();
