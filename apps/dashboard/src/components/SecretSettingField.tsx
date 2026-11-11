import React, { useState } from 'react';
import { Eye, EyeOff, Lock, CheckCircle2, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from './ui/Button.js';
import type { SettingFieldSummary } from '@pigeon/shared';

interface Props {
  id: string;
  label: string;
  description?: string;
  summary?: SettingFieldSummary | undefined;
  value: string;
  onChange: (val: string) => void;
  onClear?: (() => Promise<void>) | undefined;
  placeholder?: string;
  disabled?: boolean;
}

export function SecretSettingField({
  id,
  label,
  description,
  summary,
  value,
  onChange,
  onClear,
  placeholder = 'Enter secret value...',
  disabled = false,
}: Props): React.JSX.Element {
  const [isReplacing, setIsReplacing] = useState(false);
  const [showPlain, setShowPlain] = useState(false);
  const [clearing, setClearing] = useState(false);

  const isSet = Boolean(summary?.isSet);
  const maskedHint = summary?.maskedHint;
  const isEnvSource = summary?.source === 'env';

  const handleClear = async () => {
    if (!onClear) return;
    try {
      setClearing(true);
      await onClear();
      setIsReplacing(false);
      onChange('');
    } finally {
      setClearing(false);
    }
  };

  const handleCancelReplace = () => {
    setIsReplacing(false);
    onChange('');
    setShowPlain(false);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label
          htmlFor={id}
          className="block text-[12px] font-medium uppercase tracking-wider text-fg-muted"
        >
          {label}
        </label>
        {isEnvSource && (
          <span className="text-[11px] px-1.5 py-0.5 rounded-[4px] border border-border bg-surface-subtle text-fg-muted">
            Environment variable
          </span>
        )}
      </div>

      {description && <p className="text-[12px] text-fg-muted leading-relaxed">{description}</p>}

      {isSet && !isReplacing ? (
        <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-[6px] border border-state-ok-border bg-state-ok-bg/30">
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle2 size={16} strokeWidth={1.5} className="text-state-ok-fg shrink-0" />
            <span className="text-[13px] font-medium text-fg truncate">
              Saved
              {maskedHint ? (
                <span className="ml-1 text-fg-muted font-mono text-[12px]">
                  (ends in ••••{maskedHint})
                </span>
              ) : null}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={disabled}
              onClick={() => setIsReplacing(true)}
            >
              <RotateCcw size={13} className="mr-1" />
              Replace
            </Button>
            {onClear && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={disabled || clearing}
                loading={clearing}
                onClick={() => void handleClear()}
              >
                <Trash2 size={13} className="mr-1" />
                Clear
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="relative flex items-center">
            <div className="absolute left-3 text-fg-muted pointer-events-none">
              <Lock size={14} strokeWidth={1.5} />
            </div>
            <input
              id={id}
              type={showPlain ? 'text' : 'password'}
              autoComplete="off"
              value={value}
              disabled={disabled}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              className="w-full text-[13px] pl-9 pr-10 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent font-mono"
            />
            <button
              type="button"
              onClick={() => setShowPlain((prev) => !prev)}
              aria-label={showPlain ? 'Hide secret' : 'Show secret'}
              className="absolute right-2.5 text-fg-muted hover:text-fg p-1 rounded-[4px] cursor-pointer"
            >
              {showPlain ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>

          {isReplacing && (
            <div className="flex justify-end">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleCancelReplace}
                disabled={disabled}
              >
                Cancel Replace
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
