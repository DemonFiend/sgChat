/**
 * Mention parsing utilities shared between API and web packages.
 *
 * Storage format (in message `content` column):
 *   <@userId>      — user mention
 *   <#channelId>   — channel mention
 *   <@&roleId>     — role mention
 *   @here           — here broadcast
 *   @everyone       — everyone broadcast
 *   <t:unix>        — server time tag (UTC unix timestamp)
 *   <motd>          — MOTD reference
 */

/** UUID v4 pattern fragment */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/**
 * Single combined regex matching every mention type.
 * Capture groups:
 *   1 = role UUID   (<@&uuid>)
 *   2 = user UUID   (<@uuid>)
 *   3 = channel UUID (<#uuid>)
 *   4 = timestamp   (<t:digits>)
 *   5 = "everyone" | "here"
 *   (no captures for <motd>)
 */
const MENTION_SRC =
  `<@&(${UUID})>` +
  `|<@(${UUID})>` +
  `|<#(${UUID})>` +
  `|<t:(\\d+)>` +
  `|<motd>` +
  `|@(everyone|here)`;

/** Global regex for replacing / iterating mentions */
export const MENTION_REGEX = new RegExp(MENTION_SRC, 'gi');

/** Message-link pattern: https://host/channels/{channelId}/{messageId} */
export const MESSAGE_LINK_REGEX = new RegExp(
  `https?://[^/\\s]+/channels/(${UUID})/(${UUID})`,
  'gi',
);

// ── Types ───────────────────────────────────────────────────────

export type MentionType = 'user' | 'channel' | 'role' | 'here' | 'everyone' | 'time' | 'motd';

export interface ParsedMention {
  type: MentionType;
  /** The full matched text (e.g. "<@uuid>") */
  raw: string;
  /** UUID for user / channel / role mentions */
  id?: string;
  /** Unix timestamp for time mentions */
  timestamp?: number;
  /** Start index in source string */
  start: number;
  /** End index in source string */
  end: number;
}

export interface ParsedMessageLink {
  raw: string;
  channelId: string;
  messageId: string;
  start: number;
  end: number;
}

// ── Parsing ─────────────────────────────────────────────────────

/**
 * Parse all mentions from stored message content.
 * Returns mentions sorted by position.
 */
export function parseMentions(content: string): ParsedMention[] {
  const mentions: ParsedMention[] = [];
  const re = new RegExp(MENTION_SRC, 'gi');
  let m: RegExpExecArray | null;

  while ((m = re.exec(content)) !== null) {
    const base = { raw: m[0], start: m.index, end: m.index + m[0].length };

    if (m[1]) {
      mentions.push({ ...base, type: 'role', id: m[1] });
    } else if (m[2]) {
      mentions.push({ ...base, type: 'user', id: m[2] });
    } else if (m[3]) {
      mentions.push({ ...base, type: 'channel', id: m[3] });
    } else if (m[4]) {
      mentions.push({ ...base, type: 'time', timestamp: parseInt(m[4], 10) });
    } else if (m[0] === '<motd>') {
      mentions.push({ ...base, type: 'motd' });
    } else if (m[5]) {
      mentions.push({ ...base, type: m[5].toLowerCase() as 'everyone' | 'here' });
    }
  }

  return mentions;
}

/**
 * Parse message-link URLs from content.
 */
export function parseMessageLinks(content: string): ParsedMessageLink[] {
  const links: ParsedMessageLink[] = [];
  const re = new RegExp(MESSAGE_LINK_REGEX.source, 'gi');
  let m: RegExpExecArray | null;

  while ((m = re.exec(content)) !== null) {
    links.push({
      raw: m[0],
      channelId: m[1],
      messageId: m[2],
      start: m.index,
      end: m.index + m[0].length,
    });
  }

  return links;
}

// ── Extraction helpers (backend notification logic) ─────────────

/** Extract unique user IDs from `<@uuid>` mentions. */
export function extractMentionedUserIds(content: string): string[] {
  return [...new Set(
    parseMentions(content)
      .filter((m) => m.type === 'user' && m.id)
      .map((m) => m.id!),
  )];
}

/** Extract unique role IDs from `<@&uuid>` mentions. */
export function extractMentionedRoleIds(content: string): string[] {
  return [...new Set(
    parseMentions(content)
      .filter((m) => m.type === 'role' && m.id)
      .map((m) => m.id!),
  )];
}

/** Check if message contains @here or @everyone. */
export function hasBroadcastMention(content: string): { here: boolean; everyone: boolean } {
  const mentions = parseMentions(content);
  return {
    here: mentions.some((m) => m.type === 'here'),
    everyone: mentions.some((m) => m.type === 'everyone'),
  };
}

/** Returns true if the content contains any mention syntax. */
export function hasMentions(content: string): boolean {
  return MENTION_REGEX.test(content);
}
