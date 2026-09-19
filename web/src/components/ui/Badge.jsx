import { cn } from '@/lib/cn';

/**
 * Status badges. Tinted backgrounds come from the theme's *-soft tokens, so a
 * "paid" badge stays legible in any palette including dark themes.
 */
const TONES = {
  neutral: 'bg-surface-alt text-muted border-border',
  primary: 'bg-primary-soft text-primary border-transparent',
  success: 'bg-success-soft text-success border-transparent',
  warning: 'bg-warning-soft text-warning border-transparent',
  danger: 'bg-danger-soft text-danger border-transparent',
  info: 'bg-info-soft text-info border-transparent',
  accent: 'bg-accent text-accent-fg border-transparent',
};

const DOTS = {
  neutral: 'bg-muted',
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  accent: 'bg-accent',
};

export function Badge({ tone = 'neutral', dot = false, className, children, icon: Icon }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium leading-5',
        TONES[tone] || TONES.neutral,
        className,
      )}
    >
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', DOTS[tone] || DOTS.neutral)} aria-hidden="true" />}
      {Icon && <Icon className="h-3 w-3" aria-hidden="true" />}
      {children}
    </span>
  );
}

/**
 * Maps a lifecycle status string from the API to a tone. Centralised so the
 * colour of "active" is the same on the members list, the profile and reports.
 */
const STATUS_TONES = {
  active: 'success',
  paid: 'success',
  completed: 'success',
  checked_in: 'success',
  present: 'success',
  enabled: 'success',
  approved: 'success',

  pending: 'warning',
  partial: 'warning',
  frozen: 'info',
  paused: 'info',
  trial: 'info',
  scheduled: 'info',
  refunded: 'info',

  expired: 'danger',
  cancelled: 'danger',
  canceled: 'danger',
  failed: 'danger',
  overdue: 'danger',
  disabled: 'neutral',
  inactive: 'neutral',
  suspended: 'danger',
  absent: 'danger',
  draft: 'neutral',
};

export function statusTone(status) {
  if (!status) return 'neutral';
  return STATUS_TONES[String(status).toLowerCase()] || 'neutral';
}

export function StatusBadge({ status, label, className }) {
  if (!status) return <span className="text-xs text-muted">—</span>;
  const text =
    label ||
    String(status)
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <Badge tone={statusTone(status)} dot className={className}>
      {text}
    </Badge>
  );
}

export default Badge;
