import { useState } from 'react';
import { Modal } from './Modal';
import { api } from '@/api';
import { clsx } from 'clsx';

interface TimeoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetUser: { id: string; username: string; display_name?: string | null };
  serverId: string;
}

const DURATION_PRESETS = [
  { label: '60s', seconds: 60 },
  { label: '5m', seconds: 300 },
  { label: '10m', seconds: 600 },
  { label: '1h', seconds: 3600 },
  { label: '1d', seconds: 86400 },
  { label: '1w', seconds: 604800 },
] as const;

const DURATION_UNITS = [
  { label: 'seconds', multiplier: 1 },
  { label: 'minutes', multiplier: 60 },
  { label: 'hours', multiplier: 3600 },
  { label: 'days', multiplier: 86400 },
  { label: 'weeks', multiplier: 604800 },
] as const;

export function TimeoutModal({ isOpen, onClose, targetUser, serverId }: TimeoutModalProps) {
  const [selectedDuration, setSelectedDuration] = useState<number | null>(null);
  const [customValue, setCustomValue] = useState('');
  const [customUnit, setCustomUnit] = useState(60); // minutes by default
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayName = targetUser.display_name || targetUser.username;
  const isCustom = selectedDuration === null && customValue !== '';
  const effectiveDuration = selectedDuration ?? (customValue ? Number(customValue) * customUnit : 0);
  const canSubmit = effectiveDuration > 0 && !loading;

  const handlePresetClick = (seconds: number) => {
    setSelectedDuration(seconds);
    setCustomValue('');
    setError(null);
  };

  const handleCustomChange = (value: string) => {
    // Only allow positive numbers
    if (value === '' || /^\d+$/.test(value)) {
      setCustomValue(value);
      setSelectedDuration(null);
      setError(null);
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      await api.post(`/servers/${serverId}/members/${targetUser.id}/timeout`, {
        duration: effectiveDuration,
        ...(reason.trim() && { reason: reason.trim() }),
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to timeout member');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setSelectedDuration(null);
    setCustomValue('');
    setReason('');
    setError(null);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={`Timeout ${displayName}`}>
      <div className="space-y-4">
        {/* Duration Presets */}
        <div>
          <label className="text-xs font-medium text-text-muted uppercase tracking-wide">Duration</label>
          <div className="grid grid-cols-3 gap-2 mt-1.5">
            {DURATION_PRESETS.map((preset) => (
              <button
                key={preset.seconds}
                onClick={() => handlePresetClick(preset.seconds)}
                className={clsx(
                  'px-3 py-2 text-sm font-medium rounded-md border transition-colors',
                  selectedDuration === preset.seconds
                    ? 'bg-yellow-500/20 border-yellow-500 text-yellow-400'
                    : 'bg-bg-tertiary border-divider text-text-secondary hover:bg-bg-modifier-hover hover:text-text-primary'
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Custom Duration */}
        <div>
          <label className="text-xs font-medium text-text-muted uppercase tracking-wide">Custom Duration</label>
          <div className="flex gap-2 mt-1.5">
            <input
              type="text"
              inputMode="numeric"
              value={customValue}
              onChange={(e) => handleCustomChange(e.target.value)}
              placeholder="Amount"
              className={clsx(
                'flex-1 px-3 py-2 text-sm bg-bg-tertiary border rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1',
                isCustom ? 'border-yellow-500 focus:ring-yellow-500' : 'border-divider focus:ring-brand-primary'
              )}
            />
            <select
              value={customUnit}
              onChange={(e) => { setCustomUnit(Number(e.target.value)); setSelectedDuration(null); }}
              className="px-3 py-2 text-sm bg-bg-tertiary border border-divider rounded-md text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
            >
              {DURATION_UNITS.map((unit) => (
                <option key={unit.multiplier} value={unit.multiplier}>
                  {unit.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Reason */}
        <div>
          <label className="text-xs font-medium text-text-muted uppercase tracking-wide">Reason (optional)</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this user being timed out?"
            rows={2}
            className="w-full mt-1.5 px-3 py-2 text-sm bg-bg-tertiary border border-divider rounded-md text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:ring-1 focus:ring-brand-primary"
          />
        </div>

        {/* Error */}
        {error && (
          <p className="text-sm text-danger">{error}</p>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-2 text-sm font-medium bg-yellow-500 text-black rounded-md hover:bg-yellow-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Processing...' : 'Timeout'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
