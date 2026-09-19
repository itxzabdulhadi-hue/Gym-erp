import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Toasts. One provider at the app root; any component calls useToast() and gets
 * a stable push function. Announced to screen readers via a polite live region.
 */

const ToastContext = createContext(null);

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

// Token colours are CSS variables, so opacity modifiers cannot be used; the
// tone is carried by the icon and the accent colour instead.
const TONES = {
  success: 'border-border bg-surface',
  error: 'border-border bg-surface',
  warning: 'border-border bg-surface',
  info: 'border-border bg-surface',
};

const ACCENTS = {
  success: 'text-success',
  error: 'text-danger',
  warning: 'text-warning',
  info: 'text-info',
};

let sequence = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    ({ tone = 'info', title, description, duration = 4500, action }) => {
      sequence += 1;
      const id = sequence;
      setToasts((list) => [...list.slice(-3), { id, tone, title, description, action }]);
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) clearTimeout(timer);
      map.clear();
    };
  }, []);

  const value = useMemo(
    () => ({
      push,
      dismiss,
      success: (title, description, options) => push({ tone: 'success', title, description, ...options }),
      error: (title, description, options) => push({ tone: 'error', title, description, duration: 6500, ...options }),
      warning: (title, description, options) => push({ tone: 'warning', title, description, ...options }),
      info: (title, description, options) => push({ tone: 'info', title, description, ...options }),
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div
          className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-3 pb-safe sm:inset-x-auto sm:right-4 sm:top-4 sm:bottom-auto sm:items-end sm:p-0"
          role="region"
          aria-label="Notifications"
        >
          <div aria-live="polite" aria-atomic="false" className="sr-only">
            {toasts.map((t) => (
              <p key={t.id}>{t.title}{t.description ? `: ${t.description}` : ''}</p>
            ))}
          </div>
          {toasts.map((toast) => {
            const Icon = ICONS[toast.tone] || Info;
            return (
              <div
                key={toast.id}
                role="status"
                className={cn(
                  'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded border border-border p-3 shadow-lg animate-in-rise',
                  TONES[toast.tone] || TONES.info,
                )}
              >
                <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', ACCENTS[toast.tone] || ACCENTS.info)} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{toast.title}</p>
                  {toast.description && (
                    <p className="mt-0.5 text-xs leading-relaxed text-muted">{toast.description}</p>
                  )}
                  {toast.action && (
                    <button
                      type="button"
                      onClick={() => {
                        toast.action.onClick?.();
                        dismiss(toast.id);
                      }}
                      className="mt-1.5 text-xs font-medium text-primary hover:underline"
                    >
                      {toast.action.label}
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(toast.id)}
                  aria-label="Dismiss notification"
                  className="-mr-1 -mt-1 grid h-6 w-6 shrink-0 place-items-center rounded text-muted transition-colors hover:bg-surface-alt hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

export default ToastProvider;
