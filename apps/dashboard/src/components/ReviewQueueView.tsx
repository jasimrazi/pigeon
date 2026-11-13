import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCheck,
  Copy,
  Inbox,
  Loader2,
  Mail,
} from 'lucide-react';
import { Button } from './ui/Button.js';
import { StatusChip } from './ui/StatusChip.js';
import { apiFetch } from '../api.js';

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
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [editedLetter, setEditedLetter] = useState<string>('');
  const [savingLetter, setSavingLetter] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [queueRes, resumesRes] = await Promise.all([
        apiFetch(`${apiBase}/api/review-queue`),
        apiFetch(`${apiBase}/api/resumes`).catch(() => null),
      ]);

      if (!queueRes.ok) {
        throw new Error(`Failed to load review queue (${queueRes.status})`);
      }
      const queueData = (await queueRes.json()) as { ok: boolean; items: ReviewQueueItem[] };
      setItems(queueData.items || []);

      if (resumesRes && resumesRes.ok) {
        const resData = (await resumesRes.json()) as {
          resumes: (ResumeOption & { archived?: boolean })[];
        };
        setResumes((resData.resumes || []).filter((r) => !r.archived));
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
      const res = await apiFetch(`${apiBase}/api/applications/${selectedItem.id}/letter`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ letter: editedLetter }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        errors?: string[];
        is_safe_for_bulk?: boolean;
      };
      if (!res.ok || !data.ok) {
        throw new Error((data.errors || []).join(', ') || 'Validation failed');
      }

      // Update local state with new validation outcome
      setItems((prev) =>
        prev.map((it) =>
          it.id === selectedItem.id
            ? {
                ...it,
                cover_letter: editedLetter,
                validator_errors:
                  data.errors && data.errors.length > 0 ? JSON.stringify(data.errors) : null,
                is_safe_for_bulk: Boolean(data.is_safe_for_bulk),
              }
            : it,
        ),
      );
      setActionFeedback('Letter updated and validated successfully.');
      setTimeout(() => setActionFeedback(null), 3500);
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
      const res = await apiFetch(`${apiBase}/api/applications/${selectedItem.id}/resume`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resume_id: resumeId || null }),
      });
      if (!res.ok) {
        throw new Error('Failed to update resume attachment');
      }
      setItems((prev) =>
        prev.map((it) =>
          it.id === selectedItem.id
            ? {
                ...it,
                resume_id: resumeId || null,
                resume_label: resumes.find((r) => r.id === resumeId)?.label || null,
              }
            : it,
        ),
      );
      setActionFeedback('Attached resume updated.');
      setTimeout(() => setActionFeedback(null), 3000);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  // Handle Approve Single Item
  const handleApprove = async () => {
    if (!selectedItem) return;
    try {
      const res = await apiFetch(`${apiBase}/api/applications/${selectedItem.id}/approve`, {
        method: 'POST',
      });
      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errJson.error || `Approval failed (${res.status})`);
      }
      setItems((prev) => prev.filter((it) => it.id !== selectedItem.id));
      setSelectedId(null);
      setMobileDetailOpen(false);
      setActionFeedback(`Approved application for ${selectedItem.company}.`);
      setTimeout(() => setActionFeedback(null), 3500);
      onActionComplete?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  // Handle Reject Single Item
  const handleReject = async () => {
    if (!selectedItem) return;
    if (!confirm(`Reject and dismiss application for ${selectedItem.company}?`)) return;
    try {
      const res = await apiFetch(`${apiBase}/api/applications/${selectedItem.id}/reject`, {
        method: 'POST',
      });
      if (!res.ok) {
        throw new Error('Failed to reject application');
      }
      setItems((prev) => prev.filter((it) => it.id !== selectedItem.id));
      setSelectedId(null);
      setMobileDetailOpen(false);
      setActionFeedback(`Rejected application for ${selectedItem.company}.`);
      setTimeout(() => setActionFeedback(null), 3500);
      onActionComplete?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  // Handle Bulk Approve
  const handleBulkApprove = async () => {
    if (safeItems.length === 0) return;
    const count = safeItems.length;
    if (
      !confirm(
        `Approve all ${count} safe applications ready for dispatch? Unsafe items will remain for review.`,
      )
    ) {
      return;
    }

    try {
      const safeIds = safeItems.map((it) => it.id);
      const res = await apiFetch(`${apiBase}/api/applications/bulk-approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: safeIds }),
      });
      if (!res.ok) {
        throw new Error(`Bulk approval failed (${res.status})`);
      }
      const data = (await res.json()) as { ok: boolean; approved_count: number };
      setItems((prev) => prev.filter((it) => !safeIds.includes(it.id)));
      setSelectedId(null);
      setActionFeedback(`Successfully bulk-approved ${data.approved_count} applications.`);
      setTimeout(() => setActionFeedback(null), 4000);
      onActionComplete?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  // Click-to-copy cover letter
  const handleCopyLetter = async () => {
    if (!editedLetter) return;
    try {
      await navigator.clipboard.writeText(editedLetter);
      setCopyFeedback('Copied!');
      setTimeout(() => setCopyFeedback(null), 2000);
    } catch {
      setCopyFeedback('Failed to copy');
      setTimeout(() => setCopyFeedback(null), 2000);
    }
  };

  if (loading && items.length === 0) {
    return (
      <div className="flex items-center justify-center py-20 text-fg-muted text-[14px] gap-2">
        <Loader2 className="animate-spin shrink-0" size={16} aria-hidden="true" />
        <span>Loading review queue...</span>
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <div className="p-4 bg-state-danger-bg border border-state-danger-border rounded-[6px] text-state-danger-fg text-[14px]">
        <strong>Error:</strong> {error}
        <button
          onClick={() => void loadData()}
          className="ml-4 underline font-medium hover:opacity-80 cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header & Bulk Approve Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 bg-surface p-4 sm:p-5 rounded-[6px] border border-border">
        <div>
          <div className="flex items-center gap-2">
            <Mail
              size={16}
              strokeWidth={1.5}
              className="text-fg-muted shrink-0"
              aria-hidden="true"
            />
            <h2 className="text-[16px] font-semibold text-fg">Email Review Queue</h2>
            <span className="text-[12px] bg-surface-subtle text-fg-muted font-medium px-2 py-0.5 rounded-[4px] border border-border">
              {items.length} pending
            </span>
          </div>
          <p className="text-[13px] text-fg-muted mt-1">
            Review and personalize auto-generated email applications before approving for dispatch.
          </p>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <Button
            variant="primary"
            size="md"
            icon={CheckCheck}
            onClick={() => void handleBulkApprove()}
            disabled={safeItems.length === 0}
            className="w-full sm:w-auto"
          >
            Bulk Approve Safe ({safeItems.length})
          </Button>
        </div>
      </div>

      {actionFeedback && (
        <div className="p-3 bg-state-ok-bg border border-state-ok-border text-state-ok-fg rounded-[6px] text-[13px] font-medium">
          {actionFeedback}
        </div>
      )}

      {items.length === 0 ? (
        <div className="bg-surface rounded-[6px] border border-border p-12 text-center">
          <div className="w-10 h-10 rounded-full bg-surface-subtle text-fg-muted border border-border flex items-center justify-center mx-auto mb-3">
            <Inbox size={20} strokeWidth={1.5} aria-hidden="true" />
          </div>
          <h3 className="text-[14px] font-semibold text-fg">Queue is Clear!</h3>
          <p className="mt-1 text-[13px] text-fg-muted max-w-sm mx-auto">
            There are no email applications currently awaiting your review. New items will arrive
            from ingestion.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Item List */}
          <div className={`lg:col-span-4 space-y-2 ${mobileDetailOpen ? 'hidden lg:block' : 'block'}`}>
            <h3 className="text-[12px] font-medium uppercase tracking-wider text-fg-muted px-1">
              Applications ({items.length})
            </h3>
            <div className="space-y-2 max-h-[700px] overflow-y-auto pr-1">
              {items.map((it) => {
                const isSelected = it.id === selectedId;
                const isUntrusted = Boolean(it.untrusted);
                return (
                  <button
                    key={it.id}
                    onClick={() => {
                      setSelectedId(it.id);
                      setMobileDetailOpen(true);
                    }}
                    className={`w-full text-left p-3.5 rounded-[6px] border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-surface-subtle border-accent ring-1 ring-accent'
                        : 'bg-surface border-border hover:border-border-subtle hover:bg-surface-subtle/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-[14px] text-fg truncate">{it.company}</div>
                      <span className="text-[12px] font-mono font-semibold tabular-nums px-1.5 py-0.5 rounded-[4px] border border-border bg-surface-subtle text-fg">
                        {it.match_score}%
                      </span>
                    </div>
                    <div className="text-[13px] text-fg-muted truncate mt-0.5">{it.title}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {it.is_safe_for_bulk && (
                        <StatusChip variant="ok" label="Safe for bulk" size="sm" />
                      )}
                      {isUntrusted && <StatusChip variant="danger" label="Untrusted" size="sm" />}
                      {it.red_flags.length > 0 && (
                        <StatusChip
                          variant="warn"
                          label={`Red flags (${it.red_flags.length})`}
                          size="sm"
                        />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Column: Detail & Letter Editor */}
          {selectedItem && (
            <div className={`lg:col-span-8 bg-surface rounded-[6px] border border-border p-4 sm:p-6 space-y-5 sm:space-y-6 ${mobileDetailOpen ? 'block' : 'hidden lg:block'}`}>
              {/* Mobile Back Button */}
              <button
                type="button"
                onClick={() => setMobileDetailOpen(false)}
                className="lg:hidden inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline cursor-pointer self-start mb-1"
              >
                <ArrowLeft size={14} strokeWidth={1.5} aria-hidden="true" />
                <span>Back to review list</span>
              </button>

              {/* Warnings */}
              {Boolean(selectedItem.untrusted) && (
                <div className="p-3 bg-state-warn-bg border border-state-warn-border text-state-warn-fg rounded-[6px] text-[13px] font-medium flex items-center gap-2">
                  <AlertTriangle
                    size={16}
                    strokeWidth={1.5}
                    className="shrink-0"
                    aria-hidden="true"
                  />
                  <span>
                    Warning: Job was ingested while portal source had empty parse streaks or circuit
                    issues. Verify details carefully.
                  </span>
                </div>
              )}

              {/* Title & Metadata */}
              <div className="flex items-start justify-between border-b border-border pb-4">
                <div>
                  <h3 className="text-[16px] font-semibold text-fg">{selectedItem.title}</h3>
                  <div className="text-[13px] font-medium text-fg-muted mt-0.5">
                    {selectedItem.company}{' '}
                    {selectedItem.location ? `• ${selectedItem.location}` : ''}
                  </div>
                  <div className="text-[12px] text-fg-muted mt-1">
                    Contact:{' '}
                    <span className="font-mono text-fg">
                      {selectedItem.contact_email || 'None'}
                    </span>{' '}
                    (source: {selectedItem.contact_source || 'unknown'})
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-[12px] uppercase text-fg-muted font-medium tracking-wider">
                    Match Score
                  </div>
                  <div className="text-[24px] font-mono font-semibold tabular-nums text-accent">
                    {selectedItem.match_score}%
                  </div>
                </div>
              </div>

              {/* Resume Selector */}
              <div>
                <label
                  htmlFor="attached-resume-select"
                  className="block text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-1.5"
                >
                  Attached Resume
                </label>
                <select
                  id="attached-resume-select"
                  aria-label="Attached Resume"
                  value={selectedItem.resume_id || ''}
                  onChange={(e) => void handleChangeResume(e.target.value)}
                  className="w-full text-[13px] font-medium p-2 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
                <div className="p-3.5 bg-state-danger-bg border border-state-danger-border rounded-[6px] text-[13px] text-state-danger-fg space-y-1">
                  <div className="font-semibold flex items-center gap-1.5">
                    <AlertCircle
                      size={16}
                      strokeWidth={1.5}
                      className="shrink-0"
                      aria-hidden="true"
                    />
                    <span>Guardrail Validation Failed ({validatorErrors.length} errors)</span>
                  </div>
                  <ul className="list-disc pl-5 space-y-0.5 text-state-danger-fg/90 text-[12px]">
                    {validatorErrors.map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Cover Letter Editor */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="cover-letter-editor"
                    className="text-[12px] font-medium uppercase tracking-wider text-fg-muted"
                  >
                    Cover Letter (150-250 words, strict guardrails)
                  </label>
                  <div className="flex items-center gap-2">
                    {copyFeedback && (
                      <span className="text-[12px] text-state-ok-fg font-medium">
                        {copyFeedback}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={handleCopyLetter}
                      className="text-[12px] text-accent hover:underline font-medium cursor-pointer inline-flex items-center gap-1"
                    >
                      <Copy size={12} strokeWidth={1.5} aria-hidden="true" />
                      <span>Copy Letter</span>
                    </button>
                  </div>
                </div>

                <div className="text-[13px] font-mono bg-surface-subtle p-2.5 rounded-[6px] border border-border text-fg">
                  <span className="text-fg-muted font-sans text-[12px]">Subject:</span>{' '}
                  {selectedItem.subject}
                </div>

                <textarea
                  id="cover-letter-editor"
                  aria-label="Cover Letter"
                  rows={10}
                  value={editedLetter}
                  onChange={(e) => setEditedLetter(e.target.value)}
                  className="w-full p-3 text-[13px] leading-relaxed font-sans rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  placeholder="Cover letter body..."
                />

                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-fg-muted font-mono tabular-nums">
                    Word count: {editedLetter.trim().split(/\s+/).filter(Boolean).length} words
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={savingLetter}
                    onClick={() => void handleSaveLetter()}
                  >
                    {savingLetter ? 'Validating & Saving...' : 'Save & Validate Letter'}
                  </Button>
                </div>
              </div>

              {/* Action Buttons: Approve / Reject */}
              <div className="pt-4 border-t border-border flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5 sm:gap-3">
                <Button variant="destructive" size="md" onClick={() => void handleReject()} className="w-full sm:w-auto">
                  Reject Application
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  icon={Check}
                  onClick={() => void handleApprove()}
                  className="w-full sm:w-auto"
                >
                  Approve Application
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
