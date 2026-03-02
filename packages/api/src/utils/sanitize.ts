import sanitize from 'sanitize-html';
import { MENTION_REGEX } from '@sgchat/shared';

/**
 * Sanitization options: strip ALL HTML tags.
 * Messages in sgChat are plain text — the client renders markdown
 * separately via `marked` + DOMPurify. Server-side we enforce no
 * HTML storage at all as defense-in-depth.
 */
const SANITIZE_OPTIONS: sanitize.IOptions = {
  allowedTags: [],
  allowedAttributes: {},
  disallowedTagsMode: 'discard',
};

/** Matches a single URL on its own (no surrounding text) */
const BARE_URL_RE = /^https?:\/\/\S+$/;

/**
 * Sanitize user-provided text content by stripping all HTML.
 * This is a defense-in-depth measure — the client also sanitizes on render.
 */
export function sanitizeContent(text: string): string {
  return sanitize(text, SANITIZE_OPTIONS);
}

/**
 * Sanitize a chat message. Plain URLs (GIFs, images) are returned as-is
 * because sanitize-html can mangle query-string ampersands (`&` → `&amp;`).
 * Mention syntax (<@uuid>, <#uuid>, <@&uuid>, <t:unix>, <motd>) is preserved
 * by replacing with placeholders before sanitization and restoring after.
 */
export function sanitizeMessage(text: string): string {
  const trimmed = text.trim();
  if (BARE_URL_RE.test(trimmed)) return trimmed;

  // Preserve mention syntax (angle-bracket mentions look like HTML tags and
  // would be stripped by sanitize-html)
  const preserved: string[] = [];
  const withPlaceholders = text.replace(
    new RegExp(MENTION_REGEX.source, 'gi'),
    (match) => {
      preserved.push(match);
      return `__MENTION_${preserved.length - 1}__`;
    },
  );

  let sanitized = sanitize(withPlaceholders, SANITIZE_OPTIONS);

  // Restore mention syntax
  sanitized = sanitized.replace(/__MENTION_(\d+)__/g, (_, i) => preserved[parseInt(i, 10)]);

  return sanitized;
}
