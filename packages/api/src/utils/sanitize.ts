import sanitize from 'sanitize-html';

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
 * Everything else goes through the normal HTML-strip pipeline.
 */
export function sanitizeMessage(text: string): string {
  const trimmed = text.trim();
  if (BARE_URL_RE.test(trimmed)) return trimmed;
  return sanitize(text, SANITIZE_OPTIONS);
}
