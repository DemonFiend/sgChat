import { useState, useRef } from 'react';

export interface VariableButton {
  label: string;
  variable: string;
  description?: string;
}

const DEFAULT_VARIABLES: VariableButton[] = [
  { label: 'Username', variable: '{username}', description: "User's display name" },
  { label: 'Server Name', variable: '{servername}', description: 'Server name' },
  { label: 'Server Icon', variable: '{servericon}', description: 'Server icon URL' },
  { label: 'Server Time', variable: '{servertime}', description: 'Current server time' },
  { label: 'If Statement', variable: '{if:condition}...{/if}', description: 'Conditional block' },
];

interface RichTextareaProps {
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  rows?: number;
  showVariables?: boolean;
  showFormatting?: boolean;
  variables?: VariableButton[];
  className?: string;
}

export function RichTextarea({
  value,
  onInput,
  placeholder,
  maxLength,
  rows = 4,
  showVariables,
  showFormatting,
  variables = DEFAULT_VARIABLES,
  className,
}: RichTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);

  const charCount = value?.length ?? 0;
  const nearMax = maxLength ? charCount > maxLength * 0.9 : false;

  const insertAtCursor = (text: string) => {
    if (!textareaRef.current) return;
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const newValue = before + text + after;
    onInput(newValue);
    const newPos = start + text.length;
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(newPos, newPos);
    });
  };

  const wrapSelection = (prefix: string, suffix: string) => {
    if (!textareaRef.current) return;
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const selected = value.slice(start, end);
    const before = value.slice(0, start);
    const after = value.slice(end);

    if (selected) {
      const newValue = before + prefix + selected + suffix + after;
      onInput(newValue);
      const newStart = start + prefix.length;
      const newEnd = newStart + selected.length;
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(newStart, newEnd);
      });
    } else {
      const ph = 'text';
      const newValue = before + prefix + ph + suffix + after;
      onInput(newValue);
      const newStart = start + prefix.length;
      const newEnd = newStart + ph.length;
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(newStart, newEnd);
      });
    }
  };

  const handleBold = () => wrapSelection('**', '**');
  const handleItalic = () => wrapSelection('*', '*');
  const handleStrikethrough = () => wrapSelection('~~', '~~');
  const handleCode = () => wrapSelection('`', '`');
  const handleLink = () => {
    if (!textareaRef.current) return;
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const selected = value.slice(start, end);

    if (selected) {
      const before = value.slice(0, start);
      const after = value.slice(end);
      const newValue = before + '[' + selected + '](url)' + after;
      onInput(newValue);
      const urlStart = start + selected.length + 3;
      const urlEnd = urlStart + 3;
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(urlStart, urlEnd);
      });
    } else {
      insertAtCursor('[text](url)');
      const textStart = start + 1;
      const textEnd = textStart + 4;
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(textStart, textEnd);
      });
    }
  };

  return (
    <div className={`rounded-lg border border-border-subtle bg-bg-tertiary ${focused ? 'ring-2 ring-brand-primary border-brand-primary' : ''} ${className ?? ''}`}>
      {/* Toolbar */}
      {(showFormatting || showVariables) && (
        <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 border-b border-border-subtle">
          {showFormatting && (
            <div className="flex items-center gap-0.5">
              <button type="button" onClick={handleBold} className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-modifier-hover transition-colors" title="Bold (**text**)">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z" /></svg>
              </button>
              <button type="button" onClick={handleItalic} className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-modifier-hover transition-colors" title="Italic (*text*)">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z" /></svg>
              </button>
              <button type="button" onClick={handleStrikethrough} className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-modifier-hover transition-colors" title="Strikethrough (~~text~~)">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M10 19h4v-3h-4v3zM5 4v3h5v3h4V7h5V4H5zM3 14h18v-2H3v2z" /></svg>
              </button>
              <button type="button" onClick={handleCode} className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-modifier-hover transition-colors" title="Code (`text`)">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z" /></svg>
              </button>
              <button type="button" onClick={handleLink} className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-modifier-hover transition-colors" title="Link ([text](url))">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" /></svg>
              </button>
            </div>
          )}

          {showFormatting && showVariables && (
            <div className="w-px h-5 bg-border-subtle mx-1" />
          )}

          {showVariables && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-xs text-text-muted mr-1">Variables:</span>
              {variables.map((v) => (
                <button
                  key={v.variable}
                  type="button"
                  onClick={() => insertAtCursor(v.variable)}
                  className="px-2 py-0.5 text-xs rounded-full bg-brand-primary/20 text-brand-primary hover:bg-brand-primary/30 transition-colors"
                  title={v.description}
                >
                  {v.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onInput(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={rows}
        className="w-full px-3 py-2 bg-transparent text-text-primary placeholder-text-muted focus:outline-none resize-none"
      />

      {/* Footer */}
      {maxLength && (
        <div className="flex justify-end px-3 pb-1.5">
          <span className={`text-xs ${nearMax ? 'text-yellow-500' : 'text-text-muted'}`}>
            {charCount} / {maxLength}
          </span>
        </div>
      )}
    </div>
  );
}
