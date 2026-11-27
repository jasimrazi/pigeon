import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Download, FolderX, Layers, Loader2, Search } from 'lucide-react';
import { Button } from './ui/Button.js';
import { StatusChip } from './ui/StatusChip.js';
import { SourceLogo, getSourceDisplayName } from './ui/SourceLogo.js';
import { WorkplaceBadge, getWorkplaceType } from './ui/WorkplaceBadge.js';
import { useDialog } from './ui/DialogProvider.js';
import { useToast } from './ui/ToastProvider.js';
import { ApplicationDetailDrawer, type ApplicationDetailData } from './ApplicationDetailDrawer.js';
import { apiFetch } from '../api.js';

export type ApplicationItem = ApplicationDetailData;

interface Props {
  apiBase?: string;
}

const SUBMITTED_STATUSES = new Set([
  'sent',
  'manual_applied',
  'replied',
  'interview',
  'offer',
  'rejected',
  'bounced',
]);

const RESPONSE_STATUSES = new Set(['replied', 'interview', 'offer', 'rejected']);

/**
 * Neutralizes spreadsheet formula injection (Rule 9) before writing CSV cells.
 */
export function sanitizeCsvCell(raw: string | number | null | undefined): string {
  const str = raw === null || raw === undefined ? '' : String(raw);
  const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function ApplicationsView({ apiBase = '' }: Props): React.JSX.Element {
  const dialog = useDialog();
  const toast = useToast();
  const [apps, setApps] = useState<ApplicationItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [channelFilter, setChannelFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [sortOrder, setSortOrder] = useState<'updated_desc' | 'score_desc'>('updated_desc');
  const [presetFilter, setPresetFilter] = useState<'all' | 'active' | 'positive' | 'closed'>('all');
  const [workplaceFilter, setWorkplaceFilter] = useState<'all' | 'remote' | 'hybrid' | 'onsite'>(
    'all',
  );

  // Outcome modal & Detail Drawer state
  const [outcomeTargetApp, setOutcomeTargetApp] = useState<ApplicationItem | null>(null);
  const [drawerApp, setDrawerApp] = useState<ApplicationItem | null>(null);
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
      params.set('sort', sortOrder);
      params.set('limit', '200');

      const res = await apiFetch(`${apiBase}/api/applications?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Failed to load applications (${res.status})`);
      }
      const data = (await res.json()) as {
        ok?: boolean;
        items?: ApplicationItem[];
        applications?: ApplicationItem[];
        total?: number;
      };
      const rows = data.items ?? data.applications ?? [];
      setApps(rows);
      setTotal(data.total ?? rows.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [apiBase, search, statusFilter, channelFilter, sourceFilter, sortOrder]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadApplications();
    }, 200);
    return () => clearTimeout(timer);
  }, [loadApplications]);

  const displayedApps = useMemo(() => {
    let list = apps;
    if (workplaceFilter !== 'all') {
      list = list.filter((app) => getWorkplaceType(app) === workplaceFilter);
    }
    if (presetFilter === 'active') {
      list = list.filter((app) =>
        ['draft', 'needs_review', 'approved', 'sending', 'manual_pending', 'sent', 'manual_applied', 'replied'].includes(
          app.status,
        ),
      );
    } else if (presetFilter === 'positive') {
      list = list.filter((app) => ['replied', 'interview', 'offer'].includes(app.status));
    } else if (presetFilter === 'closed') {
      list = list.filter((app) =>
        ['rejected', 'bounced', 'failed', 'skipped', 'manual_skipped'].includes(app.status),
      );
    }
    return list;
  }, [apps, workplaceFilter, presetFilter]);

  const funnelStats = useMemo(() => {
    const submitted = apps.filter((a) => SUBMITTED_STATUSES.has(a.status)).length;
    const responded = apps.filter((a) => RESPONSE_STATUSES.has(a.status)).length;
    const interviews = apps.filter(
      (a) => a.status === 'interview' || a.status === 'offer',
    ).length;
    const offers = apps.filter((a) => a.status === 'offer').length;
    const responseRate = submitted > 0 ? Math.round((responded / submitted) * 100) : 0;
    const interviewRate = submitted > 0 ? Math.round((interviews / submitted) * 100) : 0;
    return { submitted, responded, interviews, offers, responseRate, interviewRate };
  }, [apps]);

  const handleRecordOutcome = async () => {
    if (!outcomeTargetApp) return;
    try {
      setSavingOutcome(true);
      const res = await apiFetch(
        `${apiBase}/api/applications/${outcomeTargetApp.id}/outcome`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: outcomeChoice,
            notes: outcomeNotes.trim() || undefined,
          }),
        },
      );
      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errJson.error || `Failed to record outcome (${res.status})`);
      }
      toast.success(`Recorded outcome (${outcomeChoice}) for ${outcomeTargetApp.company}.`);
      setOutcomeTargetApp(null);
      setOutcomeNotes('');
      await loadApplications();
    } catch (err) {
      void dialog.alert({
        title: 'Failed to Record Outcome',
        message: err instanceof Error ? err.message : String(err),
        variant: 'danger',
      });
    } finally {
      setSavingOutcome(false);
    }
  };

  const handleExportCsv = () => {
    if (displayedApps.length === 0) {
      toast.info('No applications to export.');
      return;
    }
    const headers = [
      'Company',
      'Title',
      'Status',
      'Channel',
      'Source',
      'Location',
      'Match Score',
      'Date',
      'Contact Email',
      'Apply URL',
      'Notes',
    ];
    const lines = [headers.map((h) => sanitizeCsvCell(h)).join(',')];
    for (const app of displayedApps) {
      const dateStr = app.sent_at || app.applied_at || app.updated_at;
      lines.push(
        [
          sanitizeCsvCell(app.company),
          sanitizeCsvCell(app.title),
          sanitizeCsvCell(app.status),
          sanitizeCsvCell(app.channel),
          sanitizeCsvCell(app.source),
          sanitizeCsvCell(app.location),
          sanitizeCsvCell(app.match_score),
          sanitizeCsvCell(dateStr ? new Date(dateStr).toISOString().slice(0, 10) : ''),
          sanitizeCsvCell(app.contact_email),
          sanitizeCsvCell(app.apply_url),
          sanitizeCsvCell(app.notes),
        ].join(','),
      );
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pigeon-applications-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${displayedApps.length} application(s) to CSV.`);
  };

  return (
    <div className="space-y-6">
      {/* Funnel Conversion Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-surface border border-border rounded-[6px] p-3.5">
          <div className="text-[11px] font-medium uppercase tracking-wider text-fg-muted">
            Submitted
          </div>
          <div className="mt-1 text-[20px] font-semibold font-mono tabular-nums text-fg">
            {funnelStats.submitted}
          </div>
          <div className="text-[11px] text-fg-muted mt-0.5">Sent or manually applied</div>
        </div>
        <div className="bg-surface border border-border rounded-[6px] p-3.5">
          <div className="text-[11px] font-medium uppercase tracking-wider text-fg-muted">
            Response Rate
          </div>
          <div className="mt-1 text-[20px] font-semibold font-mono tabular-nums text-fg">
            {funnelStats.responseRate}%
          </div>
          <div className="text-[11px] text-fg-muted mt-0.5">{funnelStats.responded} replies</div>
        </div>
        <div className="bg-surface border border-border rounded-[6px] p-3.5">
          <div className="text-[11px] font-medium uppercase tracking-wider text-fg-muted">
            Interview Rate
          </div>
          <div className="mt-1 text-[20px] font-semibold font-mono tabular-nums text-accent">
            {funnelStats.interviewRate}%
          </div>
          <div className="text-[11px] text-fg-muted mt-0.5">
            {funnelStats.interviews} interview/offer
          </div>
        </div>
        <div className="bg-surface border border-border rounded-[6px] p-3.5">
          <div className="text-[11px] font-medium uppercase tracking-wider text-state-ok-fg">
            Offers
          </div>
          <div className="mt-1 text-[20px] font-semibold font-mono tabular-nums text-state-ok-fg">
            {funnelStats.offers}
          </div>
          <div className="text-[11px] text-fg-muted mt-0.5">Recorded offers</div>
        </div>
      </div>

      {/* Header & Filter Controls */}
      <div className="bg-surface p-5 rounded-[6px] border border-border space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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
                {displayedApps.length}
                {total > apps.length ? ` / ${total}` : ''}
              </span>
            </div>
            <p className="text-[13px] text-fg-muted mt-1">
              Click any application to view cover letter, timeline, and notes, or record responses.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <Button variant="secondary" size="sm" icon={Download} onClick={handleExportCsv}>
              Export CSV
            </Button>
          </div>
        </div>

        {/* Preset Chips + Sort */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'active', label: 'Active' },
                { id: 'positive', label: 'Replies & Interviews' },
                { id: 'closed', label: 'Rejected / Failed' },
              ] as const
            ).map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => setPresetFilter(chip.id)}
                className={`px-2.5 py-1 text-[12px] font-medium rounded-[4px] border cursor-pointer transition-colors ${
                  presetFilter === chip.id
                    ? 'bg-accent/10 text-accent border-accent/30'
                    : 'bg-surface-subtle text-fg-muted border-border hover:text-fg'
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>

          <select
            aria-label="Sort applications"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value as 'updated_desc' | 'score_desc')}
            className="text-[12px] px-2.5 py-1 rounded-[4px] border border-border bg-surface text-fg focus-visible:outline-none"
          >
            <option value="updated_desc">Sort: Most Recent</option>
            <option value="score_desc">Sort: Highest Match Score</option>
          </select>
        </div>

        {/* Filter Inputs Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
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
            aria-label="Filter by workplace type"
            value={workplaceFilter}
            onChange={(e) =>
              setWorkplaceFilter(e.target.value as 'all' | 'remote' | 'hybrid' | 'onsite')
            }
            className="w-full text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="all">All Workplaces</option>
            <option value="remote">Remote Only</option>
            <option value="hybrid">Hybrid Only</option>
            <option value="onsite">On-site Only</option>
          </select>

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
            <option value="sending">Sending</option>
            <option value="sent">Sent</option>
            <option value="manual_pending">Manual Pending</option>
            <option value="manual_applied">Manual Applied</option>
            <option value="manual_skipped">Manual Skipped</option>
            <option value="replied">Replied</option>
            <option value="interview">Interview</option>
            <option value="offer">Offer</option>
            <option value="rejected">Rejected</option>
            <option value="bounced">Bounced</option>
            <option value="failed">Failed</option>
            <option value="skipped">Skipped</option>
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
              <option value="whatjobs">WhatJobs</option>
              <option value="bebee">beBee</option>
              <option value="ambitionbox">AmbitionBox</option>
              <option value="cutshort">Cutshort</option>
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
        ) : displayedApps.length === 0 ? (
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
          <>
            {/* Mobile Cards List (< md) */}
            <div className="md:hidden divide-y divide-border">
              {displayedApps.map((app) => (
                <div
                  key={app.id}
                  onClick={() => setDrawerApp(app)}
                  className="p-4 space-y-2.5 cursor-pointer hover:bg-surface-subtle/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-fg text-[14px] truncate">{app.company}</div>
                      <div className="text-[13px] text-fg-muted truncate">{app.title}</div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <WorkplaceBadge type={getWorkplaceType(app)} />
                        {app.location && (
                          <span className="text-[11px] text-fg-muted font-mono truncate">
                            {app.location}
                          </span>
                        )}
                      </div>
                    </div>
                    <StatusChip status={app.status} size="sm" />
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-[12px] text-fg-muted">
                    <div className="inline-flex items-center gap-1.5">
                      <SourceLogo source={app.source} size="xs" />
                      <span>{getSourceDisplayName(app.source)}</span>
                    </div>
                    <span>•</span>
                    <span className="font-mono uppercase">{app.channel}</span>
                    {app.match_score !== null && (
                      <>
                        <span>•</span>
                        <span className="font-mono tabular-nums font-semibold text-fg">
                          {app.match_score}%
                        </span>
                      </>
                    )}
                    <span>•</span>
                    <span className="font-mono tabular-nums">
                      {app.sent_at || app.applied_at
                        ? new Date(app.sent_at || app.applied_at || '').toLocaleDateString()
                        : new Date(app.updated_at).toLocaleDateString()}
                    </span>
                  </div>

                  <div className="pt-1 flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOutcomeNotes(app.notes || '');
                        setOutcomeTargetApp(app);
                      }}
                    >
                      Record Outcome
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop Table (md+) */}
            <div className="hidden md:block overflow-x-auto max-h-[640px]">
              <table className="w-full text-left border-collapse text-[13px]">
                <thead className="sticky top-0 bg-surface-subtle border-b border-border z-10">
                  <tr className="text-fg-muted uppercase text-[11px] font-medium tracking-wider">
                    <th className="py-2.5 px-4">Company &amp; Role</th>
                    <th className="py-2.5 px-4">Workplace</th>
                    <th className="py-2.5 px-4">Channel</th>
                    <th className="py-2.5 px-4">Source</th>
                    <th className="py-2.5 px-4">Score</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4">Date</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {displayedApps.map((app) => (
                    <tr
                      key={app.id}
                      onClick={() => setDrawerApp(app)}
                      className="hover:bg-surface-subtle/50 transition-colors cursor-pointer"
                    >
                      <td className="py-2.5 px-4">
                        <div className="font-semibold text-fg flex items-center gap-1.5">
                          <span>{app.company}</span>
                          {app.kind === 'follow_up' && (
                            <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-surface-subtle border border-border text-fg-muted">
                              Follow-up
                            </span>
                          )}
                        </div>
                        <div className="text-fg-muted truncate max-w-xs">{app.title}</div>
                        {app.location && (
                          <div className="text-[11px] text-fg-muted font-mono">{app.location}</div>
                        )}
                      </td>

                      <td className="py-2.5 px-4">
                        <WorkplaceBadge type={getWorkplaceType(app)} />
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
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOutcomeNotes(app.notes || '');
                            setOutcomeTargetApp(app);
                          }}
                        >
                          Record Outcome
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Application Detail Drawer */}
      <ApplicationDetailDrawer
        apiBase={apiBase}
        application={drawerApp}
        onClose={() => setDrawerApp(null)}
        onRecordOutcome={() => {
          if (drawerApp) {
            setOutcomeNotes(drawerApp.notes || '');
            setOutcomeTargetApp(drawerApp);
          }
        }}
        onNotesSaved={() => void loadApplications()}
      />

      {/* Record Outcome Modal */}
      {outcomeTargetApp && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
        >
          <div className="bg-surface rounded-[6px] max-w-md w-full p-6 border border-border shadow-sm">
            <h3 className="text-[16px] font-semibold text-fg">
              Record Outcome: {outcomeTargetApp.company}
            </h3>
            <p className="text-[13px] text-fg-muted mt-1">
              Position: <span className="font-medium text-fg">{outcomeTargetApp.title}</span>
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

            <div className="mt-6 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setOutcomeTargetApp(null)}
                className="w-full sm:w-auto"
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={savingOutcome}
                onClick={() => void handleRecordOutcome()}
                className="w-full sm:w-auto"
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
