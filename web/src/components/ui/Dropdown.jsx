import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * Dropdown menu. Opens on click, closes on Escape or an outside click, and
 * moves focus through items with the arrow keys. `menu` semantics rather than a
 * listbox, because these trigger actions rather than select a value.
 */
export function Dropdown({
  trigger,
  children,
  align = 'right',
  width = 'w-52',
  className,
  ariaLabel = 'Menu',
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const menuRef = useRef(null);
  const id = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!wrapRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        wrapRef.current?.querySelector('[data-dropdown-trigger]')?.focus();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const items = Array.from(
        menuRef.current?.querySelectorAll('[role="menuitem"]:not([disabled])') || [],
      );
      if (!items.length) return;
      event.preventDefault();
      const index = items.indexOf(document.activeElement);
      const next =
        event.key === 'ArrowDown'
          ? items[(index + 1) % items.length]
          : items[(index - 1 + items.length) % items.length];
      next?.focus();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    const raf = requestAnimationFrame(() => {
      menuRef.current?.querySelector('[role="menuitem"]')?.focus();
    });
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      cancelAnimationFrame(raf);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      <div
        data-dropdown-trigger
        role="button"
        tabIndex={0}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen((v) => !v);
          }
        }}
        className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {trigger}
      </div>

      {open && (
        <div
          ref={menuRef}
          id={id}
          role="menu"
          className={cn(
            'absolute z-40 mt-1.5 overflow-hidden rounded border border-border bg-surface p-1 shadow-lg animate-in-rise',
            width,
            align === 'right' ? 'right-0' : 'left-0',
          )}
          onClick={() => setOpen(false)}
        >
          {typeof children === 'function' ? children({ close: () => setOpen(false) }) : children}
        </div>
      )}
    </div>
  );
}

export function DropdownItem({ icon: Icon, children, tone = 'default', disabled, className, ...rest }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left text-sm transition-colors',
        'focus:outline-none focus-visible:bg-surface-alt',
        tone === 'danger' ? 'text-danger hover:bg-danger-soft' : 'text-foreground hover:bg-surface-alt',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
      {...rest}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
      <span className="truncate">{children}</span>
    </button>
  );
}

export function DropdownSeparator() {
  return <div role="separator" className="my-1 h-px bg-border" />;
}

export function DropdownLabel({ children }) {
  return <p className="px-2.5 pb-1 pt-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">{children}</p>;
}

export default Dropdown;
