import React from 'react';

export type StateVariant = 'ok' | 'warn' | 'danger' | 'unknown';

export interface StatusChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: StateVariant;
  label?: string;
  dot?: boolean;
  status?: string;
  size?: 'sm' | 'md';
}

export function mapStatusToVariant(status?: string): StateVariant {
  if (!status) return 'unknown';
  const s = status.toLowerCase();

  switch (s) {
    case 'ok':
    case 'active':
    case 'approved':
    case 'sent':
    case 'applied':
    case 'replied':
    case 'auto_email':
    case 'closed': // Circuit breaker closed is healthy
      return 'ok';

    case 'draft':
    case 'needs_review':
    case 'manual_pending':
    case 'manual_portal':
    case 'warn':
    case 'warning':
    case 'half_open':
      return 'warn';

    case 'rejected':
    case 'bounced':
    case 'failed':
    case 'danger':
    case 'invalid':
    case 'manual_review':
    case 'open': // Circuit breaker open is broken
      return 'danger';

    case 'unknown':
    case 'skipped':
    case 'archived':
    default:
      return 'unknown';
  }
}

export function StatusChip({
  variant,
  status,
  label,
  dot = true,
  size = 'sm',
  className = '',
  children,
  ...props
}: StatusChipProps) {
  const resolvedVariant = variant ?? mapStatusToVariant(status);
  const text = label ?? children ?? status ?? '';

  const variantStyles: Record<StateVariant, { container: string; dot: string }> = {
    ok: {
      container: 'bg-state-ok-bg text-state-ok-fg border-state-ok-border',
      dot: 'bg-state-ok-fg',
    },
    warn: {
      container: 'bg-state-warn-bg text-state-warn-fg border-state-warn-border',
      dot: 'bg-state-warn-fg',
    },
    danger: {
      container: 'bg-state-danger-bg text-state-danger-fg border-state-danger-border',
      dot: 'bg-state-danger-fg',
    },
    unknown: {
      container: 'bg-state-unknown-bg text-state-unknown-fg border-state-unknown-border',
      dot: 'bg-state-unknown-fg',
    },
  };

  const currentVariant = variantStyles[resolvedVariant];
  const sizeStyles = size === 'sm' ? 'px-2 py-0.5 text-[12px]' : 'px-2.5 py-1 text-[13px]';

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-medium rounded-[4px] border ${currentVariant.container} ${sizeStyles} ${className}`}
      {...props}
    >
      {dot && (
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${currentVariant.dot}`}
          aria-hidden="true"
        />
      )}
      <span className="truncate">{text}</span>
    </span>
  );
}
