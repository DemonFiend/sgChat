interface MOTDDisplayProps {
  motd: string | undefined | null;
  serverName?: string;
}

export function MOTDDisplay({ motd }: MOTDDisplayProps) {
  if (!motd) return null;

  return (
    <div className="mx-2 mb-2 p-3 bg-bg-tertiary/50 rounded-lg border border-border-subtle">
      <div className="flex items-start gap-2">
        <div className="flex-shrink-0 mt-0.5">
          <svg className="w-4 h-4 text-brand-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-xs font-bold uppercase text-text-muted mb-1">
            Message of the Day
          </h4>
          <p className="text-sm text-text-primary whitespace-pre-wrap break-words">
            {motd}
          </p>
        </div>
      </div>
    </div>
  );
}
