/**
 * Auto-resolve plain-text @mentions into wire format.
 *
 * Scans message content for `@SomeName` patterns that aren't already
 * inside wire format (`<@uuid>`, `<@&uuid>`, `<#uuid>`) and replaces
 * them with the proper wire format if a matching role exists.
 */

import { sql } from '../lib/db.js';
import { MENTION_REGEX } from '@sgchat/shared';

/**
 * Match @Word patterns that are NOT inside angle brackets (already wire format).
 * Captures the name after @, which can contain spaces if we match greedily
 * up to a known delimiter.
 */
const PLAIN_MENTION_RE = /(?<![<@&])@([A-Za-z0-9_ ]+?)(?=[\s,;.!?()[\]{}]|$)/g;

/**
 * Resolve plain-text @RoleName mentions into `<@&roleId>` wire format.
 * Only resolves roles for the given server. Skips @here and @everyone.
 */
export async function resolveTextMentions(
  content: string,
  serverId: string,
): Promise<string> {
  if (!content || !content.includes('@')) return content;

  // Collect all plain @mentions from the content
  const plainMentions: { full: string; name: string; start: number; end: number }[] = [];
  const re = new RegExp(PLAIN_MENTION_RE.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = re.exec(content)) !== null) {
    const name = match[1].trim();
    // Skip broadcast mentions and empty names
    if (!name || name.toLowerCase() === 'here' || name.toLowerCase() === 'everyone') continue;
    plainMentions.push({
      full: match[0],
      name,
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  if (plainMentions.length === 0) return content;

  // Check which mentions are already inside wire format (skip those)
  const wireRanges: { start: number; end: number }[] = [];
  const wireRe = new RegExp(MENTION_REGEX.source, 'gi');
  let wm: RegExpExecArray | null;
  while ((wm = wireRe.exec(content)) !== null) {
    wireRanges.push({ start: wm.index, end: wm.index + wm[0].length });
  }

  // Filter out mentions that overlap with wire format
  const candidates = plainMentions.filter(
    (pm) => !wireRanges.some((wr) => pm.start >= wr.start && pm.end <= wr.end),
  );

  if (candidates.length === 0) return content;

  // Fetch all roles for this server (cached per-request is fine, role count is small)
  const roles = await sql`
    SELECT id, name FROM roles WHERE server_id = ${serverId}
  `;

  // Build a case-insensitive name → role map
  const roleMap = new Map<string, string>();
  for (const role of roles) {
    roleMap.set((role.name as string).toLowerCase(), role.id as string);
  }

  // Replace matches from end to start (so indices stay valid)
  let result = content;
  for (let i = candidates.length - 1; i >= 0; i--) {
    const c = candidates[i];
    const roleId = roleMap.get(c.name.toLowerCase());
    if (roleId) {
      result = result.slice(0, c.start) + `<@&${roleId}>` + result.slice(c.end);
    }
  }

  return result;
}
