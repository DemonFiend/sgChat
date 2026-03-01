interface StageControlsProps {
  channelId: string;
  canSpeak: boolean;
  isSpeaker: boolean;
  onRequestToSpeak?: () => void;
}

export function StageControls({ isSpeaker, onRequestToSpeak }: StageControlsProps) {
  return (
    <div className="p-4 bg-bg-secondary rounded-lg">
      <div className="text-sm text-text-muted mb-2">
        Stage Channel
      </div>

      {isSpeaker ? (
        <div className="text-xs text-status-online">
          ✓ You are a speaker
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-xs text-text-muted">
            You are listening
          </div>
          {onRequestToSpeak && (
            <button
              className="px-3 py-1.5 text-sm bg-brand-primary hover:bg-brand-primary-hover text-white rounded transition-colors"
              onClick={onRequestToSpeak}
            >
              Request to Speak
            </button>
          )}
        </div>
      )}
    </div>
  );
}
