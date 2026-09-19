import { cn } from '@/lib/cn';

/**
 * Tabs. Used for the member profile and the settings screens, where several
 * related views share one page. Horizontal scroll keeps them usable on a phone
 * instead of wrapping into an unreadable block.
 */
export function Tabs({ tabs, active, onChange, className, size = 'md' }) {
  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      className={cn('no-scrollbar flex gap-1 overflow-x-auto border-b border-border', className)}
    >
      {tabs.map((tab) => {
        const selected = tab.key === active;
        const Icon = tab.icon;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`tab-${tab.key}`}
            aria-selected={selected}
            aria-controls={`panel-${tab.key}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.key)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
              const index = tabs.findIndex((t) => t.key === active);
              const delta = event.key === 'ArrowRight' ? 1 : -1;
              const next = tabs[(index + delta + tabs.length) % tabs.length];
              onChange(next.key);
              document.getElementById(`tab-${next.key}`)?.focus();
            }}
            className={cn(
              'relative flex shrink-0 items-center gap-1.5 whitespace-nowrap font-medium transition-colors',
              size === 'sm' ? 'px-2.5 py-2 text-xs' : 'px-3 py-2.5 text-sm',
              selected ? 'text-foreground' : 'text-muted hover:text-foreground',
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
            {tab.label}
            {typeof tab.count === 'number' && (
              <span
                className={cn(
                  'rounded-full px-1.5 text-[0.625rem] font-semibold',
                  selected ? 'bg-primary-soft text-primary' : 'bg-surface-alt text-muted',
                )}
              >
                {tab.count}
              </span>
            )}
            {selected && (
              <span className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-primary" aria-hidden="true" />
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ id, children, className }) {
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} className={cn('pt-4', className)}>
      {children}
    </div>
  );
}

export default Tabs;
