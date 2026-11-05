import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { ManualQueueResponse, ManualKit } from '@pigeon/shared';

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
        // Refresh queue and select next
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
      // Ignore key events when typing inside inputs or textareas
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        return;
      }

      const currentIndex = displayedItems.findIndex((i) => i.application_id === selectedId);

      if (e.key === 'j') {
        // Next
        e.preventDefault();
        if (currentIndex < displayedItems.length - 1) {
          const next = displayedItems[currentIndex + 1];
          if (next) setSelectedId(next.application_id);
        }
      } else if (e.key === 'k') {
        // Previous
        e.preventDefault();
        if (currentIndex > 0) {
          const prev = displayedItems[currentIndex - 1];
          if (prev) setSelectedId(prev.application_id);
        }
      } else if (e.key === 'o') {
        // Open link
        e.preventDefault();
        handleOpenLink();
      } else if (e.key === 'c') {
        // Copy letter
        e.preventDefault();
        if (kit?.cover_letter) {
          handleCopyText(kit.cover_letter, 'Cover Letter');
        }
      } else if (e.key === 'a') {
        // Mark applied
        e.preventDefault();
        void handleMarkApplied();
      } else if (e.key === 's') {
        // Skip
        e.preventDefault();
        void handleSkip();
      } else if (e.key === 'z') {
        // Snooze
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
      <div className="flex flex-wrap items-center justify-between border-b pb-4 gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">Manual Apply Queue</h2>
          <p className="text-sm text-gray-500">
            Keyboard shortcuts:{' '}
            <kbd className="px-1 py-0.5 border rounded bg-gray-50 text-xs">j</kbd>/
            <kbd className="px-1 py-0.5 border rounded bg-gray-50 text-xs">k</kbd> navigate,{' '}
            <kbd className="px-1 py-0.5 border rounded bg-gray-50 text-xs">o</kbd> open link,{' '}
            <kbd className="px-1 py-0.5 border rounded bg-gray-50 text-xs">c</kbd> copy letter,{' '}
            <kbd className="px-1 py-0.5 border rounded bg-gray-50 text-xs">a</kbd> mark applied,{' '}
            <kbd className="px-1 py-0.5 border rounded bg-gray-50 text-xs">s</kbd> skip,{' '}
            <kbd className="px-1 py-0.5 border rounded bg-gray-50 text-xs">z</kbd> snooze
          </p>
        </div>

        {/* Counts & Refresh */}
        <div className="flex items-center space-x-2 text-sm">
          <span className="bg-blue-100 text-blue-800 px-2.5 py-0.5 rounded font-medium">
            Waiting: {data?.counts.total ?? 0}
          </span>
          <span className="bg-amber-100 text-amber-800 px-2.5 py-0.5 rounded font-medium">
            Needs Review: {data?.counts.needs_review ?? 0}
          </span>
          <span className="bg-gray-100 text-gray-700 px-2.5 py-0.5 rounded font-medium">
            Snoozed: {data?.counts.snoozed ?? 0}
          </span>
          <button
            onClick={() => void loadQueue()}
            className="px-3 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50 text-gray-700 cursor-pointer"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Notifications / Toast */}
      {actionFeedback && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-2 rounded text-sm animate-pulse">
          {actionFeedback}
        </div>
      )}
      {copyFeedback && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-2 rounded text-sm animate-pulse">
          {copyFeedback}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-2 rounded text-sm">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex space-x-2 border-b">
        <button
          onClick={() => setActiveTab('focus')}
          className={`py-2 px-4 text-sm font-medium border-b-2 cursor-pointer ${
            activeTab === 'focus'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Today's Focus ({data?.todays_focus.length ?? 0})
        </button>
        <button
          onClick={() => setActiveTab('needs_attention')}
          className={`py-2 px-4 text-sm font-medium border-b-2 cursor-pointer ${
            activeTab === 'needs_attention'
              ? 'border-amber-600 text-amber-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Needs Attention ({data?.needs_attention.length ?? 0})
        </button>
        <button
          onClick={() => setActiveTab('all')}
          className={`py-2 px-4 text-sm font-medium border-b-2 cursor-pointer ${
            activeTab === 'all'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
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
            <div className="text-gray-500 text-center py-12">Loading manual queue...</div>
          ) : displayedItems.length === 0 ? (
            <div className="text-gray-500 text-center py-12 border border-dashed rounded-lg">
              No applications waiting in this view!
            </div>
          ) : (
            displayedItems.map((item) => {
              const isSelected = item.application_id === selectedId;
              return (
                <div
                  key={item.application_id}
                  onClick={() => setSelectedId(item.application_id)}
                  className={`p-4 rounded-lg border text-left cursor-pointer transition-colors ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50/50 shadow-sm'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0 pr-2">
                      <h4 className="font-semibold text-gray-900 truncate">{item.title}</h4>
                      <p className="text-sm text-gray-600 truncate">{item.company}</p>
                    </div>
                    {item.match_score !== null && (
                      <span className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                        {item.match_score}
                      </span>
                    )}
                  </div>

                  {/* Badges / Warnings */}
                  <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                    <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                      {item.source}
                    </span>
                    {item.location && (
                      <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                        {item.location}
                      </span>
                    )}
                    {item.may_be_closed && (
                      <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded font-medium">
                        May be closed (&gt;14d)
                      </span>
                    )}
                    {item.applied_before_warning && (
                      <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-medium">
                        Applied before
                      </span>
                    )}
                    {item.untrusted && (
                      <span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded font-medium">
                        Untrusted source
                      </span>
                    )}
                    {item.needs_attention && (
                      <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-medium">
                        Needs attention
                      </span>
                    )}
                  </div>

                  {item.route_reason_explained && (
                    <p className="mt-1.5 text-xs text-gray-500 truncate">
                      {item.route_reason_explained}
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Right: Kit Side Panel */}
        <div className="lg:col-span-7 bg-white border rounded-lg p-6 flex flex-col space-y-6 overflow-y-auto max-h-[800px]">
          {kitLoading ? (
            <div className="text-gray-500 text-center py-24">Loading application kit...</div>
          ) : !kit ? (
            <div className="text-gray-400 text-center py-24">
              Select an application from the queue to view its kit.
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="border-b pb-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-xl font-bold text-gray-900">{kit.title}</h3>
                    <p className="text-base text-gray-700 font-medium">{kit.company}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      Source: {kit.source} • Location: {kit.location || 'Not specified'} • Salary:{' '}
                      {kit.salary || 'Not specified'}
                    </p>
                  </div>
                  {kit.match_score !== null && (
                    <div className="text-center bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg">
                      <span className="block text-2xl font-black text-emerald-700">
                        {kit.match_score}
                      </span>
                      <span className="text-[10px] text-emerald-800 font-semibold uppercase">
                        Fit Score
                      </span>
                    </div>
                  )}
                </div>

                {/* Banners */}
                {kit.untrusted && (
                  <div className="mt-3 bg-purple-50 border border-purple-200 text-purple-800 p-2.5 rounded text-xs">
                    ⚠️ Untrusted Source: This job posting arrived while the source adapter circuit
                    was half-open. Verify details carefully.
                  </div>
                )}
                {kit.route_reason_explained && (
                  <div className="mt-2 bg-amber-50 border border-amber-200 text-amber-900 p-2.5 rounded text-xs">
                    ℹ️ Route Info: {kit.route_reason_explained}
                  </div>
                )}

                {/* Apply Link */}
                <div className="mt-4 flex items-center space-x-3">
                  {kit.apply_url ? (
                    <a
                      href={kit.apply_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded font-medium text-sm hover:bg-blue-700"
                    >
                      Open Application ({kit.apply_domain || 'Portal'}) ↗
                    </a>
                  ) : (
                    <span className="text-xs text-red-600 font-medium">
                      No valid HTTP/HTTPS apply link available
                    </span>
                  )}

                  {/* Actions */}
                  <button
                    onClick={() => void handleMarkApplied()}
                    className="px-3 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-700 cursor-pointer"
                  >
                    Mark Applied [a]
                  </button>
                  <button
                    onClick={() => void handleSkip()}
                    className="px-3 py-2 bg-gray-100 text-gray-700 rounded text-sm font-medium hover:bg-gray-200 cursor-pointer"
                  >
                    Skip [s]
                  </button>
                  <button
                    onClick={() => void handleSnooze(3)}
                    className="px-3 py-2 bg-gray-100 text-gray-700 rounded text-sm font-medium hover:bg-gray-200 cursor-pointer"
                  >
                    Snooze (3d) [z]
                  </button>
                </div>
              </div>

              {/* Skills & Flags */}
              <div className="space-y-2">
                <h5 className="text-xs font-bold uppercase tracking-wider text-gray-500">
                  Skills & Fit Analysis
                </h5>
                <div className="flex flex-wrap gap-1.5">
                  {kit.matched_skills.map((s) => (
                    <span
                      key={s}
                      className="bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs px-2 py-0.5 rounded"
                    >
                      ✓ {s}
                    </span>
                  ))}
                  {kit.missing_skills.map((s) => (
                    <span
                      key={s}
                      className="bg-gray-50 text-gray-600 border border-gray-200 text-xs px-2 py-0.5 rounded"
                    >
                      - {s}
                    </span>
                  ))}
                  {kit.red_flags.map((rf) => (
                    <span
                      key={rf}
                      className="bg-red-50 text-red-700 border border-red-200 text-xs px-2 py-0.5 rounded font-semibold"
                    >
                      🚩 {rf}
                    </span>
                  ))}
                </div>
              </div>

              {/* Cover Letter Section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h5 className="text-xs font-bold uppercase tracking-wider text-gray-500">
                    Cover Letter
                  </h5>
                  <div className="space-x-2">
                    <button
                      onClick={() => handleCopyText(editedLetter, 'Cover Letter')}
                      className="px-2.5 py-1 bg-white border border-gray-300 rounded text-xs font-medium text-gray-700 hover:bg-gray-50 cursor-pointer"
                    >
                      Copy Letter [c]
                    </button>
                    <button
                      onClick={() => void handleSaveLetter()}
                      disabled={savingLetter}
                      className="px-2.5 py-1 bg-blue-50 border border-blue-200 rounded text-xs font-medium text-blue-700 hover:bg-blue-100 cursor-pointer"
                    >
                      {savingLetter ? 'Saving...' : 'Save & Validate'}
                    </button>
                  </div>
                </div>

                {letterErrors.length > 0 && (
                  <div className="bg-red-50 border border-red-200 text-red-800 p-2.5 rounded text-xs space-y-1">
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
                  className="w-full text-xs font-mono p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  placeholder="Cover letter text..."
                />
              </div>

              {/* Resume Download */}
              {kit.resume && (
                <div className="p-3 bg-gray-50 border rounded-lg flex items-center justify-between text-xs">
                  <div>
                    <span className="font-semibold text-gray-900">Recommended Resume:</span>{' '}
                    <span className="text-gray-700">{kit.resume.label}</span>
                  </div>
                  <a
                    href={kit.resume.download_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline font-medium"
                  >
                    Download PDF ↗
                  </a>
                </div>
              )}

              {/* Quick Copy Profile Answers */}
              <div className="space-y-2">
                <h5 className="text-xs font-bold uppercase tracking-wider text-gray-500">
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
                      className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 rounded text-xs text-gray-700 cursor-pointer"
                    >
                      Notice: {kit.answers.notice_period} 📋
                    </button>
                  ) : null}
                  {kit.answers.current_ctc ? (
                    <button
                      onClick={() => {
                        if (kit.answers.current_ctc) {
                          handleCopyText(kit.answers.current_ctc, 'Current CTC');
                        }
                      }}
                      className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 rounded text-xs text-gray-700 cursor-pointer"
                    >
                      Current: {kit.answers.current_ctc} 📋
                    </button>
                  ) : null}
                  {kit.answers.expected_ctc ? (
                    <button
                      onClick={() => {
                        if (kit.answers.expected_ctc) {
                          handleCopyText(kit.answers.expected_ctc, 'Expected CTC');
                        }
                      }}
                      className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 rounded text-xs text-gray-700 cursor-pointer"
                    >
                      Expected: {kit.answers.expected_ctc} 📋
                    </button>
                  ) : null}
                  {kit.answers.work_authorisation ? (
                    <button
                      onClick={() => {
                        if (kit.answers.work_authorisation) {
                          handleCopyText(kit.answers.work_authorisation, 'Work Authorisation');
                        }
                      }}
                      className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 rounded text-xs text-gray-700 cursor-pointer"
                    >
                      Work Auth: {kit.answers.work_authorisation} 📋
                    </button>
                  ) : null}
                  {kit.answers.links &&
                    Object.entries(kit.answers.links).map(([k, url]) => (
                      <button
                        key={k}
                        onClick={() => handleCopyText(url, k)}
                        className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 rounded text-xs text-gray-700 cursor-pointer"
                      >
                        {k}: {url} 📋
                      </button>
                    ))}
                </div>
              </div>

              {/* Job Description (Strictly plain text, NEVER HTML) */}
              <div className="space-y-2">
                <h5 className="text-xs font-bold uppercase tracking-wider text-gray-500">
                  Job Description (Plain Text)
                </h5>
                <div
                  data-testid="job-description-plain"
                  className="p-4 bg-gray-50 border rounded-lg text-xs whitespace-pre-wrap text-gray-800 font-mono leading-relaxed"
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
