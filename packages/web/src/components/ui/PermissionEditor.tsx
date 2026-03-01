import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
}

type PermState = 'allow' | 'neutral' | 'deny';
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function PermissionEditor({ channelType, textAllow: textAllowProp, textDeny: textDenyProp, voiceAllow: voiceAllowProp, voiceDeny: voiceDenyProp, onSave }: PermissionEditorProps) {
  const [textAllow, setTextAllow] = useState(BigInt(textAllowProp || '0'));
  const [textDeny, setTextDeny] = useState(BigInt(textDenyProp || '0'));
  const [voiceAllow, setVoiceAllow] = useState(BigInt(voiceAllowProp || '0'));
  const [voiceDeny, setVoiceDeny] = useState(BigInt(voiceDenyProp || '0'));
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const savedTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const isTextChannel = channelType === 'text' || channelType === 'announcement';
  const isVoiceChannel = channelType === 'voice' || channelType === 'temp_voice' || channelType === 'music';

  const scheduleAutoSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    setSaveStatus('saving');
    saveTimerRef.current = setTimeout(async () => {
      try {
        // Read current state at save time
        await onSave({
          text_allow: textAllow.toString(),
          text_deny: textDeny.toString(),
          voice_allow: voiceAllow.toString(),
          voice_deny: voiceDeny.toString(),
        });
        setSaveStatus('saved');
        savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000);
      } catch {
        setSaveStatus('error');
        savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 3000);
      }
    }, 600);
  }, [textAllow, textDeny, voiceAllow, voiceDeny, onSave]);

  const getTextPermState = (flag: bigint): PermState => {
    if ((textAllow & flag) !== 0n) return 'allow';
    if ((textDeny & flag) !== 0n) return 'deny';
    return 'neutral';
  };

  const getVoicePermState = (flag: bigint): PermState => {
    if ((voiceAllow & flag) !== 0n) return 'allow';
    if ((voiceDeny & flag) !== 0n) return 'deny';
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
    // scheduleAutoSave will be called via effect
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

  // Auto-save when permissions change
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    scheduleAutoSave();
  }, [textAllow, textDeny, voiceAllow, voiceDeny]);

  const textPermEntries = useMemo(() =>
    Object.entries(TextPermissions).map(([key, value]) => ({
      key: key as keyof typeof TextPermissions,
      flag: value,
      meta: TextPermissionMetadata[key as keyof typeof TextPermissions],
    })), []);

  const voicePermEntries = useMemo(() =>
    Object.entries(VoicePermissions).map(([key, value]) => ({
      key: key as keyof typeof VoicePermissions,
      flag: value,
      meta: VoicePermissionMetadata[key as keyof typeof VoicePermissions],
    })), []);

  return (
    <div className="bg-bg-tertiary rounded-b-lg border-t border-border px-3 py-3 space-y-3">
      {/* Auto-save status indicator */}
      <div className="flex items-center justify-end gap-1.5 text-xs min-h-[18px]">
        {saveStatus === 'saving' && (
          <div className="flex items-center gap-1 text-text-muted">
            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span>Saving...</span>
          </div>
        )}
        {saveStatus === 'saved' && (
          <div className="flex items-center gap-1 text-status-online">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span>Saved</span>
          </div>
        )}
        {saveStatus === 'error' && (
          <div className="flex items-center gap-1 text-danger">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            <span>Failed to save</span>
          </div>
        )}
      </div>

      {/* Text Permissions */}
      {isTextChannel && (
        <div>
          <h5 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">
            Text Channel Permissions
          </h5>
          <div className="space-y-0.5">
            {textPermEntries.map((entry) => (
              <PermissionRow
                key={entry.key}
                name={entry.meta.name}
                description={entry.meta.description}
                state={getTextPermState(entry.flag)}
                onStateChange={(state) => setTextPermState(entry.flag, state)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Voice Permissions */}
      {isVoiceChannel && (
        <div>
          <h5 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">
            Voice Channel Permissions
          </h5>
          <div className="space-y-0.5">
            {voicePermEntries.map((entry) => (
              <PermissionRow
                key={entry.key}
                name={entry.meta.name}
                description={entry.meta.description}
                state={getVoicePermState(entry.flag)}
                onStateChange={(state) => setVoicePermState(entry.flag, state)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PermissionRow({ name, description, state, onStateChange }: {
  name: string;
  description: string;
  state: PermState;
  onStateChange: (state: PermState) => void;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-bg-modifier-hover/50 group">
      <div className="min-w-0 flex-1 mr-3">
        <div className="text-sm text-text-primary">{name}</div>
        <div className="text-xs text-text-muted truncate">{description}</div>
      </div>
      <div className="flex gap-0.5 flex-shrink-0">
        {/* Deny */}
        <button
          onClick={() => onStateChange(state === 'deny' ? 'neutral' : 'deny')}
          className={`w-7 h-7 flex items-center justify-center rounded text-xs font-bold transition-colors ${
            state === 'deny'
              ? 'bg-danger text-white'
              : 'bg-bg-secondary text-text-muted hover:bg-bg-modifier-hover'
          }`}
          title="Deny"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        {/* Neutral */}
        <button
          onClick={() => onStateChange('neutral')}
          className={`w-7 h-7 flex items-center justify-center rounded text-xs font-bold transition-colors ${
            state === 'neutral'
              ? 'bg-bg-modifier-hover text-text-primary ring-1 ring-text-muted/30'
              : 'bg-bg-secondary text-text-muted hover:bg-bg-modifier-hover'
          }`}
          title="Neutral (Inherit)"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
          </svg>
        </button>
        {/* Allow */}
        <button
          onClick={() => onStateChange(state === 'allow' ? 'neutral' : 'allow')}
          className={`w-7 h-7 flex items-center justify-center rounded text-xs font-bold transition-colors ${
            state === 'allow'
              ? 'bg-status-online text-white'
              : 'bg-bg-secondary text-text-muted hover:bg-bg-modifier-hover'
          }`}
          title="Allow"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
