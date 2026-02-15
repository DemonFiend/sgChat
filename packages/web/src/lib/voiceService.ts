import { Room, RoomEvent, Track, RemoteTrack, RemoteParticipant, LocalParticipant, ConnectionState } from 'livekit-client';
import { api } from '@/api';
import { voiceStore, type VoicePermissions, type VoiceParticipant } from '@/stores/voice';
import { socketService } from './socket';
import { soundService } from './soundService';

interface JoinVoiceResponse {
  token: string;
  url: string;
  room_name?: string;
  bitrate?: number;
  user_limit?: number;
  permissions?: {
    canSpeak: boolean;
    canVideo: boolean;
    canStream: boolean;
    canMuteMembers: boolean;
    canMoveMembers: boolean;
    canDisconnectMembers: boolean;
    canDeafenMembers: boolean;
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

interface VoiceSettings {
  audio_input_device_id: string | null;
  audio_output_device_id: string | null;
  audio_input_volume: number;
  audio_output_volume: number;
  audio_input_sensitivity: number;
  audio_auto_gain_control: boolean;
  audio_echo_cancellation: boolean;
  audio_noise_suppression: boolean;
  voice_activity_detection: boolean;
  enable_voice_join_sounds: boolean;
}

class VoiceServiceClass {
  private room: Room | null = null;
  private audioElements: Map<string, HTMLAudioElement> = new Map();
  private audioContainer: HTMLElement | null = null;
  private voiceSettings: VoiceSettings | null = null;
  private outputVolume: number = 100;

  /**
   * Set the container element for audio elements
   */
  setAudioContainer(container: HTMLElement) {
    this.audioContainer = container;
  }

  /**
   * Fetch user's voice settings from the server
   */
  private async loadVoiceSettings(): Promise<VoiceSettings> {
    try {
      const settings = await api.get<any>('/users/me/settings');
      this.voiceSettings = {
        audio_input_device_id: settings?.audio_input_device_id || null,
        audio_output_device_id: settings?.audio_output_device_id || null,
        audio_input_volume: settings?.audio_input_volume ?? 100,
        audio_output_volume: settings?.audio_output_volume ?? 100,
        audio_input_sensitivity: settings?.audio_input_sensitivity ?? 50,
        audio_auto_gain_control: settings?.audio_auto_gain_control ?? true,
        audio_echo_cancellation: settings?.audio_echo_cancellation ?? true,
        audio_noise_suppression: settings?.audio_noise_suppression ?? true,
        voice_activity_detection: settings?.voice_activity_detection ?? true,
        enable_voice_join_sounds: settings?.enable_voice_join_sounds ?? true,
      };
      this.outputVolume = this.voiceSettings.audio_output_volume;
      return this.voiceSettings;
    } catch (err) {
      console.warn('[VoiceService] Could not load voice settings:', err);
      // Return defaults
      return {
        audio_input_device_id: null,
        audio_output_device_id: null,
        audio_input_volume: 100,
        audio_output_volume: 100,
        audio_input_sensitivity: 50,
        audio_auto_gain_control: true,
        audio_echo_cancellation: true,
        audio_noise_suppression: true,
        voice_activity_detection: true,
        enable_voice_join_sounds: true,
      };
    }
  }

  /**
   * Play a sound effect (if enabled)
   */
  private playSound(type: 'join' | 'leave'): void {
    if (type === 'join') {
      soundService.playVoiceJoin();
    } else {
      soundService.playVoiceLeave();
    }
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

      // 0. Load user's voice settings
      const settings = await this.loadVoiceSettings();

      // 1. Get token from server
      const response = await api.post<JoinVoiceResponse>(`/voice/join/${channelId}`, {});
      const { token, url, permissions, bitrate, user_limit } = response;
      
      console.log('[VoiceService] Got token, connecting to LiveKit at:', url);
      console.log('[VoiceService] Channel bitrate:', bitrate || 64000, 'user_limit:', user_limit || 0);

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

      // 3. Create and configure Room with user's audio settings
      const channelBitrate = bitrate || 64000;
      this.room = new Room({
        adaptiveStream: true,
        dynacast: true,
        // Audio settings - apply user's preferences
        audioCaptureDefaults: {
          deviceId: settings.audio_input_device_id || undefined,
          autoGainControl: settings.audio_auto_gain_control,
          echoCancellation: settings.audio_echo_cancellation,
          noiseSuppression: settings.audio_noise_suppression,
        },
        publishDefaults: {
          audioBitrate: channelBitrate,
          dtx: true, // Discontinuous Transmission - saves bandwidth when not speaking
          red: true, // Redundant encoding for packet loss resilience
        },
      });

      // Play join sound
      this.playSound('join');

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

      // Play leave sound before disconnecting
      this.playSound('leave');

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
   * Update output volume for all audio elements
   */
  setOutputVolume(volume: number): void {
    this.outputVolume = volume;
    this.audioElements.forEach(audio => {
      audio.volume = volume / 100;
    });
  }

  /**
   * Reload voice settings (call after settings change)
   */
  async reloadSettings(): Promise<void> {
    await this.loadVoiceSettings();
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
      
      // Notify server (server listens for 'voice:update')
      const channelId = voiceStore.currentChannelId();
      if (channelId) {
        socketService.emit('voice:update', {
          muted,
          deafened: voiceStore.isDeafened(),
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
      
      // Notify server (server listens for 'voice:update')
      const channelId = voiceStore.currentChannelId();
      if (channelId) {
        socketService.emit('voice:update', {
          muted: voiceStore.isMuted(),
          deafened,
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
    
    // Apply output volume from settings
    audio.volume = this.outputVolume / 100;
    
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
