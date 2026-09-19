import { cn } from '@/lib/cn';

/**
 * Card. The theme's cardStyle decides whether the surface is flat, outlined or
 * elevated, so the same component reads differently per tenant.
 */
export function Card({ className, children, as: Component = 'div', padded = true, ...rest }) {
  return (
    <Component
      className={cn(
        'card overflow-hidden',
        padded && 'p-4 sm:p-5',
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  );
}

export function CardHeader({ title, description, action, icon: Icon, className }) {
  return (
    <div className={cn('flex items-start justify-between gap-3', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span
            className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded bg-primary-soft text-primary"
            aria-hidden="true"
          >
            <Icon className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="truncate text-[0.9375rem] font-semibold text-foreground">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardFooter({ className, children }) {
  return (
    <div
      className={cn(
        '-mx-4 -mb-4 mt-4 flex items-center justify-between gap-2 border-t border-border bg-surface-alt px-4 py-2.5 sm:-mx-5 sm:-mb-5 sm:px-5',
        className,
      )}
    >
      {children}
    </div>
  );
}

export default Card;
