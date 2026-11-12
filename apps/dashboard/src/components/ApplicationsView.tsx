import React, { useState, useEffect, useCallback } from 'react';
import { FolderX, Layers, Loader2, Search } from 'lucide-react';
import { Button } from './ui/Button.js';
import { StatusChip } from './ui/StatusChip.js';
import { SourceLogo, getSourceDisplayName } from './ui/SourceLogo.js';

export interface ApplicationItem {
  id: string;
  job_id: string;
  kind: string;
  channel: string;
  status: string;
  cover_letter: string | null;
  subject: string | null;
  sent_at: string | null;
  applied_at: string | null;
  outcome: string | null;
  outcome_at: string | null;
  notes: string | null;
  updated_at: string;
  title: string;
  company: string;
  source: string;
  location: string | null;
  match_score: number | null;
  contact_email: string | null;
  apply_url: string | null;
}

interface Props {
  apiBase?: string;
}

export function ApplicationsView({ apiBase = '' }: Props): React.JSX.Element {
  const [apps, setApps] = useState<ApplicationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [channelFilter, setChannelFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');

  // Outcome modal state
  const [selectedApp, setSelectedApp] = useState<ApplicationItem | null>(null);
  const [outcomeChoice, setOutcomeChoice] = useState<
    'replied' | 'interview' | 'rejected' | 'offer'
  >('interview');
  const [outcomeNotes, setOutcomeNotes] = useState('');
  const [savingOutcome, setSavingOutcome] = useState(false);

  const loadApplications = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (statusFilter) params.set('status', statusFilter);
      if (channelFilter) params.set('channel', channelFilter);
      if (sourceFilter) params.set('source', sourceFilter);

      const res = await fetch(`${apiBase}/api/applications?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Failed to load applications (${res.status})`);
      }
      const data = (await res.json()) as { ok: boolean; applications: ApplicationItem[] };
      setApps(data.applications || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [apiBase, search, statusFilter, channelFilter, sourceFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadApplications();
    }, 200);
    return () => clearTimeout(timer);
  }, [loadApplications]);

  const handleRecordOutcome = async () => {
    if (!selectedApp) return;
    try {
      setSavingOutcome(true);
      const res = await fetch(`${apiBase}/api/applications/${selectedApp.id}/outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcome: outcomeChoice,
          notes: outcomeNotes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        throw new Error(`Failed to record outcome (${res.status})`);
      }
      setSelectedApp(null);
      setOutcomeNotes('');
      await loadApplications();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingOutcome(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Filter Controls */}
      <div className="bg-surface p-5 rounded-[6px] border border-border space-y-4">
        <div>
          <div className="flex items-center gap-2">
            <Layers
              size={16}
              strokeWidth={1.5}
              className="text-fg-muted shrink-0"
              aria-hidden="true"
            />
            <h2 className="text-[16px] font-semibold text-fg">All Applications</h2>
            <span className="text-[12px] bg-surface-subtle text-fg-muted font-medium font-mono tabular-nums px-2 py-0.5 rounded-[4px] border border-border">
              {apps.length}
            </span>
          </div>
          <p className="text-[13px] text-fg-muted mt-1">
            Search, filter by route and status, and record responses and interview outcomes.
          </p>
        </div>

        {/* Filter Inputs Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          <div className="relative">
            <Search
              size={14}
              strokeWidth={1.5}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="text"
              aria-label="Search company or title"
              placeholder="Search company or title..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full text-[13px] pl-8 pr-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>

          <select
            aria-label="Filter by application status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="needs_review">Needs Review</option>
            <option value="approved">Approved</option>
            <option value="sent">Sent</option>
            <option value="manual_pending">Manual Pending</option>
            <option value="applied">Applied</option>
            <option value="replied">Replied</option>
            <option value="interview">Interview</option>
            <option value="offer">Offer</option>
            <option value="rejected">Rejected</option>
            <option value="bounced">Bounced</option>
          </select>

          <select
            aria-label="Filter by application channel"
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
            className="w-full text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">All Channels</option>
            <option value="email">Email</option>
            <option value="manual">Manual</option>
          </select>

          <select
            aria-label="Filter by job source"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="w-full text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">All Sources</option>
            <optgroup label="Alert Emails">
              <option value="linkedin">LinkedIn</option>
              <option value="indeed">Indeed</option>
              <option value="naukri">Naukri</option>
              <option value="wellfound">Wellfound</option>
              <option value="otta">Otta</option>
              <option value="ziprecruiter">ZipRecruiter</option>
              <option value="dice">Dice</option>
              <option value="glassdoor">Glassdoor</option>
              <option value="instahyre">Instahyre</option>
              <option value="foundit">Foundit</option>
            </optgroup>
            <optgroup label="ATS Endpoints">
              <option value="greenhouse">Greenhouse</option>
              <option value="lever">Lever</option>
              <option value="ashby">Ashby</option>
              <option value="smartrecruiters">SmartRecruiters</option>
              <option value="workable">Workable</option>
              <option value="breezy">Breezy HR</option>
              <option value="bamboohr">BambooHR</option>
              <option value="recruitee">Recruitee</option>
            </optgroup>
            <optgroup label="Job APIs & Feeds">
              <option value="adzuna">Adzuna</option>
              <option value="remoteok">RemoteOK</option>
              <option value="remotive">Remotive</option>
              <option value="weworkremotely">We Work Remotely</option>
              <option value="hiring_hn">Hacker News</option>
              <option value="himalayas">Himalayas</option>
              <option value="jobicy">Jobicy</option>
              <option value="workingnomads">Working Nomads</option>
            </optgroup>
          </select>
        </div>
      </div>

      {/* Applications Table */}
      <div className="bg-surface rounded-[6px] border border-border overflow-hidden">
        {loading && apps.length === 0 ? (
          <div className="p-12 text-center text-[13px] text-fg-muted flex items-center justify-center gap-2">
            <Loader2 className="animate-spin shrink-0" size={16} aria-hidden="true" />
            <span>Loading applications...</span>
          </div>
        ) : error ? (
          <div className="p-4 bg-state-danger-bg text-state-danger-fg text-[13px]">{error}</div>
        ) : apps.length === 0 ? (
          <div className="p-12 text-center">
            <FolderX
              size={24}
              strokeWidth={1.5}
              className="mx-auto text-fg-muted mb-2"
              aria-hidden="true"
            />
            <div className="text-[14px] font-medium text-fg">
              No applications match your filter criteria.
            </div>
            <p className="text-[12px] text-fg-muted mt-1">Try clearing filters or search terms.</p>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[640px]">
            <table className="w-full text-left border-collapse text-[13px]">
              <thead className="sticky top-0 bg-surface-subtle border-b border-border z-10">
                <tr className="text-fg-muted uppercase text-[11px] font-medium tracking-wider">
                  <th className="py-2.5 px-4">Company & Role</th>
                  <th className="py-2.5 px-4">Channel</th>
                  <th className="py-2.5 px-4">Source</th>
                  <th className="py-2.5 px-4">Score</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Date</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {apps.map((app) => (
                  <tr key={app.id} className="hover:bg-surface-subtle/50 transition-colors">
                    <td className="py-2.5 px-4">
                      <div className="font-semibold text-fg">{app.company}</div>
                      <div className="text-fg-muted truncate max-w-xs">{app.title}</div>
                      {app.location && (
                        <div className="text-[11px] text-fg-muted font-mono">{app.location}</div>
                      )}
                    </td>

                    <td className="py-2.5 px-4">
                      <span className="font-mono text-[12px] uppercase text-fg-muted">
                        {app.channel}
                      </span>
                    </td>

                    <td className="py-2.5 px-4 text-fg-muted text-[12px]">
                      <div className="inline-flex items-center gap-1.5">
                        <SourceLogo source={app.source} size="xs" />
                        <span>{getSourceDisplayName(app.source)}</span>
                      </div>
                    </td>

                    <td className="py-2.5 px-4">
                      <span className="font-mono tabular-nums font-semibold text-fg">
                        {app.match_score !== null ? `${app.match_score}%` : '—'}
                      </span>
                    </td>

                    <td className="py-2.5 px-4">
                      <StatusChip status={app.status} size="sm" />
                    </td>

                    <td className="py-2.5 px-4 text-fg-muted font-mono tabular-nums text-[12px]">
                      {app.sent_at || app.applied_at
                        ? new Date(app.sent_at || app.applied_at || '').toLocaleDateString()
                        : new Date(app.updated_at).toLocaleDateString()}
                    </td>

                    <td className="py-2.5 px-4 text-right">
                      <Button variant="ghost" size="xs" onClick={() => setSelectedApp(app)}>
                        Record Outcome
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Record Outcome Modal */}
      {selectedApp && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
        >
          <div className="bg-surface rounded-[6px] max-w-md w-full p-6 border border-border shadow-sm">
            <h3 className="text-[16px] font-semibold text-fg">
              Record Outcome: {selectedApp.company}
            </h3>
            <p className="text-[13px] text-fg-muted mt-1">
              Position: <span className="font-medium text-fg">{selectedApp.title}</span>
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label
                  htmlFor="outcome-choice-select"
                  className="block text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-1.5"
                >
                  Outcome Type
                </label>
                <select
                  id="outcome-choice-select"
                  aria-label="Outcome Type"
                  value={outcomeChoice}
                  onChange={(e) =>
                    setOutcomeChoice(
                      e.target.value as 'replied' | 'interview' | 'rejected' | 'offer',
                    )
                  }
                  className="w-full text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <option value="interview">Interview Scheduled</option>
                  <option value="replied">Recruiter Replied</option>
                  <option value="offer">Offer Received</option>
                  <option value="rejected">Rejection</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="outcome-notes-input"
                  className="block text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-1.5"
                >
                  Notes (optional)
                </label>
                <textarea
                  id="outcome-notes-input"
                  aria-label="Notes"
                  rows={3}
                  value={outcomeNotes}
                  onChange={(e) => setOutcomeNotes(e.target.value)}
                  placeholder="e.g. Technical round scheduled for next Tuesday with engineering director"
                  className="w-full text-[13px] p-2.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent leading-relaxed"
                />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setSelectedApp(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={savingOutcome}
                onClick={() => void handleRecordOutcome()}
              >
                Save Outcome
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
