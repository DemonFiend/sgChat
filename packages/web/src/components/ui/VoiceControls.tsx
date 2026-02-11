import { Show } from 'solid-js';
import { clsx } from 'clsx';

interface MuteButtonProps {
  isMuted: boolean;
  onClick: () => void;
  size?: 'sm' | 'md' | 'lg';
  class?: string;
}

export function MuteButton(props: MuteButtonProps) {
  const sizeClasses = () => {
    switch (props.size) {
      case 'sm': return 'w-8 h-8';
      case 'lg': return 'w-12 h-12';
      default: return 'w-10 h-10';
    }
  };

  const iconSizeClasses = () => {
    switch (props.size) {
      case 'sm': return 'w-4 h-4';
      case 'lg': return 'w-6 h-6';
      default: return 'w-5 h-5';
    }
  };

  return (
    <button
      onClick={props.onClick}
      class={clsx(
        'flex items-center justify-center rounded-full transition-colors',
        sizeClasses(),
        props.isMuted
          ? 'bg-danger/20 text-danger hover:bg-danger/30'
          : 'bg-bg-secondary text-text-primary hover:bg-bg-modifier-hover',
        props.class
      )}
      title={props.isMuted ? 'Unmute' : 'Mute'}
    >
      <Show
        when={props.isMuted}
        fallback={
          <svg class={iconSizeClasses()} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        }
      >
        <svg class={iconSizeClasses()} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
        </svg>
      </Show>
    </button>
  );
}

interface DeafenButtonProps {
  isDeafened: boolean;
  onClick: () => void;
  size?: 'sm' | 'md' | 'lg';
  class?: string;
}

export function DeafenButton(props: DeafenButtonProps) {
  const sizeClasses = () => {
    switch (props.size) {
      case 'sm': return 'w-8 h-8';
      case 'lg': return 'w-12 h-12';
      default: return 'w-10 h-10';
    }
  };

  const iconSizeClasses = () => {
    switch (props.size) {
      case 'sm': return 'w-4 h-4';
      case 'lg': return 'w-6 h-6';
      default: return 'w-5 h-5';
    }
  };

  return (
    <button
      onClick={props.onClick}
      class={clsx(
        'flex items-center justify-center rounded-full transition-colors',
        sizeClasses(),
        props.isDeafened
          ? 'bg-danger/20 text-danger hover:bg-danger/30'
          : 'bg-bg-secondary text-text-primary hover:bg-bg-modifier-hover',
        props.class
      )}
      title={props.isDeafened ? 'Undeafen' : 'Deafen'}
    >
      <Show
        when={props.isDeafened}
        fallback={
          <svg class={iconSizeClasses()} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
          </svg>
        }
      >
        <svg class={iconSizeClasses()} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
        </svg>
      </Show>
    </button>
  );
}

interface DisconnectButtonProps {
  onClick: () => void;
  size?: 'sm' | 'md' | 'lg';
  class?: string;
}

export function DisconnectButton(props: DisconnectButtonProps) {
  const sizeClasses = () => {
    switch (props.size) {
      case 'sm': return 'w-8 h-8';
      case 'lg': return 'w-12 h-12';
      default: return 'w-10 h-10';
    }
  };

  const iconSizeClasses = () => {
    switch (props.size) {
      case 'sm': return 'w-4 h-4';
      case 'lg': return 'w-6 h-6';
      default: return 'w-5 h-5';
    }
  };

  return (
    <button
      onClick={props.onClick}
      class={clsx(
        'flex items-center justify-center rounded-full bg-danger/20 text-danger hover:bg-danger/30 transition-colors',
        sizeClasses(),
        props.class
      )}
      title="Disconnect"
    >
      <svg class={iconSizeClasses()} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
      </svg>
    </button>
  );
}

// Speaker icon for participant status
interface SpeakerIconProps {
  isMuted: boolean;
  isDeafened: boolean;
  isSpeaking: boolean;
  size?: 'sm' | 'md';
}

export function SpeakerIcon(props: SpeakerIconProps) {
  const iconSize = () => props.size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';

  if (props.isDeafened) {
    return (
      <svg class={`${iconSize()} text-danger`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
      </svg>
    );
  }

  if (props.isMuted) {
    return (
      <svg class={`${iconSize()} text-text-muted`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
      </svg>
    );
  }

  if (props.isSpeaking) {
    return (
      <svg class={`${iconSize()} text-status-online animate-pulse`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
      </svg>
    );
  }

  // Normal - listening
  return (
    <svg class={`${iconSize()} text-text-muted`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
    </svg>
  );
}
