import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui';
import { useAuthStore } from '@/stores/auth';
import { useNetworkStore } from '@/stores/network';
import { socketService } from '@/lib/socket';
import { api } from '@/api/client';

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

interface ApprovalStatus {
  status: 'pending' | 'approved' | 'denied';
  denial_reason?: string;
  submitted_at?: string;
}

export function PendingApprovalPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isPendingApproval = useAuthStore((s) => s.isPendingApproval);
  const setIsPendingApproval = useAuthStore((s) => s.setIsPendingApproval);
  const logout = useAuthStore((s) => s.logout);
  const { serverInfo } = useNetworkStore();

  const [intakeForm, setIntakeForm] = useState<IntakeFormConfig | null>(null);
  const [responses, setResponses] = useState<Record<string, string | boolean>>({});
  const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const hasSubmitted = approvalStatus?.submitted_at != null;
  const isDenied = approvalStatus?.status === 'denied';

  // Redirect if not pending
  useEffect(() => {
    if (!isPendingApproval) {
      navigate('/channels/@me', { replace: true });
    }
  }, [isPendingApproval, navigate]);

  // Fetch approval status and intake form
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statusRes, formRes] = await Promise.all([
          api.get<ApprovalStatus>('/server/approval-status'),
          api.get<IntakeFormConfig>('/server/intake-form'),
        ]);
        setApprovalStatus(statusRes);
        setIntakeForm(formRes);
      } catch {
        // If we can't fetch, just show the waiting screen
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // Listen for approval.resolved socket event
  const handleApprovalResolved = useCallback(
    (data: unknown) => {
      const { status, denial_reason } = data as { status: 'approved' | 'denied'; denial_reason?: string };
      if (status === 'approved') {
        setIsPendingApproval(false);
        navigate('/channels/@me', { replace: true });
      } else {
        setApprovalStatus((prev) => ({
          ...prev,
          status: 'denied',
          denial_reason: denial_reason,
          submitted_at: prev?.submitted_at,
        }));
      }
    },
    [setIsPendingApproval, navigate],
  );

  useEffect(() => {
    socketService.on('approval.resolved', handleApprovalResolved);
    return () => {
      socketService.off('approval.resolved', handleApprovalResolved);
    };
  }, [handleApprovalResolved]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      await api.post(`/server/approvals/submit`, { responses });
      setApprovalStatus((prev) => ({
        ...prev,
        status: prev?.status ?? 'pending',
        submitted_at: new Date().toISOString(),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit application');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const updateResponse = (questionId: string, value: string | boolean) => {
    setResponses((prev) => ({ ...prev, [questionId]: value }));
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-tertiary p-4">
        <div className="w-full max-w-md bg-bg-primary rounded-md shadow-high p-8 text-center">
          <div className="w-8 h-8 border-2 border-accent-primary border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-tertiary p-4">
      <div className="w-full max-w-lg">
        <div className="bg-bg-primary rounded-md shadow-high p-8">
          <div className="text-center mb-6">
            <svg
              className="w-12 h-12 text-warning mx-auto mb-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <h1 className="text-2xl font-bold text-text-primary mb-2">
              {isDenied ? 'Application Denied' : 'Pending Approval'}
            </h1>
            {serverInfo?.name && (
              <p className="text-text-muted text-sm">
                {isDenied
                  ? `Your application to join "${serverInfo.name}" was denied.`
                  : `Your account is awaiting approval to join "${serverInfo.name}".`}
              </p>
            )}
          </div>

          {/* Denied state */}
          {isDenied && (
            <div className="mb-6 p-4 rounded bg-danger/10 border border-danger/50">
              <p className="text-danger font-medium mb-1">Your application was denied</p>
              {approvalStatus?.denial_reason && (
                <p className="text-text-muted text-sm">{approvalStatus.denial_reason}</p>
              )}
            </div>
          )}

          {/* Submitted state — waiting for review */}
          {hasSubmitted && !isDenied && (
            <div className="mb-6 p-4 rounded bg-success/10 border border-success/50 text-center">
              <svg
                className="w-8 h-8 text-success mx-auto mb-2"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M5 13l4 4L19 7"
                />
              </svg>
              <p className="text-text-primary font-medium mb-1">Application submitted</p>
              <p className="text-text-muted text-sm">
                You&apos;ll be notified when an administrator reviews your application.
              </p>
            </div>
          )}

          {/* Intake form — not yet submitted and not denied */}
          {!hasSubmitted && !isDenied && intakeForm && intakeForm.questions.length > 0 && (
            <>
              <p className="text-text-muted text-sm mb-4">
                Please complete the application form below. An administrator will review your
                submission.
              </p>

              {error && (
                <div className="mb-4 p-3 rounded bg-danger/10 border border-danger/50 text-danger text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {intakeForm.questions.map((q) => (
                  <div key={q.id}>
                    <label className="block text-xs font-semibold uppercase text-text-muted mb-1.5">
                      {q.label}
                      {q.required && <span className="text-danger ml-0.5">*</span>}
                    </label>

                    {q.type === 'text' && (
                      <input
                        type="text"
                        className="w-full px-3 py-2 bg-bg-tertiary border border-border-primary rounded text-text-primary text-sm focus:outline-none focus:border-accent-primary"
                        placeholder={q.placeholder}
                        maxLength={q.max_length}
                        required={q.required}
                        value={(responses[q.id] as string) || ''}
                        onChange={(e) => updateResponse(q.id, e.target.value)}
                      />
                    )}

                    {q.type === 'textarea' && (
                      <textarea
                        className="w-full px-3 py-2 bg-bg-tertiary border border-border-primary rounded text-text-primary text-sm focus:outline-none focus:border-accent-primary resize-y min-h-[80px]"
                        placeholder={q.placeholder}
                        maxLength={q.max_length}
                        required={q.required}
                        value={(responses[q.id] as string) || ''}
                        onChange={(e) => updateResponse(q.id, e.target.value)}
                      />
                    )}

                    {q.type === 'select' && q.options && (
                      <select
                        className="w-full px-3 py-2 bg-bg-tertiary border border-border-primary rounded text-text-primary text-sm focus:outline-none focus:border-accent-primary"
                        required={q.required}
                        value={(responses[q.id] as string) || ''}
                        onChange={(e) => updateResponse(q.id, e.target.value)}
                      >
                        <option value="">{q.placeholder || 'Select an option...'}</option>
                        {q.options.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    )}

                    {q.type === 'checkbox' && (
                      <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
                        <input
                          type="checkbox"
                          className="w-4 h-4 rounded border-border-primary bg-bg-secondary text-accent-primary focus:ring-accent-primary focus:ring-offset-0"
                          checked={!!responses[q.id]}
                          onChange={(e) => updateResponse(q.id, e.target.checked)}
                        />
                        {q.placeholder || q.label}
                      </label>
                    )}
                  </div>
                ))}

                <Button type="submit" fullWidth loading={submitting}>
                  Submit Application
                </Button>
              </form>
            </>
          )}

          {/* No intake form and not submitted — just waiting */}
          {!hasSubmitted && !isDenied && (!intakeForm || intakeForm.questions.length === 0) && (
            <div className="mb-6 p-4 rounded bg-warning/10 border border-warning/50 text-center">
              <p className="text-text-primary font-medium mb-1">Awaiting approval</p>
              <p className="text-text-muted text-sm">
                An administrator will review your account. You&apos;ll be notified when your account
                is approved.
              </p>
            </div>
          )}

          {/* User info */}
          {user && (
            <div className="mt-6 pt-4 border-t border-border-primary flex items-center justify-between">
              <span className="text-text-muted text-sm">
                Logged in as <span className="text-text-primary font-medium">{user.username}</span>
              </span>
              <button
                onClick={handleLogout}
                className="text-text-link text-sm hover:underline"
              >
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
