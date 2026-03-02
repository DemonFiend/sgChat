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

/**
 * Sanitize user-provided text content by stripping all HTML.
 * This is a defense-in-depth measure — the client also sanitizes on render.
 */
export function sanitizeContent(text: string): string {
  return sanitize(text, SANITIZE_OPTIONS);
}
