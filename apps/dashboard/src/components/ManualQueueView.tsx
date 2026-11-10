import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { ManualQueueResponse, ManualKit } from '@pigeon/shared';
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Flag,
  Info,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { Button } from './ui/Button.js';
import { StatusChip } from './ui/StatusChip.js';

interface Props {
  apiBase?: string;
}

export function ManualQueueView({ apiBase = '' }: Props): React.JSX.Element {
  const [data, setData] = useState<ManualQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [kit, setKit] = useState<ManualKit | null>(null);
  const [kitLoading, setKitLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'focus' | 'needs_attention' | 'all'>('focus');
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [editedLetter, setEditedLetter] = useState<string>('');
  const [savingLetter, setSavingLetter] = useState(false);
  const [letterErrors, setLetterErrors] = useState<string[]>([]);

  // Fetch Queue Items
  const loadQueue = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${apiBase}/api/manual`);
      if (!res.ok) {
        throw new Error(`Failed to load queue (${res.status})`);
      }
      const json = (await res.json()) as ManualQueueResponse & { ok?: boolean };
      setData(json);

      // Default select the first item if none selected
      const list = json.todays_focus.length > 0 ? json.todays_focus : json.items;
      if (list.length > 0 && !selectedId) {
        setSelectedId(list[0]?.application_id ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [apiBase, selectedId]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  // Fetch Kit when selectedId changes
  useEffect(() => {
    if (!selectedId) {
      setKit(null);
      return;
    }

    let isMounted = true;
    async function loadKit() {
      try {
        setKitLoading(true);
        const res = await fetch(`${apiBase}/api/manual/${selectedId}/kit`);
        if (!res.ok) {
          throw new Error('Failed to load kit');
        }
        const json = (await res.json()) as { kit: ManualKit };
        if (isMounted) {
          setKit(json.kit);
          setEditedLetter(json.kit.cover_letter || '');
          setLetterErrors(json.kit.validator_errors || []);
        }
      } catch {
        if (isMounted) {
          setKit(null);
        }
      } finally {
        if (isMounted) {
          setKitLoading(false);
        }
      }
    }

    void loadKit();
    return () => {
      isMounted = false;
    };
  }, [apiBase, selectedId]);

  // Filter list by active tab
  const displayedItems = useMemo(() => {
    if (!data) return [];
    if (activeTab === 'focus') return data.todays_focus;
    if (activeTab === 'needs_attention') return data.needs_attention;
    return data.items;
  }, [data, activeTab]);

  // Actions
  const handleMarkApplied = useCallback(async () => {
    if (!selectedId) return;
    try {
      const res = await fetch(`${apiBase}/api/manual/${selectedId}/applied`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        setActionFeedback('Application marked as applied!');
        setTimeout(() => setActionFeedback(null), 3000);
        void loadQueue();
      }
    } catch {
      // Ignored
    }
  }, [apiBase, selectedId, loadQueue]);

  const handleSkip = useCallback(async () => {
    if (!selectedId) return;
    const reason = window.prompt('Reason for skipping this job:', 'NOT_INTERESTED') || 'SKIPPED';
    try {
      const res = await fetch(`${apiBase}/api/manual/${selectedId}/skip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (res.ok) {
        setActionFeedback('Application skipped.');
        setTimeout(() => setActionFeedback(null), 3000);
        void loadQueue();
      }
    } catch {
      // Ignored
    }
  }, [apiBase, selectedId, loadQueue]);

  const handleSnooze = useCallback(
    async (days = 3) => {
      if (!selectedId) return;
      try {
        const res = await fetch(`${apiBase}/api/manual/${selectedId}/snooze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ days }),
        });
        if (res.ok) {
          setActionFeedback(`Application snoozed for ${days} days.`);
          setTimeout(() => setActionFeedback(null), 3000);
          void loadQueue();
        }
      } catch {
        // Ignored
      }
    },
    [apiBase, selectedId, loadQueue],
  );

  const handleCopyText = useCallback((text: string, label: string) => {
    void navigator.clipboard.writeText(text);
    setCopyFeedback(`Copied ${label}!`);
    setTimeout(() => setCopyFeedback(null), 2500);
  }, []);

  const handleOpenLink = useCallback(() => {
    if (kit?.apply_url) {
      window.open(kit.apply_url, '_blank', 'noopener,noreferrer');
    }
  }, [kit?.apply_url]);

  const handleSaveLetter = useCallback(async () => {
    if (!selectedId) return;
    setSavingLetter(true);
    setLetterErrors([]);
    try {
      const res = await fetch(`${apiBase}/api/applications/${selectedId}/letter`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cover_letter: editedLetter }),
      });
      const body = (await res.json()) as { validation_passed: boolean; errors?: string[] };
      if (body.validation_passed) {
        setActionFeedback('Cover letter saved and validated successfully!');
        setLetterErrors([]);
      } else {
        setLetterErrors(body.errors || ['Validation failed']);
      }
    } catch (err) {
      setLetterErrors([err instanceof Error ? err.message : 'Error saving letter']);
    } finally {
      setSavingLetter(false);
    }
  }, [apiBase, selectedId, editedLetter]);

  // Keyboard navigation shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        return;
      }

      const currentIndex = displayedItems.findIndex((i) => i.application_id === selectedId);

      if (e.key === 'j') {
        e.preventDefault();
        if (currentIndex < displayedItems.length - 1) {
          const next = displayedItems[currentIndex + 1];
          if (next) setSelectedId(next.application_id);
        }
      } else if (e.key === 'k') {
        e.preventDefault();
        if (currentIndex > 0) {
          const prev = displayedItems[currentIndex - 1];
          if (prev) setSelectedId(prev.application_id);
        }
      } else if (e.key === 'o') {
        e.preventDefault();
        handleOpenLink();
      } else if (e.key === 'c') {
        e.preventDefault();
        if (kit?.cover_letter) {
          handleCopyText(kit.cover_letter, 'Cover Letter');
        }
      } else if (e.key === 'a') {
        e.preventDefault();
        void handleMarkApplied();
      } else if (e.key === 's') {
        e.preventDefault();
        void handleSkip();
      } else if (e.key === 'z') {
        e.preventDefault();
        void handleSnooze(3);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    displayedItems,
    selectedId,
    kit,
    handleOpenLink,
    handleCopyText,
    handleMarkApplied,
    handleSkip,
    handleSnooze,
  ]);

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Top Banner & Stats */}
      <div className="flex flex-wrap items-center justify-between border-b border-border pb-4 gap-4">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight text-fg">Manual Apply Queue</h2>
          <p className="text-[13px] text-fg-muted mt-0.5">
            Keyboard shortcuts:{' '}
            <kbd className="px-1 py-0.5 border border-border rounded-[4px] bg-surface-subtle text-[11px] font-mono">
              j
            </kbd>
            /
            <kbd className="px-1 py-0.5 border border-border rounded-[4px] bg-surface-subtle text-[11px] font-mono">
              k
            </kbd>{' '}
            navigate,{' '}
            <kbd className="px-1 py-0.5 border border-border rounded-[4px] bg-surface-subtle text-[11px] font-mono">
              o
            </kbd>{' '}
            open link,{' '}
            <kbd className="px-1 py-0.5 border border-border rounded-[4px] bg-surface-subtle text-[11px] font-mono">
              c
            </kbd>{' '}
            copy letter,{' '}
            <kbd className="px-1 py-0.5 border border-border rounded-[4px] bg-surface-subtle text-[11px] font-mono">
              a
            </kbd>{' '}
            mark applied,{' '}
            <kbd className="px-1 py-0.5 border border-border rounded-[4px] bg-surface-subtle text-[11px] font-mono">
              s
            </kbd>{' '}
            skip,{' '}
            <kbd className="px-1 py-0.5 border border-border rounded-[4px] bg-surface-subtle text-[11px] font-mono">
              z
            </kbd>{' '}
            snooze
          </p>
        </div>

        {/* Counts & Refresh */}
        <div className="flex items-center gap-2 text-[12px]">
          <span className="bg-surface-subtle text-fg border border-border px-2 py-0.5 rounded-[4px] font-medium font-mono tabular-nums">
            Waiting: {data?.counts.total ?? 0}
          </span>
          <span className="bg-state-warn-bg text-state-warn-fg border border-state-warn-border px-2 py-0.5 rounded-[4px] font-medium font-mono tabular-nums">
            Needs Review: {data?.counts.needs_review ?? 0}
          </span>
          <span className="bg-surface-subtle text-fg-muted border border-border px-2 py-0.5 rounded-[4px] font-medium font-mono tabular-nums">
            Snoozed: {data?.counts.snoozed ?? 0}
          </span>
          <Button variant="secondary" size="xs" icon={RefreshCw} onClick={() => void loadQueue()}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Notifications / Feedback */}
      {actionFeedback && (
        <div className="bg-state-ok-bg border border-state-ok-border text-state-ok-fg px-4 py-2 rounded-[6px] text-[13px] font-medium">
          {actionFeedback}
        </div>
      )}
      {copyFeedback && (
        <div className="bg-surface-subtle border border-border text-fg px-4 py-2 rounded-[6px] text-[13px] font-medium">
          {copyFeedback}
        </div>
      )}
      {error && (
        <div className="bg-state-danger-bg border border-state-danger-border text-state-danger-fg px-4 py-2 rounded-[6px] text-[13px] font-medium">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border">
        <button
          onClick={() => setActiveTab('focus')}
          className={`py-2 px-3 text-[13px] font-medium border-b-2 cursor-pointer transition-colors ${
            activeTab === 'focus'
              ? 'border-accent text-fg font-semibold'
              : 'border-transparent text-fg-muted hover:text-fg'
          }`}
        >
          Today's Focus ({data?.todays_focus.length ?? 0})
        </button>
        <button
          onClick={() => setActiveTab('needs_attention')}
          className={`py-2 px-3 text-[13px] font-medium border-b-2 cursor-pointer transition-colors ${
            activeTab === 'needs_attention'
              ? 'border-accent text-fg font-semibold'
              : 'border-transparent text-fg-muted hover:text-fg'
          }`}
        >
          Needs Attention ({data?.needs_attention.length ?? 0})
        </button>
        <button
          onClick={() => setActiveTab('all')}
          className={`py-2 px-3 text-[13px] font-medium border-b-2 cursor-pointer transition-colors ${
            activeTab === 'all'
              ? 'border-accent text-fg font-semibold'
              : 'border-transparent text-fg-muted hover:text-fg'
          }`}
        >
          All Active ({data?.items.length ?? 0})
        </button>
      </div>

      {/* Main Split: Queue List on Left, Kit Panel on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-[600px]">
        {/* Left: Queue List */}
        <div className="lg:col-span-5 flex flex-col space-y-2 overflow-y-auto max-h-[800px] pr-2">
          {loading ? (
            <div className="text-fg-muted text-center py-12 text-[14px]">
              Loading manual queue...
            </div>
          ) : displayedItems.length === 0 ? (
            <div className="text-fg-muted text-center py-12 border border-dashed border-border rounded-[6px] text-[14px]">
              No applications waiting in this view!
            </div>
          ) : (
            displayedItems.map((item) => {
              const isSelected = item.application_id === selectedId;
              return (
                <div
                  key={item.application_id}
                  onClick={() => setSelectedId(item.application_id)}
                  className={`p-4 rounded-[6px] border text-left cursor-pointer transition-colors ${
                    isSelected
                      ? 'border-accent bg-surface-subtle shadow-xs'
                      : 'border-border hover:border-border-subtle bg-surface hover:bg-surface-subtle/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0 pr-2">
                      <h4 className="font-semibold text-fg text-[14px] truncate">{item.title}</h4>
                      <p className="text-[13px] text-fg-muted truncate">{item.company}</p>
                    </div>
                    {item.match_score !== null && (
                      <span className="text-[12px] font-mono font-semibold tabular-nums px-2 py-0.5 rounded-[4px] bg-surface-subtle border border-border text-fg">
                        {item.match_score}
                      </span>
                    )}
                  </div>

                  {/* Badges / Warnings */}
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[12px]">
                    <span className="bg-surface-subtle text-fg-muted border border-border px-1.5 py-0.5 rounded-[4px]">
                      {item.source}
                    </span>
                    {item.location && (
                      <span className="bg-surface-subtle text-fg-muted border border-border px-1.5 py-0.5 rounded-[4px]">
                        {item.location}
                      </span>
                    )}
                    {item.may_be_closed && (
                      <StatusChip variant="danger" label="May be closed (>14d)" size="sm" />
                    )}
                    {item.applied_before_warning && (
                      <StatusChip variant="warn" label="Applied before" size="sm" />
                    )}
                    {item.untrusted && (
                      <StatusChip variant="danger" label="Untrusted source" size="sm" />
                    )}
                    {item.needs_attention && (
                      <StatusChip variant="warn" label="Needs attention" size="sm" />
                    )}
                  </div>

                  {item.route_reason_explained && (
                    <p className="mt-1.5 text-[12px] text-fg-muted truncate">
                      {item.route_reason_explained}
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Right: Kit Side Panel */}
        <div className="lg:col-span-7 bg-surface border border-border rounded-[6px] p-6 flex flex-col space-y-6 overflow-y-auto max-h-[800px]">
          {kitLoading ? (
            <div className="text-fg-muted text-center py-24 text-[14px] flex items-center justify-center gap-2">
              <Loader2 className="animate-spin shrink-0" size={16} aria-hidden="true" />
              <span>Loading application kit...</span>
            </div>
          ) : !kit ? (
            <div className="text-fg-muted text-center py-24 text-[14px]">
              Select an application from the queue to view its kit.
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="border-b border-border pb-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-[18px] font-semibold text-fg">{kit.title}</h3>
                    <p className="text-[14px] text-fg-muted font-medium">{kit.company}</p>
                    <p className="text-[12px] text-fg-muted mt-1">
                      Source: {kit.source} • Location: {kit.location || 'Not specified'} • Salary:{' '}
                      {kit.salary || 'Not specified'}
                    </p>
                  </div>
                  {kit.match_score !== null && (
                    <div className="text-center bg-surface-subtle border border-border px-3 py-1.5 rounded-[6px]">
                      <span className="block text-[24px] font-mono font-semibold tabular-nums text-accent leading-none">
                        {kit.match_score}
                      </span>
                      <span className="text-[11px] text-fg-muted font-medium uppercase tracking-wider">
                        Fit Score
                      </span>
                    </div>
                  )}
                </div>

                {/* Banners */}
                {kit.untrusted && (
                  <div className="mt-3 bg-state-warn-bg border border-state-warn-border text-state-warn-fg p-2.5 rounded-[6px] text-[13px] flex items-center gap-2">
                    <AlertTriangle
                      size={16}
                      strokeWidth={1.5}
                      className="shrink-0"
                      aria-hidden="true"
                    />
                    <span>
                      Untrusted Source: This job posting arrived while the source adapter circuit
                      was half-open. Verify details carefully.
                    </span>
                  </div>
                )}
                {kit.route_reason_explained && (
                  <div className="mt-2 bg-surface-subtle border border-border text-fg p-2.5 rounded-[6px] text-[13px] flex items-center gap-2">
                    <Info
                      size={16}
                      strokeWidth={1.5}
                      className="text-fg-muted shrink-0"
                      aria-hidden="true"
                    />
                    <span>Route Info: {kit.route_reason_explained}</span>
                  </div>
                )}

                {/* Apply Link & Action Buttons */}
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {kit.apply_url ? (
                    <a
                      href={kit.apply_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-accent hover:bg-accent-hover text-accent-fg rounded-[6px] font-medium text-[13px] transition-colors"
                    >
                      <span>Open Application ({kit.apply_domain || 'Portal'})</span>
                      <ExternalLink size={14} strokeWidth={1.5} aria-hidden="true" />
                    </a>
                  ) : (
                    <span className="text-[12px] text-state-danger-fg font-medium">
                      No valid HTTP/HTTPS apply link available
                    </span>
                  )}

                  <Button variant="primary" size="sm" onClick={() => void handleMarkApplied()}>
                    Mark Applied [a]
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => void handleSkip()}>
                    Skip [s]
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => void handleSnooze(3)}>
                    Snooze (3d) [z]
                  </Button>
                </div>
              </div>

              {/* Skills & Flags */}
              <div className="space-y-2">
                <h5 className="text-[12px] font-medium uppercase tracking-wider text-fg-muted">
                  Skills & Fit Analysis
                </h5>
                <div className="flex flex-wrap gap-1.5">
                  {kit.matched_skills.map((s) => (
                    <span
                      key={s}
                      className="bg-state-ok-bg text-state-ok-fg border border-state-ok-border text-[12px] px-2 py-0.5 rounded-[4px] inline-flex items-center gap-1"
                    >
                      <Check size={12} strokeWidth={1.5} aria-hidden="true" />
                      <span>{s}</span>
                    </span>
                  ))}
                  {kit.missing_skills.map((s) => (
                    <span
                      key={s}
                      className="bg-surface-subtle text-fg-muted border border-border text-[12px] px-2 py-0.5 rounded-[4px]"
                    >
                      - {s}
                    </span>
                  ))}
                  {kit.red_flags.map((rf) => (
                    <span
                      key={rf}
                      className="bg-state-danger-bg text-state-danger-fg border border-state-danger-border text-[12px] px-2 py-0.5 rounded-[4px] font-medium inline-flex items-center gap-1"
                    >
                      <Flag size={12} strokeWidth={1.5} aria-hidden="true" />
                      <span>{rf}</span>
                    </span>
                  ))}
                </div>
              </div>

              {/* Cover Letter Section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h5 className="text-[12px] font-medium uppercase tracking-wider text-fg-muted">
                    Cover Letter
                  </h5>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="xs"
                      icon={Copy}
                      onClick={() => handleCopyText(editedLetter, 'Cover Letter')}
                    >
                      Copy Letter [c]
                    </Button>
                    <Button
                      variant="primary"
                      size="xs"
                      loading={savingLetter}
                      onClick={() => void handleSaveLetter()}
                    >
                      Save & Validate
                    </Button>
                  </div>
                </div>

                {letterErrors.length > 0 && (
                  <div className="bg-state-danger-bg border border-state-danger-border text-state-danger-fg p-2.5 rounded-[6px] text-[12px] space-y-1">
                    <p className="font-semibold">Guardrail errors:</p>
                    {letterErrors.map((err, idx) => (
                      <p key={idx}>• {err}</p>
                    ))}
                  </div>
                )}

                <textarea
                  value={editedLetter}
                  onChange={(e) => setEditedLetter(e.target.value)}
                  rows={8}
                  className="w-full text-[13px] font-mono p-3 border border-border rounded-[6px] bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent leading-relaxed"
                  placeholder="Cover letter text..."
                />
              </div>

              {/* Resume Download */}
              {kit.resume && (
                <div className="p-3 bg-surface-subtle border border-border rounded-[6px] flex items-center justify-between text-[13px]">
                  <div>
                    <span className="font-semibold text-fg">Recommended Resume:</span>{' '}
                    <span className="text-fg-muted">{kit.resume.label}</span>
                  </div>
                  <a
                    href={kit.resume.download_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline font-medium inline-flex items-center gap-1"
                  >
                    <span>Download PDF</span>
                    <ExternalLink size={12} strokeWidth={1.5} aria-hidden="true" />
                  </a>
                </div>
              )}

              {/* Quick Copy Profile Answers */}
              <div className="space-y-2">
                <h5 className="text-[12px] font-medium uppercase tracking-wider text-fg-muted">
                  Quick-Copy Candidate Answers
                </h5>
                <div className="flex flex-wrap gap-2">
                  {kit.answers.notice_period ? (
                    <button
                      onClick={() => {
                        if (kit.answers.notice_period) {
                          handleCopyText(kit.answers.notice_period, 'Notice Period');
                        }
                      }}
                      className="px-2.5 py-1 bg-surface-subtle hover:bg-surface border border-border rounded-[4px] text-[12px] text-fg cursor-pointer inline-flex items-center gap-1.5 transition-colors"
                    >
                      <span>Notice: {kit.answers.notice_period}</span>
                      <Copy
                        size={12}
                        strokeWidth={1.5}
                        className="text-fg-muted"
                        aria-hidden="true"
                      />
                    </button>
                  ) : null}
                  {kit.answers.current_ctc ? (
                    <button
                      onClick={() => {
                        if (kit.answers.current_ctc) {
                          handleCopyText(kit.answers.current_ctc, 'Current CTC');
                        }
                      }}
                      className="px-2.5 py-1 bg-surface-subtle hover:bg-surface border border-border rounded-[4px] text-[12px] text-fg cursor-pointer inline-flex items-center gap-1.5 transition-colors"
                    >
                      <span>Current: {kit.answers.current_ctc}</span>
                      <Copy
                        size={12}
                        strokeWidth={1.5}
                        className="text-fg-muted"
                        aria-hidden="true"
                      />
                    </button>
                  ) : null}
                  {kit.answers.expected_ctc ? (
                    <button
                      onClick={() => {
                        if (kit.answers.expected_ctc) {
                          handleCopyText(kit.answers.expected_ctc, 'Expected CTC');
                        }
                      }}
                      className="px-2.5 py-1 bg-surface-subtle hover:bg-surface border border-border rounded-[4px] text-[12px] text-fg cursor-pointer inline-flex items-center gap-1.5 transition-colors"
                    >
                      <span>Expected: {kit.answers.expected_ctc}</span>
                      <Copy
                        size={12}
                        strokeWidth={1.5}
                        className="text-fg-muted"
                        aria-hidden="true"
                      />
                    </button>
                  ) : null}
                  {kit.answers.work_authorisation ? (
                    <button
                      onClick={() => {
                        if (kit.answers.work_authorisation) {
                          handleCopyText(kit.answers.work_authorisation, 'Work Authorisation');
                        }
                      }}
                      className="px-2.5 py-1 bg-surface-subtle hover:bg-surface border border-border rounded-[4px] text-[12px] text-fg cursor-pointer inline-flex items-center gap-1.5 transition-colors"
                    >
                      <span>Work Auth: {kit.answers.work_authorisation}</span>
                      <Copy
                        size={12}
                        strokeWidth={1.5}
                        className="text-fg-muted"
                        aria-hidden="true"
                      />
                    </button>
                  ) : null}
                  {kit.answers.links &&
                    Object.entries(kit.answers.links).map(([k, url]) => (
                      <button
                        key={k}
                        onClick={() => handleCopyText(url, k)}
                        className="px-2.5 py-1 bg-surface-subtle hover:bg-surface border border-border rounded-[4px] text-[12px] text-fg cursor-pointer inline-flex items-center gap-1.5 transition-colors"
                      >
                        <span>
                          {k}: {url}
                        </span>
                        <Copy
                          size={12}
                          strokeWidth={1.5}
                          className="text-fg-muted"
                          aria-hidden="true"
                        />
                      </button>
                    ))}
                </div>
              </div>

              {/* Job Description (Strictly plain text, NEVER HTML) */}
              <div className="space-y-2">
                <h5 className="text-[12px] font-medium uppercase tracking-wider text-fg-muted">
                  Job Description (Plain Text)
                </h5>
                <div
                  data-testid="job-description-plain"
                  className="p-4 bg-surface-subtle border border-border rounded-[6px] text-[13px] whitespace-pre-wrap text-fg font-mono leading-relaxed"
                >
                  {kit.description}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
