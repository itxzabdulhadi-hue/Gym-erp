import { forwardRef, useId } from 'react';
import { cn } from '@/lib/cn';

/**
 * Form primitives. Every field renders a real <label> wired by id, announces
 * its own error, and keeps the same visual weight at 320px and on a desktop.
 */

const INPUT_STYLES = {
  outlined: 'border border-border bg-input',
  filled: 'border border-transparent bg-surface-alt',
  underlined: 'border-0 border-b border-border bg-transparent rounded-none px-0',
};

const BASE =
  'w-full text-sm text-foreground placeholder:text-muted transition-colors duration-150 ' +
  'focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

export const Input = forwardRef(function Input(
  { className, invalid, inputStyle = 'outlined', size = 'md', ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        BASE,
        INPUT_STYLES[inputStyle] || INPUT_STYLES.outlined,
        size === 'sm' ? 'h-8 px-2.5' : size === 'lg' ? 'h-11 px-3.5' : 'h-9.5 px-3',
        inputStyle === 'underlined' ? 'h-9.5 py-1' : 'rounded',
        invalid && 'border-danger focus:ring-danger focus:border-danger',
        className,
      )}
      {...rest}
    />
  );
});

export const Textarea = forwardRef(function Textarea({ className, invalid, rows = 3, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        BASE,
        'rounded border border-border bg-input px-3 py-2',
        invalid && 'border-danger focus:ring-danger',
        className,
      )}
      {...rest}
    />
  );
});

export const Select = forwardRef(function Select(
  { className, invalid, children, inputStyle = 'outlined', size = 'md', ...rest },
  ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          BASE,
          'appearance-none pr-8',
          INPUT_STYLES[inputStyle] || INPUT_STYLES.outlined,
          size === 'sm' ? 'h-8 px-2.5' : 'h-9.5 px-3',
          inputStyle === 'underlined' ? '' : 'rounded',
          invalid && 'border-danger',
          className,
        )}
        {...rest}
      >
        {children}
      </select>
      <svg
        className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
      >
        <path d="m5 8 5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
});

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  className,
  children,
  labelClassName,
}) {
  const autoId = useId();
  const id = htmlFor || autoId;
  const errorId = `${id}-error`;
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <label
          htmlFor={id}
          className={cn('block text-xs font-medium text-foreground', labelClassName)}
        >
          {label}
          {required && (
            <span className="ml-0.5 text-danger" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      {typeof children === 'function' ? children({ id, error, errorId }) : children}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted">{hint}</p>
      )}
    </div>
  );
}

export function Checkbox({ label, description, className, id, ...rest }) {
  const autoId = useId();
  const inputId = id || autoId;
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <input
        id={inputId}
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border bg-input text-primary accent-[var(--color-primary)] focus:ring-2 focus:ring-ring"
        {...rest}
      />
      {label && (
        <label htmlFor={inputId} className="cursor-pointer select-none text-sm leading-tight">
          <span className="text-foreground">{label}</span>
          {description && <span className="mt-0.5 block text-xs text-muted">{description}</span>}
        </label>
      )}
    </div>
  );
}

export function Switch({ label, description, className, id, checked, disabled, onChange, ...rest }) {
  const autoId = useId();
  const inputId = id || autoId;
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      {(label || description) && (
        <label htmlFor={inputId} className="cursor-pointer select-none">
          {label && <span className="block text-sm font-medium text-foreground">{label}</span>}
          {description && <span className="mt-0.5 block text-xs text-muted">{description}</span>}
        </label>
      )}
      <button
        id={inputId}
        type="button"
        role="switch"
        aria-checked={!!checked}
        aria-label={typeof label === 'string' ? label : undefined}
        disabled={disabled}
        onClick={() => !disabled && onChange?.(!checked)}
        className={cn(
          'relative h-5.5 w-10 shrink-0 rounded-full transition-colors duration-200 ease-smooth',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          checked ? 'bg-primary' : 'bg-border',
          disabled && 'cursor-not-allowed opacity-50',
        )}
        {...rest}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-smooth',
            checked ? 'translate-x-[1.375rem]' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}
