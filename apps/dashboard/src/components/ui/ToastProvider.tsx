import React, { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export type ToastVariant = 'ok' | 'danger' | 'info';

export interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  pushToast: (message: string, variant?: ToastVariant, durationMs?: number) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (message: string, variant: ToastVariant = 'info', durationMs = 4000) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-3), { id, message, variant }]);
      if (durationMs > 0) {
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, durationMs);
      }
    },
    [],
  );

  const success = useCallback((message: string) => pushToast(message, 'ok', 3500), [pushToast]);
  const error = useCallback((message: string) => pushToast(message, 'danger', 5500), [pushToast]);
  const info = useCallback((message: string) => pushToast(message, 'info', 4000), [pushToast]);

  return (
    <ToastContext.Provider value={{ pushToast, success, error, info }}>
      {children}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          aria-label="Notifications"
          className="fixed bottom-16 md:bottom-5 right-4 z-50 flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)] pointer-events-none"
        >
          {toasts.map((toast) => {
            const style =
              toast.variant === 'ok'
                ? 'bg-state-ok-bg border-state-ok-border text-state-ok-fg'
                : toast.variant === 'danger'
                  ? 'bg-state-danger-bg border-state-danger-border text-state-danger-fg'
                  : 'bg-surface border-border text-fg';
            const Icon =
              toast.variant === 'ok'
                ? CheckCircle2
                : toast.variant === 'danger'
                  ? AlertCircle
                  : Info;
            return (
              <div
                key={toast.id}
                role="status"
                className={`pointer-events-auto flex items-start gap-2.5 px-3.5 py-2.5 rounded-[6px] border shadow-lg text-[13px] font-medium ${style}`}
              >
                <Icon size={15} strokeWidth={1.75} className="shrink-0 mt-0.5" aria-hidden="true" />
                <span className="flex-1 leading-snug">{toast.message}</span>
                <button
                  type="button"
                  onClick={() => dismiss(toast.id)}
                  aria-label="Dismiss notification"
                  className="opacity-70 hover:opacity-100 cursor-pointer shrink-0 p-0.5"
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      pushToast: () => undefined,
      success: () => undefined,
      error: () => undefined,
      info: () => undefined,
    };
  }
  return ctx;
}
