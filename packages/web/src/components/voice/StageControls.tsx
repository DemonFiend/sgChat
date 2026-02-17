import { Show } from 'solid-js';

interface StageControlsProps {
  channelId: string;
  canSpeak: boolean;
  isSpeaker: boolean;
  onRequestToSpeak?: () => void;
}

/**
 * StageControls - UI for music/stage channels showing speaker/listener roles
 * 
 * Phase 1: Basic structure placeholder
 * Future enhancements:
 * - Display list of speakers vs listeners
 * - "Request to Speak" button for listeners
 * - Speaker promotion/demotion controls for moderators
 * - Application audio capture integration
 */
export function StageControls(props: StageControlsProps) {
  return (
    <div class="p-4 bg-zinc-800 rounded-lg">
      <div class="text-sm text-zinc-400 mb-2">
        Stage Channel
      </div>
      
      <Show
        when={props.isSpeaker}
        fallback={
          <div class="space-y-2">
            <div class="text-xs text-zinc-500">
              You are listening
            </div>
            <Show when={props.onRequestToSpeak}>
              <button
                class="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 rounded transition-colors"
                onClick={props.onRequestToSpeak}
              >
                Request to Speak
              </button>
            </Show>
          </div>
        }
      >
        <div class="text-xs text-green-500">
          ✓ You are a speaker
        </div>
      </Show>

      {/* TODO: Add participants list with speaker/listener sections */}
      {/* TODO: Add moderator controls for promoting/demoting speakers */}
      {/* TODO: Add application audio source selection */}
    </div>
  );
}
