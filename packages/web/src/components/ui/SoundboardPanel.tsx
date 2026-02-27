import { createSignal, createMemo, For, Show, onMount } from 'solid-js';
import { api } from '@/api';
import { authStore } from '@/stores/auth';
import { getEffectiveUrl } from '@/stores/network';
import { soundService } from '@/lib/soundService';

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
  const [collapsed, setCollapsed] = createSignal(true);
  const [searchQuery, setSearchQuery] = createSignal('');

  const currentUserId = () => authStore.state().user?.id;

  const userSoundCount = () => sounds().filter(s => s.uploader_id === currentUserId()).length;
  const canUpload = () => userSoundCount() < config().max_sounds_per_user;

  const filteredSounds = createMemo(() => {
    const query = searchQuery().toLowerCase().trim();
    if (!query) return sounds();
    return sounds().filter(s =>
      s.name.toLowerCase().includes(query) ||
      (s.uploader_username || '').toLowerCase().includes(query)
    );
  });

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

  const handlePlayLocal = (sound: SoundboardSound) => {
    setPlayingId(sound.id);
    soundService.playCustomSound(sound.sound_url);
    setTimeout(() => setPlayingId(null), sound.duration_seconds * 1000);
  };

  const handlePlayForEveryone = async (sound: SoundboardSound) => {
    try {
      setPlayingId(sound.id);
      await api.post(`/servers/${props.serverId}/soundboard/${sound.id}/play`);
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

      if (file.size > config().max_sound_size_bytes) {
        setError(`File too large. Max ${Math.round(config().max_sound_size_bytes / 1024)}KB`);
        return;
      }

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
    <div class="border-t border-border-primary">
      {/* Collapsible header */}
      <button
        class="w-full flex items-center justify-between px-3 py-2 hover:bg-bg-secondary transition-colors"
        onClick={() => setCollapsed(prev => !prev)}
      >
        <div class="flex items-center gap-2">
          <svg
            class={`w-3 h-3 text-text-muted transition-transform ${collapsed() ? '' : 'rotate-90'}`}
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z" />
          </svg>
          <span class="text-xs font-semibold text-text-primary">Soundboard</span>
          <Show when={!loading() && sounds().length > 0}>
            <span class="text-[10px] text-text-muted bg-bg-tertiary rounded-full px-1.5">
              {sounds().length}
            </span>
          </Show>
        </div>
      </button>

      {/* Expanded content */}
      <Show when={!collapsed()}>
        <div class="px-3 pb-3">
          {/* Search + Upload row */}
          <div class="flex items-center gap-1.5 mb-2">
            <div class="flex-1 relative">
              <svg class="absolute left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <input
                type="text"
                placeholder="Search sounds..."
                class="w-full text-[11px] pl-6 pr-2 py-1 rounded bg-bg-tertiary text-text-primary placeholder-text-muted border border-transparent focus:border-accent-primary focus:outline-none"
                value={searchQuery()}
                onInput={(e) => setSearchQuery(e.currentTarget.value)}
              />
            </div>
            <Show when={canUpload() && !uploading()}>
              <button
                class="text-[11px] px-2 py-1 rounded bg-accent-primary hover:bg-accent-primary/80 text-white transition-colors whitespace-nowrap"
                onClick={handleUpload}
              >
                + Add
              </button>
            </Show>
            <Show when={uploading()}>
              <span class="text-[11px] text-text-muted">Uploading...</span>
            </Show>
          </div>

          <Show when={error()}>
            <div class="text-[11px] text-red-400 mb-2">{error()}</div>
          </Show>

          <Show when={loading()}>
            <div class="text-[11px] text-text-muted text-center py-3">Loading sounds...</div>
          </Show>

          <Show when={!loading() && sounds().length === 0}>
            <div class="text-[11px] text-text-muted text-center py-3">
              No sounds yet. Click "+ Add" to upload one!
            </div>
          </Show>

          <Show when={!loading() && sounds().length > 0 && filteredSounds().length === 0}>
            <div class="text-[11px] text-text-muted text-center py-3">
              No sounds match "{searchQuery()}"
            </div>
          </Show>

          <div class="grid grid-cols-3 gap-1.5">
            <For each={filteredSounds()}>
              {(sound) => (
                <div class="relative group">
                  <div
                    class={`w-full text-center p-1.5 rounded text-xs transition-colors ${
                      playingId() === sound.id
                        ? 'bg-accent-primary/30 border border-accent-primary'
                        : 'bg-bg-tertiary hover:bg-bg-secondary border border-transparent'
                    }`}
                  >
                    <div class="text-base leading-none mb-0.5">
                      {sound.emoji || '🔊'}
                    </div>
                    <div class="text-text-primary truncate text-[10px] mb-1">{sound.name}</div>

                    {/* Play buttons */}
                    <div class="flex gap-1 justify-center">
                      <button
                        class="p-0.5 rounded hover:bg-bg-primary transition-colors"
                        onClick={() => handlePlayLocal(sound)}
                        title="Play locally (only you)"
                      >
                        <svg class="w-3.5 h-3.5 text-text-muted hover:text-text-primary" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                        </svg>
                      </button>
                      <button
                        class="p-0.5 rounded hover:bg-bg-primary transition-colors"
                        onClick={() => handlePlayForEveryone(sound)}
                        title="Play for everyone in voice"
                      >
                        <svg class="w-3.5 h-3.5 text-text-muted hover:text-accent-primary" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                        </svg>
                      </button>
                    </div>

                    <div class="text-[9px] text-text-muted truncate mt-0.5">
                      {sound.uploader_username || 'Unknown'}
                    </div>
                  </div>

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
      </Show>
    </div>
  );
}
