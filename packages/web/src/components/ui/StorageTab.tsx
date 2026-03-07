import { useState, useEffect, useCallback } from 'react';
import { api } from '@/api';

// ── Helpers ──────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function usageColor(pct: number): string {
  if (pct >= 95) return 'bg-red-500';
  if (pct >= 80) return 'bg-orange-500';
  if (pct >= 60) return 'bg-yellow-500';
  return 'bg-green-500';
}

function usagePct(used: number, limit: number | null): number | null {
  if (!limit || limit <= 0) return null;
  return Math.min(100, (used / limit) * 100);
}

// ── Sub-Components ───────────────────────────────────────────────────

function UsageBar({ used, limit, label }: { used: number; limit: number | null; label?: string }) {
  const pct = usagePct(used, limit);
  if (pct === null) {
    return (
      <div className="text-xs text-text-muted">
        {label && <span>{label}: </span>}
        {formatBytes(used)} (no limit)
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-text-muted">
        <span>{label || 'Usage'}: {formatBytes(used)} / {formatBytes(limit!)}</span>
        <span>{pct.toFixed(0)}%</span>
      </div>
      <div className="w-full bg-bg-tertiary rounded-full h-2 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${usageColor(pct)}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-bg-secondary rounded-lg p-4">
      <div className="text-xs text-text-muted uppercase tracking-wide mb-1">{label}</div>
      <div className="text-2xl font-bold text-text-primary">{value}</div>
    </div>
  );
}

function LimitEditor({
  label,
  valueMB,
  onChange,
}: {
  label: string;
  valueMB: number | null;
  onChange: (mb: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(valueMB !== null ? String(valueMB) : '');

  if (!editing) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-text-muted">{label}:</span>
        <span className="text-text-secondary">{valueMB !== null ? `${valueMB} MB` : 'No limit'}</span>
        <button
          onClick={() => { setInput(valueMB !== null ? String(valueMB) : ''); setEditing(true); }}
          className="text-brand-primary hover:underline text-xs"
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-text-muted">{label}:</span>
      <input
        type="number"
        min="0"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="No limit"
        className="w-24 bg-bg-tertiary border border-bg-modifier-accent rounded px-2 py-1 text-xs text-text-primary"
      />
      <span className="text-xs text-text-muted">MB</span>
      <button
        onClick={() => {
          onChange(input ? parseInt(input) : null);
          setEditing(false);
        }}
        className="text-xs text-green-400 hover:underline"
      >
        Save
      </button>
      <button onClick={() => setEditing(false)} className="text-xs text-text-muted hover:underline">
        Cancel
      </button>
    </div>
  );
}

function RetentionEditor({
  label,
  days,
  onChange,
}: {
  label: string;
  days: number;
  onChange: (days: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(String(days));

  if (!editing) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-text-muted">{label}:</span>
        <span className="text-text-secondary">{days} days</span>
        <button
          onClick={() => { setInput(String(days)); setEditing(true); }}
          className="text-brand-primary hover:underline text-xs"
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-text-muted">{label}:</span>
      <input
        type="number"
        min="1"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        className="w-20 bg-bg-tertiary border border-bg-modifier-accent rounded px-2 py-1 text-xs text-text-primary"
      />
      <span className="text-xs text-text-muted">days</span>
      <button
        onClick={() => {
          const v = parseInt(input);
          if (v >= 1) { onChange(v); setEditing(false); }
        }}
        className="text-xs text-green-400 hover:underline"
      >
        Save
      </button>
      <button onClick={() => setEditing(false)} className="text-xs text-text-muted hover:underline">
        Cancel
      </button>
    </div>
  );
}

function CollapsibleSection({
  title,
  totalBytes,
  limitBytes,
  defaultOpen = false,
  children,
}: {
  title: string;
  totalBytes: number;
  limitBytes?: number | null;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const pct = usagePct(totalBytes, limitBytes ?? null);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-bg-secondary hover:bg-bg-modifier-hover transition-colors"
      >
        <div className="flex items-center gap-3">
          <svg className={`w-4 h-4 text-text-muted transition-transform ${open ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-sm font-medium text-text-primary">{title}</span>
        </div>
        <div className="flex items-center gap-3">
          {pct !== null && (
            <div className={`text-xs px-2 py-0.5 rounded ${pct >= 95 ? 'bg-red-500/20 text-red-400' : pct >= 80 ? 'bg-orange-500/20 text-orange-400' : 'bg-green-500/20 text-green-400'}`}>
              {pct.toFixed(0)}%
            </div>
          )}
          <span className="text-sm text-text-muted">{formatBytes(totalBytes)}</span>
        </div>
      </button>
      {open && <div className="px-4 py-3 space-y-3 border-t border-border">{children}</div>}
    </div>
  );
}

function PurgeButton({
  category,
  onPurge,
  disabled,
  label,
}: {
  category: string;
  onPurge: (category: string, percent?: number, olderThanDays?: number) => void;
  disabled: boolean;
  label?: string;
}) {
  const [showSlider, setShowSlider] = useState(false);
  const [percent, setPercent] = useState(25);
  const presets = [25, 50, 60, 75];

  if (!showSlider) {
    return (
      <button
        onClick={() => setShowSlider(true)}
        disabled={disabled}
        className="px-3 py-1.5 bg-danger/20 hover:bg-danger/30 text-danger rounded-md text-xs transition-colors disabled:opacity-50"
      >
        {label || 'Purge Oldest'}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-text-muted">Purge oldest:</span>
      {presets.map((p) => (
        <button
          key={p}
          onClick={() => setPercent(p)}
          className={`px-2 py-1 rounded text-xs transition-colors ${
            percent === p ? 'bg-danger text-white' : 'bg-bg-tertiary text-text-secondary hover:bg-bg-modifier-hover'
          }`}
        >
          {p}%
        </button>
      ))}
      <button
        onClick={() => { onPurge(category, percent); setShowSlider(false); }}
        disabled={disabled}
        className="px-3 py-1 bg-danger hover:bg-danger/80 text-white rounded text-xs transition-colors disabled:opacity-50"
      >
        Purge {percent}%
      </button>
      <button
        onClick={() => setShowSlider(false)}
        className="text-xs text-text-muted hover:underline"
      >
        Cancel
      </button>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────

export function StorageTab() {
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [purging, setPurging] = useState(false);
  const [purgePreview, setPurgePreview] = useState<any>(null);

  // Retention settings (merged from old RetentionTab)
  const [retentionSettings, setRetentionSettings] = useState<any>(null);
  const [retentionSaving, setRetentionSaving] = useState(false);
  const [retentionSaved, setRetentionSaved] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<any>(null);
  const [cleaningUp, setCleaningUp] = useState(false);
  const [cleanupLogs, setCleanupLogs] = useState<any[]>([]);

  const fetchDashboard = useCallback(async () => {
    try {
      const data = await api.get<any>('/server/storage/dashboard');
      setDashboard(data);
    } catch (err) {
      console.error('Failed to fetch storage dashboard:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchRetention = useCallback(async () => {
    try {
      const [retData, logsData] = await Promise.all([
        api.get<any>('/server/settings/retention'),
        api.get<any>('/server/cleanup/logs'),
      ]);
      setRetentionSettings(retData);
      setCleanupLogs(logsData.logs || []);
    } catch (err) {
      console.error('Failed to fetch retention data:', err);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
    fetchRetention();
  }, [fetchDashboard, fetchRetention]);

  const handleLimitChange = async (field: string, valueMB: number | null) => {
    try {
      const bytes = valueMB !== null ? valueMB * 1024 * 1024 : null;
      await api.patch('/server/storage/limits', { [field]: bytes });
      await fetchDashboard();
    } catch (err) {
      console.error('Failed to update limit:', err);
    }
  };

  const handleRetentionDaysChange = async (field: string, days: number) => {
    try {
      await api.patch('/server/storage/limits', { [field]: days });
      await fetchDashboard();
    } catch (err) {
      console.error('Failed to update retention:', err);
    }
  };

  const handlePurge = async (category: string, percent?: number, olderThanDays?: number) => {
    setPurging(true);
    try {
      // First do a dry run
      const preview = await api.post<any>('/server/storage/purge', {
        category,
        percent,
        older_than_days: olderThanDays,
        dry_run: true,
      });
      setPurgePreview({ ...preview, category, percent, older_than_days: olderThanDays });
    } catch (err) {
      console.error('Purge preview failed:', err);
    } finally {
      setPurging(false);
    }
  };

  const confirmPurge = async () => {
    if (!purgePreview) return;
    setPurging(true);
    try {
      await api.post('/server/storage/purge', {
        category: purgePreview.category,
        percent: purgePreview.percent,
        older_than_days: purgePreview.older_than_days,
        dry_run: false,
      });
      setPurgePreview(null);
      await fetchDashboard();
    } catch (err) {
      console.error('Purge failed:', err);
    } finally {
      setPurging(false);
    }
  };

  const handleRetentionSave = async () => {
    setRetentionSaving(true);
    try {
      const result = await api.patch<any>('/server/settings/retention', retentionSettings);
      setRetentionSettings(result.settings);
      setRetentionSaved(true);
      setTimeout(() => setRetentionSaved(false), 3000);
    } catch (err) {
      console.error('Failed to save retention settings:', err);
    } finally {
      setRetentionSaving(false);
    }
  };

  const handleCleanup = async (dryRun: boolean) => {
    setCleaningUp(true);
    try {
      const result = await api.post<any>('/server/cleanup/run', { dry_run: dryRun });
      setCleanupResult(result);
      if (!dryRun) await fetchDashboard();
    } catch (err) {
      console.error('Failed to run cleanup:', err);
    } finally {
      setCleaningUp(false);
    }
  };

  const handleAutoPurgeToggle = async (field: string, value: any) => {
    try {
      await api.patch('/server/storage/limits', { [field]: value });
      await fetchDashboard();
    } catch (err) {
      console.error('Failed to update auto-purge setting:', err);
    }
  };

  if (loading) return <div className="text-text-muted text-center py-8">Loading storage dashboard...</div>;
  if (!dashboard) return <div className="text-danger text-center py-8">Failed to load storage data</div>;

  const { categories: cats, grand_total_bytes, limits, alerts } = dashboard;

  return (
    <div className="space-y-6">
      {/* ── Overview ── */}
      <div>
        <h3 className="text-lg font-semibold text-text-primary mb-1">Storage Management</h3>
        <p className="text-sm text-text-muted">Monitor and manage server storage across all categories.</p>
      </div>

      {/* Alerts */}
      {alerts?.length > 0 && (
        <div className="space-y-2">
          {alerts.map((alert: any, i: number) => (
            <div
              key={i}
              className={`p-3 rounded-md text-sm ${
                alert.severity === 'critical' ? 'bg-danger/20 text-danger' : 'bg-yellow-500/20 text-yellow-400'
              }`}
            >
              {alert.message}
            </div>
          ))}
        </div>
      )}

      {/* Grand Total */}
      <div className="bg-bg-secondary rounded-lg p-4">
        <div className="text-xs text-text-muted uppercase tracking-wide mb-2">Total Storage Used</div>
        <div className="text-3xl font-bold text-text-primary">{formatBytes(grand_total_bytes)}</div>
      </div>

      {/* ── Purge Preview Modal ── */}
      {purgePreview && (
        <div className="bg-bg-secondary border border-danger/50 rounded-lg p-4 space-y-3">
          <h4 className="text-sm font-semibold text-danger">Purge Preview</h4>
          <p className="text-sm text-text-secondary">
            Category: <strong>{purgePreview.category}</strong> — {purgePreview.items_affected} items, {formatBytes(purgePreview.bytes_freed)} would be freed
          </p>
          <div className="flex gap-2">
            <button
              onClick={confirmPurge}
              disabled={purging}
              className="px-4 py-2 bg-danger hover:bg-danger/80 text-white rounded-md text-sm font-medium transition-colors disabled:opacity-50"
            >
              {purging ? 'Purging...' : 'Confirm Purge'}
            </button>
            <button
              onClick={() => setPurgePreview(null)}
              className="px-4 py-2 bg-bg-tertiary hover:bg-bg-modifier-hover text-text-secondary rounded-md text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Channels ── */}
      {cats.channels && (
        <CollapsibleSection title="Channels" totalBytes={cats.channels.total_bytes} limitBytes={cats.channels.limit} defaultOpen>
          <UsageBar used={cats.channels.total_bytes} limit={cats.channels.limit} />
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Message Storage" value={formatBytes(cats.channels.message_bytes)} />
            <StatCard label="Attachment Storage" value={formatBytes(cats.channels.attachment_bytes)} />
          </div>
          <LimitEditor
            label="Message limit"
            valueMB={limits.channel_message_limit_bytes ? Math.round(limits.channel_message_limit_bytes / 1024 / 1024) : null}
            onChange={(mb) => handleLimitChange('channel_message_limit_bytes', mb)}
          />
          <LimitEditor
            label="Attachment limit"
            valueMB={limits.channel_attachment_limit_bytes ? Math.round(limits.channel_attachment_limit_bytes / 1024 / 1024) : null}
            onChange={(mb) => handleLimitChange('channel_attachment_limit_bytes', mb)}
          />

          {cats.channels.channels?.length > 0 && (
            <div className="bg-bg-tertiary rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-3 py-2 text-text-muted font-medium">Channel</th>
                    <th className="text-right px-3 py-2 text-text-muted font-medium">Messages</th>
                    <th className="text-right px-3 py-2 text-text-muted font-medium">Attachments</th>
                    <th className="text-right px-3 py-2 text-text-muted font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {cats.channels.channels.map((ch: any) => (
                    <tr key={ch.id} className="border-b border-border/50 last:border-0">
                      <td className="px-3 py-2 text-text-primary">#{ch.name}</td>
                      <td className="px-3 py-2 text-right text-text-secondary">{formatBytes(ch.message_bytes)}</td>
                      <td className="px-3 py-2 text-right text-text-secondary">{formatBytes(ch.attachment_bytes)}</td>
                      <td className="px-3 py-2 text-right text-text-secondary">{formatBytes(ch.total_bytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <PurgeButton category="channels" onPurge={handlePurge} disabled={purging} />
        </CollapsibleSection>
      )}

      {/* ── DMs ── */}
      {cats.dms && (
        <CollapsibleSection title="Direct Messages" totalBytes={cats.dms.total_bytes} limitBytes={cats.dms.limit}>
          <UsageBar used={cats.dms.total_bytes} limit={cats.dms.limit} />
          {cats.dms.slow_query && (
            <div className="text-xs text-yellow-400">Note: DM stats may be incomplete due to query timeout</div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="DM Conversations" value={cats.dms.dm_count.toLocaleString()} />
            <StatCard label="Total Size" value={formatBytes(cats.dms.total_bytes)} />
            <StatCard label="Average per DM" value={formatBytes(cats.dms.avg_per_dm_bytes)} />
            <StatCard label="Median per DM" value={formatBytes(cats.dms.median_per_dm_bytes)} />
          </div>
          <LimitEditor
            label="DM message limit"
            valueMB={limits.dm_message_limit_bytes ? Math.round(limits.dm_message_limit_bytes / 1024 / 1024) : null}
            onChange={(mb) => handleLimitChange('dm_message_limit_bytes', mb)}
          />
          <PurgeButton category="dms" onPurge={handlePurge} disabled={purging} />
        </CollapsibleSection>
      )}

      {/* ── Emojis ── */}
      {cats.emojis && (
        <CollapsibleSection title="Emoji Packs" totalBytes={cats.emojis.total_bytes} limitBytes={cats.emojis.limit}>
          <UsageBar used={cats.emojis.total_bytes} limit={cats.emojis.limit} />
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Emojis" value={cats.emojis.emoji_count} />
            <StatCard label="Packs" value={cats.emojis.pack_count} />
          </div>
          <LimitEditor
            label="Emoji storage limit"
            valueMB={limits.emoji_storage_limit_bytes ? Math.round(limits.emoji_storage_limit_bytes / 1024 / 1024) : null}
            onChange={(mb) => handleLimitChange('emoji_storage_limit_bytes', mb)}
          />
          <PurgeButton category="emojis" onPurge={handlePurge} disabled={purging} />
        </CollapsibleSection>
      )}

      {/* ── Stickers ── */}
      {cats.stickers && (
        <CollapsibleSection title="Stickers" totalBytes={cats.stickers.total_bytes} limitBytes={cats.stickers.limit}>
          <UsageBar used={cats.stickers.total_bytes} limit={cats.stickers.limit} />
          <StatCard label="Stickers" value={cats.stickers.sticker_count} />
          {cats.stickers.total_bytes === 0 && cats.stickers.sticker_count > 0 && (
            <div className="text-xs text-yellow-400">Some sticker sizes are unknown (pre-migration)</div>
          )}
          <LimitEditor
            label="Sticker storage limit"
            valueMB={limits.sticker_storage_limit_bytes ? Math.round(limits.sticker_storage_limit_bytes / 1024 / 1024) : null}
            onChange={(mb) => handleLimitChange('sticker_storage_limit_bytes', mb)}
          />
          <PurgeButton category="stickers" onPurge={handlePurge} disabled={purging} />
        </CollapsibleSection>
      )}

      {/* ── Profiles ── */}
      {cats.profiles && (
        <CollapsibleSection title="Profiles" totalBytes={cats.profiles.total_bytes}>
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Avatars" value={`${cats.profiles.avatars.count} (${formatBytes(cats.profiles.avatars.total_bytes)})`} />
            <StatCard label="Banners" value={`${cats.profiles.banners.count} (${formatBytes(cats.profiles.banners.total_bytes)})`} />
            <StatCard label="Soundboard" value={`${cats.profiles.soundboard.count} (${formatBytes(cats.profiles.soundboard.total_bytes)})`} />
            <StatCard label="Voice Sounds" value={`${cats.profiles.voice_sounds.count} (${formatBytes(cats.profiles.voice_sounds.total_bytes)})`} />
          </div>
          <LimitEditor
            label="Avatar limit"
            valueMB={limits.profile_avatar_limit_bytes ? Math.round(limits.profile_avatar_limit_bytes / 1024 / 1024) : null}
            onChange={(mb) => handleLimitChange('profile_avatar_limit_bytes', mb)}
          />
          <LimitEditor
            label="Banner limit"
            valueMB={limits.profile_banner_limit_bytes ? Math.round(limits.profile_banner_limit_bytes / 1024 / 1024) : null}
            onChange={(mb) => handleLimitChange('profile_banner_limit_bytes', mb)}
          />
          <LimitEditor
            label="Sound limit"
            valueMB={limits.profile_sound_limit_bytes ? Math.round(limits.profile_sound_limit_bytes / 1024 / 1024) : null}
            onChange={(mb) => handleLimitChange('profile_sound_limit_bytes', mb)}
          />
          <PurgeButton category="profiles" onPurge={handlePurge} disabled={purging} label="Clean Up Orphaned" />
        </CollapsibleSection>
      )}

      {/* ── Uploads & Media ── */}
      {cats.uploads && (
        <CollapsibleSection title="Uploads & Media" totalBytes={cats.uploads.total_bytes}>
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Files" value={cats.uploads.file_count} />
            <StatCard label="Total Size" value={formatBytes(cats.uploads.total_bytes)} />
            {cats.uploads.oldest_file && (
              <StatCard label="Oldest File" value={new Date(cats.uploads.oldest_file).toLocaleDateString()} />
            )}
            <StatCard label="Orphaned Files" value={cats.uploads.orphan_count} />
          </div>
          <div className="flex gap-2 flex-wrap">
            {cats.uploads.orphan_count > 0 && (
              <PurgeButton category="uploads" onPurge={handlePurge} disabled={purging} label="Purge Orphans" />
            )}
            <PurgeButton category="uploads" onPurge={(cat) => handlePurge(cat, undefined, 90)} disabled={purging} label="Purge > 90 Days" />
          </div>
        </CollapsibleSection>
      )}

      {/* ── Archives ── */}
      {cats.archives && (
        <CollapsibleSection title="Archives" totalBytes={cats.archives.total_bytes} limitBytes={cats.archives.limit}>
          <UsageBar used={cats.archives.total_bytes} limit={cats.archives.limit} />
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Archives" value={cats.archives.archive_count} />
            <StatCard label="Health" value={cats.archives.healthy ? 'Healthy' : 'Issues Detected'} />
          </div>
          <LimitEditor
            label="Archive limit"
            valueMB={limits.archive_limit_bytes ? Math.round(limits.archive_limit_bytes / 1024 / 1024) : null}
            onChange={(mb) => handleLimitChange('archive_limit_bytes', mb)}
          />
          <PurgeButton category="archives" onPurge={handlePurge} disabled={purging} />
        </CollapsibleSection>
      )}

      {/* ── Exports ── */}
      {cats.exports && (
        <CollapsibleSection title="Exports" totalBytes={cats.exports.total_bytes}>
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Export Files" value={cats.exports.export_count ?? cats.exports.count ?? 0} />
            <StatCard label="Total Size" value={formatBytes(cats.exports.total_bytes)} />
          </div>
          <RetentionEditor
            label="Export retention"
            days={limits.export_retention_days}
            onChange={(days) => handleRetentionDaysChange('export_retention_days', days)}
          />
          <PurgeButton category="exports" onPurge={handlePurge} disabled={purging} />
        </CollapsibleSection>
      )}

      {/* ── System Data ── */}
      {cats.db_tables && (
        <CollapsibleSection title="System Data" totalBytes={
          (cats.db_tables.crash_reports?.est_bytes || 0) +
          (cats.db_tables.notifications?.est_bytes || 0) +
          (cats.db_tables.trimming_log?.est_bytes || 0)
        }>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">Crash Reports: {cats.db_tables.crash_reports?.count || 0} rows ({formatBytes(cats.db_tables.crash_reports?.est_bytes || 0)})</span>
              <RetentionEditor
                label=""
                days={limits.crash_report_retention_days}
                onChange={(days) => handleRetentionDaysChange('crash_report_retention_days', days)}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">Notifications: {cats.db_tables.notifications?.count || 0} rows ({formatBytes(cats.db_tables.notifications?.est_bytes || 0)})</span>
              <RetentionEditor
                label=""
                days={limits.notification_retention_days}
                onChange={(days) => handleRetentionDaysChange('notification_retention_days', days)}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">Trimming Log: {cats.db_tables.trimming_log?.count || 0} rows ({formatBytes(cats.db_tables.trimming_log?.est_bytes || 0)})</span>
              <RetentionEditor
                label=""
                days={limits.trimming_log_retention_days}
                onChange={(days) => handleRetentionDaysChange('trimming_log_retention_days', days)}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                handlePurge('crash_reports');
                handlePurge('notifications');
                handlePurge('trimming_log');
              }}
              disabled={purging}
              className="px-3 py-1.5 bg-danger/20 hover:bg-danger/30 text-danger rounded-md text-xs transition-colors disabled:opacity-50"
            >
              Purge All Expired
            </button>
          </div>
        </CollapsibleSection>
      )}

      {/* ── Retention Settings (merged from old RetentionTab) ── */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-bg-secondary">
          <h4 className="text-sm font-semibold text-text-primary">Retention Settings</h4>
          <p className="text-xs text-text-muted mt-1">Configure message retention policies and run cleanup operations.</p>
        </div>
        <div className="px-4 py-3 space-y-4 border-t border-border">
          {retentionSettings ? (
            <>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1" htmlFor="storage-channel-size-limit">Default Channel Size Limit (MB)</label>
                <input
                  type="number"
                  id="storage-channel-size-limit"
                  name="storage-channel-size-limit"
                  value={Math.round((retentionSettings.default_channel_size_limit_bytes || 0) / 1024 / 1024)}
                  onChange={(e) => setRetentionSettings({ ...retentionSettings, default_channel_size_limit_bytes: parseInt(e.target.value || '0') * 1024 * 1024 })}
                  className="w-full bg-bg-tertiary border border-bg-modifier-accent rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-primary"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1" htmlFor="storage-warning-threshold">Warning Threshold (%)</label>
                  <input
                    type="number"
                    id="storage-warning-threshold"
                    name="storage-warning-threshold"
                    min="0"
                    max="100"
                    value={retentionSettings.storage_warning_threshold_percent || 80}
                    onChange={(e) => setRetentionSettings({ ...retentionSettings, storage_warning_threshold_percent: parseInt(e.target.value || '80') })}
                    className="w-full bg-bg-tertiary border border-bg-modifier-accent rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1" htmlFor="storage-action-threshold">Action Threshold (%)</label>
                  <input
                    type="number"
                    id="storage-action-threshold"
                    name="storage-action-threshold"
                    min="0"
                    max="100"
                    value={retentionSettings.storage_action_threshold_percent || 95}
                    onChange={(e) => setRetentionSettings({ ...retentionSettings, storage_action_threshold_percent: parseInt(e.target.value || '95') })}
                    className="w-full bg-bg-tertiary border border-bg-modifier-accent rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-primary"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleRetentionSave}
                  disabled={retentionSaving}
                  className="px-4 py-2 bg-brand-primary hover:bg-brand-primary-hover text-white rounded-md text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {retentionSaving ? 'Saving...' : 'Save Settings'}
                </button>
                {retentionSaved && <span className="text-sm text-green-400">Saved!</span>}
              </div>

              <div className="border-t border-border pt-4">
                <h4 className="text-sm font-semibold text-text-primary mb-2">Manual Cleanup</h4>
                <p className="text-xs text-text-muted mb-3">Run cleanup to delete old messages exceeding channel size limits.</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleCleanup(true)}
                    disabled={cleaningUp}
                    className="px-3 py-1.5 bg-bg-tertiary hover:bg-bg-modifier-hover text-text-secondary rounded-md text-sm transition-colors disabled:opacity-50"
                  >
                    {cleaningUp ? 'Running...' : 'Preview (Dry Run)'}
                  </button>
                  <button
                    onClick={() => handleCleanup(false)}
                    disabled={cleaningUp}
                    className="px-3 py-1.5 bg-danger hover:bg-danger/80 text-white rounded-md text-sm transition-colors disabled:opacity-50"
                  >
                    Run Cleanup
                  </button>
                </div>
                {cleanupResult && (
                  <div className="mt-3 bg-bg-secondary rounded-md p-3 text-sm">
                    <p className="text-text-primary">
                      {cleanupResult.dry_run ? 'Preview' : 'Cleanup complete'}: {cleanupResult.total_messages_deleted} messages, {formatBytes(cleanupResult.total_bytes_freed || 0)} freed
                    </p>
                  </div>
                )}
              </div>

              {cleanupLogs.length > 0 && (
                <div className="border-t border-border pt-4">
                  <h4 className="text-sm font-semibold text-text-primary mb-2">Cleanup History</h4>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {cleanupLogs.map((log: any, i: number) => (
                      <div key={i} className="bg-bg-secondary rounded-md p-2 text-xs">
                        <div className="flex justify-between text-text-muted">
                          <span>{log.messages_deleted || 0} messages deleted</span>
                          <span>{new Date(log.created_at).toLocaleString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-text-muted text-sm">Loading retention settings...</div>
          )}
        </div>
      </div>

      {/* ── Auto-Purge Settings ── */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-bg-secondary">
          <h4 className="text-sm font-semibold text-text-primary">Auto-Purge</h4>
          <p className="text-xs text-text-muted mt-1">Automatically purge storage when categories exceed their limits.</p>
        </div>
        <div className="px-4 py-3 space-y-4 border-t border-border">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={limits.auto_purge_enabled || false}
              onChange={(e) => handleAutoPurgeToggle('auto_purge_enabled', e.target.checked)}
              className="w-4 h-4 rounded border-bg-modifier-accent bg-bg-tertiary text-brand-primary focus:ring-brand-primary"
            />
            <span className="text-sm text-text-primary">Enable auto-purge</span>
          </label>

          {limits.auto_purge_enabled && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1" htmlFor="auto-purge-threshold">Trigger Threshold (%)</label>
                <input
                  type="number"
                  id="auto-purge-threshold"
                  name="auto-purge-threshold"
                  min="1"
                  max="100"
                  value={limits.auto_purge_threshold_percent}
                  onChange={(e) => handleAutoPurgeToggle('auto_purge_threshold_percent', parseInt(e.target.value || '90'))}
                  className="w-full bg-bg-tertiary border border-bg-modifier-accent rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1" htmlFor="auto-purge-target">Target After Purge (%)</label>
                <input
                  type="number"
                  id="auto-purge-target"
                  name="auto-purge-target"
                  min="1"
                  max="100"
                  value={limits.auto_purge_target_percent}
                  onChange={(e) => handleAutoPurgeToggle('auto_purge_target_percent', parseInt(e.target.value || '75'))}
                  className="w-full bg-bg-tertiary border border-bg-modifier-accent rounded-md px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-primary"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
