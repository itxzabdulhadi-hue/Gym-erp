import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

/**
 * Button.
 *
 * Colours come only from tokens, so a tenant's palette restyles every button in
 * the product. `variant` maps to the theme's buttonStyle when the caller does
 * not override it.
 */
const SIZES = {
  xs: 'h-7 px-2.5 text-xs gap-1.5',
  sm: 'h-8 px-3 text-[0.8125rem] gap-1.5',
  md: 'h-9.5 px-3.5 text-sm gap-2',
  lg: 'h-11 px-5 text-[0.9375rem] gap-2',
  icon: 'h-9 w-9 justify-center',
  'icon-sm': 'h-8 w-8 justify-center',
};

const VARIANTS = {
  primary:
    'bg-primary text-primary-fg hover:bg-primary-hover shadow-sm disabled:hover:bg-primary',
  secondary:
    'bg-secondary text-secondary-fg hover:opacity-90',
  accent: 'bg-accent text-accent-fg hover:opacity-90',
  outline:
    'border border-border bg-surface text-foreground hover:bg-surface-alt',
  ghost: 'text-foreground hover:bg-surface-alt',
  soft: 'bg-primary-soft text-primary hover:opacity-85',
  danger: 'bg-danger text-white hover:opacity-90',
  'danger-outline': 'border border-danger text-danger hover:bg-danger-soft',
  link: 'text-primary underline-offset-4 hover:underline px-0',
};

const SHAPES = {
  solid: 'rounded',
  soft: 'rounded',
  outline: 'rounded',
  pill: 'rounded-full',
};

export const Button = forwardRef(function Button(
  {
    as: Component = 'button',
    variant = 'primary',
    size = 'md',
    shape,
    className,
    children,
    loading = false,
    disabled,
    type,
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <Component
      ref={ref}
      type={Component === 'button' ? type || 'button' : type}
      disabled={Component === 'button' ? isDisabled : undefined}
      aria-disabled={isDisabled || undefined}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex select-none items-center whitespace-nowrap font-medium',
        'transition-[background-color,color,box-shadow,opacity] duration-150 ease-smooth',
        'disabled:cursor-not-allowed disabled:opacity-55',
        SIZES[size] || SIZES.md,
        VARIANTS[variant] || VARIANTS.primary,
        SHAPES[shape] || SHAPES.solid,
        className,
      )}
      {...rest}
    >
      {loading && <Spinner className="h-3.5 w-3.5" />}
      {children}
    </Component>
  );
});

export function Spinner({ className }) {
  return (
    <svg
      className={cn('animate-spin', className || 'h-4 w-4')}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export default Button;
