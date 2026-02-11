import { For, Show } from 'solid-js';
import { voiceStore, type VoiceParticipant } from '@/stores/voice';
import { SpeakerIcon } from './VoiceControls';
import { Avatar } from './Avatar';

interface VoiceParticipantsListProps {
  channelId: string;
  compact?: boolean;
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
              compact={props.compact} 
            />
          )}
        </For>
      </div>
    </Show>
  );
}

interface VoiceParticipantItemProps {
  participant: VoiceParticipant;
  compact?: boolean;
}

function VoiceParticipantItem(props: VoiceParticipantItemProps) {
  const displayName = () => props.participant.displayName || props.participant.username;

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
      </div>
    );
  }

  return (
    <div 
      class={`flex items-center gap-2 py-1 px-2 rounded transition-colors hover:bg-bg-modifier-hover ${
        props.participant.isSpeaking ? 'bg-status-online/10' : ''
      }`}
    >
      {/* Avatar with speaking ring */}
      <div class={`relative ${props.participant.isSpeaking ? 'ring-2 ring-status-online ring-offset-1 ring-offset-bg-secondary rounded-full' : ''}`}>
        <Avatar
          src={props.participant.avatarUrl}
          alt={displayName()}
          size="xs"
        />
      </div>

      {/* Name */}
      <span class="flex-1 text-sm text-text-secondary truncate">
        {displayName()}
      </span>

      {/* Status icon */}
      <SpeakerIcon
        isMuted={props.participant.isMuted}
        isDeafened={props.participant.isDeafened}
        isSpeaking={props.participant.isSpeaking}
        size="sm"
      />
    </div>
  );
}

// Inline participant list for sidebar (more compact)
interface InlineParticipantsProps {
  channelId: string;
  maxShow?: number;
}

export function InlineParticipants(props: InlineParticipantsProps) {
  const participants = () => voiceStore.getParticipants(props.channelId);
  const maxShow = () => props.maxShow ?? 5;
  const visibleParticipants = () => participants().slice(0, maxShow());
  const hiddenCount = () => Math.max(0, participants().length - maxShow());

  return (
    <Show when={participants().length > 0}>
      <div class="pl-6 mt-0.5 space-y-0.5">
        <For each={visibleParticipants()}>
          {(participant) => (
            <div class="flex items-center gap-1.5 py-0.5 text-xs text-text-muted">
              <SpeakerIcon
                isMuted={participant.isMuted}
                isDeafened={participant.isDeafened}
                isSpeaking={participant.isSpeaking}
                size="sm"
              />
              <span class="truncate">
                {participant.displayName || participant.username}
              </span>
            </div>
          )}
        </For>
        <Show when={hiddenCount() > 0}>
          <div class="text-xs text-text-muted pl-5">
            +{hiddenCount()} more
          </div>
        </Show>
      </div>
    </Show>
  );
}
