import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Ban,
  Check,
  CheckCheck,
  Copy,
  ExternalLink,
  Flag,
  Inbox,
  Loader2,
  Mail,
  RefreshCw,
  Send,
  Sparkles,
} from 'lucide-react';
import { Button } from './ui/Button.js';
import { StatusChip } from './ui/StatusChip.js';
import { WorkplaceBadge, getWorkplaceType } from './ui/WorkplaceBadge.js';
import { useDialog } from './ui/DialogProvider.js';
import { useToast } from './ui/ToastProvider.js';
import { apiFetch } from '../api.js';

export interface ReviewQueueItem {
  id: string;
  job_id: string;
  kind?: string;
  status: string;
  cover_letter: string;
  subject: string;
  resume_id: string | null;
  resume_label: string | null;
  validator_errors: string | null;
  scheduled_at?: string | null;
  sent_at?: string | null;
  error?: string | null;
  follow_up_count?: number;
  updated_at: string;
  title: string;
  company: string;
  location: string | null;
  remote?: boolean | number | null;
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
  bulk_block_reasons?: string[];
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

function isSafeHttpUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
}

export function ReviewQueueView({ apiBase = '', onActionComplete }: Props): React.JSX.Element {
  const dialog = useDialog();
  const toast = useToast();
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [outboxItems, setOutboxItems] = useState<ReviewQueueItem[]>([]);
  const [resumes, setResumes] = useState<ResumeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [queueMode, setQueueMode] = useState<'pending' | 'outbox'>('pending');
  const [detailTab, setDetailTab] = useState<'draft' | 'description' | 'fit'>('draft');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [editedSubject, setEditedSubject] = useState<string>('');
  const [editedLetter, setEditedLetter] = useState<string>('');
  const [savingLetter, setSavingLetter] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [pollingInbox, setPollingInbox] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [workplaceFilter, setWorkplaceFilter] = useState<'all' | 'remote' | 'hybrid' | 'onsite'>(
    'all',
  );

  const activeSourceList = queueMode === 'pending' ? items : outboxItems;

  const displayedItems = useMemo(() => {
    if (workplaceFilter === 'all') return activeSourceList;
    return activeSourceList.filter((it) => getWorkplaceType(it) === workplaceFilter);
  }, [activeSourceList, workplaceFilter]);

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
      const queueData = (await queueRes.json()) as {
        ok?: boolean;
        items: ReviewQueueItem[];
        outbox?: ReviewQueueItem[];
      };
      const loadedItems = queueData.items || [];
      const loadedOutbox = queueData.outbox || [];
      setItems(loadedItems);
      setOutboxItems(loadedOutbox);

      if (resumesRes && resumesRes.ok) {
        const resData = (await resumesRes.json()) as {
          resumes: (ResumeOption & { archived?: boolean })[];
        };
        setResumes((resData.resumes || []).filter((r) => !r.archived));
      }

      if (loadedItems.length > 0) {
        setSelectedId((prev) => prev || loadedItems[0]?.id || null);
      } else if (loadedOutbox.length > 0) {
        setSelectedId((prev) => prev || loadedOutbox[0]?.id || null);
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

  // Keep selected item valid when switching modes
  useEffect(() => {
    const list = queueMode === 'pending' ? items : outboxItems;
    if (list.length > 0 && !list.some((it) => it.id === selectedId)) {
      setSelectedId(list[0]?.id || null);
    } else if (list.length === 0) {
      setSelectedId(null);
    }
  }, [queueMode, items, outboxItems, selectedId]);

  const selectedItem = useMemo(
    () => activeSourceList.find((it) => it.id === selectedId) || null,
    [activeSourceList, selectedId],
  );

  useEffect(() => {
    if (selectedItem) {
      setEditedSubject(selectedItem.subject || '');
      setEditedLetter(selectedItem.cover_letter || '');
    }
  }, [selectedItem]);

  const validatorErrors: string[] = useMemo(() => {
    if (!selectedItem?.validator_errors) return [];
    try {
      const parsed = JSON.parse(selectedItem.validator_errors);
      return Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
    } catch {
      return [selectedItem.validator_errors];
    }
  }, [selectedItem]);

  const safeItems = useMemo(() => items.filter((it) => it.is_safe_for_bulk), [items]);

  const showFeedback = useCallback(
    (msg: string, variant: 'ok' | 'danger' = 'ok') => {
      if (variant === 'ok') {
        toast.success(msg);
      } else {
        toast.error(msg);
      }
      setActionFeedback(msg);
      setTimeout(() => setActionFeedback(null), 3500);
    },
    [toast],
  );

  const handleSaveLetter = useCallback(async (): Promise<boolean> => {
    if (!selectedItem) return false;
    try {
      setSavingLetter(true);
      const res = await apiFetch(`${apiBase}/api/applications/${selectedItem.id}/letter`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cover_letter: editedLetter,
          subject: editedSubject.trim() || selectedItem.subject,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        validation_passed?: boolean;
        errors?: string[];
        validator_errors?: string[];
        is_safe_for_bulk?: boolean;
      };
      const errs = data.validator_errors ?? data.errors ?? [];
      if (!res.ok || !data.ok) {
        throw new Error(errs.join(', ') || 'Validation failed');
      }

      const nextErrorsJson = errs.length > 0 ? JSON.stringify(errs) : null;
      const nextSafe =
        typeof data.is_safe_for_bulk === 'boolean'
          ? data.is_safe_for_bulk
          : errs.length === 0 && selectedItem.is_safe_for_bulk;

      setItems((prev) =>
        prev.map((it) =>
          it.id === selectedItem.id
            ? {
                ...it,
                subject: editedSubject.trim() || it.subject,
                cover_letter: editedLetter,
                validator_errors: nextErrorsJson,
                is_safe_for_bulk: nextSafe,
              }
            : it,
        ),
      );

      if (errs.length > 0) {
        showFeedback(`Saved with ${errs.length} guardrail warning(s).`, 'danger');
        return false;
      }
      showFeedback('Letter updated and validated successfully.');
      return true;
    } catch (err) {
      void dialog.alert({
        title: 'Letter Validation Error',
        message: err instanceof Error ? err.message : String(err),
        variant: 'danger',
      });
      return false;
    } finally {
      setSavingLetter(false);
    }
  }, [apiBase, dialog, editedLetter, editedSubject, selectedItem, showFeedback]);

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
      showFeedback('Attached resume updated.');
    } catch (err) {
      void dialog.alert({
        title: 'Resume Update Failed',
        message: err instanceof Error ? err.message : String(err),
        variant: 'danger',
      });
    }
  };

  const handleApprove = useCallback(async () => {
    if (!selectedItem) return;
    let confirmRisk = false;
    if (selectedItem.status === 'needs_review') {
      const confirmed = await dialog.confirm({
        title: 'Approve Flagged Application?',
        message: `This item is flagged as needs_review (${selectedItem.route_reason || 'manual review required'}). Confirm you verified the recipient (${selectedItem.contact_email || 'none'}) and want to approve it for sending.`,
        confirmLabel: 'Confirm & Approve',
        isDanger: true,
      });
      if (!confirmed) return;
      confirmRisk = true;
    }

    try {
      const res = await apiFetch(`${apiBase}/api/applications/${selectedItem.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(confirmRisk ? { confirm_risk: true } : {}),
      });
      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errJson.error || `Approval failed (${res.status})`);
      }
      setItems((prev) => prev.filter((it) => it.id !== selectedItem.id));
      setOutboxItems((prev) => [{ ...selectedItem, status: 'approved' }, ...prev]);
      setSelectedId(null);
      setMobileDetailOpen(false);
      showFeedback(`Approved application for ${selectedItem.company}.`);
      onActionComplete?.();
    } catch (err) {
      void dialog.alert({
        title: 'Approval Failed',
        message: err instanceof Error ? err.message : String(err),
        variant: 'danger',
      });
    }
  }, [apiBase, dialog, onActionComplete, selectedItem, showFeedback]);

  const handleSaveAndApprove = useCallback(async () => {
    const saved = await handleSaveLetter();
    if (saved) {
      await handleApprove();
    }
  }, [handleApprove, handleSaveLetter]);

  const handleReject = useCallback(async () => {
    if (!selectedItem) return;
    const confirmed = await dialog.confirm({
      title: 'Reject Application?',
      message: `Reject and dismiss application for ${selectedItem.company}?`,
      confirmLabel: 'Reject Application',
      isDanger: true,
    });
    if (!confirmed) return;
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
      showFeedback(`Rejected application for ${selectedItem.company}.`);
      onActionComplete?.();
    } catch (err) {
      void dialog.alert({
        title: 'Reject Failed',
        message: err instanceof Error ? err.message : String(err),
        variant: 'danger',
      });
    }
  }, [apiBase, dialog, onActionComplete, selectedItem, showFeedback]);

  const handleBlockCompanyDnc = async () => {
    if (!selectedItem) return;
    const confirmed = await dialog.confirm({
      title: `Block ${selectedItem.company}?`,
      message: `Add "${selectedItem.company}" to Do-Not-Contact and dismiss all pending applications for this company?`,
      confirmLabel: 'Add to Do-Not-Contact',
      isDanger: true,
    });
    if (!confirmed) return;
    try {
      const res = await apiFetch(`${apiBase}/api/dnc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          value: selectedItem.company,
          reason: 'BLOCKED_FROM_REVIEW_QUEUE',
          dismiss_pending: true,
        }),
      });
      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errJson.error || `Failed to add DNC (${res.status})`);
      }
      showFeedback(`Added ${selectedItem.company} to Do-Not-Contact.`);
      await loadData();
      onActionComplete?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to block company');
    }
  };

  const handleBulkApprove = async () => {
    if (safeItems.length === 0) return;
    const count = safeItems.length;
    const confirmed = await dialog.confirm({
      title: `Approve ${count} Safe Draft${count === 1 ? '' : 's'}?`,
      message: `Approve all ${count} safe applications ready for dispatch? Unsafe items will remain for review.`,
      confirmLabel: `Approve All (${count})`,
    });
    if (!confirmed) return;

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
      const approvedSet = new Set(safeIds);
      setItems((prev) => prev.filter((it) => !approvedSet.has(it.id)));
      setOutboxItems((prev) => [
        ...safeItems.map((it) => ({ ...it, status: 'approved' })),
        ...prev,
      ]);
      setSelectedId(null);
      showFeedback(`Successfully bulk-approved ${data.approved_count} applications.`);
      onActionComplete?.();
    } catch (err) {
      void dialog.alert({
        title: 'Bulk Approval Failed',
        message: err instanceof Error ? err.message : String(err),
        variant: 'danger',
      });
    }
  };

  const handleSendNow = async (item: ReviewQueueItem) => {
    try {
      setSendingId(item.id);
      const res = await apiFetch(`${apiBase}/api/applications/${item.id}/send`, {
        method: 'POST',
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        simulated?: boolean;
      };
      if (!res.ok || json.ok === false) {
        throw new Error(json.error || `Send failed (${res.status})`);
      }
      showFeedback(
        json.simulated
          ? `Simulated send (DRY_RUN) for ${item.company}.`
          : `Email sent to ${item.company}.`,
      );
      await loadData();
      onActionComplete?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSendingId(null);
    }
  };

  const handlePollInbox = async () => {
    try {
      setPollingInbox(true);
      const res = await apiFetch(`${apiBase}/api/inbox/poll`, { method: 'POST' });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        repliedCount?: number;
        followUpsCreated?: number;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(json.error || `Inbox poll failed (${res.status})`);
      }
      showFeedback(
        `Inbox checked: ${json.repliedCount ?? 0} reply(s), ${json.followUpsCreated ?? 0} follow-up draft(s) created.`,
      );
      await loadData();
      onActionComplete?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Inbox poll failed');
    } finally {
      setPollingInbox(false);
    }
  };

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

  // Keyboard shortcuts for Review Queue
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && selectedItem && queueMode === 'pending') {
        e.preventDefault();
        void handleSaveLetter();
        return;
      }

      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      const idx = displayedItems.findIndex((it) => it.id === selectedId);
      if (e.key === 'j') {
        e.preventDefault();
        const next = displayedItems[idx + 1];
        if (next) setSelectedId(next.id);
      } else if (e.key === 'k') {
        e.preventDefault();
        const prev = displayedItems[idx - 1];
        if (prev) setSelectedId(prev.id);
      } else if (e.key === 'a' && queueMode === 'pending' && selectedItem) {
        e.preventDefault();
        void handleApprove();
      } else if (e.key === 'r' && queueMode === 'pending' && selectedItem) {
        e.preventDefault();
        void handleReject();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    displayedItems,
    handleApprove,
    handleReject,
    handleSaveLetter,
    queueMode,
    selectedId,
    selectedItem,
  ]);

  if (loading && items.length === 0 && outboxItems.length === 0) {
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

  const hasUnsavedEdits =
    selectedItem !== null &&
    (editedLetter !== (selectedItem.cover_letter || '') ||
      editedSubject !== (selectedItem.subject || ''));

  return (
    <div className="space-y-6">
      {/* Header & Bulk Approve Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 bg-surface p-4 sm:p-5 rounded-[6px] border border-border">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
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
            <span className="hidden lg:inline ml-2 font-mono text-[11px]">
              Shortcuts: j/k navigate, a approve, r reject, Ctrl/Cmd+Enter save
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <Button
            variant="secondary"
            size="sm"
            icon={RefreshCw}
            loading={pollingInbox}
            onClick={() => void handlePollInbox()}
          >
            Poll Replies
          </Button>
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

      {/* Pending vs Approved Outbox Toggle */}
      <div className="flex items-center justify-between border-b border-border pb-2 gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setQueueMode('pending')}
            className={`px-3 py-1.5 text-[13px] font-medium border-b-2 transition-colors cursor-pointer ${
              queueMode === 'pending'
                ? 'border-accent text-fg font-semibold'
                : 'border-transparent text-fg-muted hover:text-fg'
            }`}
          >
            Pending Review ({items.length})
          </button>
          <button
            type="button"
            onClick={() => setQueueMode('outbox')}
            className={`px-3 py-1.5 text-[13px] font-medium border-b-2 transition-colors cursor-pointer ${
              queueMode === 'outbox'
                ? 'border-accent text-fg font-semibold'
                : 'border-transparent text-fg-muted hover:text-fg'
            }`}
          >
            Approved & Outbox ({outboxItems.length})
          </button>
        </div>
      </div>

      {activeSourceList.length === 0 ? (
        <div className="bg-surface rounded-[6px] border border-border p-12 text-center">
          <div className="w-10 h-10 rounded-full bg-surface-subtle text-fg-muted border border-border flex items-center justify-center mx-auto mb-3">
            <Inbox size={20} strokeWidth={1.5} aria-hidden="true" />
          </div>
          <h3 className="text-[14px] font-semibold text-fg">
            {queueMode === 'pending' ? 'Queue is Clear!' : 'Outbox is Empty'}
          </h3>
          <p className="mt-1 text-[13px] text-fg-muted max-w-sm mx-auto">
            {queueMode === 'pending'
              ? 'There are no email applications currently awaiting your review. New items will arrive from ingestion.'
              : 'Approved email drafts queued for send windows or recent failed sends will appear here.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Item List */}
          <div
            className={`lg:col-span-4 space-y-2 ${mobileDetailOpen ? 'hidden lg:block' : 'block'}`}
          >
            <div className="flex items-center justify-between px-1">
              <h3 className="text-[12px] font-medium uppercase tracking-wider text-fg-muted">
                Applications ({displayedItems.length})
              </h3>
              <select
                aria-label="Filter by workplace type"
                value={workplaceFilter}
                onChange={(e) =>
                  setWorkplaceFilter(e.target.value as 'all' | 'remote' | 'hybrid' | 'onsite')
                }
                className="text-[11px] px-2 py-0.5 rounded-[4px] border border-border bg-surface text-fg focus-visible:outline-none"
              >
                <option value="all">All</option>
                <option value="remote">Remote</option>
                <option value="hybrid">Hybrid</option>
                <option value="onsite">On-site</option>
              </select>
            </div>
            <div className="space-y-2 max-h-[720px] overflow-y-auto pr-1">
              {displayedItems.map((it) => {
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
                      <WorkplaceBadge type={getWorkplaceType(it)} />
                      {it.kind === 'follow_up' && (
                        <StatusChip variant="warn" label="Follow-up" size="sm" />
                      )}
                      {queueMode === 'outbox' && <StatusChip status={it.status} size="sm" />}
                      {it.location && (
                        <span className="text-[11px] text-fg-muted font-mono truncate max-w-[120px]">
                          {it.location}
                        </span>
                      )}
                      {queueMode === 'pending' && it.is_safe_for_bulk && (
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
            <div
              className={`lg:col-span-8 bg-surface rounded-[6px] border border-border p-4 sm:p-6 space-y-5 sm:space-y-6 ${mobileDetailOpen ? 'block' : 'hidden lg:block'}`}
            >
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
              <div className="flex items-start justify-between border-b border-border pb-4 gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-[16px] font-semibold text-fg">{selectedItem.title}</h3>
                    {selectedItem.kind === 'follow_up' && (
                      <StatusChip variant="warn" label="Follow-up Draft" size="sm" />
                    )}
                  </div>
                  <div className="text-[13px] font-medium text-fg-muted mt-1 flex flex-wrap items-center gap-2">
                    <span>{selectedItem.company}</span>
                    <WorkplaceBadge type={getWorkplaceType(selectedItem)} />
                    {selectedItem.location && <span>• {selectedItem.location}</span>}
                    {selectedItem.salary_raw && (
                      <span className="font-mono text-fg">• {selectedItem.salary_raw}</span>
                    )}
                  </div>
                  <div className="text-[12px] text-fg-muted mt-1 flex flex-wrap items-center gap-3">
                    <span>
                      Contact:{' '}
                      <span className="font-mono text-fg">
                        {selectedItem.contact_email || 'None'}
                      </span>{' '}
                      (source: {selectedItem.contact_source || 'unknown'})
                    </span>
                    {isSafeHttpUrl(selectedItem.apply_url) && (
                      <a
                        href={selectedItem.apply_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-accent hover:underline font-medium"
                      >
                        <span>Open Posting</span>
                        <ExternalLink size={11} aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="text-[12px] uppercase text-fg-muted font-medium tracking-wider">
                    Match Score
                  </div>
                  <div className="text-[24px] font-mono font-semibold tabular-nums text-accent">
                    {selectedItem.match_score}%
                  </div>
                </div>
              </div>

              {/* Detail Context Sub-Tabs */}
              <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
                <div className="flex items-center gap-1">
                  {(
                    [
                      { id: 'draft', label: 'Draft & Resume' },
                      { id: 'description', label: 'Job Description' },
                      { id: 'fit', label: 'AI Fit & Signals' },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setDetailTab(t.id)}
                      className={`px-3 py-1.5 text-[12px] font-medium rounded-[4px] cursor-pointer transition-colors ${
                        detailTab === t.id
                          ? 'bg-surface-subtle text-fg border border-border font-semibold'
                          : 'text-fg-muted hover:text-fg'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                <Button
                  variant="ghost"
                  size="xs"
                  icon={Ban}
                  onClick={() => void handleBlockCompanyDnc()}
                >
                  Block Company
                </Button>
              </div>

              {detailTab === 'draft' && (
                <div className="space-y-5">
                  {/* Bulk-safety explainability */}
                  {queueMode === 'pending' &&
                    !selectedItem.is_safe_for_bulk &&
                    selectedItem.bulk_block_reasons &&
                    selectedItem.bulk_block_reasons.length > 0 && (
                      <div className="p-3 bg-surface-subtle border border-border rounded-[6px] text-[12px] text-fg-muted space-y-1">
                        <div className="font-semibold text-fg">
                          Why individual review is required:
                        </div>
                        <ul className="list-disc pl-5 space-y-0.5">
                          {selectedItem.bulk_block_reasons.map((reason, idx) => (
                            <li key={idx}>{reason}</li>
                          ))}
                        </ul>
                      </div>
                    )}

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
                      disabled={queueMode === 'outbox'}
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

                  {/* Cover Letter & Subject Editor */}
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

                    <div className="flex items-center gap-2 bg-surface-subtle px-2.5 py-1.5 rounded-[6px] border border-border">
                      <label
                        htmlFor="review-subject-input"
                        className="text-fg-muted font-sans text-[12px] shrink-0"
                      >
                        Subject:
                      </label>
                      <input
                        id="review-subject-input"
                        type="text"
                        value={editedSubject}
                        onChange={(e) => setEditedSubject(e.target.value)}
                        readOnly={queueMode === 'outbox'}
                        className="flex-1 bg-transparent text-[13px] font-mono text-fg focus:outline-none"
                      />
                    </div>

                    <textarea
                      id="cover-letter-editor"
                      aria-label="Cover Letter"
                      rows={10}
                      value={editedLetter}
                      onChange={(e) => setEditedLetter(e.target.value)}
                      readOnly={queueMode === 'outbox'}
                      className="w-full p-3 text-[13px] leading-relaxed font-sans rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      placeholder="Cover letter body..."
                    />

                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-fg-muted font-mono tabular-nums">
                        Word count: {editedLetter.trim().split(/\s+/).filter(Boolean).length} words
                      </span>
                      {queueMode === 'pending' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={savingLetter}
                          onClick={() => void handleSaveLetter()}
                        >
                          {savingLetter ? 'Validating & Saving...' : 'Save & Validate Letter'}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {detailTab === 'description' && (
                <div className="space-y-2">
                  <div className="text-[12px] font-medium uppercase tracking-wider text-fg-muted">
                    Job Description (Plain Text)
                  </div>
                  <div
                    data-testid="review-job-description-plain"
                    className="p-4 bg-surface-subtle border border-border rounded-[6px] text-[13px] whitespace-pre-wrap text-fg font-mono leading-relaxed max-h-[460px] overflow-y-auto"
                  >
                    {selectedItem.description || 'No job description available.'}
                  </div>
                </div>
              )}

              {detailTab === 'fit' && (
                <div className="space-y-4">
                  <div className="p-4 bg-surface-subtle border border-border rounded-[6px] space-y-2">
                    <div className="text-[12px] font-semibold text-fg flex items-center gap-1.5">
                      <Sparkles size={14} className="text-accent" aria-hidden="true" />
                      <span>AI Match Reasoning</span>
                    </div>
                    <p className="text-[13px] text-fg-muted leading-relaxed">
                      {selectedItem.match_reasons || 'No detailed match reasons recorded.'}
                    </p>
                  </div>

                  {selectedItem.route_reason && (
                    <div className="p-3 bg-surface-subtle border border-border rounded-[6px] text-[12px] text-fg">
                      <span className="text-fg-muted font-medium">Route Reason: </span>
                      <span className="font-mono">{selectedItem.route_reason}</span>
                    </div>
                  )}

                  {selectedItem.red_flags.length > 0 ? (
                    <div className="p-3.5 bg-state-warn-bg border border-state-warn-border rounded-[6px] text-[12px] text-state-warn-fg space-y-1">
                      <div className="font-semibold flex items-center gap-1.5">
                        <Flag size={13} aria-hidden="true" />
                        <span>Red Flags Detected</span>
                      </div>
                      <ul className="list-disc pl-5 space-y-0.5">
                        {selectedItem.red_flags.map((rf, idx) => (
                          <li key={idx}>{rf}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="p-3 bg-state-ok-bg border border-state-ok-border rounded-[6px] text-[12px] text-state-ok-fg">
                      No scam or policy red flags detected.
                    </div>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              {queueMode === 'pending' ? (
                <div className="pt-4 border-t border-border flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5 sm:gap-3">
                  <Button
                    variant="destructive"
                    size="md"
                    onClick={() => void handleReject()}
                    className="w-full sm:w-auto"
                  >
                    Reject Application
                  </Button>
                  {hasUnsavedEdits && (
                    <Button
                      variant="secondary"
                      size="md"
                      loading={savingLetter}
                      onClick={() => void handleSaveAndApprove()}
                      className="w-full sm:w-auto"
                    >
                      Save &amp; Approve
                    </Button>
                  )}
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
              ) : (
                <div className="pt-4 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="text-[12px] text-fg-muted">
                    Status: <span className="font-mono text-fg">{selectedItem.status}</span>
                    {selectedItem.error && (
                      <span className="block text-state-danger-fg font-mono mt-1">
                        Error: {selectedItem.error}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="primary"
                    size="md"
                    icon={Send}
                    loading={sendingId === selectedItem.id}
                    onClick={() => void handleSendNow(selectedItem)}
                    className="w-full sm:w-auto"
                  >
                    Send Now
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
