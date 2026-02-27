import { createSignal, For, Show, onMount } from 'solid-js';
import { api } from '@/api';
import { authStore } from '@/stores/auth';
import { getEffectiveUrl } from '@/stores/network';

interface SoundboardSound {
  id: string;
  server_id: string;
  uploader_id: string;
  uploader_username?: string;
  name: string;
  emoji: string | null;
  sound_url: string;
  duration_seconds: number;
  file_size_bytes: number;
  play_count: number;
  created_at: string;
}

interface SoundboardConfig {
  enabled: boolean;
  max_sounds_per_user: number;
  max_sound_duration_seconds: number;
  max_sound_size_bytes: number;
}

interface SoundboardPanelProps {
  serverId: string;
}

export function SoundboardPanel(props: SoundboardPanelProps) {
  const [sounds, setSounds] = createSignal<SoundboardSound[]>([]);
  const [config, setConfig] = createSignal<SoundboardConfig>({
    enabled: true,
    max_sounds_per_user: 3,
    max_sound_duration_seconds: 5,
    max_sound_size_bytes: 1048576,
  });
  const [loading, setLoading] = createSignal(true);
  const [uploading, setUploading] = createSignal(false);
  const [playingId, setPlayingId] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  const currentUserId = () => authStore.state().user?.id;

  const userSoundCount = () => sounds().filter(s => s.uploader_id === currentUserId()).length;
  const canUpload = () => userSoundCount() < config().max_sounds_per_user;

  const fetchSounds = async () => {
    try {
      setLoading(true);
      const response = await api.get<{ sounds: SoundboardSound[]; config: SoundboardConfig }>(
        `/servers/${props.serverId}/soundboard`
      );
      setSounds(response.sounds || []);
      setConfig(response.config);
    } catch (err) {
      console.error('[Soundboard] Failed to fetch sounds:', err);
    } finally {
      setLoading(false);
    }
  };

  onMount(fetchSounds);

  const handlePlay = async (sound: SoundboardSound) => {
    try {
      setPlayingId(sound.id);
      await api.post(`/servers/${props.serverId}/soundboard/${sound.id}/play`);
      // The actual playback happens via the socket event in MainLayout
      setTimeout(() => setPlayingId(null), sound.duration_seconds * 1000);
    } catch (err) {
      console.error('[Soundboard] Failed to play sound:', err);
      setPlayingId(null);
    }
  };

  const handleDelete = async (soundId: string) => {
    try {
      await api.delete(`/servers/${props.serverId}/soundboard/${soundId}`);
      setSounds(prev => prev.filter(s => s.id !== soundId));
    } catch (err) {
      console.error('[Soundboard] Failed to delete sound:', err);
    }
  };

  const handleUpload = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/mpeg,audio/wav,audio/ogg,.mp3,.wav,.ogg';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      setError(null);

      // Validate file size
      if (file.size > config().max_sound_size_bytes) {
        setError(`File too large. Max ${Math.round(config().max_sound_size_bytes / 1024)}KB`);
        return;
      }

      // Measure duration using Web Audio API
      let duration: number;
      try {
        const arrayBuffer = await file.arrayBuffer();
        const audioCtx = new AudioContext();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        duration = audioBuffer.duration;
        audioCtx.close();
      } catch {
        setError('Could not read audio file');
        return;
      }

      if (duration > config().max_sound_duration_seconds) {
        setError(`Sound too long. Max ${config().max_sound_duration_seconds}s (got ${duration.toFixed(1)}s)`);
        return;
      }

      // Prompt for a name
      const name = prompt('Sound name (max 32 characters):', file.name.replace(/\.[^/.]+$/, '').slice(0, 32));
      if (!name) return;

      setUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('name', name.slice(0, 32));
        formData.append('duration', duration.toString());

        const token = authStore.getAccessToken();
        const response = await fetch(
          `${getEffectiveUrl(null)}/servers/${props.serverId}/soundboard`,
          {
            method: 'POST',
            headers: {
              ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            },
            credentials: 'include',
            body: formData,
          }
        );

        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: 'Upload failed' }));
          setError(err.error || err.message || 'Upload failed');
          return;
        }

        const sound = await response.json();
        setSounds(prev => [sound, ...prev]);
      } catch (err: any) {
        setError(err.message || 'Upload failed');
      } finally {
        setUploading(false);
      }
    };
    input.click();
  };

  return (
    <div class="p-3">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-semibold text-text-primary">Soundboard</h3>
        <Show when={canUpload() && !uploading()}>
          <button
            class="text-xs px-2 py-1 rounded bg-accent-primary hover:bg-accent-primary/80 text-white transition-colors"
            onClick={handleUpload}
          >
            + Add Sound
          </button>
        </Show>
        <Show when={uploading()}>
          <span class="text-xs text-text-muted">Uploading...</span>
        </Show>
      </div>

      <Show when={error()}>
        <div class="text-xs text-red-400 mb-2">{error()}</div>
      </Show>

      <Show when={loading()}>
        <div class="text-sm text-text-muted text-center py-4">Loading sounds...</div>
      </Show>

      <Show when={!loading() && sounds().length === 0}>
        <div class="text-sm text-text-muted text-center py-4">
          No sounds yet. Click "Add Sound" to upload one!
        </div>
      </Show>

      <div class="grid grid-cols-3 gap-1.5">
        <For each={sounds()}>
          {(sound) => (
            <div class="relative group">
              <button
                class={`w-full text-center p-2 rounded text-xs transition-colors ${
                  playingId() === sound.id
                    ? 'bg-accent-primary/30 border border-accent-primary'
                    : 'bg-bg-tertiary hover:bg-bg-secondary border border-transparent'
                }`}
                onClick={() => handlePlay(sound)}
                title={`${sound.name} (${sound.duration_seconds.toFixed(1)}s) - by ${sound.uploader_username || 'Unknown'}`}
              >
                <div class="text-lg leading-none mb-0.5">
                  {sound.emoji || '🔊'}
                </div>
                <div class="text-text-primary truncate text-[11px]">{sound.name}</div>
              </button>

              {/* Delete button for own sounds */}
              <Show when={sound.uploader_id === currentUserId()}>
                <button
                  class="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-600 text-white hidden group-hover:flex items-center justify-center text-[10px] leading-none"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(sound.id);
                  }}
                  title="Delete sound"
                >
                  x
                </button>
              </Show>
            </div>
          )}
        </For>
      </div>

      <Show when={!loading() && sounds().length > 0}>
        <div class="text-[10px] text-text-muted mt-2 text-center">
          {userSoundCount()}/{config().max_sounds_per_user} sounds uploaded
        </div>
      </Show>
    </div>
  );
}
