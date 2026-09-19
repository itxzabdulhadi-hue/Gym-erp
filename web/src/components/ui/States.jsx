import { cn } from '@/lib/cn';
import { Button } from './Button';
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';

/**
 * The three states every data view must handle. Kept separate and explicit so
 * no screen can silently render an empty box while loading or after an error.
 */

export function Skeleton({ className }) {
  return <div className={cn('skeleton rounded', className)} aria-hidden="true" />;
}

/** Table-shaped skeleton, sized to the rows actually expected. */
export function TableSkeleton({ rows = 6, columns = 5, className }) {
  return (
    <div className={cn('space-y-2 p-4', className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-3">
          {Array.from({ length: columns }).map((__, c) => (
            <Skeleton
              key={c}
              className={cn('h-3.5', c === 0 ? 'w-[22%]' : 'flex-1')}
              style={{ opacity: 1 - r * 0.09 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ className, lines = 3 }) {
  return (
    <div className={cn('card space-y-3 p-5', className)} aria-busy="true">
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3" style={{ width: `${92 - i * 14}%` }} />
      ))}
    </div>
  );
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  actionLabel,
  onAction,
  compact = false,
  className,
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded border border-dashed border-border bg-surface text-center',
        compact ? 'px-4 py-8' : 'px-6 py-14',
        className,
      )}
    >
      <span className="grid h-11 w-11 place-items-center rounded-full bg-surface-alt text-muted" aria-hidden="true">
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="mt-3 text-sm font-semibold text-foreground">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted">{description}</p>}
      {(action || onAction) && (
        <div className="mt-4">{action || <Button size="sm" onClick={onAction}>{actionLabel || 'Get started'}</Button>}</div>
      )}
    </div>
  );
}

/**
 * Error state with a retry. The message shown is the server's own message where
 * there is one, so a permission problem does not read like a network failure.
 */
export function ErrorState({ error, onRetry, title, className, compact = false }) {
  const status = error?.status;
  const heading =
    title ||
    (status === 403
      ? 'You do not have access to this'
      : status === 404
        ? 'Not found'
        : 'Something went wrong');
  const detail =
    error?.message && !/failed to fetch|networkerror/i.test(error.message)
      ? error.message
      : 'The request could not be completed. Check your connection and try again.';

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center rounded border border-border bg-surface text-center',
        compact ? 'px-4 py-8' : 'px-6 py-14',
        className,
      )}
    >
      <span className="grid h-11 w-11 place-items-center rounded-full bg-danger-soft text-danger" aria-hidden="true">
        <AlertTriangle className="h-5 w-5" />
      </span>
      <h3 className="mt-3 text-sm font-semibold text-foreground">{heading}</h3>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted">{detail}</p>
      {onRetry && (
        <Button size="sm" variant="outline" className="mt-4" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" />
          Try again
        </Button>
      )}
    </div>
  );
}

/** Full-page loader used while the session is being restored. */
export function PageLoader({ label = 'Loading' }) {
  return (
    <div className="grid min-h-[60vh] place-items-center" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3">
        <span className="relative grid h-10 w-10 place-items-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-primary-soft" />
          <span className="relative h-3 w-3 rounded-full bg-primary" />
        </span>
        <span className="sr-only">{label}</span>
      </div>
    </div>
  );
}

export default EmptyState;
