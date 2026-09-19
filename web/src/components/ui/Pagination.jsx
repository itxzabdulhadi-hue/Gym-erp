import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';
import { plainNumber } from '@/lib/format';

/**
 * Pagination. Shows a compact range on small screens and the full window on
 * desktop, and states the result range in words for screen readers.
 */
export function Pagination({ page, limit, total, onPageChange, className }) {
  const totalPages = Math.max(1, Math.ceil((total || 0) / (limit || 1)));
  const current = Math.min(Math.max(1, page || 1), totalPages);
  const from = total === 0 ? 0 : (current - 1) * limit + 1;
  const to = Math.min(current * limit, total || 0);

  const window = [];
  const span = 1;
  for (let p = 1; p <= totalPages; p += 1) {
    if (p === 1 || p === totalPages || Math.abs(p - current) <= span) window.push(p);
  }
  const items = window.filter((p, i) => window.indexOf(p) === i);

  return (
    <nav
      className={cn('flex items-center justify-between gap-3 border-t border-border px-3 py-2.5', className)}
      aria-label="Pagination"
    >
      <p className="text-xs text-muted" aria-live="polite">
        {total === 0 ? (
          'No results'
        ) : (
          <>
            <span className="font-medium text-foreground">{plainNumber(from)}–{plainNumber(to)}</span>
            {' of '}
            <span className="font-medium text-foreground">{plainNumber(total)}</span>
            <span className="hidden sm:inline"> · page {current} of {totalPages}</span>
          </>
        )}
      </p>

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => onPageChange(current - 1)}
          disabled={current <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <div className="hidden items-center gap-1 sm:flex">
          {items.map((p, index) => {
            const previous = items[index - 1];
            const gap = previous && p - previous > 1;
            return (
              <span key={p} className="flex items-center gap-1">
                {gap && <span className="px-1 text-xs text-muted" aria-hidden="true">…</span>}
                <button
                  type="button"
                  onClick={() => onPageChange(p)}
                  aria-current={p === current ? 'page' : undefined}
                  className={cn(
                    'h-8 min-w-8 rounded px-2 text-xs font-medium transition-colors',
                    p === current
                      ? 'bg-primary text-primary-fg'
                      : 'text-muted hover:bg-surface-alt hover:text-foreground',
                  )}
                >
                  {p}
                </button>
              </span>
            );
          })}
        </div>

        <span className="px-1 text-xs text-muted sm:hidden" aria-hidden="true">
          {current}/{totalPages}
        </span>

        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => onPageChange(current + 1)}
          disabled={current >= totalPages}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  );
}

export default Pagination;
