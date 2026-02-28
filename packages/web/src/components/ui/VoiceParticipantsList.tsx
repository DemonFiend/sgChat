import { For, Show } from 'solid-js';
import { voiceStore, type VoiceParticipant } from '@/stores/voice';
import { streamViewerStore } from '@/stores/streamViewer';
import { voiceService } from '@/lib/voiceService';
import { SpeakerIcon } from './VoiceControls';
import { Avatar } from './Avatar';

interface VoiceParticipantsListProps {
  channelId: string;
  channelName?: string;
  compact?: boolean;
  onUserClick?: (userId: string, rect: DOMRect) => void;
  onUserContextMenu?: (userId: string, e: MouseEvent) => void;
}

export function VoiceParticipantsList(props: VoiceParticipantsListProps) {
  const participants = () => voiceStore.getParticipants(props.channelId);

  return (
    <Show when={participants().length > 0}>
      <div class="ml-4 mt-1 space-y-0.5">
        <For each={participants()}>
          {(participant) => (
            <VoiceParticipantItem
              participant={participant}
              channelId={props.channelId}
              channelName={props.channelName}
              compact={props.compact}
              onUserClick={props.onUserClick}
              onUserContextMenu={props.onUserContextMenu}
            />
          )}
        </For>
      </div>
    </Show>
  );
}

interface VoiceParticipantItemProps {
  participant: VoiceParticipant;
  channelId: string;
  channelName?: string;
  compact?: boolean;
  onUserClick?: (userId: string, rect: DOMRect) => void;
  onUserContextMenu?: (userId: string, e: MouseEvent) => void;
}

function VoiceParticipantItem(props: VoiceParticipantItemProps) {
  const displayName = () => props.participant.displayName || props.participant.username;

  const handleWatchStream = (e: Event) => {
    e.stopPropagation();
    const streamerId = props.participant.userId;
    console.log('[VoiceParticipantsList] Watch stream clicked for:', streamerId);
    console.log('[VoiceParticipantsList] Current voice channel:', voiceStore.currentChannelId());
    console.log('[VoiceParticipantsList] Stream channel:', props.channelId);
    console.log('[VoiceParticipantsList] Is connected to voice:', voiceStore.isConnected());
    
    // Start watching the stream
    streamViewerStore.watchStream({
      streamerId: streamerId,
      streamerName: displayName(),
      streamerAvatar: props.participant.avatarUrl,
      channelId: props.channelId,
      channelName: props.channelName || 'Voice Channel',
    });
    
    // If video element already exists (track already subscribed), set it immediately
    const existingVideo = voiceService.getVideoElementForStreamer(streamerId);
    console.log('[VoiceParticipantsList] Existing video element:', existingVideo ? 'found' : 'not found');
    
    if (existingVideo) {
      console.log('[VoiceParticipantsList] Video element already exists, setting it');
      streamViewerStore.setVideoElement(existingVideo);
    } else {
      console.log('[VoiceParticipantsList] No video element yet - you may need to be in the same voice channel');
      // Check if we're in the voice channel
      if (!voiceStore.isConnected() || voiceStore.currentChannelId() !== props.channelId) {
        console.warn('[VoiceParticipantsList] Not in the same voice channel - cannot receive video track');
      }
    }
  };

  if (props.compact) {
    return (
      <div class="flex items-center gap-1.5 py-0.5 px-1 rounded text-xs text-text-muted">
        <SpeakerIcon
          isMuted={props.participant.isMuted}
          isDeafened={props.participant.isDeafened}
          isSpeaking={props.participant.isSpeaking}
          size="sm"
        />
        <span class="truncate">{displayName()}</span>
        {/* Streaming indicator */}
        <Show when={props.participant.isStreaming}>
          <span class="ml-auto flex items-center gap-1 text-purple-400" title="Streaming">
            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </span>
        </Show>
      </div>
    );
  }

  return (
    <div
      class={`flex items-center gap-2 py-1 px-2 rounded transition-colors hover:bg-bg-modifier-hover cursor-pointer ${
        props.participant.isSpeaking ? 'bg-status-online/10' : ''
      } ${props.participant.isStreaming ? 'bg-purple-500/10' : ''}`}
      onClick={(e: MouseEvent) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        props.onUserClick?.(props.participant.userId, rect);
      }}
      onContextMenu={(e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        props.onUserContextMenu?.(props.participant.userId, e);
      }}
    >
      {/* Avatar with speaking/streaming ring */}
      <div class={`relative ${
        props.participant.isStreaming 
          ? 'ring-2 ring-purple-400 ring-offset-1 ring-offset-bg-secondary rounded-full'
          : props.participant.isSpeaking 
            ? 'ring-2 ring-status-online ring-offset-1 ring-offset-bg-secondary rounded-full' 
            : ''
      }`}>
        <Avatar
          src={props.participant.avatarUrl}
          alt={displayName()}
          size="xs"
        />
        {/* Streaming badge */}
        <Show when={props.participant.isStreaming}>
          <div class="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-purple-500 rounded-full flex items-center justify-center">
            <svg class="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
        </Show>
      </div>

      {/* Name */}
      <span class="flex-1 text-sm text-text-secondary truncate">
        {displayName()}
      </span>

      {/* Streaming indicator - clickable */}
      <Show when={props.participant.isStreaming}>
        <button
          onClick={handleWatchStream}
          class="flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-purple-400 bg-purple-500/20 rounded hover:bg-purple-500/30 transition-colors"
          title={`Watch ${displayName()}'s stream`}
        >
          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          <span>LIVE</span>
        </button>
      </Show>

      {/* Status icon - only show when not streaming */}
      <Show when={!props.participant.isStreaming}>
        <SpeakerIcon
          isMuted={props.participant.isMuted}
          isDeafened={props.participant.isDeafened}
          isSpeaking={props.participant.isSpeaking}
          size="sm"
        />
      </Show>
    </div>
  );
}

// Inline participant list for sidebar (more compact)
interface InlineParticipantsProps {
  channelId: string;
  channelName?: string;
  maxShow?: number;
  onUserClick?: (userId: string, rect: DOMRect) => void;
  onUserContextMenu?: (userId: string, e: MouseEvent) => void;
}

export function InlineParticipants(props: InlineParticipantsProps) {
  const participants = () => voiceStore.getParticipants(props.channelId);
  const maxShow = () => props.maxShow ?? 5;
  const visibleParticipants = () => participants().slice(0, maxShow());
  const hiddenCount = () => Math.max(0, participants().length - maxShow());
  const streamingCount = () => participants().filter(p => p.isStreaming).length;

  const handleWatchStream = (participant: VoiceParticipant, e: Event) => {
    e.stopPropagation();
    streamViewerStore.watchStream({
      streamerId: participant.userId,
      streamerName: participant.displayName || participant.username,
      streamerAvatar: participant.avatarUrl,
      channelId: props.channelId,
      channelName: props.channelName || 'Voice Channel',
    });

    const existingVideo = voiceService.getVideoElementForStreamer(participant.userId);
    if (existingVideo) {
      streamViewerStore.setVideoElement(existingVideo);
    }
  };

  return (
    <Show when={participants().length > 0}>
      <div class="pl-6 mt-0.5 space-y-0.5">
        <For each={visibleParticipants()}>
          {(participant) => (
            <div
              class={`flex items-center gap-1.5 py-0.5 text-xs cursor-pointer hover:bg-bg-modifier-hover rounded px-0.5 ${participant.isStreaming ? 'text-purple-400' : 'text-text-muted'}`}
              onClick={(e: MouseEvent) => {
                e.stopPropagation();
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                props.onUserClick?.(participant.userId, rect);
              }}
              onContextMenu={(e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                props.onUserContextMenu?.(participant.userId, e);
              }}
            >
              {/* Show stream icon if streaming, otherwise speaker */}
              <Show 
                when={participant.isStreaming}
                fallback={
                  <SpeakerIcon
                    isMuted={participant.isMuted}
                    isDeafened={participant.isDeafened}
                    isSpeaking={participant.isSpeaking}
                    size="sm"
                  />
                }
              >
                <svg class="w-3.5 h-3.5 flex-shrink-0 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </Show>
              <span class="truncate">
                {participant.displayName || participant.username}
              </span>
              <Show when={participant.isStreaming}>
                <button
                  onClick={(e) => handleWatchStream(participant, e)}
                  class="ml-auto text-[10px] font-semibold bg-purple-500/30 px-1 rounded hover:bg-purple-500/50 transition-colors cursor-pointer"
                  title={`Watch ${participant.displayName || participant.username}'s stream`}
                >
                  LIVE
                </button>
              </Show>
            </div>
          )}
        </For>
        <Show when={hiddenCount() > 0}>
          <div class="text-xs text-text-muted pl-5">
            +{hiddenCount()} more
          </div>
        </Show>
        {/* Show streaming summary if any hidden users are streaming */}
        <Show when={streamingCount() > 0 && hiddenCount() > 0}>
          <div class="text-xs text-purple-400 pl-5">
            {streamingCount()} streaming
          </div>
        </Show>
      </div>
    </Show>
  );
}
