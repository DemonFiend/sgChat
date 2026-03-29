import { create } from 'zustand';
import type { NoiseSuppressionMode } from '@sgchat/shared';
import { DEFAULT_NOISE_SUPPRESSION_MODE, DEFAULT_NOISE_AGGRESSIVENESS } from '@sgchat/shared';
import { api } from '@/api/client';

interface VoiceSettingsState {
  // Noise suppression
  noiseSuppressionMode: NoiseSuppressionMode;
  noiseAggressiveness: number;
  // Audio devices
  audioInputDeviceId: string | null;
  audioOutputDeviceId: string | null;
  // Volumes
  inputVolume: number;
  outputVolume: number;
  inputSensitivity: number;
  // Audio processing
  autoGainControl: boolean;
  echoCancellation: boolean;
  voiceActivityDetection: boolean;
  // Sounds
  enableVoiceJoinSounds: boolean;
  // Push to talk
  pushToTalkKey: string | null;
  // Loading state
  loaded: boolean;
  saving: boolean;
}

interface VoiceSettingsActions {
  load: () => Promise<void>;
  setNoiseMode: (mode: NoiseSuppressionMode) => void;
  setAggressiveness: (value: number) => void;
  saveSetting: (key: string, value: unknown) => Promise<void>;
}

export const useVoiceSettingsStore = create<VoiceSettingsState & VoiceSettingsActions>(
  (set, get) => ({
    // Default state
    noiseSuppressionMode: DEFAULT_NOISE_SUPPRESSION_MODE,
    noiseAggressiveness: DEFAULT_NOISE_AGGRESSIVENESS,
    audioInputDeviceId: null,
    audioOutputDeviceId: null,
    inputVolume: 100,
    outputVolume: 100,
    inputSensitivity: 50,
    autoGainControl: true,
    echoCancellation: true,
    voiceActivityDetection: true,
    enableVoiceJoinSounds: true,
    pushToTalkKey: null,
    loaded: false,
    saving: false,

    load: async () => {
      try {
        const settings = await api.get<Record<string, unknown>>('/users/me/settings');
        if (settings) {
          // Derive noise mode from response — use new field if present, else derive from legacy booleans
          let noiseMode: NoiseSuppressionMode = DEFAULT_NOISE_SUPPRESSION_MODE;
          if (settings.noise_suppression_mode) {
            noiseMode = settings.noise_suppression_mode as NoiseSuppressionMode;
          } else if (settings.audio_ai_noise_suppression) {
            noiseMode = 'nsnet2';
          } else if (settings.audio_noise_suppression) {
            noiseMode = 'native';
          } else {
            noiseMode = 'off';
          }

          set({
            noiseSuppressionMode: noiseMode,
            noiseAggressiveness:
              (settings.noise_aggressiveness as number) ?? DEFAULT_NOISE_AGGRESSIVENESS,
            audioInputDeviceId: (settings.audio_input_device_id as string) ?? null,
            audioOutputDeviceId: (settings.audio_output_device_id as string) ?? null,
            inputVolume: (settings.audio_input_volume as number) ?? 100,
            outputVolume: (settings.audio_output_volume as number) ?? 100,
            inputSensitivity: (settings.audio_input_sensitivity as number) ?? 50,
            autoGainControl: (settings.audio_auto_gain_control as boolean) ?? true,
            echoCancellation: (settings.audio_echo_cancellation as boolean) ?? true,
            voiceActivityDetection: (settings.voice_activity_detection as boolean) ?? true,
            enableVoiceJoinSounds: (settings.enable_voice_join_sounds as boolean) ?? true,
            pushToTalkKey: (settings.push_to_talk_key as string) ?? null,
            loaded: true,
          });
        }
      } catch (err) {
        console.error('[voiceSettingsStore] Failed to load settings:', err);
      }
    },

    setNoiseMode: (mode: NoiseSuppressionMode) => {
      set({ noiseSuppressionMode: mode });
      get().saveSetting('noise_suppression_mode', mode);
    },

    setAggressiveness: (value: number) => {
      set({ noiseAggressiveness: value });
      get().saveSetting('noise_aggressiveness', value);
    },

    saveSetting: async (key: string, value: unknown) => {
      set({ saving: true });
      try {
        await api.patch('/users/me/settings', { [key]: value });
      } catch (err) {
        console.error('[voiceSettingsStore] Failed to save setting:', err);
      } finally {
        set({ saving: false });
      }
    },
  }),
);

// Non-hook export for use outside React components
export const voiceSettingsStore = useVoiceSettingsStore;
