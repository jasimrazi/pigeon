import React, { useState, useEffect, useCallback, useMemo } from 'react';

export interface ReviewQueueItem {
  id: string;
  job_id: string;
  status: string;
  cover_letter: string;
  subject: string;
  resume_id: string | null;
  resume_label: string | null;
  validator_errors: string | null;
  updated_at: string;
  title: string;
  company: string;
  location: string | null;
  salary_raw: string | null;
  description: string;
  apply_url: string | null;
  contact_email: string | null;
  contact_source: string | null;
  match_score: number;
  match_reasons: string | null;
  red_flags: string[];
  untrusted: boolean | number;
  route_reason: string | null;
  is_safe_for_bulk: boolean;
}

export interface ResumeOption {
  id: string;
  label: string;
  tags: string[];
  is_default: boolean;
}

interface Props {
  apiBase?: string;
  onActionComplete?: () => void;
}

export function ReviewQueueView({ apiBase = '', onActionComplete }: Props): React.JSX.Element {
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [resumes, setResumes] = useState<ResumeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editedLetter, setEditedLetter] = useState<string>('');
  const [savingLetter, setSavingLetter] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [queueRes, resumesRes] = await Promise.all([
        fetch(`${apiBase}/api/review-queue`),
        fetch(`${apiBase}/api/resumes`).catch(() => null),
      ]);

      if (!queueRes.ok) {
        throw new Error(`Failed to load review queue (${queueRes.status})`);
      }
      const queueData = (await queueRes.json()) as { ok: boolean; items: ReviewQueueItem[] };
      setItems(queueData.items || []);

      if (resumesRes && resumesRes.ok) {
        const resData = (await resumesRes.json()) as { resumes: ResumeOption[] };
        setResumes(resData.resumes || []);
      }

      // Default select first item
      if (queueData.items && queueData.items.length > 0) {
        setSelectedId((prev) => prev || queueData.items[0]?.id || null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Selected item reference
  const selectedItem = useMemo(
    () => items.find((it) => it.id === selectedId) || null,
    [items, selectedId],
  );

  // Sync edited letter when selection changes
  useEffect(() => {
    if (selectedItem) {
      setEditedLetter(selectedItem.cover_letter || '');
    }
  }, [selectedItem]);

  // Parse validator errors for selected item
  const validatorErrors: string[] = useMemo(() => {
    if (!selectedItem?.validator_errors) return [];
    try {
      return JSON.parse(selectedItem.validator_errors);
    } catch {
      return [selectedItem.validator_errors];
    }
  }, [selectedItem]);

  // Safe items for bulk approve
  const safeItems = useMemo(() => items.filter((it) => it.is_safe_for_bulk), [items]);

  // Handle Cover Letter Save
  const handleSaveLetter = async () => {
    if (!selectedItem) return;
    try {
      setSavingLetter(true);
      const res = await fetch(`${apiBase}/api/applications/${selectedItem.id}/letter`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cover_letter: editedLetter }),
      });
      if (!res.ok) {
        throw new Error(`Failed to save cover letter (${res.status})`);
      }
      const data = (await res.json()) as { ok: boolean; validator_errors: string[] };

      // Update local state
      setItems((prev) =>
        prev.map((it) =>
          it.id === selectedItem.id
            ? {
                ...it,
                cover_letter: editedLetter,
                validator_errors:
                  data.validator_errors.length > 0 ? JSON.stringify(data.validator_errors) : null,
              }
            : it,
        ),
      );
      setActionFeedback(
        data.validator_errors.length > 0
          ? 'Letter saved with guardrail warnings'
          : 'Letter saved & all guardrails passed!',
      );
      setTimeout(() => setActionFeedback(null), 4000);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingLetter(false);
    }
  };

  // Handle Resume Change
  const handleChangeResume = async (resumeId: string) => {
    if (!selectedItem) return;
    try {
      const res = await fetch(`${apiBase}/api/applications/${selectedItem.id}/resume`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resume_id: resumeId }),
      });
      if (!res.ok) {
        throw new Error(`Failed to update resume (${res.status})`);
      }
      const selectedResume = resumes.find((r) => r.id === resumeId);
      setItems((prev) =>
        prev.map((it) =>
          it.id === selectedItem.id
            ? { ...it, resume_id: resumeId, resume_label: selectedResume?.label ?? it.resume_label }
            : it,
        ),
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  // Handle Single Approve
  const handleApprove = async () => {
    if (!selectedItem) return;
    try {
      const res = await fetch(`${apiBase}/api/applications/${selectedItem.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm_risk: true }),
      });
      if (!res.ok) {
        throw new Error(`Failed to approve application (${res.status})`);
      }
      setActionFeedback(`Approved application for ${selectedItem.company}!`);
      setTimeout(() => setActionFeedback(null), 3000);

      // Remove from list and select next
      const remaining = items.filter((it) => it.id !== selectedItem.id);
      setItems(remaining);
      setSelectedId(remaining[0]?.id ?? null);
      onActionComplete?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  // Handle Single Reject
  const handleReject = async () => {
    if (!selectedItem) return;
    try {
      const res = await fetch(`${apiBase}/api/applications/${selectedItem.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        throw new Error(`Failed to reject application (${res.status})`);
      }
      setActionFeedback(`Rejected draft for ${selectedItem.company}`);
      setTimeout(() => setActionFeedback(null), 3000);

      // Remove from list and select next
      const remaining = items.filter((it) => it.id !== selectedItem.id);
      setItems(remaining);
      setSelectedId(remaining[0]?.id ?? null);
      onActionComplete?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  // Handle Bulk Approve Safe Items
  const handleBulkApprove = async () => {
    if (safeItems.length === 0) return;
    const ids = safeItems.map((it) => it.id);
    try {
      const res = await fetch(`${apiBase}/api/applications/bulk-approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ application_ids: ids }),
      });
      if (!res.ok) {
        throw new Error(`Bulk approve failed (${res.status})`);
      }
      setActionFeedback(`Successfully bulk-approved ${ids.length} safe applications!`);
      setTimeout(() => setActionFeedback(null), 4000);

      // Refresh data
      await loadData();
      onActionComplete?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCopyLetter = () => {
    if (!editedLetter) return;
    navigator.clipboard.writeText(editedLetter);
    setCopyFeedback('Copied to clipboard!');
    setTimeout(() => setCopyFeedback(null), 2000);
  };

  if (loading && items.length === 0) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500 text-sm">
        <span className="animate-spin mr-2">🔄</span> Loading review queue...
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm">
        <strong>Error:</strong> {error}
        <button
          onClick={() => void loadData()}
          className="ml-4 underline font-medium hover:text-rose-900 cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header & Bulk Approve Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
        <div>
          <h2 className="text-base font-bold text-gray-900 flex items-center space-x-2">
            <span>📫</span>
            <span>Email Review Queue</span>
            <span className="text-xs bg-indigo-50 text-indigo-700 font-semibold px-2 py-0.5 rounded-full border border-indigo-100">
              {items.length} pending
            </span>
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Review and personalize auto-generated email applications before approving for dispatch.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => void handleBulkApprove()}
            disabled={safeItems.length === 0}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold shadow-sm transition-colors cursor-pointer flex items-center space-x-1.5 ${
              safeItems.length > 0
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            <span>⚡ Bulk Approve Safe ({safeItems.length})</span>
          </button>
        </div>
      </div>

      {actionFeedback && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-medium animate-in fade-in">
          {actionFeedback}
        </div>
      )}

      {items.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center shadow-sm">
          <span className="text-4xl">🎉</span>
          <h3 className="mt-2 text-sm font-bold text-gray-900">Queue is Clear!</h3>
          <p className="mt-1 text-xs text-gray-500 max-w-sm mx-auto">
            There are no email applications currently awaiting your review. New items will arrive
            from ingestion.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Item List */}
          <div className="lg:col-span-4 space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 px-1">
              Applications ({items.length})
            </h3>
            <div className="space-y-2 max-h-[700px] overflow-y-auto pr-1">
              {items.map((it) => {
                const isSelected = it.id === selectedId;
                const isUntrusted = Boolean(it.untrusted);
                return (
                  <button
                    key={it.id}
                    onClick={() => setSelectedId(it.id)}
                    className={`w-full text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-50/70 border-indigo-400 shadow-sm ring-1 ring-indigo-400'
                        : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="font-semibold text-sm text-gray-900 truncate">
                        {it.company}
                      </div>
                      <span
                        className={`text-xs px-2 py-0.5 rounded font-bold ${
                          it.match_score >= 85
                            ? 'bg-emerald-100 text-emerald-800'
                            : it.match_score >= 70
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {it.match_score}%
                      </span>
                    </div>
                    <div className="text-xs text-gray-600 truncate mt-0.5">{it.title}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                      {it.is_safe_for_bulk && (
                        <span className="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-200">
                          Safe for bulk
                        </span>
                      )}
                      {isUntrusted && (
                        <span className="bg-rose-50 text-rose-700 px-1.5 py-0.5 rounded border border-rose-200">
                          Untrusted
                        </span>
                      )}
                      {it.red_flags.length > 0 && (
                        <span className="bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded border border-amber-200">
                          Red flags ({it.red_flags.length})
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Column: Detail & Letter Editor */}
          {selectedItem && (
            <div className="lg:col-span-8 bg-white rounded-xl border border-gray-200 p-6 shadow-sm space-y-6">
              {/* Warnings */}
              {Boolean(selectedItem.untrusted) && (
                <div className="p-3 bg-amber-50 border border-amber-300 text-amber-900 rounded-lg text-xs font-semibold flex items-center space-x-2">
                  <span>⚠️</span>
                  <span>
                    Warning: Job was ingested while portal source had empty parse streaks or circuit
                    issues. Verify details carefully.
                  </span>
                </div>
              )}

              {/* Title & Metadata */}
              <div className="flex items-start justify-between border-b pb-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">{selectedItem.title}</h3>
                  <div className="text-sm font-medium text-gray-600 mt-0.5">
                    {selectedItem.company}{' '}
                    {selectedItem.location ? `• ${selectedItem.location}` : ''}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Contact:{' '}
                    <span className="font-mono">{selectedItem.contact_email || 'None'}</span>{' '}
                    (source: {selectedItem.contact_source || 'unknown'})
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-xs uppercase text-gray-400 font-bold">Match Score</div>
                  <div className="text-2xl font-black text-indigo-600">
                    {selectedItem.match_score}%
                  </div>
                </div>
              </div>

              {/* Resume Selector */}
              <div>
                <label className="block text-xs font-bold uppercase text-gray-600 mb-1">
                  Attached Resume
                </label>
                <select
                  value={selectedItem.resume_id || ''}
                  onChange={(e) => void handleChangeResume(e.target.value)}
                  className="w-full text-xs font-medium p-2.5 rounded-lg border border-gray-300 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">No Resume Attached</option>
                  {resumes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label} {r.is_default ? '(Default)' : ''} — [{r.tags.join(', ')}]
                    </option>
                  ))}
                </select>
              </div>

              {/* Guardrail Validator Errors Banner */}
              {validatorErrors.length > 0 && (
                <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 space-y-1">
                  <div className="font-bold flex items-center space-x-1.5">
                    <span>🛑</span>
                    <span>Guardrail Validation Failed ({validatorErrors.length} errors)</span>
                  </div>
                  <ul className="list-disc pl-5 space-y-0.5 text-rose-700">
                    {validatorErrors.map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Cover Letter Editor */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase text-gray-600">
                    Cover Letter (150-250 words, strict guardrails)
                  </label>
                  <div className="flex items-center space-x-2">
                    {copyFeedback && (
                      <span className="text-xs text-emerald-600 font-medium">{copyFeedback}</span>
                    )}
                    <button
                      type="button"
                      onClick={handleCopyLetter}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium cursor-pointer"
                    >
                      Copy Letter
                    </button>
                  </div>
                </div>

                <div className="text-xs font-mono bg-gray-50 p-2.5 rounded-lg border border-gray-200 text-gray-700">
                  <span className="text-gray-400 font-sans">Subject:</span> {selectedItem.subject}
                </div>

                <textarea
                  rows={10}
                  value={editedLetter}
                  onChange={(e) => setEditedLetter(e.target.value)}
                  className="w-full p-3 text-xs leading-relaxed font-sans rounded-lg border border-gray-300 shadow-inner focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Cover letter body..."
                />

                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-400">
                    Word count: {editedLetter.trim().split(/\s+/).filter(Boolean).length} words
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleSaveLetter()}
                    disabled={savingLetter}
                    className="px-3 py-1.5 bg-gray-800 hover:bg-gray-900 text-white text-xs font-semibold rounded-lg shadow-sm cursor-pointer disabled:opacity-50"
                  >
                    {savingLetter ? 'Validating & Saving...' : 'Save & Validate Letter'}
                  </button>
                </div>
              </div>

              {/* Action Buttons: Approve / Reject */}
              <div className="pt-4 border-t flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => void handleReject()}
                  className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold text-xs rounded-lg border border-rose-200 shadow-sm cursor-pointer transition-colors"
                >
                  Reject Application
                </button>
                <button
                  type="button"
                  onClick={() => void handleApprove()}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-lg shadow-sm cursor-pointer transition-colors"
                >
                  Approve Application
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
