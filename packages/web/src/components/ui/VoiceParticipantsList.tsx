import { useMemo } from 'react';
import { useVoiceStore, type VoiceParticipant } from '@/stores/voice';
import { streamViewerStore } from '@/stores/streamViewer';
import { voiceService } from '@/lib/voiceService';
import { SpeakerIcon } from './VoiceControls';
import { Avatar } from './Avatar';

interface VoiceParticipantsListProps {
  channelId: string;
  channelName?: string;
  compact?: boolean;
  onUserClick?: (userId: string, rect: DOMRect) => void;
  onUserContextMenu?: (userId: string, e: React.MouseEvent) => void;
}

export function VoiceParticipantsList({ channelId, channelName, compact, onUserClick, onUserContextMenu }: VoiceParticipantsListProps) {
  const participants = useVoiceStore((s) => s.getParticipants(channelId));

  if (participants.length === 0) return null;

  return (
    <div className="ml-4 mt-1 space-y-0.5">
      {participants.map((participant) => (
        <VoiceParticipantItem
          key={participant.userId}
          participant={participant}
          channelId={channelId}
          channelName={channelName}
          compact={compact}
          onUserClick={onUserClick}
          onUserContextMenu={onUserContextMenu}
        />
      ))}
    </div>
  );
}

interface VoiceParticipantItemProps {
  participant: VoiceParticipant;
  channelId: string;
  channelName?: string;
  compact?: boolean;
  onUserClick?: (userId: string, rect: DOMRect) => void;
  onUserContextMenu?: (userId: string, e: React.MouseEvent) => void;
}

function VoiceParticipantItem({ participant, channelId, channelName, compact, onUserClick, onUserContextMenu }: VoiceParticipantItemProps) {
  const displayName = participant.displayName || participant.username;

  const handleWatchStream = (e: React.MouseEvent) => {
    e.stopPropagation();
    streamViewerStore.watchStream({
      streamerId: participant.userId,
      streamerName: displayName,
      streamerAvatar: participant.avatarUrl,
      channelId,
      channelName: channelName || 'Voice Channel',
    });
    const existingVideo = voiceService.getVideoElementForStreamer(participant.userId);
    if (existingVideo) {
      streamViewerStore.setVideoElement(existingVideo);
    }
  };

  if (compact) {
    return (
      <div className="flex items-center gap-1.5 py-0.5 px-1 rounded text-xs text-text-muted">
        <SpeakerIcon
          isMuted={participant.isMuted}
          isDeafened={participant.isDeafened}
          isSpeaking={participant.isSpeaking}
          size="sm"
        />
        <div className="min-w-0 flex-1">
          <span className="truncate block">{displayName}</span>
          {participant.voiceStatus && (
            <span className="truncate block text-[10px] opacity-70">{participant.voiceStatus}</span>
          )}
        </div>
        {participant.isStreaming && (
          <span className="ml-auto flex items-center gap-1 text-purple-400" title="Streaming">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-2 py-1 px-2 rounded transition-colors hover:bg-bg-modifier-hover cursor-pointer ${
        participant.isSpeaking ? 'bg-status-online/10' : ''
      } ${participant.isStreaming ? 'bg-purple-500/10' : ''}`}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onUserClick?.(participant.userId, rect);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onUserContextMenu?.(participant.userId, e);
      }}
    >
      <div className={`relative ${
        participant.isStreaming
          ? 'ring-2 ring-purple-400 ring-offset-1 ring-offset-bg-secondary rounded-full'
          : participant.isSpeaking
            ? 'ring-2 ring-status-online ring-offset-1 ring-offset-bg-secondary rounded-full'
            : ''
      }`}>
        <Avatar src={participant.avatarUrl} alt={displayName} size="xs" />
        {participant.isStreaming && (
          <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-purple-500 rounded-full flex items-center justify-center">
            <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <span className="text-sm text-text-secondary truncate block">{displayName}</span>
        {participant.voiceStatus && (
          <span className="text-xs text-text-muted truncate block">{participant.voiceStatus}</span>
        )}
      </div>

      {participant.isStreaming ? (
        <button
          onClick={handleWatchStream}
          className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-purple-400 bg-purple-500/20 rounded hover:bg-purple-500/30 transition-colors"
          title={`Watch ${displayName}'s stream`}
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          <span>LIVE</span>
        </button>
      ) : (
        <SpeakerIcon
          isMuted={participant.isMuted}
          isDeafened={participant.isDeafened}
          isSpeaking={participant.isSpeaking}
          size="sm"
        />
      )}
    </div>
  );
}

interface InlineParticipantsProps {
  channelId: string;
  channelName?: string;
  maxShow?: number;
  onUserClick?: (userId: string, rect: DOMRect) => void;
  onUserContextMenu?: (userId: string, e: React.MouseEvent) => void;
}

export function InlineParticipants({ channelId, channelName, maxShow = 5, onUserClick, onUserContextMenu }: InlineParticipantsProps) {
  const participants = useVoiceStore((s) => s.getParticipants(channelId));

  const visibleParticipants = useMemo(() => participants.slice(0, maxShow), [participants, maxShow]);
  const hiddenCount = Math.max(0, participants.length - maxShow);
  const streamingCount = useMemo(() => participants.filter(p => p.isStreaming).length, [participants]);

  if (participants.length === 0) return null;

  const handleWatchStream = (participant: VoiceParticipant, e: React.MouseEvent) => {
    e.stopPropagation();
    streamViewerStore.watchStream({
      streamerId: participant.userId,
      streamerName: participant.displayName || participant.username,
      streamerAvatar: participant.avatarUrl,
      channelId,
      channelName: channelName || 'Voice Channel',
    });
    const existingVideo = voiceService.getVideoElementForStreamer(participant.userId);
    if (existingVideo) {
      streamViewerStore.setVideoElement(existingVideo);
    }
  };

  return (
    <div className="pl-6 mt-0.5 space-y-0.5">
      {visibleParticipants.map((participant) => (
        <div
          key={participant.userId}
          className={`flex items-center gap-1.5 py-0.5 text-xs cursor-pointer hover:bg-bg-modifier-hover rounded px-0.5 ${participant.isStreaming ? 'text-purple-400' : 'text-text-muted'}`}
          onClick={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            onUserClick?.(participant.userId, rect);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onUserContextMenu?.(participant.userId, e);
          }}
        >
          {participant.isStreaming ? (
            <svg className="w-3.5 h-3.5 flex-shrink-0 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          ) : (
            <SpeakerIcon
              isMuted={participant.isMuted}
              isDeafened={participant.isDeafened}
              isSpeaking={participant.isSpeaking}
              size="sm"
            />
          )}
          <div className="min-w-0 flex-1">
            <span className="truncate block">
              {participant.displayName || participant.username}
            </span>
            {participant.voiceStatus && (
              <span className="truncate block text-[10px] opacity-60">{participant.voiceStatus}</span>
            )}
          </div>
          {participant.isStreaming && (
            <button
              onClick={(e) => handleWatchStream(participant, e)}
              className="ml-auto text-[10px] font-semibold bg-purple-500/30 px-1 rounded hover:bg-purple-500/50 transition-colors cursor-pointer"
              title={`Watch ${participant.displayName || participant.username}'s stream`}
            >
              LIVE
            </button>
          )}
        </div>
      ))}
      {hiddenCount > 0 && (
        <div className="text-xs text-text-muted pl-5">
          +{hiddenCount} more
        </div>
      )}
      {streamingCount > 0 && hiddenCount > 0 && (
        <div className="text-xs text-purple-400 pl-5">
          {streamingCount} streaming
        </div>
      )}
    </div>
  );
}
