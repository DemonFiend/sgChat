import { sql } from '../lib/db.js';
import { db } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { publishEvent } from '../lib/eventBus.js';
import { handleMemberJoin } from './server.js';

// ── Types ────────────────────────────────────────────────────

export interface AccessControlSettings {
  signups_disabled: boolean;
  member_approvals_enabled: boolean;
  approvals_skip_for_invited: boolean;
}

export interface IntakeFormQuestion {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'checkbox';
  required: boolean;
  max_length?: number;
  placeholder?: string;
  options?: string[];
}

export interface IntakeFormConfig {
  questions: IntakeFormQuestion[];
}

export interface MemberApproval {
  id: string;
  server_id: string;
  user_id: string;
  status: 'pending' | 'approved' | 'denied';
  responses: Record<string, string>;
  invite_code: string | null;
  reviewed_by: string | null;
  denial_reason: string | null;
  created_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
}

// ── Cache Keys ───────────────────────────────────────────────

const CACHE_KEY_ACCESS_CONTROL = 'instance:access_control_settings';
const CACHE_KEY_INTAKE_FORM = 'instance:intake_form_config';
const CACHE_TTL_ACCESS_CONTROL = 60; // 60 seconds
const CACHE_TTL_INTAKE_FORM = 300; // 5 minutes

// ── Access Control Settings ──────────────────────────────────

export async function getAccessControlSettings(): Promise<AccessControlSettings> {
  // Check Redis cache first
  const cached = await redis.client.get(CACHE_KEY_ACCESS_CONTROL);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      // Fall through to DB
    }
  }

  const setting = await db.instanceSettings.get('access_control_settings');
  const defaults: AccessControlSettings = {
    signups_disabled: false,
    member_approvals_enabled: false,
    approvals_skip_for_invited: false,
  };
  const value = setting?.value ?? defaults;

  // Cache in Redis
  await redis.client.setex(CACHE_KEY_ACCESS_CONTROL, CACHE_TTL_ACCESS_CONTROL, JSON.stringify(value));
  return value as AccessControlSettings;
}

export async function setAccessControlSettings(
  settings: Partial<AccessControlSettings>,
  updatedBy: string,
  serverId: string,
  io?: any,
): Promise<AccessControlSettings> {
  const current = await getAccessControlSettings();
  const updated: AccessControlSettings = { ...current, ...settings };

  await db.instanceSettings.set('access_control_settings', updated);

  // Invalidate cache
  await redis.client.del(CACHE_KEY_ACCESS_CONTROL);

  // Audit log
  await sql`
    INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, changes)
    VALUES (
      ${serverId}, ${updatedBy}, 'signup_settings_update', 'server', ${serverId},
      ${JSON.stringify({ before: current, after: updated })}
    )
  `;

  // Broadcast to all connected clients
  await publishEvent({
    type: 'server.update' as any,
    actorId: updatedBy,
    resourceId: `server:${serverId}`,
    payload: { access_control: updated },
  });

  return updated;
}

// ── Intake Form Config ───────────────────────────────────────

export async function getIntakeFormConfig(): Promise<IntakeFormConfig> {
  const cached = await redis.client.get(CACHE_KEY_INTAKE_FORM);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      // Fall through to DB
    }
  }

  const setting = await db.instanceSettings.get('intake_form_config');
  const value: IntakeFormConfig = setting?.value ?? { questions: [] };

  await redis.client.setex(CACHE_KEY_INTAKE_FORM, CACHE_TTL_INTAKE_FORM, JSON.stringify(value));
  return value;
}

export async function setIntakeFormConfig(
  config: IntakeFormConfig,
  updatedBy: string,
  serverId: string,
): Promise<IntakeFormConfig> {
  // Enforce max 10 questions
  if (config.questions.length > 10) {
    throw new Error('Maximum 10 intake form questions allowed');
  }

  await db.instanceSettings.set('intake_form_config', config);

  // Invalidate cache
  await redis.client.del(CACHE_KEY_INTAKE_FORM);

  // Audit log
  await sql`
    INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, changes)
    VALUES (
      ${serverId}, ${updatedBy}, 'intake_form_updated', 'server', ${serverId},
      ${JSON.stringify({ question_count: config.questions.length })}
    )
  `;

  return config;
}

// ── Member Approvals CRUD ────────────────────────────────────

export async function createApproval(
  userId: string,
  serverId: string,
  inviteCode?: string | null,
): Promise<MemberApproval> {
  const [approval] = await sql`
    INSERT INTO member_approvals (user_id, server_id, invite_code)
    VALUES (${userId}, ${serverId}, ${inviteCode || null})
    ON CONFLICT (user_id, server_id) DO UPDATE SET
      status = EXCLUDED.status,
      created_at = NOW()
    WHERE member_approvals.status = 'denied'
    RETURNING *
  `;
  return approval as MemberApproval;
}

export async function submitResponses(
  userId: string,
  serverId: string,
  responses: Record<string, string>,
): Promise<MemberApproval> {
  // Validate responses against intake form config
  const formConfig = await getIntakeFormConfig();
  if (formConfig.questions.length > 0) {
    for (const question of formConfig.questions) {
      const answer = responses[question.id];
      if (question.required && (!answer || answer.trim() === '')) {
        throw new ValidationError(`Question "${question.label}" is required`);
      }
      if (answer && question.max_length && answer.length > question.max_length) {
        throw new ValidationError(
          `Answer for "${question.label}" exceeds maximum length of ${question.max_length}`,
        );
      }
    }
  }

  const [approval] = await sql`
    UPDATE member_approvals
    SET responses = ${JSON.stringify(responses)},
        submitted_at = NOW()
    WHERE user_id = ${userId}
      AND server_id = ${serverId}
      AND status = 'pending'
    RETURNING *
  `;

  if (!approval) {
    throw new NotFoundError('No pending approval found');
  }

  // Invalidate pending count cache
  await redis.client.del(`pending_approval_count:${serverId}`);

  // Notify admins
  const [user] = await sql`SELECT username FROM users WHERE id = ${userId}`;
  await publishEvent({
    type: 'member.update' as any,
    actorId: userId,
    resourceId: `server:${serverId}`,
    payload: {
      event: 'approval.new',
      approval_id: approval.id,
      username: user?.username,
      submitted_at: approval.submitted_at,
    },
  });

  return approval as MemberApproval;
}

export async function approveApplicant(
  approvalId: string,
  reviewerId: string,
  serverId: string,
  io?: any,
): Promise<MemberApproval> {
  // Use a transaction: update status + handleMemberJoin
  return sql.begin(async (tx: any) => {
    const [approval] = await tx`
      UPDATE member_approvals
      SET status = 'approved',
          reviewed_by = ${reviewerId},
          reviewed_at = NOW()
      WHERE id = ${approvalId}
        AND status = 'pending'
      RETURNING *
    `;

    if (!approval) {
      throw new NotFoundError('Approval not found or already processed');
    }

    // Self-approval prevention
    if (approval.user_id === reviewerId) {
      throw new ForbiddenError('Cannot approve your own application');
    }

    // Join the user to the server (outside tx since handleMemberJoin has its own tx)
    // We need to commit the approval first, then join
    return approval as MemberApproval;
  }).then(async (approval) => {
    // Now that the approval status is committed, join the member
    try {
      await handleMemberJoin(approval.user_id, serverId, io);
    } catch (err) {
      // Rollback approval status if join fails
      await sql`
        UPDATE member_approvals SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL
        WHERE id = ${approvalId}
      `;
      throw err;
    }

    // Invalidate pending count cache
    await redis.client.del(`pending_approval_count:${serverId}`);

    // Audit log
    await sql`
      INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, changes)
      VALUES (
        ${serverId}, ${reviewerId}, 'member_approved', 'member', ${approval.user_id},
        ${JSON.stringify({ approval_id: approvalId })}
      )
    `;

    // Notify the user
    await publishEvent({
      type: 'member.update' as any,
      actorId: reviewerId,
      resourceId: `user:${approval.user_id}`,
      payload: {
        event: 'approval.resolved',
        status: 'approved',
      },
    });

    return approval;
  });
}

export async function denyApplicant(
  approvalId: string,
  reviewerId: string,
  serverId: string,
  reason?: string,
  io?: any,
): Promise<MemberApproval> {
  const [approval] = await sql`
    UPDATE member_approvals
    SET status = 'denied',
        reviewed_by = ${reviewerId},
        reviewed_at = NOW(),
        denial_reason = ${reason || null}
    WHERE id = ${approvalId}
      AND status = 'pending'
    RETURNING *
  `;

  if (!approval) {
    throw new NotFoundError('Approval not found or already processed');
  }

  // Self-denial prevention (same check as approve for consistency)
  if (approval.user_id === reviewerId) {
    // Rollback
    await sql`
      UPDATE member_approvals SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL, denial_reason = NULL
      WHERE id = ${approvalId}
    `;
    throw new ForbiddenError('Cannot deny your own application');
  }

  // Invalidate pending count cache
  await redis.client.del(`pending_approval_count:${serverId}`);

  // Audit log
  await sql`
    INSERT INTO audit_log (server_id, user_id, action, target_type, target_id, changes)
    VALUES (
      ${serverId}, ${reviewerId}, 'member_denied', 'member', ${approval.user_id},
      ${JSON.stringify({ approval_id: approvalId, reason: reason || null })}
    )
  `;

  // Notify the user
  await publishEvent({
    type: 'member.update' as any,
    actorId: reviewerId,
    resourceId: `user:${approval.user_id}`,
    payload: {
      event: 'approval.resolved',
      status: 'denied',
      denial_reason: reason || null,
    },
  });

  return approval as MemberApproval;
}

export async function getApprovalQueue(
  serverId: string,
  options: {
    status?: 'pending' | 'approved' | 'denied' | 'all';
    limit?: number;
    before?: string;
  } = {},
): Promise<{ approvals: any[]; total_pending: number }> {
  const { status = 'pending', limit = 50, before } = options;

  const statusFilter = status === 'all' ? sql`` : sql`AND ma.status = ${status}`;
  const cursorFilter = before ? sql`AND ma.submitted_at < ${before}` : sql``;

  const approvals = await sql`
    SELECT
      ma.*,
      u.username,
      u.avatar_url,
      u.email,
      u.created_at as user_created_at
    FROM member_approvals ma
    JOIN users u ON u.id = ma.user_id
    WHERE ma.server_id = ${serverId}
      ${statusFilter}
      ${cursorFilter}
    ORDER BY ma.created_at DESC
    LIMIT ${limit}
  `;

  const totalPending = await getPendingCount(serverId);

  return {
    approvals: approvals.map((a: any) => ({
      id: a.id,
      user: {
        id: a.user_id,
        username: a.username,
        email: a.email,
        avatar_url: a.avatar_url,
        created_at: a.user_created_at,
      },
      status: a.status,
      responses: a.responses,
      invite_code: a.invite_code,
      reviewed_by: a.reviewed_by,
      denial_reason: a.denial_reason,
      created_at: a.created_at,
      submitted_at: a.submitted_at,
      reviewed_at: a.reviewed_at,
      has_responses: a.responses && Object.keys(a.responses).length > 0,
    })),
    total_pending: totalPending,
  };
}

export async function getUserApprovalStatus(
  userId: string,
  serverId: string,
): Promise<MemberApproval | null> {
  const [approval] = await sql`
    SELECT * FROM member_approvals
    WHERE user_id = ${userId} AND server_id = ${serverId}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return (approval as MemberApproval) || null;
}

export async function getApprovalById(approvalId: string): Promise<MemberApproval | null> {
  const [approval] = await sql`
    SELECT * FROM member_approvals WHERE id = ${approvalId}
  `;
  return (approval as MemberApproval) || null;
}

export async function getPendingCount(serverId: string): Promise<number> {
  // Check Redis cache
  const cached = await redis.client.get(`pending_approval_count:${serverId}`);
  if (cached !== null) return parseInt(cached, 10);

  const [result] = await sql`
    SELECT COUNT(*)::int as count FROM member_approvals
    WHERE server_id = ${serverId} AND status = 'pending'
  `;
  const count = result?.count ?? 0;

  // Cache for 5 minutes (invalidated on submit/approve/deny)
  await redis.client.setex(`pending_approval_count:${serverId}`, 300, count.toString());
  return count;
}

export async function deleteApproval(approvalId: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM member_approvals WHERE id = ${approvalId}
    RETURNING id
  `;
  return result.length > 0;
}

export async function isPendingApproval(userId: string, serverId: string): Promise<boolean> {
  // Fast path: check if user is already a member
  const [member] = await sql`
    SELECT 1 FROM members WHERE user_id = ${userId} AND server_id = ${serverId}
  `;
  if (member) return false;

  // Check for pending approval
  const [approval] = await sql`
    SELECT 1 FROM member_approvals
    WHERE user_id = ${userId} AND server_id = ${serverId} AND status = 'pending'
  `;
  return !!approval;
}

// ── Error Types ──────────────────────────────────────────────

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}
