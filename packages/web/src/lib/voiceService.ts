import { Room, RoomEvent, Track, RemoteTrack, RemoteParticipant, ConnectionState, ConnectionQuality, TrackPublication, Track as TrackTypes } from 'livekit-client';
import { api } from '@/api';
import { voiceStore, type VoicePermissions, type VoiceParticipant, type ConnectionQualityLevel, type ScreenShareQuality, type ConnectionQualityState } from '@/stores/voice';
import { socketService } from './socket';
import { soundService } from './soundService';
import { SCREEN_SHARE_QUALITIES } from '@sgchat/shared';
import { streamViewerStore } from '@/stores/streamViewer';

interface JoinVoiceResponse {
  token: string;
  url: string;
  room_name?: string;
  channel_id?: string;
  is_temp_channel?: boolean;
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

const VOICE_CHANNEL_STORAGE_KEY = 'sgchat_voice_channel';
const USER_VOLUMES_STORAGE_KEY = 'sgchat_user_volumes';
const LOCAL_MUTES_STORAGE_KEY = 'sgchat_local_mutes';

interface StoredVoiceChannel {
  channelId: string;
  channelName: string;
  timestamp: number;
}

class VoiceServiceClass {
  private room: Room | null = null;
  private audioElements: Map<string, HTMLAudioElement> = new Map();
  private videoElements: Map<string, HTMLVideoElement> = new Map();
  private screenShareAudioTracks: Map<string, RemoteTrack> = new Map();
  private screenShareAudioElements: Map<string, HTMLAudioElement> = new Map();
  private localScreenShareVideoElement: HTMLVideoElement | null = null;
  private audioContainer: HTMLElement | null = null;
  private voiceSettings: VoiceSettings | null = null;
  private outputVolume: number = 100;
  private connectionQualityInterval: ReturnType<typeof setInterval> | null = null;
  private isAutoRejoining: boolean = false;
  private activityDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private activityListeners: Array<{ event: string; handler: () => void }> = [];
  private userVolumes: Map<string, number> = new Map();
  private localMutes: Set<string> = new Set();
  private _isServerMuted: boolean = false;
  private _isServerDeafened: boolean = false;

  /**
   * Set the container element for audio elements
   */
  setAudioContainer(container: HTMLElement) {
    this.audioContainer = container;
  }

  /**
   * Save current voice channel to localStorage for persistence across refresh
   */
  private saveVoiceChannel(channelId: string, channelName: string): void {
    try {
      const data: StoredVoiceChannel = {
        channelId,
        channelName,
        timestamp: Date.now(),
      };
      localStorage.setItem(VOICE_CHANNEL_STORAGE_KEY, JSON.stringify(data));
      console.log('[VoiceService] Saved voice channel to localStorage:', channelId);
    } catch (err) {
      console.warn('[VoiceService] Failed to save voice channel to localStorage:', err);
    }
  }

  /**
   * Clear stored voice channel from localStorage
   */
  private clearStoredVoiceChannel(): void {
    try {
      localStorage.removeItem(VOICE_CHANNEL_STORAGE_KEY);
      console.log('[VoiceService] Cleared voice channel from localStorage');
    } catch (err) {
      console.warn('[VoiceService] Failed to clear voice channel from localStorage:', err);
    }
  }

  /**
   * Get stored voice channel from localStorage
   * Returns null if expired (older than 1 hour) or not found
   */
  getStoredVoiceChannel(): StoredVoiceChannel | null {
    try {
      const stored = localStorage.getItem(VOICE_CHANNEL_STORAGE_KEY);
      if (!stored) return null;

      const data: StoredVoiceChannel = JSON.parse(stored);
      
      // Check if the stored channel is older than 1 hour (expired)
      const ONE_HOUR = 60 * 60 * 1000;
      if (Date.now() - data.timestamp > ONE_HOUR) {
        console.log('[VoiceService] Stored voice channel expired, clearing');
        this.clearStoredVoiceChannel();
        return null;
      }

      return data;
    } catch (err) {
      console.warn('[VoiceService] Failed to get stored voice channel:', err);
      return null;
    }
  }

  /**
   * Attempt to rejoin a previously connected voice channel after page refresh
   * First checks server state, then falls back to localStorage
   */
  async attemptAutoRejoin(): Promise<boolean> {
    if (voiceStore.isConnected() || voiceStore.isConnecting()) {
      console.log('[VoiceService] Already connected or connecting, skipping auto-rejoin');
      return false;
    }

    try {
      // First, check server-side state for the user's current voice channel
      const serverState = await api.get<{
        in_voice: boolean;
        channel_id: string | null;
        channel_name: string | null;
        voice_state: {
          is_muted: boolean;
          is_deafened: boolean;
          is_streaming: boolean;
        } | null;
      }>('/voice/me');

      if (serverState.in_voice && serverState.channel_id && serverState.channel_name) {
        console.log('[VoiceService] Server reports user in voice channel:', serverState.channel_id, serverState.channel_name);
        
        this.isAutoRejoining = true;
        try {
          await this.join(serverState.channel_id, serverState.channel_name);
          console.log('[VoiceService] Successfully auto-rejoined voice channel from server state');
          return true;
        } catch (err) {
          console.warn('[VoiceService] Failed to auto-rejoin from server state:', err);
        } finally {
          this.isAutoRejoining = false;
        }
      }
    } catch (err) {
      console.warn('[VoiceService] Failed to fetch server voice state:', err);
    }

    // Fallback to localStorage
    const stored = this.getStoredVoiceChannel();
    if (!stored) {
      console.log('[VoiceService] No stored voice channel to rejoin');
      return false;
    }

    try {
      this.isAutoRejoining = true;
      console.log('[VoiceService] Attempting to auto-rejoin voice channel from localStorage:', stored.channelId, stored.channelName);
      await this.join(stored.channelId, stored.channelName);
      console.log('[VoiceService] Successfully auto-rejoined voice channel from localStorage');
      return true;
    } catch (err) {
      console.warn('[VoiceService] Failed to auto-rejoin voice channel:', err);
      this.clearStoredVoiceChannel();
      return false;
    } finally {
      this.isAutoRejoining = false;
    }
  }

  /**
   * Check if currently auto-rejoining
   */
  isAutoRejoiningChannel(): boolean {
    return this.isAutoRejoining;
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
    // If already connected or connecting to a channel, leave first
    if (voiceStore.isConnected() || voiceStore.isConnecting()) {
      await this.leave();
    }

    try {
      // Set connecting state
      voiceStore.setConnecting(channelId, channelName);
      console.log('[VoiceService] Joining voice channel:', channelId, channelName);

      // 0. Load user's voice settings and per-user overrides
      const settings = await this.loadVoiceSettings();
      this.loadPerUserSettings();

      // 1. Get token from server (may redirect to temp channel)
      const response = await api.post<JoinVoiceResponse>(`/voice/join/${channelId}`, {});
      const { token, url, permissions, bitrate, user_limit, channel_id: actualChannelId, is_temp_channel } = response;
      
      // Use the actual channel ID returned by the server (may differ for temp_voice_generator)
      const targetChannelId = actualChannelId || channelId;
      const targetChannelName = is_temp_channel ? `${channelName} (Temp)` : channelName;
      
      if (targetChannelId !== channelId) {
        console.log('[VoiceService] Redirected to temp channel:', targetChannelId);
        // Update the connecting state with the actual channel ID
        voiceStore.setConnecting(targetChannelId, targetChannelName);
      }
      
      console.log('[VoiceService] Got token, connecting to LiveKit at:', url);
      console.log('[VoiceService] Channel bitrate:', bitrate || 64000, 'user_limit:', user_limit || 0);
      console.log('[VoiceService] Is temp channel:', is_temp_channel);

      // 2. Fetch current participants for the actual channel
      try {
        const participantsResponse = await api.get<VoiceParticipantResponse>(
          `/channels/${targetChannelId}/voice-participants`
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
          voiceStore.setChannelParticipants(targetChannelId, participants);
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
          audioPreset: { maxBitrate: channelBitrate },
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
        canDisconnectMembers: false,
        canDeafenMembers: false,
      };
      voiceStore.setConnected(voicePermissions);

      // 7. Enable microphone if we have speak permission and not muted
      if (voicePermissions.canSpeak && !voiceStore.isMuted()) {
        await this.room.localParticipant.setMicrophoneEnabled(true);
        console.log('[VoiceService] Microphone enabled');
      }

      // 8. Start connection quality monitoring
      this.startConnectionQualityMonitoring();

      // 9. Emit socket event to update mute/deafen state (join is already handled by API route)
      socketService.emit('voice:join', { 
        channel_id: targetChannelId,
        muted: voiceStore.isMuted(),
        deafened: voiceStore.isDeafened(),
      });

      // 10. Save to localStorage for persistence across refresh
      this.saveVoiceChannel(targetChannelId, targetChannelName);

      // 11. Start activity tracking for AFK prevention
      this.setupActivityTracking();

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

      // Stop connection quality monitoring
      this.stopConnectionQualityMonitoring();

      // Stop activity tracking
      this.teardownActivityTracking();

      // Stop screen share if active
      if (voiceStore.isScreenSharing()) {
        await this.stopScreenShare();
      }

      // Play leave sound before disconnecting
      this.playSound('leave');

      // Emit socket event before disconnecting
      if (channelId) {
        socketService.emit('voice:leave', { channel_id: channelId });
      }

      // Disconnect from LiveKit
      await this.room.disconnect();
      this.room = null;

      // Clean up audio and video elements
      this.cleanupAudioElements();
      this.cleanupVideoElements();

      // Update store
      voiceStore.setDisconnected();

      // Clear stored voice channel (user intentionally left)
      this.clearStoredVoiceChannel();
      
      console.log('[VoiceService] Disconnected from voice channel');
    } catch (err) {
      console.error('[VoiceService] Error leaving voice channel:', err);
      // Force disconnect state even on error
      this.room = null;
      this.stopConnectionQualityMonitoring();
      voiceStore.setDisconnected();
      this.clearStoredVoiceChannel();
    }
  }

  /**
   * Update output volume for all audio elements
   */
  setOutputVolume(volume: number): void {
    this.outputVolume = volume;
    this.audioElements.forEach((audio, userId) => {
      const userVol = this.userVolumes.get(userId) ?? 100;
      audio.volume = Math.min(1, (userVol / 100) * (volume / 100));
    });
  }

  /**
   * Set per-user volume (client-side only, 0-200%)
   */
  setUserVolume(userId: string, volume: number): void {
    this.userVolumes.set(userId, volume);
    const audio = this.audioElements.get(userId);
    if (audio) {
      audio.volume = Math.min(1, (volume / 100) * (this.outputVolume / 100));
    }
    this.persistUserVolumes();
  }

  getUserVolume(userId: string): number {
    return this.userVolumes.get(userId) ?? 100;
  }

  /**
   * Toggle local mute for a specific user (client-side only)
   */
  toggleLocalMute(userId: string): void {
    if (this.localMutes.has(userId)) {
      this.localMutes.delete(userId);
      const audio = this.audioElements.get(userId);
      if (audio) audio.muted = voiceStore.isDeafened();
    } else {
      this.localMutes.add(userId);
      const audio = this.audioElements.get(userId);
      if (audio) audio.muted = true;
    }
    this.persistLocalMutes();
  }

  isLocallyMuted(userId: string): boolean {
    return this.localMutes.has(userId);
  }

  private persistUserVolumes(): void {
    try {
      localStorage.setItem(USER_VOLUMES_STORAGE_KEY, JSON.stringify(Object.fromEntries(this.userVolumes)));
    } catch {}
  }

  private persistLocalMutes(): void {
    try {
      localStorage.setItem(LOCAL_MUTES_STORAGE_KEY, JSON.stringify([...this.localMutes]));
    } catch {}
  }

  private loadPerUserSettings(): void {
    try {
      const volumes = localStorage.getItem(USER_VOLUMES_STORAGE_KEY);
      if (volumes) this.userVolumes = new Map(Object.entries(JSON.parse(volumes)).map(([k, v]) => [k, Number(v)]));
      const mutes = localStorage.getItem(LOCAL_MUTES_STORAGE_KEY);
      if (mutes) this.localMutes = new Set(JSON.parse(mutes));
    } catch {}
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

    // Can't unmute while server-muted
    if (!muted && this._isServerMuted) return;

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

    // Can't undeafen while server-deafened
    if (!deafened && this._isServerDeafened) return;

    try {
      // When deafening, also mute and disable all audio
      if (deafened) {
        await this.room.localParticipant.setMicrophoneEnabled(false);
        // Mute all audio elements
        this.audioElements.forEach(audio => {
          audio.muted = true;
        });
      } else {
        // When undeafening, restore audio but keep locally muted users muted
        this.audioElements.forEach((audio, userId) => {
          audio.muted = this.localMutes.has(userId);
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
   * Move a member to a different voice channel (moderator action)
   */
  async moveMember(userId: string, fromChannelId: string, toChannelId: string): Promise<void> {
    await api.post('/voice/move-member', {
      user_id: userId,
      from_channel_id: fromChannelId,
      to_channel_id: toChannelId,
    });
  }

  /**
   * Disconnect a member from voice (moderator action)
   */
  async disconnectMember(userId: string, channelId: string): Promise<void> {
    await api.post('/voice/disconnect-member', {
      user_id: userId,
      channel_id: channelId,
    });
  }

  /**
   * Server mute a member (moderator action)
   */
  async serverMuteMember(userId: string, channelId: string, muted: boolean): Promise<void> {
    await api.post('/voice/server-mute', {
      user_id: userId,
      channel_id: channelId,
      muted,
    });
  }

  /**
   * Server deafen a member (moderator action)
   */
  async serverDeafenMember(userId: string, channelId: string, deafened: boolean): Promise<void> {
    await api.post('/voice/server-deafen', {
      user_id: userId,
      channel_id: channelId,
      deafened,
    });
  }

  /**
   * Set server-muted state (called when receiving server mute event)
   */
  setServerMuted(muted: boolean): void {
    this._isServerMuted = muted;
    if (muted) {
      this.setMuted(true);
    }
  }

  /**
   * Set server-deafened state (called when receiving server deafen event)
   */
  setServerDeafened(deafened: boolean): void {
    this._isServerDeafened = deafened;
    if (deafened) {
      this.setDeafened(true);
    }
  }

  get isServerMuted(): boolean {
    return this._isServerMuted;
  }

  get isServerDeafened(): boolean {
    return this._isServerDeafened;
  }

  /**
   * Send activity ping to server (debounced to max once per 60s)
   */
  private sendActivityPing(): void {
    if (this.activityDebounceTimer) return; // Already debounced
    socketService.emit('voice:activity', {});
    this.activityDebounceTimer = setTimeout(() => {
      this.activityDebounceTimer = null;
    }, 60_000);
  }

  /**
   * Set up UI interaction listeners that send activity pings to prevent AFK
   */
  private setupActivityTracking(): void {
    this.teardownActivityTracking();

    const handler = () => this.sendActivityPing();

    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
    for (const event of events) {
      document.addEventListener(event, handler, { passive: true });
      this.activityListeners.push({ event, handler });
    }
  }

  /**
   * Remove activity tracking listeners
   */
  private teardownActivityTracking(): void {
    for (const { event, handler } of this.activityListeners) {
      document.removeEventListener(event, handler);
    }
    this.activityListeners = [];

    if (this.activityDebounceTimer) {
      clearTimeout(this.activityDebounceTimer);
      this.activityDebounceTimer = null;
    }
  }

  /**
   * Start screen sharing
   */
  async startScreenShare(quality: ScreenShareQuality = 'standard'): Promise<void> {
    if (!this.room) {
      console.warn('[VoiceService] Cannot start screen share: not connected');
      return;
    }

    // Check permission
    const permissions = voiceStore.permissions();
    if (!permissions?.canStream) {
      console.warn('[VoiceService] Cannot start screen share: no STREAM permission');
      voiceStore.setError('You do not have permission to share your screen');
      return;
    }

    try {
      const qualityConfig = SCREEN_SHARE_QUALITIES[quality.toUpperCase() as keyof typeof SCREEN_SHARE_QUALITIES];
      
      await this.room.localParticipant.setScreenShareEnabled(true, {
        audio: true,
        resolution: quality === 'native' ? undefined : {
          width: qualityConfig.width,
          height: qualityConfig.height,
          frameRate: qualityConfig.fps,
        },
      }, {
        screenShareEncoding: {
          maxBitrate: qualityConfig.bitrate,
          maxFramerate: qualityConfig.fps,
        },
      });

      voiceStore.setScreenSharing(true);
      voiceStore.setScreenShareQuality(quality);
      console.log('[VoiceService] Screen share started with quality:', quality);

      // Create local video element for host preview
      this.createLocalScreenSharePreview();

      // Notify server and update local participant state
      const channelId = voiceStore.currentChannelId();
      if (channelId) {
        // Update local participant's isStreaming state immediately
        const userId = this.room?.localParticipant.identity;
        if (userId) {
          voiceStore.updateParticipantState(channelId, userId, { isStreaming: true });
        }
        
        socketService.emit('voice:update', {
          muted: voiceStore.isMuted(),
          deafened: voiceStore.isDeafened(),
          screen_sharing: true,
        });
      }
    } catch (err: any) {
      console.error('[VoiceService] Failed to start screen share:', err);
      if (err.name === 'NotAllowedError') {
        voiceStore.setError('Screen sharing was cancelled');
      } else {
        voiceStore.setError(err?.message || 'Failed to start screen share');
      }
    }
  }

  /**
   * Stop screen sharing
   */
  async stopScreenShare(): Promise<void> {
    if (!this.room) return;

    try {
      await this.room.localParticipant.setScreenShareEnabled(false);
      voiceStore.setScreenSharing(false);
      console.log('[VoiceService] Screen share stopped');

      // Clean up local preview
      this.cleanupLocalScreenSharePreview();

      // Notify server and update local participant state
      const channelId = voiceStore.currentChannelId();
      if (channelId) {
        // Update local participant's isStreaming state immediately
        const userId = this.room?.localParticipant.identity;
        if (userId) {
          voiceStore.updateParticipantState(channelId, userId, { isStreaming: false });
        }
        
        socketService.emit('voice:update', {
          muted: voiceStore.isMuted(),
          deafened: voiceStore.isDeafened(),
          screen_sharing: false,
        });
      }
    } catch (err) {
      console.error('[VoiceService] Failed to stop screen share:', err);
    }
  }

  /**
   * Create local video element for host to preview their own screen share
   */
  private createLocalScreenSharePreview(): void {
    if (!this.room) return;

    // Find the local screen share track
    const screenShareTrack = this.room.localParticipant.getTrackPublication(TrackTypes.Source.ScreenShare);
    if (!screenShareTrack?.track) {
      console.log('[VoiceService] No local screen share track found for preview');
      return;
    }

    // Create video element
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true; // Mute to avoid audio feedback
    
    // Attach the track
    screenShareTrack.track.attach(video);
    
    this.localScreenShareVideoElement = video;
    console.log('[VoiceService] Local screen share preview created');

    // If the host is watching their own stream, update the StreamViewer
    const userId = this.room.localParticipant.identity;
    if (streamViewerStore.isWatchingStreamer(userId)) {
      streamViewerStore.setVideoElement(video);
    }
  }

  /**
   * Clean up local screen share preview
   */
  private cleanupLocalScreenSharePreview(): void {
    if (this.localScreenShareVideoElement) {
      this.localScreenShareVideoElement.pause();
      this.localScreenShareVideoElement.srcObject = null;
      this.localScreenShareVideoElement.remove();
      this.localScreenShareVideoElement = null;
      console.log('[VoiceService] Local screen share preview cleaned up');
    }
  }

  /**
   * Get local screen share video element for host preview
   */
  getLocalScreenShareVideo(): HTMLVideoElement | null {
    return this.localScreenShareVideoElement;
  }

  /**
   * Check if current user is the streamer
   */
  isLocalUserStreamer(streamerId: string): boolean {
    if (!this.room) return false;
    return this.room.localParticipant.identity === streamerId;
  }

  /**
   * Toggle screen sharing
   */
  async toggleScreenShare(quality?: ScreenShareQuality): Promise<void> {
    if (voiceStore.isScreenSharing()) {
      await this.stopScreenShare();
    } else {
      await this.startScreenShare(quality || voiceStore.screenShareQuality());
    }
  }

  /**
   * Update screen share quality while sharing
   */
  async updateScreenShareQuality(quality: ScreenShareQuality): Promise<void> {
    voiceStore.setScreenShareQuality(quality);
    
    if (voiceStore.isScreenSharing()) {
      // Restart with new quality
      await this.stopScreenShare();
      await this.startScreenShare(quality);
    }
  }

  /**
   * Get current connection quality metrics
   */
  getConnectionQuality(): ConnectionQualityState {
    return voiceStore.connectionQuality();
  }

  /**
   * Start monitoring connection quality
   */
  private startConnectionQualityMonitoring(): void {
    if (this.connectionQualityInterval) {
      clearInterval(this.connectionQualityInterval);
    }

    this.connectionQualityInterval = setInterval(() => {
      this.updateConnectionQuality();
    }, 2000);

    // Initial update
    this.updateConnectionQuality();
  }

  /**
   * Stop monitoring connection quality
   */
  private stopConnectionQualityMonitoring(): void {
    if (this.connectionQualityInterval) {
      clearInterval(this.connectionQualityInterval);
      this.connectionQualityInterval = null;
    }
  }

  /**
   * Update connection quality from LiveKit stats
   */
  private async updateConnectionQuality(): Promise<void> {
    if (!this.room?.localParticipant) return;

    const quality = this.room.localParticipant.connectionQuality;
    const level = this.mapConnectionQuality(quality);

    // Get RTT/ping from room engine if available
    let ping: number | null = null;
    let jitter: number | null = null;
    let packetLoss: number | null = null;

    try {
      // Access the engine's publisher stats for detailed metrics
      const engine = (this.room as any).engine;
      if (engine?.client?.rtt) {
        ping = Math.round(engine.client.rtt);
      }
    } catch {
      // Stats not available
    }

    voiceStore.setConnectionQuality({
      level,
      ping,
      jitter,
      packetLoss,
    });
  }

  /**
   * Map LiveKit ConnectionQuality to our level
   */
  private mapConnectionQuality(quality: ConnectionQuality): ConnectionQualityLevel {
    switch (quality) {
      case ConnectionQuality.Excellent:
        return 'excellent';
      case ConnectionQuality.Good:
        return 'good';
      case ConnectionQuality.Poor:
        return 'poor';
      case ConnectionQuality.Lost:
        return 'lost';
      default:
        return 'unknown';
    }
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

    // Track subscribed - attach audio or video
    this.room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      console.log('[VoiceService] Track subscribed:', track.kind, 'source:', publication.source, 'from', participant.identity);
      
      if (track.kind === Track.Kind.Audio) {
        // Check if this is screen share audio - store separately, don't auto-attach
        if (publication.source === TrackTypes.Source.ScreenShareAudio) {
          console.log('[VoiceService] Screen share audio track from:', participant.identity, '- storing for stream viewer');
          this.screenShareAudioTracks.set(participant.identity, track as RemoteTrack);
          // If already watching this streamer, notify the StreamViewer to attach audio
          if (streamViewerStore.isWatchingStreamer(participant.identity)) {
            console.log('[VoiceService] Already watching this streamer, notifying StreamViewer to attach audio');
            streamViewerStore.notifyAudioAvailable();
          }
        } else {
          // Regular microphone audio - attach normally
          this.attachAudioTrack(track as RemoteTrack, participant);
        }
      } else if (track.kind === Track.Kind.Video) {
        console.log('[VoiceService] Video track subscribed from:', participant.identity, 'source:', publication.source);
        this.attachVideoTrack(track as RemoteTrack, participant, publication);
      }
    });

    // Track unsubscribed - detach audio or video
    this.room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
      console.log('[VoiceService] Track unsubscribed:', track.kind, 'source:', publication.source, 'from', participant.identity);
      
      if (track.kind === Track.Kind.Audio) {
        // Check if this is screen share audio
        if (publication.source === TrackTypes.Source.ScreenShareAudio) {
          console.log('[VoiceService] Screen share audio track unsubscribed from:', participant.identity);
          this.detachScreenShareAudio(participant.identity);
        } else {
          this.detachAudioTrack(participant.identity);
        }
      } else if (track.kind === Track.Kind.Video) {
        console.log('[VoiceService] Video track unsubscribed from:', participant.identity);
        this.detachVideoTrack(participant.identity);
      }
    });

    // Track published - detect when someone starts screen sharing
    this.room.on(RoomEvent.TrackPublished, (publication, participant) => {
      console.log('[VoiceService] Track published:', publication.kind, 'source:', publication.source, 'from', participant.identity);
      
      // Check if this is a screen share track
      if (publication.source === TrackTypes.Source.ScreenShare) {
        console.log('[VoiceService] Screen share started by:', participant.identity);
        const channelId = voiceStore.currentChannelId();
        if (channelId) {
          voiceStore.updateParticipantState(channelId, participant.identity, { isStreaming: true });
        }
      }
    });

    // Track unpublished - detect when someone stops screen sharing
    this.room.on(RoomEvent.TrackUnpublished, (publication, participant) => {
      console.log('[VoiceService] Track unpublished:', publication.kind, 'source:', publication.source, 'from', participant.identity);
      
      // Check if this is a screen share track
      if (publication.source === TrackTypes.Source.ScreenShare) {
        console.log('[VoiceService] Screen share stopped by:', participant.identity);
        const channelId = voiceStore.currentChannelId();
        if (channelId) {
          voiceStore.updateParticipantState(channelId, participant.identity, { isStreaming: false });
        }
        
        // If we were watching this streamer, close the stream viewer
        if (streamViewerStore.isWatchingStreamer(participant.identity)) {
          console.log('[VoiceService] Closing stream viewer - streamer stopped sharing');
          streamViewerStore.leaveStream();
        }
        
        // Clean up video element
        this.detachVideoTrack(participant.identity);
      }
    });

    // Local track unpublished - detect when we stop screen sharing (e.g., browser share dialog closed)
    this.room.on(RoomEvent.LocalTrackUnpublished, (publication) => {
      console.log('[VoiceService] Local track unpublished:', publication.kind, 'source:', publication.source);
      
      if (publication.source === TrackTypes.Source.ScreenShare) {
        console.log('[VoiceService] Local screen share stopped (browser dialog closed or track ended)');
        
        // Update local screen sharing state
        if (voiceStore.isScreenSharing()) {
          voiceStore.setScreenSharing(false);
          
          // Notify server that screen sharing stopped
          const channelId = voiceStore.currentChannelId();
          if (channelId) {
            // Update local participant's isStreaming state immediately
            const userId = this.room?.localParticipant.identity;
            if (userId) {
              voiceStore.updateParticipantState(channelId, userId, { isStreaming: false });
            }
            
            socketService.emit('voice:update', {
              muted: voiceStore.isMuted(),
              deafened: voiceStore.isDeafened(),
              screen_sharing: false,
            });
          }
        }
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
    this.room.on(RoomEvent.TrackMuted, (_publication, participant) => {
      console.log('[VoiceService] Participant muted:', participant.identity);
      const channelId = voiceStore.currentChannelId();
      if (channelId) {
        voiceStore.updateParticipantState(channelId, participant.identity, { isMuted: true });
      }
    });

    // Track unmuted
    this.room.on(RoomEvent.TrackUnmuted, (_publication, participant) => {
      console.log('[VoiceService] Participant unmuted:', participant.identity);
      const channelId = voiceStore.currentChannelId();
      if (channelId) {
        voiceStore.updateParticipantState(channelId, participant.identity, { isMuted: false });
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

        // Speaking counts as activity for AFK prevention
        if (localIsSpeaking) {
          this.sendActivityPing();
        }
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
        this.cleanupVideoElements();
      }
    });

    // Disconnected
    this.room.on(RoomEvent.Disconnected, (reason) => {
      console.log('[VoiceService] Disconnected:', reason);
      voiceStore.setDisconnected();
      this.cleanupAudioElements();
      this.cleanupVideoElements();
    });
  }

  private attachAudioTrack(track: RemoteTrack, participant: RemoteParticipant): void {
    // Create audio element
    const audio = document.createElement('audio');
    audio.autoplay = true;

    // Apply per-user volume (or global default)
    const userVol = this.userVolumes.get(participant.identity) ?? 100;
    audio.volume = Math.min(1, (userVol / 100) * (this.outputVolume / 100));

    // Apply deafen state or local mute
    if (voiceStore.isDeafened() || this.localMutes.has(participant.identity)) {
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

  private attachVideoTrack(track: RemoteTrack, participant: RemoteParticipant, publication: TrackPublication): void {
    const streamerId = participant.identity;
    console.log('[VoiceService] Attaching video track for streamer:', streamerId, 'source:', publication.source);
    
    // Create video element
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = false;
    
    // Attach track to video element
    track.attach(video);
    
    // Store reference
    this.videoElements.set(streamerId, video);
    
    // If we're watching this streamer, update the stream viewer store
    if (streamViewerStore.isWatchingStreamer(streamerId)) {
      console.log('[VoiceService] Updating stream viewer with video element for:', streamerId);
      streamViewerStore.setVideoElement(video);
    }
    
    console.log('[VoiceService] Video track attached for:', streamerId);
  }

  private detachVideoTrack(participantIdentity: string): void {
    const video = this.videoElements.get(participantIdentity);
    if (video) {
      video.pause();
      video.srcObject = null;
      video.remove();
      this.videoElements.delete(participantIdentity);
      console.log('[VoiceService] Video track detached for:', participantIdentity);
    }
    
    // If we were watching this streamer, clear the video element
    if (streamViewerStore.isWatchingStreamer(participantIdentity)) {
      console.log('[VoiceService] Clearing stream viewer video element for:', participantIdentity);
      streamViewerStore.setVideoElement(null);
    }
  }

  /**
   * Get video element for a specific streamer (used when clicking LIVE button)
   */
  getVideoElementForStreamer(streamerId: string): HTMLVideoElement | null {
    return this.videoElements.get(streamerId) || null;
  }

  /**
   * Get screen share audio track for a specific streamer
   */
  getScreenShareAudioTrack(streamerId: string): RemoteTrack | null {
    return this.screenShareAudioTracks.get(streamerId) || null;
  }

  /**
   * Attach screen share audio for a streamer (called by StreamViewer)
   */
  attachScreenShareAudio(streamerId: string, volume: number = 100, muted: boolean = false): HTMLAudioElement | null {
    const track = this.screenShareAudioTracks.get(streamerId);
    if (!track) {
      console.log('[VoiceService] No screen share audio track for:', streamerId);
      return null;
    }

    // Check if already attached
    let audio = this.screenShareAudioElements.get(streamerId);
    if (audio) {
      // Update volume/muted state
      audio.volume = volume / 100;
      audio.muted = muted;
      return audio;
    }

    // Create new audio element
    audio = document.createElement('audio');
    audio.autoplay = true;
    audio.volume = volume / 100;
    audio.muted = muted;

    // Attach track to audio element
    track.attach(audio);

    // Store reference
    this.screenShareAudioElements.set(streamerId, audio);

    console.log('[VoiceService] Screen share audio attached for:', streamerId);
    return audio;
  }

  /**
   * Update screen share audio volume/mute state
   */
  updateScreenShareAudio(streamerId: string, volume: number, muted: boolean): void {
    const audio = this.screenShareAudioElements.get(streamerId);
    if (audio) {
      audio.volume = volume / 100;
      audio.muted = muted;
    }
  }

  /**
   * Detach screen share audio for a streamer (called when leaving stream viewer)
   */
  detachScreenShareAudio(streamerId: string): void {
    const audio = this.screenShareAudioElements.get(streamerId);
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
      this.screenShareAudioElements.delete(streamerId);
      console.log('[VoiceService] Screen share audio detached for:', streamerId);
    }
    // Also remove the track reference if it exists
    this.screenShareAudioTracks.delete(streamerId);
  }

  /**
   * Check if screen share audio is available for a streamer
   */
  hasScreenShareAudio(streamerId: string): boolean {
    return this.screenShareAudioTracks.has(streamerId);
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
    this.audioElements.forEach((audio) => {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
    });
    this.audioElements.clear();
    
    // Also cleanup screen share audio
    this.screenShareAudioElements.forEach((audio) => {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
    });
    this.screenShareAudioElements.clear();
    this.screenShareAudioTracks.clear();
    console.log('[VoiceService] All audio elements cleaned up');
  }

  private cleanupVideoElements(): void {
    this.videoElements.forEach((video) => {
      video.pause();
      video.srcObject = null;
      video.remove();
    });
    this.videoElements.clear();
    
    // Clear stream viewer if watching any stream
    if (streamViewerStore.isWatchingStream()) {
      streamViewerStore.setVideoElement(null);
    }
    console.log('[VoiceService] All video elements cleaned up');
  }
}

// Create singleton instance
export const voiceService = new VoiceServiceClass();
