import { JSX, splitProps, Show, createUniqueId } from 'solid-js';
import { clsx } from 'clsx';

interface InputProps extends JSX.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export function Input(props: InputProps) {
  const [local, rest] = splitProps(props, ['label', 'error', 'hint', 'class', 'id']);
  const inputId = local.id || createUniqueId();

  return (
    <div class="flex flex-col gap-1.5">
      <Show when={local.label}>
        <label
          for={inputId}
          class={clsx(
            'text-xs font-semibold uppercase tracking-wide',
            local.error ? 'text-danger' : 'text-text-secondary'
          )}
        >
          {local.label}
          <Show when={local.error}>
            <span class="text-danger font-normal normal-case"> - {local.error}</span>
          </Show>
        </label>
      </Show>
      
      <input
        {...rest}
        id={inputId}
        class={clsx(
          'w-full h-10 px-3 rounded-md bg-bg-tertiary text-text-primary',
          'border border-transparent outline-none',
          'placeholder:text-text-muted',
          'transition-colors duration-200',
          'focus:border-accent focus:ring-1 focus:ring-accent',
          local.error && 'border-danger focus:border-danger focus:ring-danger',
          local.class
        )}
      />

      <Show when={local.hint && !local.error}>
        <p class="text-xs text-text-muted">{local.hint}</p>
      </Show>
    </div>
  );
}
