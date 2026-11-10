import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { StateVariant } from './StatusChip.js';

export interface AlertBannerProps {
  variant?: StateVariant;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function AlertBanner({
  variant = 'warn',
  title,
  description,
  action,
  className = '',
}: AlertBannerProps) {
  const icons = {
    ok: CheckCircle2,
    warn: AlertTriangle,
    danger: AlertCircle,
    unknown: Info,
  };

  const borderLeftMap: Record<StateVariant, string> = {
    ok: 'border-l-state-ok-fg',
    warn: 'border-l-state-warn-fg',
    danger: 'border-l-state-danger-fg',
    unknown: 'border-l-state-unknown-fg',
  };

  const iconColorMap: Record<StateVariant, string> = {
    ok: 'text-state-ok-fg',
    warn: 'text-state-warn-fg',
    danger: 'text-state-danger-fg',
    unknown: 'text-state-unknown-fg',
  };

  const Icon = icons[variant];

  return (
    <div
      role="alert"
      className={`bg-surface border border-border border-l-4 ${borderLeftMap[variant]} rounded-[6px] p-3.5 flex items-start justify-between gap-3 shadow-xs ${className}`}
    >
      <div className="flex items-start gap-3">
        <Icon
          size={20}
          strokeWidth={1.5}
          className={`shrink-0 mt-0.5 ${iconColorMap[variant]}`}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-fg leading-tight">{title}</div>
          {description && (
            <div className="mt-1 text-[13px] text-fg-muted leading-normal">{description}</div>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
