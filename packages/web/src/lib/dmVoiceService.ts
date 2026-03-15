import { Room, RoomEvent, Track, RemoteTrack, RemoteParticipant, ConnectionState, ConnectionQuality, RemoteTrackPublication } from 'livekit-client';
import { api } from '@/api';
import { voiceStore, type VoicePermissions, type ConnectionQualityLevel, type ScreenShareQuality } from '@/stores/voice';
import { socketService } from './socket';
import { soundService } from './soundService';

interface JoinDMVoiceResponse {
  token: string;
  url: string;
  room_name: string;
  dm_channel_id: string;
  permissions: {
    canSpeak: boolean;
    canVideo: boolean;
    canStream: boolean;
  };
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

class DMVoiceServiceClass {
  private room: Room | null = null;
  private audioElements: Map<string, HTMLAudioElement> = new Map();
  private videoElements: Map<string, HTMLVideoElement> = new Map();
  private screenShareElements: Map<string, HTMLVideoElement> = new Map();
  private audioContainer: HTMLElement | null = null;
  private voiceSettings: VoiceSettings | null = null;
  private outputVolume: number = 100;
  private connectionQualityInterval: ReturnType<typeof setInterval> | null = null;
  private currentDMChannelId: string | null = null;
  private remoteParticipantJoined = false;
  private notifyingTimerId: ReturnType<typeof setTimeout> | null = null;
  private autoKickTimerId: ReturnType<typeof setTimeout> | null = null;
  private autoLeaveAfterRemoteLeftTimerId: ReturnType<typeof setTimeout> | null = null;

  setAudioContainer(container: HTMLElement) {
    this.audioContainer = container;
  }

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
      console.warn('[DMVoiceService] Could not load voice settings:', err);
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

  private playSound(type: 'join' | 'leave'): void {
    if (type === 'join') {
      soundService.playVoiceJoin();
    } else {
      soundService.playVoiceLeave();
    }
  }

  async join(dmChannelId: string, friendName: string, isCallee: boolean = false): Promise<void> {
    if (voiceStore.isConnected()) {
      await this.leave();
    }

    try {
      voiceStore.setConnecting(dmChannelId, `Call with ${friendName}`);
      console.log('[DMVoiceService] Joining DM voice call:', dmChannelId, isCallee ? '(callee)' : '(caller)');

      const settings = await this.loadVoiceSettings();

      const response = await api.post<JoinDMVoiceResponse>(`/dms/${dmChannelId}/voice/join`, {});
      const { token, url, permissions } = response;

      console.log('[DMVoiceService] Got token, connecting to LiveKit at:', url);

      this.room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {
          deviceId: settings.audio_input_device_id || undefined,
          autoGainControl: settings.audio_auto_gain_control,
          echoCancellation: settings.audio_echo_cancellation,
          noiseSuppression: settings.audio_noise_suppression,
        },
        publishDefaults: {
          audioPreset: { maxBitrate: 64000 },
          dtx: true,
          red: true,
        },
      });

      // Initialize call phase tracking BEFORE connect to avoid race condition
      // (ParticipantConnected fires during connect() for existing participants)
      this.remoteParticipantJoined = false;
      this.clearCallTimers();
      if (!isCallee) {
        voiceStore.setDMCallPhase('notifying');
      }

      this.playSound('join');
      this.setupRoomEventListeners();
      await this.room.connect(url, token);

      console.log('[DMVoiceService] Connected to LiveKit room');

      // Check for existing participants (handles case where ParticipantConnected
      // fired during connect but was overridden, or didn't fire at all)
      if (this.room.remoteParticipants.size > 0) {
        this.remoteParticipantJoined = true;
        this.clearCallTimers();
        voiceStore.setDMCallPhase('connected');
      }

      this.currentDMChannelId = dmChannelId;

      const voicePermissions: VoicePermissions = {
        canSpeak: permissions.canSpeak,
        canVideo: permissions.canVideo,
        canStream: permissions.canStream,
        canMuteMembers: false,
        canMoveMembers: false,
        canDisconnectMembers: false,
        canDeafenMembers: false,
      };
      voiceStore.setConnected(voicePermissions);

      // Start caller timers only if we're the caller and nobody has joined yet
      if (!isCallee && !this.remoteParticipantJoined) {
        // After 30s, switch from "Notifying..." to "Waiting..."
        this.notifyingTimerId = setTimeout(() => {
          if (!this.remoteParticipantJoined) {
            voiceStore.setDMCallPhase('waiting');
          }
        }, 30_000);

        // After 5min, auto-leave if nobody joined
        this.autoKickTimerId = setTimeout(() => {
          if (!this.remoteParticipantJoined) {
            console.log('[DMVoiceService] Auto-leaving: no one joined after 5 minutes');
            this.leave();
          }
        }, 300_000);
      }

      if (!voiceStore.isMuted()) {
        await this.room.localParticipant.setMicrophoneEnabled(true);
        console.log('[DMVoiceService] Microphone enabled');
      }

      this.startConnectionQualityMonitoring();

      socketService.emit('dm:voice:join', { dm_channel_id: dmChannelId });
    } catch (err: any) {
      console.error('[DMVoiceService] Failed to join DM voice call:', err);
      voiceStore.setError(err?.message || 'Failed to join voice call');
      throw err;
    }
  }

  async leave(): Promise<void> {
    const dmChannelId = this.currentDMChannelId;

    if (!this.room) {
      voiceStore.setDisconnected();
      return;
    }

    try {
      console.log('[DMVoiceService] Leaving DM voice call:', dmChannelId);

      this.stopConnectionQualityMonitoring();
      this.clearCallTimers();
      this.remoteParticipantJoined = false;

      if (voiceStore.isScreenSharing()) {
        await this.stopScreenShare();
      }

      this.playSound('leave');

      if (dmChannelId) {
        socketService.emit('dm:voice:leave', { dm_channel_id: dmChannelId });
        try {
          await api.post(`/dms/${dmChannelId}/voice/leave`, {});
        } catch (err) {
          console.warn('[DMVoiceService] Failed to notify server of leave:', err);
        }
      }

      await this.room.disconnect();
      this.room = null;
      this.currentDMChannelId = null;

      this.cleanupAudioElements();
      voiceStore.setDisconnected();

      console.log('[DMVoiceService] Disconnected from DM voice call');
    } catch (err) {
      console.error('[DMVoiceService] Error leaving DM voice call:', err);
      this.room = null;
      this.currentDMChannelId = null;
      this.stopConnectionQualityMonitoring();
      this.clearCallTimers();
      this.remoteParticipantJoined = false;
      voiceStore.setDisconnected();
    }
  }

  async toggleMute(): Promise<void> {
    const currentMuted = voiceStore.isMuted();
    await this.setMuted(!currentMuted);
  }

  async setMuted(muted: boolean): Promise<void> {
    if (!this.room) return;

    try {
      await this.room.localParticipant.setMicrophoneEnabled(!muted);
      voiceStore.setMuted(muted);
      console.log('[DMVoiceService] Mute state:', muted);
    } catch (err) {
      console.error('[DMVoiceService] Failed to toggle mute:', err);
    }
  }

  async toggleVideo(): Promise<void> {
    const currentVideoOn = voiceStore.isVideoOn();
    await this.setVideoOn(!currentVideoOn);
  }

  async setVideoOn(enabled: boolean): Promise<void> {
    if (!this.room) return;

    try {
      await this.room.localParticipant.setCameraEnabled(enabled);
      voiceStore.setVideoOn(enabled);
      console.log('[DMVoiceService] Video state:', enabled);
    } catch (err) {
      console.error('[DMVoiceService] Failed to toggle video:', err);
    }
  }

  async toggleDeafen(): Promise<void> {
    const currentDeafened = voiceStore.isDeafened();
    await this.setDeafened(!currentDeafened);
  }

  async setDeafened(deafened: boolean): Promise<void> {
    if (!this.room) return;

    try {
      if (deafened) {
        await this.room.localParticipant.setMicrophoneEnabled(false);
        this.audioElements.forEach(audio => {
          audio.muted = true;
        });
      } else {
        this.audioElements.forEach(audio => {
          audio.muted = false;
        });
        if (!voiceStore.isMuted()) {
          await this.room.localParticipant.setMicrophoneEnabled(true);
        }
      }

      voiceStore.setDeafened(deafened);
      console.log('[DMVoiceService] Deafen state:', deafened);
    } catch (err) {
      console.error('[DMVoiceService] Failed to toggle deafen:', err);
    }
  }

  async startScreenShare(quality: ScreenShareQuality = 'standard'): Promise<void> {
    if (!this.room) {
      console.warn('[DMVoiceService] Cannot start screen share: not connected');
      return;
    }

    // Quality presets
    const qualityPresets = {
      standard: { width: 1280, height: 720, fps: 30, bitrate: 2_500_000 },
      high: { width: 1920, height: 1080, fps: 60, bitrate: 6_000_000 },
      native: { width: 0, height: 0, fps: 30, bitrate: 8_000_000 },
    };

    try {
      const qualityConfig = qualityPresets[quality];

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
      console.log('[DMVoiceService] Screen share started with quality:', quality);
    } catch (err: any) {
      console.error('[DMVoiceService] Failed to start screen share:', err);
      if (err.name === 'NotAllowedError') {
        voiceStore.setError('Screen sharing was cancelled');
      } else {
        voiceStore.setError(err?.message || 'Failed to start screen share');
      }
    }
  }

  async stopScreenShare(): Promise<void> {
    if (!this.room) return;

    try {
      await this.room.localParticipant.setScreenShareEnabled(false);
      voiceStore.setScreenSharing(false);
      console.log('[DMVoiceService] Screen share stopped');
    } catch (err) {
      console.error('[DMVoiceService] Failed to stop screen share:', err);
    }
  }

  async toggleScreenShare(quality?: ScreenShareQuality): Promise<void> {
    if (voiceStore.isScreenSharing()) {
      await this.stopScreenShare();
    } else {
      await this.startScreenShare(quality || voiceStore.screenShareQuality());
    }
  }

  getRoom(): Room | null {
    return this.room;
  }

  isInDMCall(dmChannelId: string): boolean {
    return voiceStore.isConnected() && this.currentDMChannelId === dmChannelId;
  }

  private clearCallTimers(): void {
    if (this.notifyingTimerId) {
      clearTimeout(this.notifyingTimerId);
      this.notifyingTimerId = null;
    }
    if (this.autoKickTimerId) {
      clearTimeout(this.autoKickTimerId);
      this.autoKickTimerId = null;
    }
    if (this.autoLeaveAfterRemoteLeftTimerId) {
      clearTimeout(this.autoLeaveAfterRemoteLeftTimerId);
      this.autoLeaveAfterRemoteLeftTimerId = null;
    }
  }

  private setupRoomEventListeners(): void {
    if (!this.room) return;

    this.room.on(RoomEvent.TrackSubscribed, (track, publication: RemoteTrackPublication, participant) => {
      console.log('[DMVoiceService] Track subscribed:', track.kind, track.source, 'from', participant.identity);

      if (track.kind === Track.Kind.Audio) {
        this.attachAudioTrack(track as RemoteTrack, participant);
      } else if (track.kind === Track.Kind.Video) {
        if (track.source === Track.Source.ScreenShare) {
          this.attachScreenShareTrack(track as RemoteTrack, participant);
        } else {
          this.attachVideoTrack(track as RemoteTrack, participant);
        }
      }
    });

    this.room.on(RoomEvent.TrackUnsubscribed, (track, _publication: RemoteTrackPublication, participant) => {
      console.log('[DMVoiceService] Track unsubscribed:', track.kind, track.source, 'from', participant.identity);

      if (track.kind === Track.Kind.Audio) {
        this.detachAudioTrack(participant.identity);
      } else if (track.kind === Track.Kind.Video) {
        if (track.source === Track.Source.ScreenShare) {
          this.detachScreenShareTrack(participant.identity);
        } else {
          this.detachVideoTrack(participant.identity);
        }
      }
    });

    this.room.on(RoomEvent.ParticipantConnected, (participant) => {
      console.log('[DMVoiceService] Participant connected:', participant.identity);
      this.remoteParticipantJoined = true;
      this.clearCallTimers();
      voiceStore.setDMCallPhase('connected');
      voiceStore.setRemoteParticipantLeft(false);
    });

    this.room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      console.log('[DMVoiceService] Participant disconnected:', participant.identity);
      this.detachAudioTrack(participant.identity);
      this.detachVideoTrack(participant.identity);
      this.detachScreenShareTrack(participant.identity);

      if (this.remoteParticipantJoined) {
        voiceStore.setRemoteParticipantLeft(true);

        // Auto-leave after 60s if remote doesn't rejoin
        this.autoLeaveAfterRemoteLeftTimerId = setTimeout(() => {
          if (voiceStore.remoteParticipantLeft()) {
            console.log('[DMVoiceService] Auto-leaving: remote user left and did not rejoin');
            this.leave();
          }
        }, 60_000);
      }
    });

    this.room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      if (this.room?.localParticipant) {
        const speakerIds = new Set(speakers.map(s => s.identity));
        const localIsSpeaking = speakerIds.has(this.room.localParticipant.identity);
        voiceStore.setSpeaking(localIsSpeaking);
      }
    });

    this.room.on(RoomEvent.ConnectionStateChanged, (state) => {
      console.log('[DMVoiceService] Connection state changed:', state);

      if (state === ConnectionState.Reconnecting) {
        voiceStore.setReconnecting();
      } else if (state === ConnectionState.Disconnected) {
        voiceStore.setDisconnected();
        this.cleanupAudioElements();
      }
    });

    this.room.on(RoomEvent.Disconnected, (reason) => {
      console.log('[DMVoiceService] Disconnected:', reason);
      voiceStore.setDisconnected();
      this.cleanupAudioElements();
    });
  }

  private attachAudioTrack(track: RemoteTrack, participant: RemoteParticipant): void {
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.volume = this.outputVolume / 100;

    if (voiceStore.isDeafened()) {
      audio.muted = true;
    }

    track.attach(audio);

    if (this.audioContainer) {
      this.audioContainer.appendChild(audio);
    } else {
      document.body.appendChild(audio);
    }

    this.audioElements.set(participant.identity, audio);
    console.log('[DMVoiceService] Audio track attached for:', participant.identity);
  }

  private detachAudioTrack(participantIdentity: string): void {
    const audio = this.audioElements.get(participantIdentity);
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
      this.audioElements.delete(participantIdentity);
      console.log('[DMVoiceService] Audio track detached for:', participantIdentity);
    }
  }

  private attachVideoTrack(track: RemoteTrack, participant: RemoteParticipant): void {
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true; // Remote video elements need muted for autoplay
    track.attach(video);
    this.videoElements.set(participant.identity, video);
    voiceStore.addRemoteVideoUser(participant.identity);
    console.log('[DMVoiceService] Video track attached for:', participant.identity);
  }

  private detachVideoTrack(participantIdentity: string): void {
    const video = this.videoElements.get(participantIdentity);
    if (video) {
      video.pause();
      video.srcObject = null;
      video.remove();
      this.videoElements.delete(participantIdentity);
      voiceStore.removeRemoteVideoUser(participantIdentity);
      console.log('[DMVoiceService] Video track detached for:', participantIdentity);
    }
  }

  private attachScreenShareTrack(track: RemoteTrack, participant: RemoteParticipant): void {
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    track.attach(video);
    this.screenShareElements.set(participant.identity, video);
    voiceStore.setRemoteScreenShare(participant.identity);
    console.log('[DMVoiceService] Screen share track attached for:', participant.identity);
  }

  private detachScreenShareTrack(participantIdentity: string): void {
    const video = this.screenShareElements.get(participantIdentity);
    if (video) {
      video.pause();
      video.srcObject = null;
      video.remove();
      this.screenShareElements.delete(participantIdentity);
      voiceStore.setRemoteScreenShare(null);
      console.log('[DMVoiceService] Screen share track detached for:', participantIdentity);
    }
  }

  getRemoteVideoElement(userId: string): HTMLVideoElement | null {
    return this.videoElements.get(userId) || null;
  }

  getRemoteScreenShareElement(userId: string): HTMLVideoElement | null {
    return this.screenShareElements.get(userId) || null;
  }

  getLocalVideoTrack(): MediaStreamTrack | null {
    if (!this.room?.localParticipant) return null;
    const pub = this.room.localParticipant.getTrackPublication(Track.Source.Camera);
    return pub?.track?.mediaStreamTrack || null;
  }

  private cleanupAudioElements(): void {
    this.audioElements.forEach((audio) => {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
    });
    this.audioElements.clear();
    this.videoElements.forEach((video) => {
      video.pause();
      video.srcObject = null;
      video.remove();
    });
    this.videoElements.clear();
    this.screenShareElements.forEach((video) => {
      video.pause();
      video.srcObject = null;
      video.remove();
    });
    this.screenShareElements.clear();
    voiceStore.setRemoteScreenShare(null);
    console.log('[DMVoiceService] All media elements cleaned up');
  }

  private startConnectionQualityMonitoring(): void {
    if (this.connectionQualityInterval) {
      clearInterval(this.connectionQualityInterval);
    }

    this.connectionQualityInterval = setInterval(() => {
      this.updateConnectionQuality();
    }, 2000);

    this.updateConnectionQuality();
  }

  private stopConnectionQualityMonitoring(): void {
    if (this.connectionQualityInterval) {
      clearInterval(this.connectionQualityInterval);
      this.connectionQualityInterval = null;
    }
  }

  private async updateConnectionQuality(): Promise<void> {
    if (!this.room?.localParticipant) return;

    const quality = this.room.localParticipant.connectionQuality;
    const level = this.mapConnectionQuality(quality);

    let ping: number | null = null;

    try {
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
      jitter: null,
      packetLoss: null,
    });
  }

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
}

export const dmVoiceService = new DMVoiceServiceClass();
