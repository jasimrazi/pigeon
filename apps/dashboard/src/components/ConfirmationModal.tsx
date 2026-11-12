import React from 'react';
import { AlertCircle, HelpCircle } from 'lucide-react';
import { Button } from './ui/Button.js';

interface Props {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDanger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmationModal({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isDanger = false,
  onConfirm,
  onCancel,
}: Props): React.JSX.Element | null {
  if (!isOpen) return null;

  const Icon = isDanger ? AlertCircle : HelpCircle;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
    >
      <div className="bg-surface rounded-[6px] max-w-md w-full p-6 border border-border shadow-sm">
        <div className="flex items-start gap-3">
          <div
            className={`p-2 rounded-[4px] shrink-0 ${
              isDanger
                ? 'bg-state-danger-bg text-state-danger-fg border border-state-danger-border'
                : 'bg-surface-subtle text-fg border border-border'
            }`}
          >
            <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[16px] font-semibold text-fg">{title}</h3>
            <p className="mt-2 text-[14px] text-fg-muted leading-relaxed">{message}</p>
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:items-center justify-end gap-2.5 sm:gap-3">
          <Button variant="secondary" size="md" onClick={onCancel} className="w-full sm:w-auto">
            {cancelLabel}
          </Button>
          <Button variant={isDanger ? 'destructive' : 'primary'} size="md" onClick={onConfirm} className="w-full sm:w-auto">
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
