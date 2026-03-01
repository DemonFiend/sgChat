import { type InputHTMLAttributes, useId } from 'react';
import { clsx } from 'clsx';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export function Input({ label, error, hint, className, id, ...rest }: InputProps) {
  const generatedId = useId();
  const inputId = id || generatedId;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label
          htmlFor={inputId}
          className={clsx(
            'text-xs font-semibold uppercase tracking-wide',
            error ? 'text-danger' : 'text-text-secondary'
          )}
        >
          {label}
          {error && <span className="text-danger font-normal normal-case"> - {error}</span>}
        </label>
      )}

      <input
        {...rest}
        id={inputId}
        className={clsx(
          'w-full h-10 px-3 rounded-md bg-bg-tertiary text-text-primary',
          'border border-transparent outline-none',
          'placeholder:text-text-muted',
          'transition-colors duration-200',
          'focus:border-accent focus:ring-1 focus:ring-accent',
          error && 'border-danger focus:border-danger focus:ring-danger',
          className
        )}
      />

      {hint && !error && <p className="text-xs text-text-muted">{hint}</p>}
    </div>
  );
}
