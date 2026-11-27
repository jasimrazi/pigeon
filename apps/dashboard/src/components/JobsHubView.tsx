import React, { useEffect, useState } from 'react';
import { Mail, Send, Sparkles } from 'lucide-react';
import { ReviewQueueView } from './ReviewQueueView.js';
import { ManualQueueView } from './ManualQueueView.js';
import { MailJobsView } from './MailJobsView.js';

export type JobsSubTab = 'review-queue' | 'manual-apply' | 'mail-jobs';

interface Props {
  apiBase?: string | undefined;
  initialSubTab?: JobsSubTab | undefined;
  onSubTabChange?: ((subTab: JobsSubTab) => void) | undefined;
  reviewPendingCount?: number | undefined;
  manualWaitingCount?: number | undefined;
  onActionComplete?: (() => void) | undefined;
  onNavigateTab?: ((tab: string, subTab?: string) => void) | undefined;
}

export function JobsHubView({
  apiBase = '',
  initialSubTab = 'review-queue',
  onSubTabChange,
  reviewPendingCount = 0,
  manualWaitingCount = 0,
  onActionComplete,
  onNavigateTab,
}: Props): React.JSX.Element {
  const [subTab, setSubTab] = useState<JobsSubTab>(initialSubTab);

  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab]);

  const handleSelectSubTab = (next: JobsSubTab) => {
    setSubTab(next);
    onSubTabChange?.(next);
  };

  const tabs: Array<{
    id: JobsSubTab;
    label: string;
    icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
    count?: number | undefined;
  }> = [
    {
      id: 'review-queue',
      label: 'Review Queue',
      icon: Mail,
      count: reviewPendingCount > 0 ? reviewPendingCount : undefined,
    },
    {
      id: 'manual-apply',
      label: 'Manual Apply',
      icon: Send,
      count: manualWaitingCount > 0 ? manualWaitingCount : undefined,
    },
    {
      id: 'mail-jobs',
      label: 'Parsed Jobs',
      icon: Sparkles,
    },
  ];

  return (
    <div className="space-y-5">
      {/* Unified Jobs Sub-Navigation */}
      <div
        role="tablist"
        aria-label="Jobs workspace sections"
        className="bg-surface border border-border rounded-[6px] p-1.5 flex items-center gap-1.5 overflow-x-auto scrollbar-none"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = subTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`jobs-subtab-${tab.id}`}
              onClick={() => handleSelectSubTab(tab.id)}
              className={`flex-1 min-w-fit inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-[4px] text-[13px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                active
                  ? 'bg-surface-subtle text-fg border border-border shadow-xs font-semibold'
                  : 'text-fg-muted hover:text-fg hover:bg-surface-subtle/50 border border-transparent'
              }`}
            >
              <Icon
                size={14}
                strokeWidth={1.75}
                className={active ? 'text-accent shrink-0' : 'text-fg-muted shrink-0'}
              />
              <span>{tab.label}</span>
              {tab.count !== undefined && (
                <span className="text-[11px] font-mono font-semibold tabular-nums px-1.5 py-0.2 rounded-[4px] bg-accent/15 text-accent border border-accent/25 leading-tight">
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Active Sub-View */}
      {subTab === 'review-queue' && (
        <ReviewQueueView
          apiBase={apiBase}
          {...(onActionComplete ? { onActionComplete } : {})}
        />
      )}
      {subTab === 'manual-apply' && (
        <ManualQueueView
          apiBase={apiBase}
          {...(onActionComplete ? { onActionComplete } : {})}
        />
      )}
      {subTab === 'mail-jobs' && (
        <MailJobsView
          apiBase={apiBase}
          {...(onNavigateTab ? { onNavigateTab } : {})}
        />
      )}
    </div>
  );
}
