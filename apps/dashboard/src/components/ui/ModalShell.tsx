import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, HelpCircle, Info } from 'lucide-react';
import { Button } from './Button.js';

export type ModalVariant = 'danger' | 'warn' | 'info' | 'ok';

interface ModalShellProps {
  isOpen: boolean;
  onClose: () => void;
  titleId?: string | undefined;
  children: React.ReactNode;
}

export function ModalShell({
  isOpen,
  onClose,
  titleId,
  children,
}: ModalShellProps): React.JSX.Element | null {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
    >
      <div className="bg-surface rounded-[6px] max-w-md w-full p-6 border border-border shadow-sm">
        {children}
      </div>
    </div>
  );
}

function getVariantIcon(variant: ModalVariant) {
  switch (variant) {
    case 'danger':
      return {
        Icon: AlertCircle,
        badgeClass: 'bg-state-danger-bg text-state-danger-fg border border-state-danger-border',
      };
    case 'warn':
      return {
        Icon: AlertTriangle,
        badgeClass: 'bg-state-warn-bg text-state-warn-fg border border-state-warn-border',
      };
    case 'ok':
      return {
        Icon: CheckCircle2,
        badgeClass: 'bg-state-ok-bg text-state-ok-fg border border-state-ok-border',
      };
    case 'info':
    default:
      return {
        Icon: Info,
        badgeClass: 'bg-surface-subtle text-fg border border-border',
      };
  }
}

export interface AlertModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  variant?: ModalVariant | undefined;
  confirmLabel?: string | undefined;
  onClose: () => void;
}

export function AlertModal({
  isOpen,
  title,
  message,
  variant = 'danger',
  confirmLabel = 'OK',
  onClose,
}: AlertModalProps): React.JSX.Element | null {
  const okButtonRef = useRef<HTMLButtonElement>(null);
  const { Icon, badgeClass } = getVariantIcon(variant);

  useEffect(() => {
    if (isOpen) {
      okButtonRef.current?.focus();
    }
  }, [isOpen]);

  return (
    <ModalShell isOpen={isOpen} onClose={onClose} titleId="pigeon-alert-modal-title">
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-[4px] shrink-0 ${badgeClass}`}>
          <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 id="pigeon-alert-modal-title" className="text-[16px] font-semibold text-fg">
            {title}
          </h3>
          <p className="mt-2 text-[14px] text-fg-muted leading-relaxed break-words">{message}</p>
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <Button
          ref={okButtonRef}
          variant={variant === 'danger' ? 'destructive' : 'primary'}
          size="md"
          onClick={onClose}
          data-testid="alert-modal-ok"
        >
          {confirmLabel}
        </Button>
      </div>
    </ModalShell>
  );
}

export interface PromptModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  defaultValue?: string | undefined;
  placeholder?: string | undefined;
  suggestions?: string[] | undefined;
  confirmLabel?: string | undefined;
  cancelLabel?: string | undefined;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function PromptModal({
  isOpen,
  title,
  message,
  defaultValue = '',
  placeholder,
  suggestions,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: PromptModalProps): React.JSX.Element | null {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setValue(defaultValue);
      const timer = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isOpen, defaultValue]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm(value.trim() || defaultValue);
  };

  return (
    <ModalShell isOpen={isOpen} onClose={onCancel} titleId="pigeon-prompt-modal-title">
      <form onSubmit={handleSubmit}>
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-[4px] shrink-0 bg-surface-subtle text-fg border border-border">
            <HelpCircle size={20} strokeWidth={1.5} aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 id="pigeon-prompt-modal-title" className="text-[16px] font-semibold text-fg">
              {title}
            </h3>
            <p className="mt-1.5 text-[13px] text-fg-muted leading-relaxed">{message}</p>
          </div>
        </div>

        <div className="mt-4 space-y-2.5">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            aria-label={message}
            data-testid="prompt-modal-input"
            className="w-full text-[13px] font-mono px-3 py-2 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />

          {suggestions && suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((suggestion) => {
                const isSelected = value === suggestion;
                return (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => setValue(suggestion)}
                    className={`px-2 py-0.5 text-[11px] font-mono rounded-[4px] border transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-accent/10 border-accent text-accent font-medium'
                        : 'bg-surface-subtle border-border text-fg-muted hover:text-fg'
                    }`}
                  >
                    {suggestion}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:items-center justify-end gap-2.5 sm:gap-3">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onCancel}
            className="w-full sm:w-auto"
            data-testid="prompt-modal-cancel"
          >
            {cancelLabel}
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            className="w-full sm:w-auto"
            data-testid="prompt-modal-confirm"
          >
            {confirmLabel}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}
