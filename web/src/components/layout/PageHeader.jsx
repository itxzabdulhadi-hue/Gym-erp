import { cn } from '@/lib/cn';

/**
 * Page header. Consistent title hierarchy across every screen, with an actions
 * slot that wraps onto its own row on a phone instead of crushing the title.
 */
export function PageHeader({ title, description, actions, children, className }) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      {children}
    </header>
  );
}

export default PageHeader;
