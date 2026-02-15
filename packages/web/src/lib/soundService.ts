import { api } from '@/api';

// Sound URLs
const SOUNDS = {
  voiceJoin: '/sounds/join.mp3',
  voiceLeave: '/sounds/leave.mp3',
  notification: '/sounds/notification.mp3',
} as const;

type SoundType = keyof typeof SOUNDS;

interface SoundSettings {
  enable_sounds: boolean;
  enable_voice_join_sounds: boolean;
  audio_output_volume: number;
}

class SoundServiceClass {
  private settings: SoundSettings = {
    enable_sounds: true,
    enable_voice_join_sounds: true,
    audio_output_volume: 100,
  };
  
  private audioCache: Map<SoundType, HTMLAudioElement> = new Map();
  private settingsLoaded: boolean = false;

  /**
   * Load user's sound settings from the server
   */
  async loadSettings(): Promise<void> {
    try {
      const response = await api.get<any>('/users/me/settings');
      if (response) {
        this.settings = {
          enable_sounds: response.enable_sounds ?? true,
          enable_voice_join_sounds: response.enable_voice_join_sounds ?? true,
          audio_output_volume: response.audio_output_volume ?? 100,
        };
      }
      this.settingsLoaded = true;
    } catch (err) {
      console.debug('[SoundService] Could not load settings:', err);
    }
  }

  /**
   * Update settings (call this when settings change)
   */
  updateSettings(settings: Partial<SoundSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  /**
   * Preload a sound into cache for faster playback
   */
  private preloadSound(type: SoundType): HTMLAudioElement {
    if (!this.audioCache.has(type)) {
      const audio = new Audio(SOUNDS[type]);
      audio.preload = 'auto';
      this.audioCache.set(type, audio);
    }
    return this.audioCache.get(type)!;
  }

  /**
   * Play a sound effect
   */
  async play(type: SoundType): Promise<void> {
    // Load settings if not already loaded
    if (!this.settingsLoaded) {
      await this.loadSettings();
    }

    // Check if sounds are enabled
    if (!this.settings.enable_sounds) {
      return;
    }

    // Check voice-specific setting
    if ((type === 'voiceJoin' || type === 'voiceLeave') && !this.settings.enable_voice_join_sounds) {
      return;
    }

    try {
      // Clone the audio element for overlapping sounds
      const audio = this.preloadSound(type).cloneNode() as HTMLAudioElement;
      audio.volume = (this.settings.audio_output_volume / 100) * 0.5; // 50% of output volume
      
      await audio.play();
    } catch (err) {
      // Sound playback can fail for various reasons (user interaction required, file not found, etc.)
      console.debug(`[SoundService] Could not play ${type} sound:`, err);
    }
  }

  /**
   * Play voice join sound
   */
  playVoiceJoin(): void {
    this.play('voiceJoin');
  }

  /**
   * Play voice leave sound
   */
  playVoiceLeave(): void {
    this.play('voiceLeave');
  }

  /**
   * Play notification sound
   */
  playNotification(): void {
    this.play('notification');
  }
}

// Export singleton instance
export const soundService = new SoundServiceClass();
