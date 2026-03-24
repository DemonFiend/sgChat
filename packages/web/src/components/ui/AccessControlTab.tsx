import { useState, useEffect, useCallback } from 'react';
import { api } from '@/api';
import { socketService } from '@/lib/socket';

// ── Types ────────────────────────────────────────────────────────────

interface AccessControlSettings {
  signups_disabled: boolean;
  member_approvals_enabled: boolean;
  approvals_skip_for_invited: boolean;
}

interface IntakeQuestion {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'checkbox';
  required: boolean;
  max_length?: number;
  placeholder?: string;
  options?: string[];
}

interface IntakeFormConfig {
  questions: IntakeQuestion[];
}

interface Approval {
  id: string;
  user_id: string;
  username: string;
  avatar_url: string | null;
  status: 'pending' | 'approved' | 'denied';
  responses: Record<string, string | boolean>;
  invite_code: string | null;
  denial_reason: string | null;
  created_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

interface AccessControlTabProps {
  serverId: string;
}

// ── Main Tab ─────────────────────────────────────────────────────────

export function AccessControlTab({ serverId }: AccessControlTabProps) {
  const [settings, setSettings] = useState<AccessControlSettings>({
    signups_disabled: false,
    member_approvals_enabled: false,
    approvals_skip_for_invited: false,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<'settings' | 'intake-form' | 'approvals'>(
    'settings',
  );

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const data = await api.get<AccessControlSettings>('/server/settings/access-control');
        setSettings(data);
      } catch {
        // defaults are fine
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await api.patch('/server/settings/access-control', settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      // error handled silently
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-text-muted">Loading...</div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-text-primary mb-1">Access Control</h2>
      <p className="text-sm text-text-muted mb-6">
        Control who can register and join your server.
      </p>

      {/* Section Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border-primary">
        {(['settings', 'intake-form', 'approvals'] as const).map((section) => (
          <button
            key={section}
            onClick={() => setActiveSection(section)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeSection === section
                ? 'border-accent-primary text-text-primary'
                : 'border-transparent text-text-muted hover:text-text-primary'
            }`}
          >
            {section === 'settings'
              ? 'Settings'
              : section === 'intake-form'
                ? 'Intake Form'
                : 'Pending Approvals'}
          </button>
        ))}
      </div>

      {activeSection === 'settings' && (
        <div className="space-y-4">
          {/* Disable Public Registration */}
          <label className="flex items-center justify-between p-3 bg-bg-secondary rounded-lg">
            <div>
              <div className="text-sm font-medium text-text-primary">
                Disable Public Registration
              </div>
              <div className="text-xs text-text-secondary">
                When enabled, only users with a bypass invite can register.
              </div>
            </div>
            <input
              type="checkbox"
              name="signups-disabled"
              checked={settings.signups_disabled}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, signups_disabled: e.target.checked }))
              }
              className="w-5 h-5 rounded"
            />
          </label>

          {settings.signups_disabled && (
            <div className="ml-4 p-3 rounded bg-warning/10 border border-warning/30 text-sm text-text-muted">
              Users with the <strong>Bypass Signup Restriction</strong> permission can create invite
              links that allow registration even when signups are closed.
            </div>
          )}

          {/* Require Member Approval */}
          <label className="flex items-center justify-between p-3 bg-bg-secondary rounded-lg">
            <div>
              <div className="text-sm font-medium text-text-primary">Require Member Approval</div>
              <div className="text-xs text-text-secondary">
                New registrants must be approved by an administrator before accessing the server.
              </div>
            </div>
            <input
              type="checkbox"
              name="member-approvals"
              checked={settings.member_approvals_enabled}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  member_approvals_enabled: e.target.checked,
                }))
              }
              className="w-5 h-5 rounded"
            />
          </label>

          {/* Skip Approval for Invited */}
          {settings.member_approvals_enabled && (
            <label className="flex items-center justify-between p-3 bg-bg-secondary rounded-lg ml-4">
              <div>
                <div className="text-sm font-medium text-text-primary">
                  Skip Approval for Invited Users
                </div>
                <div className="text-xs text-text-secondary">
                  Users who register with an invite code bypass the approval queue.
                </div>
              </div>
              <input
                type="checkbox"
                name="skip-approval-invited"
                checked={settings.approvals_skip_for_invited}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    approvals_skip_for_invited: e.target.checked,
                  }))
                }
                className="w-5 h-5 rounded"
              />
            </label>
          )}

          {/* Save Button */}
          <div className="flex items-center gap-3 pt-2">
            <button
              className="px-4 py-2 bg-accent-primary hover:bg-accent-primary/80 text-white rounded text-sm font-medium disabled:opacity-50 transition-colors"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            {saved && <span className="text-sm text-green-400">Saved!</span>}
          </div>
        </div>
      )}

      {activeSection === 'intake-form' && <IntakeFormBuilder />}

      {activeSection === 'approvals' && <MemberApprovalsPanel serverId={serverId} />}
    </div>
  );
}

// ── Intake Form Builder ──────────────────────────────────────────────

function IntakeFormBuilder() {
  const [questions, setQuestions] = useState<IntakeQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const fetchForm = async () => {
      try {
        const data = await api.get<IntakeFormConfig>('/server/intake-form');
        setQuestions(data.questions || []);
      } catch {
        // defaults
      } finally {
        setLoading(false);
      }
    };
    fetchForm();
  }, []);

  const addQuestion = () => {
    if (questions.length >= 10) return;
    setQuestions((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        label: '',
        type: 'text',
        required: false,
        placeholder: '',
      },
    ]);
  };

  const removeQuestion = (id: string) => {
    setQuestions((prev) => prev.filter((q) => q.id !== id));
  };

  const updateQuestion = (id: string, updates: Partial<IntakeQuestion>) => {
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, ...updates } : q)));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await api.patch('/server/intake-form', { questions });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      // error handled silently
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="text-text-muted">Loading...</div>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-text-muted mb-4">
        Configure questions shown to new applicants. Max 10 questions.
      </p>

      <div className="space-y-4">
        {questions.map((q, index) => (
          <div key={q.id} className="p-4 bg-bg-secondary rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase text-text-muted">
                Question {index + 1}
              </span>
              <button
                onClick={() => removeQuestion(q.id)}
                className="text-danger text-xs hover:underline"
              >
                Remove
              </button>
            </div>

            {/* Label */}
            <input
              type="text"
              placeholder="Question label"
              value={q.label}
              onChange={(e) => updateQuestion(q.id, { label: e.target.value })}
              className="w-full px-3 py-2 bg-bg-tertiary border border-border-primary rounded text-text-primary text-sm focus:outline-none focus:border-accent-primary"
            />

            <div className="flex gap-3">
              {/* Type */}
              <select
                value={q.type}
                onChange={(e) =>
                  updateQuestion(q.id, { type: e.target.value as IntakeQuestion['type'] })
                }
                className="px-3 py-2 bg-bg-tertiary border border-border-primary rounded text-text-primary text-sm focus:outline-none focus:border-accent-primary"
              >
                <option value="text">Short Text</option>
                <option value="textarea">Long Text</option>
                <option value="select">Dropdown</option>
                <option value="checkbox">Checkbox</option>
              </select>

              {/* Required */}
              <label className="flex items-center gap-2 text-sm text-text-muted">
                <input
                  type="checkbox"
                  checked={q.required}
                  onChange={(e) => updateQuestion(q.id, { required: e.target.checked })}
                  className="w-4 h-4 rounded"
                />
                Required
              </label>

              {/* Max Length */}
              {(q.type === 'text' || q.type === 'textarea') && (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-text-muted">Max:</span>
                  <input
                    type="number"
                    min="1"
                    max="2000"
                    value={q.max_length || ''}
                    onChange={(e) =>
                      updateQuestion(q.id, {
                        max_length: e.target.value ? parseInt(e.target.value) : undefined,
                      })
                    }
                    className="w-20 px-2 py-1 bg-bg-tertiary border border-border-primary rounded text-text-primary text-sm"
                    placeholder="chars"
                  />
                </div>
              )}
            </div>

            {/* Placeholder */}
            <input
              type="text"
              placeholder="Placeholder text (optional)"
              value={q.placeholder || ''}
              onChange={(e) => updateQuestion(q.id, { placeholder: e.target.value })}
              className="w-full px-3 py-2 bg-bg-tertiary border border-border-primary rounded text-text-primary text-sm focus:outline-none focus:border-accent-primary"
            />

            {/* Options for select type */}
            {q.type === 'select' && (
              <div>
                <span className="text-xs text-text-muted">
                  Options (one per line)
                </span>
                <textarea
                  value={(q.options || []).join('\n')}
                  onChange={(e) =>
                    updateQuestion(q.id, {
                      options: e.target.value
                        .split('\n')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  className="w-full mt-1 px-3 py-2 bg-bg-tertiary border border-border-primary rounded text-text-primary text-sm focus:outline-none focus:border-accent-primary resize-y min-h-[60px]"
                  placeholder="Option 1&#10;Option 2&#10;Option 3"
                />
              </div>
            )}
          </div>
        ))}

        {questions.length < 10 && (
          <button
            onClick={addQuestion}
            className="w-full py-2 border-2 border-dashed border-border-primary rounded-lg text-text-muted text-sm hover:border-accent-primary hover:text-text-primary transition-colors"
          >
            + Add Question
          </button>
        )}
      </div>

      <div className="flex items-center gap-3 pt-4">
        <button
          className="px-4 py-2 bg-accent-primary hover:bg-accent-primary/80 text-white rounded text-sm font-medium disabled:opacity-50 transition-colors"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Intake Form'}
        </button>
        {saved && <span className="text-sm text-green-400">Saved!</span>}
      </div>
    </div>
  );
}

// ── Member Approvals Panel ───────────────────────────────────────────

function MemberApprovalsPanel({ serverId }: { serverId: string }) {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'approved' | 'denied'>('pending');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchApprovals = useCallback(async () => {
    try {
      const data = await api.get<{ approvals: Approval[]; total_pending: number }>(`/server/approvals?status=${filter}`);
      setApprovals(Array.isArray(data) ? data : data.approvals ?? []);
    } catch {
      // error
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    setLoading(true);
    fetchApprovals();
  }, [fetchApprovals]);

  // Listen for new approvals
  useEffect(() => {
    const handleNewApproval = () => {
      if (filter === 'pending') fetchApprovals();
    };
    socketService.on('approval.new', handleNewApproval);
    return () => {
      socketService.off('approval.new', handleNewApproval);
    };
  }, [filter, fetchApprovals]);

  const handleApprove = async (id: string) => {
    setActionLoading(id);
    try {
      await api.post(`/server/approvals/${id}/approve`);
      setApprovals((prev) => prev.filter((a) => a.id !== id));
    } catch {
      // error
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeny = async (id: string) => {
    setActionLoading(id);
    try {
      await api.post(`/server/approvals/${id}/deny`, {
        reason: denyReason.trim() || undefined,
      });
      setApprovals((prev) => prev.filter((a) => a.id !== id));
      setDenyReason('');
      setExpandedId(null);
    } catch {
      // error
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (id: string) => {
    setActionLoading(id);
    try {
      await api.delete(`/server/approvals/${id}`);
      setApprovals((prev) => prev.filter((a) => a.id !== id));
    } catch {
      // error
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div>
      {/* Filter Tabs */}
      <div className="flex gap-2 mb-4">
        {(['pending', 'approved', 'denied'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              filter === f
                ? 'bg-accent-primary text-white'
                : 'bg-bg-secondary text-text-muted hover:text-text-primary'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="text-text-muted">Loading...</div>
        </div>
      ) : approvals.length === 0 ? (
        <div className="text-center py-8 text-text-muted text-sm">
          No {filter} applications.
        </div>
      ) : (
        <div className="space-y-3">
          {approvals.map((approval) => (
            <div key={approval.id} className="p-4 bg-bg-secondary rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-full bg-bg-tertiary flex items-center justify-center text-text-muted text-sm font-medium overflow-hidden">
                    {approval.avatar_url ? (
                      <img
                        src={approval.avatar_url}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      approval.username?.charAt(0).toUpperCase()
                    )}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-text-primary">
                      {approval.username}
                    </div>
                    <div className="text-xs text-text-muted">
                      {approval.submitted_at
                        ? `Submitted ${new Date(approval.submitted_at).toLocaleDateString()}`
                        : `Registered ${new Date(approval.created_at).toLocaleDateString()}`}
                      {approval.invite_code && (
                        <span className="ml-2 text-accent-primary">
                          invite: {approval.invite_code}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* View Responses */}
                  {approval.responses && Object.keys(approval.responses).length > 0 && (
                    <button
                      onClick={() =>
                        setExpandedId(expandedId === approval.id ? null : approval.id)
                      }
                      className="px-2 py-1 text-xs text-text-link hover:underline"
                    >
                      {expandedId === approval.id ? 'Hide' : 'Responses'}
                    </button>
                  )}

                  {filter === 'pending' && (
                    <>
                      <button
                        onClick={() => handleApprove(approval.id)}
                        disabled={actionLoading === approval.id}
                        className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-medium disabled:opacity-50 transition-colors"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() =>
                          setExpandedId(
                            expandedId === `deny-${approval.id}` ? null : `deny-${approval.id}`,
                          )
                        }
                        disabled={actionLoading === approval.id}
                        className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-medium disabled:opacity-50 transition-colors"
                      >
                        Deny
                      </button>
                    </>
                  )}

                  {filter === 'denied' && (
                    <button
                      onClick={() => handleDelete(approval.id)}
                      disabled={actionLoading === approval.id}
                      className="px-3 py-1.5 bg-bg-tertiary hover:bg-bg-modifier-hover text-text-muted rounded text-xs font-medium disabled:opacity-50 transition-colors"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>

              {/* Expanded: Responses */}
              {expandedId === approval.id && (
                <div className="mt-3 pt-3 border-t border-border-primary space-y-2">
                  {Object.entries(approval.responses).map(([key, value]) => (
                    <div key={key}>
                      <span className="text-xs font-semibold uppercase text-text-muted">
                        {key}
                      </span>
                      <p className="text-sm text-text-primary">{String(value)}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Expanded: Deny reason input */}
              {expandedId === `deny-${approval.id}` && (
                <div className="mt-3 pt-3 border-t border-border-primary flex gap-2">
                  <input
                    type="text"
                    placeholder="Denial reason (optional)"
                    value={denyReason}
                    onChange={(e) => setDenyReason(e.target.value)}
                    maxLength={500}
                    className="flex-1 px-3 py-2 bg-bg-tertiary border border-border-primary rounded text-text-primary text-sm focus:outline-none focus:border-accent-primary"
                  />
                  <button
                    onClick={() => handleDeny(approval.id)}
                    disabled={actionLoading === approval.id}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-medium disabled:opacity-50 transition-colors"
                  >
                    Confirm Deny
                  </button>
                </div>
              )}

              {/* Show denial reason for denied items */}
              {filter === 'denied' && approval.denial_reason && (
                <div className="mt-2 text-xs text-text-muted">
                  Reason: {approval.denial_reason}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
