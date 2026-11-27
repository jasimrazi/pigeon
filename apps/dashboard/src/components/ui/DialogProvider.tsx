import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { ConfirmationModal } from '../ConfirmationModal.js';
import { AlertModal, PromptModal, type ModalVariant } from './ModalShell.js';

export interface AlertOptions {
  title?: string | undefined;
  message: string;
  variant?: ModalVariant | undefined;
  confirmLabel?: string | undefined;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string | undefined;
  cancelLabel?: string | undefined;
  isDanger?: boolean | undefined;
}

export interface PromptOptions {
  title: string;
  message: string;
  defaultValue?: string | undefined;
  placeholder?: string | undefined;
  suggestions?: string[] | undefined;
  confirmLabel?: string | undefined;
  cancelLabel?: string | undefined;
}

export interface DialogContextValue {
  alert: (options: AlertOptions | string) => Promise<void>;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function DialogProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [alertState, setAlertState] = useState<AlertOptions | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmOptions | null>(null);
  const [promptState, setPromptState] = useState<PromptOptions | null>(null);

  const alertResolverRef = useRef<(() => void) | null>(null);
  const confirmResolverRef = useRef<((ok: boolean) => void) | null>(null);
  const promptResolverRef = useRef<((val: string | null) => void) | null>(null);

  const alert = useCallback((options: AlertOptions | string): Promise<void> => {
    const normalized: AlertOptions =
      typeof options === 'string' ? { title: 'Notice', message: options, variant: 'danger' } : options;
    return new Promise((resolve) => {
      alertResolverRef.current = resolve;
      setAlertState(normalized);
    });
  }, []);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      confirmResolverRef.current = resolve;
      setConfirmState(options);
    });
  }, []);

  const prompt = useCallback((options: PromptOptions): Promise<string | null> => {
    return new Promise((resolve) => {
      promptResolverRef.current = resolve;
      setPromptState(options);
    });
  }, []);

  const closeAlert = () => {
    setAlertState(null);
    const resolve = alertResolverRef.current;
    alertResolverRef.current = null;
    resolve?.();
  };

  const resolveConfirm = (ok: boolean) => {
    setConfirmState(null);
    const resolve = confirmResolverRef.current;
    confirmResolverRef.current = null;
    resolve?.(ok);
  };

  const resolvePrompt = (val: string | null) => {
    setPromptState(null);
    const resolve = promptResolverRef.current;
    promptResolverRef.current = null;
    resolve?.(val);
  };

  return (
    <DialogContext.Provider value={{ alert, confirm, prompt }}>
      {children}

      <AlertModal
        isOpen={alertState !== null}
        title={alertState?.title || 'Notice'}
        message={alertState?.message || ''}
        variant={alertState?.variant ?? 'danger'}
        confirmLabel={alertState?.confirmLabel}
        onClose={closeAlert}
      />

      <ConfirmationModal
        isOpen={confirmState !== null}
        title={confirmState?.title || ''}
        message={confirmState?.message || ''}
        confirmLabel={confirmState?.confirmLabel}
        cancelLabel={confirmState?.cancelLabel}
        isDanger={confirmState?.isDanger}
        onConfirm={() => resolveConfirm(true)}
        onCancel={() => resolveConfirm(false)}
      />

      <PromptModal
        isOpen={promptState !== null}
        title={promptState?.title || ''}
        message={promptState?.message || ''}
        defaultValue={promptState?.defaultValue}
        placeholder={promptState?.placeholder}
        suggestions={promptState?.suggestions}
        confirmLabel={promptState?.confirmLabel}
        cancelLabel={promptState?.cancelLabel}
        onConfirm={(val) => resolvePrompt(val)}
        onCancel={() => resolvePrompt(null)}
      />
    </DialogContext.Provider>
  );
}

/**
 * Returns app-styled dialog helpers (alert, confirm, prompt).
 * Also exposes a lightweight inline fallback if rendered outside DialogProvider in isolated tests.
 */
export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (ctx) return ctx;

  return {
    alert: async () => Promise.resolve(),
    confirm: async () => false,
    prompt: async () => null,
  };
}
