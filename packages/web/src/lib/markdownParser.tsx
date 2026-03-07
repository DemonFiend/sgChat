import React, { useState } from 'react';
import { renderCustomEmojis } from '@/lib/emojiRenderer';

const MAX_DEPTH = 5;
const MAX_LENGTH = 4000;

// --- Spoiler Component ---

function SpoilerSpan({ children }: { children: React.ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      className={
        revealed
          ? 'rounded px-0.5 bg-bg-tertiary cursor-pointer transition-colors'
          : 'rounded px-0.5 bg-text-primary text-transparent select-none cursor-pointer transition-colors'
      }
      onClick={() => setRevealed((r) => !r)}
      title={revealed ? undefined : 'Click to reveal spoiler'}
    >
      {children}
    </span>
  );
}

// --- Token Types ---

interface TextToken {
  type: 'text';
  content: string;
}

interface FormattedToken {
  type: 'bold' | 'italic' | 'boldItalic' | 'strikethrough' | 'spoiler';
  children: MarkdownToken[];
}

interface CodeToken {
  type: 'code';
  content: string;
}

interface CodeBlockToken {
  type: 'codeBlock';
  content: string;
  language?: string;
}

interface BlockquoteToken {
  type: 'blockquote';
  children: MarkdownToken[];
}

interface NewlineToken {
  type: 'newline';
}

type MarkdownToken =
  | TextToken
  | FormattedToken
  | CodeToken
  | CodeBlockToken
  | BlockquoteToken
  | NewlineToken;

// --- Inline Tokenizer ---

/**
 * Find the closing delimiter in text starting from `start`, respecting nesting.
 * Returns the index of the first char of the closing delimiter, or -1 if not found.
 */
function findClosing(text: string, start: number, delimiter: string): number {
  let i = start;
  while (i <= text.length - delimiter.length) {
    if (text.substring(i, i + delimiter.length) === delimiter) {
      return i;
    }
    i++;
  }
  return -1;
}

/**
 * Check if underscore at position is at a word boundary (not mid-word like snake_case).
 */
function isUnderscoreWordBoundary(text: string, pos: number, isClosing: boolean): boolean {
  if (isClosing) {
    // Closing _: char before must not be whitespace, char after must be non-word or end
    const before = pos > 0 ? text[pos - 1] : ' ';
    const after = pos + 1 < text.length ? text[pos + 1] : ' ';
    return before !== ' ' && (after === ' ' || /[^a-zA-Z0-9_]/.test(after) || pos + 1 >= text.length);
  } else {
    // Opening _: char before must be non-word or start, char after must not be whitespace
    const before = pos > 0 ? text[pos - 1] : ' ';
    const after = pos + 1 < text.length ? text[pos + 1] : ' ';
    return (before === ' ' || /[^a-zA-Z0-9_]/.test(before) || pos === 0) && after !== ' ';
  }
}

function tokenizeInline(text: string, depth: number): MarkdownToken[] {
  if (depth > MAX_DEPTH || !text) return text ? [{ type: 'text', content: text }] : [];

  const tokens: MarkdownToken[] = [];
  let i = 0;
  let textStart = 0;

  const pushText = (end: number) => {
    if (end > textStart) {
      tokens.push({ type: 'text', content: text.slice(textStart, end) });
    }
  };

  while (i < text.length) {
    // Inline code: `content`
    if (text[i] === '`') {
      const closeIdx = text.indexOf('`', i + 1);
      if (closeIdx !== -1) {
        pushText(i);
        tokens.push({ type: 'code', content: text.slice(i + 1, closeIdx) });
        i = closeIdx + 1;
        textStart = i;
        continue;
      }
    }

    // Bold italic: ***content***
    if (text[i] === '*' && text[i + 1] === '*' && text[i + 2] === '*') {
      const closeIdx = findClosing(text, i + 3, '***');
      if (closeIdx > i + 3) {
        pushText(i);
        const inner = text.slice(i + 3, closeIdx);
        tokens.push({ type: 'boldItalic', children: tokenizeInline(inner, depth + 1) });
        i = closeIdx + 3;
        textStart = i;
        continue;
      }
    }

    // Bold: **content**
    if (text[i] === '*' && text[i + 1] === '*') {
      const closeIdx = findClosing(text, i + 2, '**');
      if (closeIdx > i + 2) {
        pushText(i);
        const inner = text.slice(i + 2, closeIdx);
        tokens.push({ type: 'bold', children: tokenizeInline(inner, depth + 1) });
        i = closeIdx + 2;
        textStart = i;
        continue;
      }
    }

    // Italic with *: *content*
    if (text[i] === '*' && text[i + 1] !== '*') {
      const closeIdx = findClosing(text, i + 1, '*');
      if (closeIdx > i + 1) {
        pushText(i);
        const inner = text.slice(i + 1, closeIdx);
        tokens.push({ type: 'italic', children: tokenizeInline(inner, depth + 1) });
        i = closeIdx + 1;
        textStart = i;
        continue;
      }
    }

    // Italic with _: _content_
    if (text[i] === '_' && text[i + 1] !== '_') {
      if (isUnderscoreWordBoundary(text, i, false)) {
        // Find closing _ with word boundary check
        let searchFrom = i + 1;
        let found = false;
        while (searchFrom < text.length) {
          const closeIdx = text.indexOf('_', searchFrom);
          if (closeIdx === -1 || closeIdx <= i + 1) break;
          if (isUnderscoreWordBoundary(text, closeIdx, true)) {
            pushText(i);
            const inner = text.slice(i + 1, closeIdx);
            tokens.push({ type: 'italic', children: tokenizeInline(inner, depth + 1) });
            i = closeIdx + 1;
            textStart = i;
            found = true;
            break;
          }
          searchFrom = closeIdx + 1;
        }
        if (found) continue;
      }
    }

    // Strikethrough: ~~content~~
    if (text[i] === '~' && text[i + 1] === '~') {
      const closeIdx = findClosing(text, i + 2, '~~');
      if (closeIdx > i + 2) {
        pushText(i);
        const inner = text.slice(i + 2, closeIdx);
        tokens.push({ type: 'strikethrough', children: tokenizeInline(inner, depth + 1) });
        i = closeIdx + 2;
        textStart = i;
        continue;
      }
    }

    // Spoiler: ||content||
    if (text[i] === '|' && text[i + 1] === '|') {
      const closeIdx = findClosing(text, i + 2, '||');
      if (closeIdx > i + 2) {
        pushText(i);
        const inner = text.slice(i + 2, closeIdx);
        tokens.push({ type: 'spoiler', children: tokenizeInline(inner, depth + 1) });
        i = closeIdx + 2;
        textStart = i;
        continue;
      }
    }

    i++;
  }

  pushText(text.length);
  return tokens;
}

// --- Block-Level Tokenizer ---

function tokenize(text: string): MarkdownToken[] {
  if (!text || text.length > MAX_LENGTH) return text ? [{ type: 'text', content: text }] : [];

  const lines = text.split('\n');
  const tokens: MarkdownToken[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block: ```lang\ncontent\n```
    if (line.trimStart().startsWith('```')) {
      const trimmed = line.trimStart();
      const language = trimmed.slice(3).trim() || undefined;
      const codeLines: string[] = [];
      i++;
      let closed = false;
      while (i < lines.length) {
        if (lines[i].trimStart().startsWith('```')) {
          closed = true;
          i++;
          break;
        }
        codeLines.push(lines[i]);
        i++;
      }
      if (closed) {
        tokens.push({ type: 'codeBlock', content: codeLines.join('\n'), language });
      } else {
        // Unclosed code block — treat opening line as text, reparse remaining
        tokens.push(...tokenizeInline('```' + (language || ''), 0));
        // The codeLines were consumed, push them back as text
        for (const cl of codeLines) {
          tokens.push({ type: 'newline' });
          tokens.push(...tokenizeInline(cl, 0));
        }
      }
      continue;
    }

    // Blockquote: > text
    if (line.startsWith('> ') || line === '>') {
      const quoteContent = line === '>' ? '' : line.slice(2);
      const quoteTokens = tokenizeInline(quoteContent, 0);
      tokens.push({ type: 'blockquote', children: quoteTokens });
      i++;
      continue;
    }

    // Regular line — inline parse
    if (line) {
      tokens.push(...tokenizeInline(line, 0));
    }

    // Add newline between lines (not after the last)
    if (i < lines.length - 1) {
      tokens.push({ type: 'newline' });
    }
    i++;
  }

  return tokens;
}

// --- React Renderer ---

function renderToken(
  token: MarkdownToken,
  key: number,
  serverId?: string,
  hasEmoji?: boolean,
): React.ReactNode {
  const renderChildren = (children: MarkdownToken[]) =>
    children.map((child, j) => renderToken(child, j, serverId, hasEmoji));

  const renderLeafText = (content: string) =>
    hasEmoji && serverId ? renderCustomEmojis(content, serverId) : content;

  switch (token.type) {
    case 'text':
      return <React.Fragment key={key}>{renderLeafText(token.content)}</React.Fragment>;

    case 'newline':
      return <br key={key} />;

    case 'bold':
      return <strong key={key}>{renderChildren(token.children)}</strong>;

    case 'italic':
      return <em key={key}>{renderChildren(token.children)}</em>;

    case 'boldItalic':
      return (
        <strong key={key}>
          <em>{renderChildren(token.children)}</em>
        </strong>
      );

    case 'strikethrough':
      return <s key={key}>{renderChildren(token.children)}</s>;

    case 'code':
      return (
        <code
          key={key}
          className="px-1 py-0.5 bg-bg-tertiary rounded text-[0.85em] font-mono"
        >
          {token.content}
        </code>
      );

    case 'codeBlock':
      return (
        <pre
          key={key}
          className="px-3 py-2 bg-bg-tertiary rounded-md overflow-x-auto my-1 text-[0.85em]"
        >
          <code className="font-mono">{token.content}</code>
        </pre>
      );

    case 'spoiler':
      return <SpoilerSpan key={key}>{renderChildren(token.children)}</SpoilerSpan>;

    case 'blockquote':
      return (
        <blockquote
          key={key}
          className="border-l-3 border-text-muted pl-2 my-0.5 text-text-secondary"
        >
          {renderChildren(token.children)}
        </blockquote>
      );

    default:
      return null;
  }
}

// --- Public API ---

/**
 * Parse and render markdown in a text segment.
 * Designed to be called from MessageContent on text segments (after mention extraction).
 * Leaf text nodes pass through renderCustomEmojis to preserve emoji rendering.
 */
export function renderMarkdown(
  text: string,
  serverId?: string,
  hasEmoji?: boolean,
): React.ReactNode[] {
  if (!text) return [];

  const tokens = tokenize(text);
  return tokens.map((token, i) => renderToken(token, i, serverId, hasEmoji));
}
