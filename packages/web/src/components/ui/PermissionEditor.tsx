import { createSignal, For, Show } from 'solid-js';
import {
  TextPermissions,
  TextPermissionMetadata,
  VoicePermissions,
  VoicePermissionMetadata,
} from '@sgchat/shared';

interface PermissionEditorProps {
  channelType: string;
  textAllow: string;
  textDeny: string;
  voiceAllow: string;
  voiceDeny: string;
  onSave: (values: {
    text_allow: string;
    text_deny: string;
    voice_allow: string;
    voice_deny: string;
  }) => Promise<void>;
  onCancel: () => void;
}

type PermState = 'allow' | 'neutral' | 'deny';

export function PermissionEditor(props: PermissionEditorProps) {
  const [textAllow, setTextAllow] = createSignal(BigInt(props.textAllow || '0'));
  const [textDeny, setTextDeny] = createSignal(BigInt(props.textDeny || '0'));
  const [voiceAllow, setVoiceAllow] = createSignal(BigInt(props.voiceAllow || '0'));
  const [voiceDeny, setVoiceDeny] = createSignal(BigInt(props.voiceDeny || '0'));
  const [saving, setSaving] = createSignal(false);

  const isTextChannel = () =>
    props.channelType === 'text' || props.channelType === 'announcement';
  const isVoiceChannel = () =>
    props.channelType === 'voice' ||
    props.channelType === 'temp_voice' ||
    props.channelType === 'music';

  const getTextPermState = (flag: bigint): PermState => {
    if ((textAllow() & flag) !== 0n) return 'allow';
    if ((textDeny() & flag) !== 0n) return 'deny';
    return 'neutral';
  };

  const getVoicePermState = (flag: bigint): PermState => {
    if ((voiceAllow() & flag) !== 0n) return 'allow';
    if ((voiceDeny() & flag) !== 0n) return 'deny';
    return 'neutral';
  };

  const setTextPermState = (flag: bigint, state: PermState) => {
    switch (state) {
      case 'allow':
        setTextAllow((prev) => prev | flag);
        setTextDeny((prev) => prev & ~flag);
        break;
      case 'neutral':
        setTextAllow((prev) => prev & ~flag);
        setTextDeny((prev) => prev & ~flag);
        break;
      case 'deny':
        setTextAllow((prev) => prev & ~flag);
        setTextDeny((prev) => prev | flag);
        break;
    }
  };

  const setVoicePermState = (flag: bigint, state: PermState) => {
    switch (state) {
      case 'allow':
        setVoiceAllow((prev) => prev | flag);
        setVoiceDeny((prev) => prev & ~flag);
        break;
      case 'neutral':
        setVoiceAllow((prev) => prev & ~flag);
        setVoiceDeny((prev) => prev & ~flag);
        break;
      case 'deny':
        setVoiceAllow((prev) => prev & ~flag);
        setVoiceDeny((prev) => prev | flag);
        break;
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await props.onSave({
        text_allow: textAllow().toString(),
        text_deny: textDeny().toString(),
        voice_allow: voiceAllow().toString(),
        voice_deny: voiceDeny().toString(),
      });
    } finally {
      setSaving(false);
    }
  };

  const textPermEntries = () =>
    Object.entries(TextPermissions).map(([key, value]) => ({
      key: key as keyof typeof TextPermissions,
      flag: value,
      meta: TextPermissionMetadata[key as keyof typeof TextPermissions],
    }));

  const voicePermEntries = () =>
    Object.entries(VoicePermissions).map(([key, value]) => ({
      key: key as keyof typeof VoicePermissions,
      flag: value,
      meta: VoicePermissionMetadata[key as keyof typeof VoicePermissions],
    }));

  return (
    <div class="bg-bg-tertiary rounded-b-lg border-t border-border px-3 py-3 space-y-3">
      {/* Text Permissions */}
      <Show when={isTextChannel()}>
        <div>
          <h5 class="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">
            Text Channel Permissions
          </h5>
          <div class="space-y-0.5">
            <For each={textPermEntries()}>
              {(entry) => (
                <PermissionRow
                  name={entry.meta.name}
                  description={entry.meta.description}
                  state={getTextPermState(entry.flag)}
                  onStateChange={(state) => setTextPermState(entry.flag, state)}
                />
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* Voice Permissions */}
      <Show when={isVoiceChannel()}>
        <div>
          <h5 class="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">
            Voice Channel Permissions
          </h5>
          <div class="space-y-0.5">
            <For each={voicePermEntries()}>
              {(entry) => (
                <PermissionRow
                  name={entry.meta.name}
                  description={entry.meta.description}
                  state={getVoicePermState(entry.flag)}
                  onStateChange={(state) => setVoicePermState(entry.flag, state)}
                />
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* Save / Cancel */}
      <div class="flex gap-2 pt-2 border-t border-border">
        <button
          onClick={props.onCancel}
          class="flex-1 px-3 py-1.5 text-sm text-text-secondary bg-bg-secondary rounded-md hover:bg-bg-modifier-hover transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving()}
          class="flex-1 px-3 py-1.5 text-sm font-medium bg-brand-primary text-white rounded-md hover:bg-brand-primary-hover transition-colors disabled:opacity-50"
        >
          {saving() ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function PermissionRow(props: {
  name: string;
  description: string;
  state: PermState;
  onStateChange: (state: PermState) => void;
}) {
  return (
    <div class="flex items-center justify-between py-1.5 px-2 rounded hover:bg-bg-modifier-hover/50 group">
      <div class="min-w-0 flex-1 mr-3">
        <div class="text-sm text-text-primary">{props.name}</div>
        <div class="text-xs text-text-muted truncate">{props.description}</div>
      </div>
      <div class="flex gap-0.5 flex-shrink-0">
        {/* Deny */}
        <button
          onClick={() => props.onStateChange(props.state === 'deny' ? 'neutral' : 'deny')}
          class={`w-7 h-7 flex items-center justify-center rounded text-xs font-bold transition-colors ${
            props.state === 'deny'
              ? 'bg-danger text-white'
              : 'bg-bg-secondary text-text-muted hover:bg-bg-modifier-hover'
          }`}
          title="Deny"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        {/* Neutral */}
        <button
          onClick={() => props.onStateChange('neutral')}
          class={`w-7 h-7 flex items-center justify-center rounded text-xs font-bold transition-colors ${
            props.state === 'neutral'
              ? 'bg-bg-modifier-hover text-text-primary ring-1 ring-text-muted/30'
              : 'bg-bg-secondary text-text-muted hover:bg-bg-modifier-hover'
          }`}
          title="Neutral (Inherit)"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
            <path stroke-linecap="round" stroke-linejoin="round" d="M20 12H4" />
          </svg>
        </button>
        {/* Allow */}
        <button
          onClick={() =>
            props.onStateChange(props.state === 'allow' ? 'neutral' : 'allow')
          }
          class={`w-7 h-7 flex items-center justify-center rounded text-xs font-bold transition-colors ${
            props.state === 'allow'
              ? 'bg-status-online text-white'
              : 'bg-bg-secondary text-text-muted hover:bg-bg-modifier-hover'
          }`}
          title="Allow"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
