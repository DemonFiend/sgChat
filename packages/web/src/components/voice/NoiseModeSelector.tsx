import { useVoiceSettingsStore } from '@/stores/voiceSettings';
import { checkRnnoiseSupport } from '@/audio/micPipeline';
import type { NoiseSuppressionMode } from '@sgchat/shared';
import { WEB_NOISE_MODES } from '@sgchat/shared';
import clsx from 'clsx';
import { useMemo } from 'react';

const MODE_LABELS: Record<string, string> = {
  off: 'Off',
  native: 'Standard',
  nsnet2: 'AI Enhanced',
};

const MODE_DESCRIPTIONS: Record<string, string> = {
  off: 'No noise suppression',
  native: 'Browser built-in noise reduction',
  nsnet2: 'AI-powered noise removal (RNNoise WASM)',
};

export function NoiseModeSelector() {
  const mode = useVoiceSettingsStore((s) => s.noiseSuppressionMode);
  const aggressiveness = useVoiceSettingsStore((s) => s.noiseAggressiveness);
  const setNoiseMode = useVoiceSettingsStore((s) => s.setNoiseMode);
  const setAggressiveness = useVoiceSettingsStore((s) => s.setAggressiveness);

  const rnnoiseSupport = useMemo(() => checkRnnoiseSupport(), []);

  // Map deepfilter (desktop-only) to nsnet2 for display
  const displayMode = mode === 'deepfilter' ? 'nsnet2' : mode;

  const handleModeChange = (newMode: NoiseSuppressionMode) => {
    if (newMode === 'nsnet2' && !rnnoiseSupport.supported) return;
    setNoiseMode(newMode);
  };

  return (
    <div className="space-y-3">
      <div>
        <div className="text-text-primary font-medium mb-1">Noise Suppression</div>
        <div className="text-sm text-text-muted mb-3">
          {MODE_DESCRIPTIONS[displayMode] || MODE_DESCRIPTIONS.native}
        </div>
      </div>

      {/* Segmented control */}
      <div className="flex rounded-lg bg-bg-tertiary p-1 gap-1">
        {WEB_NOISE_MODES.map((m) => {
          const isActive = displayMode === m;
          const isDisabled = m === 'nsnet2' && !rnnoiseSupport.supported;

          return (
            <button
              key={m}
              onClick={() => handleModeChange(m)}
              disabled={isDisabled}
              className={clsx(
                'flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                isActive
                  ? 'bg-success text-white shadow-sm'
                  : isDisabled
                    ? 'text-text-muted opacity-50 cursor-not-allowed'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-secondary',
              )}
            >
              {MODE_LABELS[m]}
            </button>
          );
        })}
      </div>

      {/* Capability warning */}
      {!rnnoiseSupport.supported && (
        <div className="text-xs text-warning">
          AI Enhanced not available: {rnnoiseSupport.reason}
        </div>
      )}

      {/* Aggressiveness slider (only for nsnet2/deepfilter) */}
      {displayMode === 'nsnet2' && (
        <div className="pt-2">
          <label
            className="block text-xs font-bold uppercase text-text-muted mb-2"
            htmlFor="noise-aggressiveness"
          >
            Suppression Strength — {Math.round(aggressiveness * 100)}%
          </label>
          <input
            type="range"
            id="noise-aggressiveness"
            min="0"
            max="100"
            value={Math.round(aggressiveness * 100)}
            onChange={(e) => setAggressiveness(parseInt(e.target.value) / 100)}
            className="w-full accent-brand-primary"
          />
        </div>
      )}
    </div>
  );
}
