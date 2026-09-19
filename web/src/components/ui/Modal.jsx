import { useCallback, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';

/**
 * Modal dialog.
 *
 * Rendered in a portal, locks body scroll, traps Tab inside itself, restores
 * focus to the element that opened it, and closes on Escape or backdrop click.
 * The same component is a centred dialog on desktop and a bottom sheet on a
 * phone, because a centred 400px dialog is unusable at 320px.
 */

const SIZES = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
};

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
  initialFocus,
}) {
  const panelRef = useRef(null);
  const restoreRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();

  const focusables = useCallback(() => {
    if (!panelRef.current) return [];
    return Array.from(panelRef.current.querySelectorAll(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    restoreRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Defer so the panel exists before measuring it.
    const raf = requestAnimationFrame(() => {
      const target =
        (initialFocus && panelRef.current?.querySelector(initialFocus)) || focusables()[0];
      target?.focus();
    });

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreRef.current?.focus?.();
    };
  }, [open, onClose, focusables, initialFocus]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-black/45 animate-in-fade"
        onClick={closeOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          'relative flex max-h-[92vh] w-full flex-col overflow-hidden border border-border bg-surface shadow-xl animate-in-rise',
          'rounded-t-lg sm:rounded-lg',
          SIZES[size] || SIZES.md,
        )}
      >
        {(title || onClose) && (
          <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-3.5 sm:px-5">
            <div className="min-w-0">
              {title && (
                <h2 id={titleId} className="truncate text-base font-semibold text-foreground">
                  {title}
                </h2>
              )}
              {description && (
                <p id={descriptionId} className="mt-0.5 text-xs text-muted">
                  {description}
                </p>
              )}
            </div>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                className="-mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded text-muted transition-colors hover:bg-surface-alt hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </header>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>

        {footer && (
          <footer className="flex flex-col-reverse gap-2 border-t border-border bg-surface-alt px-4 py-3 pb-safe sm:flex-row sm:justify-end sm:px-5">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Destructive confirmation. Returns nothing; the caller passes onConfirm. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = 'Are you sure?',
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  loading = false,
}) {
  return (
    <Modal
      open={open}
      onClose={loading ? undefined : onClose}
      title={title}
      size="sm"
      closeOnBackdrop={!loading}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-muted">{description}</p>
    </Modal>
  );
}

export default Modal;
