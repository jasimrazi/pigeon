import React, { useEffect, useState } from 'react';
import {
  X,
  ExternalLink,
  Copy,
  FileText,
  Clock,
  Loader2,
  Save,
  Sparkles,
  Flag,
} from 'lucide-react';
import { Button } from './ui/Button.js';
import { StatusChip } from './ui/StatusChip.js';
import { SourceLogo, getSourceDisplayName } from './ui/SourceLogo.js';
import { WorkplaceBadge, getWorkplaceType } from './ui/WorkplaceBadge.js';
import { useToast } from './ui/ToastProvider.js';
import { apiFetch } from '../api.js';

export interface ApplicationDetailData {
  id: string;
  job_id: string;
  kind: string;
  channel: string;
  status: string;
  resume_id: string | null;
  resume_label?: string | null;
  cover_letter: string | null;
  subject: string | null;
  scheduled_at?: string | null;
  sent_at: string | null;
  applied_at: string | null;
  error?: string | null;
  follow_up_count?: number;
  notes: string | null;
  updated_at: string;
  title: string;
  company: string;
  source: string;
  location: string | null;
  remote?: boolean | number | null;
  salary_raw?: string | null;
  description?: string | null;
  apply_url: string | null;
  contact_email: string | null;
  contact_source?: string | null;
  match_score: number | null;
  match_reasons?: string | null;
  red_flags?: string | null;
  apply_route?: string | null;
}

export interface ApplicationTimelineEvent {
  id: string;
  entity: string;
  entity_id: string;
  type: string;
  payload: unknown;
  created_at: string;
}

interface Props {
  apiBase?: string;
  application: ApplicationDetailData | null;
  onClose: () => void;
  onRecordOutcome: () => void;
  onNotesSaved?: () => void;
}

function isSafeHttpUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
}

function parseRedFlags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function ApplicationDetailDrawer({
  apiBase = '',
  application,
  onClose,
  onRecordOutcome,
  onNotesSaved,
}: Props): React.JSX.Element | null {
  const toast = useToast();
  const [detail, setDetail] = useState<ApplicationDetailData | null>(application);
  const [events, setEvents] = useState<ApplicationTimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState(application?.notes || '');
  const [savingNotes, setSavingNotes] = useState(false);
  const [activeSection, setActiveSection] = useState<'overview' | 'description' | 'timeline'>(
    'overview',
  );

  useEffect(() => {
    if (!application) return;
    setDetail(application);
    setNotes(application.notes || '');
    setActiveSection('overview');

    let cancelled = false;
    async function fetchDetail() {
      if (!application) return;
      try {
        setLoading(true);
        const res = await apiFetch(`${apiBase}/api/applications/${encodeURIComponent(application.id)}`);
        if (!res.ok) return;
        const json = (await res.json()) as {
          ok?: boolean;
          application?: ApplicationDetailData;
          events?: ApplicationTimelineEvent[];
        };
        if (!cancelled && json.application) {
          setDetail(json.application);
          setNotes(json.application.notes || '');
          setEvents(json.events || []);
        }
      } catch {
        // Fallback to summary row data
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void fetchDetail();
    return () => {
      cancelled = true;
    };
  }, [apiBase, application]);

  useEffect(() => {
    if (!application) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [application, onClose]);

  if (!application || !detail) return null;

  const handleSaveNotes = async () => {
    try {
      setSavingNotes(true);
      const res = await apiFetch(
        `${apiBase}/api/applications/${encodeURIComponent(detail.id)}/notes`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes }),
        },
      );
      if (!res.ok) {
        throw new Error(`Failed to save notes (${res.status})`);
      }
      toast.success('Application notes saved.');
      onNotesSaved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save notes');
    } finally {
      setSavingNotes(false);
    }
  };

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Copied ${label}.`);
    } catch {
      toast.error(`Failed to copy ${label}.`);
    }
  };

  const redFlags = parseRedFlags(detail.red_flags);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Application details for ${detail.company}`}
      className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="bg-surface border-l border-border w-full max-w-2xl h-full flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="p-4 sm:p-5 border-b border-border flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-[16px] font-semibold text-fg truncate">{detail.company}</h3>
              <StatusChip status={detail.status} size="sm" />
              {detail.kind === 'follow_up' && (
                <span className="text-[11px] font-mono px-1.5 py-0.5 rounded-[4px] bg-surface-subtle border border-border text-fg-muted">
                  Follow-up
                </span>
              )}
            </div>
            <p className="text-[14px] text-fg-muted font-medium mt-0.5 truncate">{detail.title}</p>
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-fg-muted mt-2">
              <span className="inline-flex items-center gap-1.5">
                <SourceLogo source={detail.source} size="xs" />
                <span>{getSourceDisplayName(detail.source)}</span>
              </span>
              <WorkplaceBadge type={getWorkplaceType(detail)} />
              {detail.location && <span className="font-mono text-[11px]">{detail.location}</span>}
              {detail.salary_raw && (
                <span className="font-mono text-[11px] text-fg">{detail.salary_raw}</span>
              )}
              {detail.match_score !== null && (
                <span className="font-mono font-semibold text-accent">
                  {detail.match_score}% fit
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close detail drawer"
            className="p-1.5 rounded-[6px] text-fg-muted hover:text-fg hover:bg-surface-subtle cursor-pointer shrink-0"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Action Strip */}
        <div className="px-4 sm:px-5 py-2.5 bg-surface-subtle border-b border-border flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            {(
              [
                { id: 'overview', label: 'Letter & Notes' },
                { id: 'description', label: 'Job Description' },
                { id: 'timeline', label: `Timeline (${events.length})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveSection(tab.id)}
                className={`px-2.5 py-1 text-[12px] font-medium rounded-[4px] cursor-pointer transition-colors ${
                  activeSection === tab.id
                    ? 'bg-surface text-fg border border-border shadow-xs'
                    : 'text-fg-muted hover:text-fg'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {isSafeHttpUrl(detail.apply_url) && (
              <a
                href={detail.apply_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[4px] border border-border bg-surface text-fg text-[12px] font-medium hover:bg-surface-subtle transition-colors"
              >
                <span>Open Posting</span>
                <ExternalLink size={12} aria-hidden="true" />
              </a>
            )}
            <Button variant="primary" size="xs" onClick={onRecordOutcome}>
              Record Outcome
            </Button>
          </div>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
          {loading && (
            <div className="flex items-center gap-2 text-[12px] text-fg-muted">
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              <span>Loading full history...</span>
            </div>
          )}

          {activeSection === 'overview' && (
            <>
              {/* Metadata Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3.5 rounded-[6px] bg-surface-subtle border border-border text-[12px]">
                <div>
                  <span className="text-fg-muted block text-[11px] uppercase tracking-wider">
                    Channel
                  </span>
                  <span className="font-mono font-semibold text-fg uppercase">{detail.channel}</span>
                </div>
                <div>
                  <span className="text-fg-muted block text-[11px] uppercase tracking-wider">
                    Contact
                  </span>
                  <span className="font-mono text-fg truncate block">
                    {detail.contact_email || 'Portal Form'}
                  </span>
                </div>
                <div>
                  <span className="text-fg-muted block text-[11px] uppercase tracking-wider">
                    Resume
                  </span>
                  <span className="text-fg font-medium truncate block">
                    {detail.resume_label || 'Default / None'}
                  </span>
                </div>
                <div>
                  <span className="text-fg-muted block text-[11px] uppercase tracking-wider">
                    Sent / Applied
                  </span>
                  <span className="font-mono text-fg tabular-nums">
                    {detail.sent_at || detail.applied_at
                      ? new Date(detail.sent_at || detail.applied_at || '').toLocaleString()
                      : 'Pending'}
                  </span>
                </div>
                <div>
                  <span className="text-fg-muted block text-[11px] uppercase tracking-wider">
                    Follow-ups
                  </span>
                  <span className="font-mono text-fg tabular-nums">
                    {detail.follow_up_count ?? 0}
                  </span>
                </div>
                <div>
                  <span className="text-fg-muted block text-[11px] uppercase tracking-wider">
                    Last Updated
                  </span>
                  <span className="font-mono text-fg tabular-nums">
                    {new Date(detail.updated_at).toLocaleDateString()}
                  </span>
                </div>
              </div>

              {detail.error && (
                <div className="p-3 rounded-[6px] bg-state-danger-bg border border-state-danger-border text-state-danger-fg text-[12px] font-mono">
                  Last error: {detail.error}
                </div>
              )}

              {detail.match_reasons && (
                <div className="p-3 rounded-[6px] bg-surface-subtle border border-border text-[12px] space-y-1">
                  <div className="font-semibold text-fg flex items-center gap-1.5">
                    <Sparkles size={13} className="text-accent" aria-hidden="true" />
                    <span>AI Match Summary</span>
                  </div>
                  <p className="text-fg-muted leading-relaxed">{detail.match_reasons}</p>
                </div>
              )}

              {redFlags.length > 0 && (
                <div className="p-3 rounded-[6px] bg-state-warn-bg border border-state-warn-border text-state-warn-fg text-[12px] flex items-start gap-2">
                  <Flag size={13} className="shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <strong className="font-semibold">Red Flags:</strong> {redFlags.join(', ')}
                  </div>
                </div>
              )}

              {/* Notes Editor */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="drawer-notes-textarea"
                    className="text-[12px] font-medium uppercase tracking-wider text-fg-muted"
                  >
                    Personal Notes
                  </label>
                  <Button
                    variant="secondary"
                    size="xs"
                    icon={Save}
                    loading={savingNotes}
                    onClick={() => void handleSaveNotes()}
                  >
                    Save Notes
                  </Button>
                </div>
                <textarea
                  id="drawer-notes-textarea"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add recruiter name, referral details, interview prep notes..."
                  className="w-full text-[13px] p-2.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>

              {/* Cover Letter */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-medium uppercase tracking-wider text-fg-muted inline-flex items-center gap-1.5">
                    <FileText size={13} aria-hidden="true" />
                    <span>Cover Letter</span>
                  </span>
                  {detail.cover_letter && (
                    <Button
                      variant="ghost"
                      size="xs"
                      icon={Copy}
                      onClick={() => void handleCopy(detail.cover_letter || '', 'Cover Letter')}
                    >
                      Copy
                    </Button>
                  )}
                </div>
                {detail.subject && (
                  <div className="px-3 py-2 rounded-[6px] bg-surface-subtle border border-border text-[12px] font-mono text-fg">
                    Subject: {detail.subject}
                  </div>
                )}
                <div className="p-3.5 rounded-[6px] bg-surface-subtle border border-border text-[13px] text-fg whitespace-pre-wrap leading-relaxed">
                  {detail.cover_letter || 'No cover letter recorded.'}
                </div>
              </div>
            </>
          )}

          {activeSection === 'description' && (
            <div className="space-y-2">
              <div className="text-[12px] font-medium uppercase tracking-wider text-fg-muted">
                Job Description (Plain Text)
              </div>
              <div className="p-4 rounded-[6px] bg-surface-subtle border border-border text-[13px] font-mono text-fg whitespace-pre-wrap leading-relaxed">
                {detail.description || 'Job description unavailable.'}
              </div>
            </div>
          )}

          {activeSection === 'timeline' && (
            <div className="space-y-2.5">
              {events.length === 0 ? (
                <div className="py-10 text-center text-[13px] text-fg-muted">
                  No audit events recorded for this application yet.
                </div>
              ) : (
                events.map((ev) => (
                  <div
                    key={ev.id}
                    className="p-3 rounded-[6px] border border-border bg-surface-subtle/50 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-mono font-semibold text-fg">{ev.type}</span>
                      <span className="text-[11px] font-mono text-fg-muted inline-flex items-center gap-1">
                        <Clock size={11} aria-hidden="true" />
                        {new Date(ev.created_at).toLocaleString()}
                      </span>
                    </div>
                    <pre className="text-[11px] font-mono text-fg-muted overflow-x-auto whitespace-pre-wrap">
                      {JSON.stringify(ev.payload)}
                    </pre>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
