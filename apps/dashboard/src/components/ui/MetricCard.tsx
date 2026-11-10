import React from 'react';

export interface MetricCardProps {
  label: string;
  value: React.ReactNode;
  caption?: string;
  className?: string;
}

export function MetricCard({ label, value, caption, className = '' }: MetricCardProps) {
  return (
    <div
      className={`bg-surface border border-border rounded-[6px] p-4 flex flex-col justify-between transition-colors ${className}`}
    >
      <div className="text-[12px] font-medium uppercase tracking-wider text-fg-muted truncate">
        {label}
      </div>
      <div className="mt-2 text-[24px] font-semibold font-mono tabular-nums text-fg leading-none">
        {value}
      </div>
      {caption && <div className="mt-2 text-[12px] text-fg-muted truncate">{caption}</div>}
    </div>
  );
}
