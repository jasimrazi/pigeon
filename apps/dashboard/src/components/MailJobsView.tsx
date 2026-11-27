import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Banknote,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  Filter,
  Mail,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react';
import { Button } from './ui/Button.js';
import { StatusChip } from './ui/StatusChip.js';
import { SourceLogo } from './ui/SourceLogo.js';
import { WorkplaceBadge, getWorkplaceType } from './ui/WorkplaceBadge.js';
import { apiFetch } from '../api.js';

export interface JobFeedItem {
  id: string;
  dedupe_key: string;
  source: string;
  source_kind: 'alert_email' | 'ats' | 'api';
  source_job_id: string | null;
  title: string;
  company: string;
  location: string | null;
  remote: boolean | number | null;
  salary_raw: string | null;
  description: string;
  apply_url: string | null;
  contact_email: string | null;
  posted_at: string | null;
  fetched_at: string;
  status: 'new' | 'filtered_out' | 'skipped' | 'routed';
  filter_reason: string | null;
  match_score: number | null;
  match_reasons: string | null;
  red_flags: string | null;
  apply_route: string | null;
  route_reason: string | null;
  updated_at: string;
}

interface Props {
  apiBase?: string;
  onNavigateTab?: (tab: string) => void;
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    }
  } catch {
    // If raw is a plain string
    if (typeof raw === 'string' && raw.trim()) {
      return [raw.trim()];
    }
  }
  return [];
}

export function MailJobsView({ apiBase = '', onNavigateTab }: Props): React.JSX.Element {
  const [jobs, setJobs] = useState<JobFeedItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [sourceKind, setSourceKind] = useState<'alert_email' | 'all'>('alert_email');
  const [sourceFilter, setSourceFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [minScoreFilter, setMinScoreFilter] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'score_desc'>('newest');
  const [search, setSearch] = useState('');
  const [pageLimit, setPageLimit] = useState(50);

  // Expandable match details
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Gmail sync & requeue
  const [syncingGmail, setSyncingGmail] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [creatingAppJobId, setCreatingAppJobId] = useState<string | null>(null);
  const [requeuingJobId, setRequeuingJobId] = useState<string | null>(null);
  const [bulkRequeuing, setBulkRequeuing] = useState(false);

  const handleRequeueJob = async (jobId: string) => {
    try {
      setRequeuingJobId(jobId);
      const res = await apiFetch(`${apiBase}/api/jobs/${encodeURIComponent(jobId)}/requeue`, {
        method: 'POST',
      });
      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errJson.error || `Failed to re-queue job (${res.status})`);
      }
      setSyncFeedback('Job moved back to Pending (new) and queued for scoring.');
      await loadJobs();
      setTimeout(() => setSyncFeedback(null), 5000);
    } catch (err) {
      setSyncFeedback(`Re-queue failed: ${err instanceof Error ? err.message : String(err)}`);
      setTimeout(() => setSyncFeedback(null), 5000);
    } finally {
      setRequeuingJobId(null);
    }
  };

  const handleBulkRequeue = async (targetStatus: 'skipped' | 'filtered_out') => {
    try {
      setBulkRequeuing(true);
      const payload: Record<string, unknown> = { status: targetStatus, limit: 100 };
      if (sourceKind !== 'all') {
        payload.source_kind = sourceKind;
      }
      const res = await apiFetch(`${apiBase}/api/jobs/requeue-bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errJson.error || `Bulk re-queue failed (${res.status})`);
      }
      const json = (await res.json()) as { requeued?: number };
      setSyncFeedback(
        `Re-queued ${json.requeued ?? 0} ${targetStatus.replace('_', ' ')} job(s) for re-scoring.`,
      );
      await loadJobs();
      setTimeout(() => setSyncFeedback(null), 6000);
    } catch (err) {
      setSyncFeedback(`Bulk re-queue failed: ${err instanceof Error ? err.message : String(err)}`);
      setTimeout(() => setSyncFeedback(null), 6000);
    } finally {
      setBulkRequeuing(false);
    }
  };

  const handlePromoteToQueue = async (jobId: string) => {
    try {
      setCreatingAppJobId(jobId);
      const res = await apiFetch(`${apiBase}/api/applications/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId }),
      });
      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errJson.error || `Failed to create application (${res.status})`);
      }
      setSyncFeedback('Job promoted to Manual Apply / Review Queue.');
      setTimeout(() => setSyncFeedback(null), 5000);
      await loadJobs();
    } catch (err) {
      setSyncFeedback(
        `Promote failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      setTimeout(() => setSyncFeedback(null), 5000);
    } finally {
      setCreatingAppJobId(null);
    }
  };

  const handleViewInManualApply = async (jobId: string) => {
    try {
      setCreatingAppJobId(jobId);
      await apiFetch(`${apiBase}/api/applications/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId }),
      });
    } catch (err) {
      console.warn('Could not ensure application exists:', err);
    } finally {
      setCreatingAppJobId(null);
      if (onNavigateTab) {
        onNavigateTab('manual-apply');
      }
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const loadJobs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (sourceKind !== 'all') params.set('source_kind', sourceKind);
      if (sourceFilter) params.set('source', sourceFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (minScoreFilter) params.set('min_score', minScoreFilter);
      if (sortOrder !== 'newest') params.set('sort', sortOrder);
      if (search.trim()) params.set('search', search.trim());
      params.set('limit', String(pageLimit));

      const res = await apiFetch(`${apiBase}/api/jobs?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Failed to load jobs (${res.status})`);
      }
      const data = (await res.json()) as { ok: boolean; jobs: JobFeedItem[]; total: number };
      setJobs(data.jobs || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [apiBase, sourceKind, sourceFilter, statusFilter, minScoreFilter, sortOrder, search, pageLimit]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const handleSyncGmailAlerts = async () => {
    try {
      setSyncingGmail(true);
      setSyncFeedback(null);
      const res = await apiFetch(`${apiBase}/api/alerts/sync`, { method: 'POST' });
      if (res.ok) {
        const json = (await res.json()) as {
          messagesFound?: number;
          messagesProcessed?: number;
          newJobs?: number;
          duplicates?: number;
        };
        const processed = json.messagesProcessed ?? 0;
        const newJobs = json.newJobs ?? 0;
        if (processed > 0) {
          setSyncFeedback(
            `Gmail alerts synced: ${processed} email(s) parsed, ${newJobs} new jobs queued for scoring!`,
          );
        } else {
          setSyncFeedback(
            `Gmail checked: ${json.messagesFound ?? 0} matching alert email(s) found, 0 new unparsed emails.`,
          );
        }
        await loadJobs();
        setTimeout(() => setSyncFeedback(null), 6000);
      } else {
        const errJson = await res.json().catch(() => ({}));
        setSyncFeedback(`Gmail sync failed: ${(errJson as { error?: string }).error || res.statusText}`);
        setTimeout(() => setSyncFeedback(null), 6000);
      }
    } catch (err) {
      setSyncFeedback(`Gmail sync error: ${err instanceof Error ? err.message : String(err)}`);
      setTimeout(() => setSyncFeedback(null), 6000);
    } finally {
      setSyncingGmail(false);
    }
  };

  // Metrics
  const metrics = useMemo(() => {
    const highMatches = jobs.filter((j) => (j.match_score ?? 0) >= 65).length;
    const routed = jobs.filter((j) => j.status === 'routed').length;
    const filtered = jobs.filter((j) => j.status === 'filtered_out').length;
    const skipped = jobs.filter((j) => j.status === 'skipped').length;
    return { highMatches, routed, filtered, skipped };
  }, [jobs]);

  return (
    <div className="space-y-6">
      {/* Header Banner & Controls */}
      <div className="bg-surface p-4 sm:p-5 rounded-[6px] border border-border flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Mail size={18} className="text-accent shrink-0" strokeWidth={1.5} aria-hidden="true" />
            <h2 className="text-[16px] font-semibold text-fg">Mail Parsed Jobs & AI Match Scoring</h2>
          </div>
          <p className="text-[13px] text-fg-muted mt-1">
            Browse all job postings extracted from email alerts (WhatJobs, beBee, LinkedIn, Indeed, etc.)
            and inspect their full AI match breakdown and scoring reasons.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto shrink-0">
          {(statusFilter === 'skipped' || statusFilter === 'filtered_out') && (
            <Button
              variant="secondary"
              size="sm"
              icon={RefreshCw}
              loading={bulkRequeuing}
              onClick={() => void handleBulkRequeue(statusFilter)}
            >
              {bulkRequeuing
                ? 'Re-queuing...'
                : `Re-queue ${statusFilter === 'skipped' ? 'Skipped' : 'Filtered'} Jobs`}
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            icon={RefreshCw}
            loading={loading}
            onClick={() => void loadJobs()}
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={Mail}
            loading={syncingGmail}
            onClick={() => void handleSyncGmailAlerts()}
          >
            {syncingGmail ? 'Checking Gmail...' : 'Sync Alerts from Gmail'}
          </Button>
        </div>
      </div>

      {syncFeedback && (
        <div className="bg-surface border border-accent/40 text-fg p-3 rounded-[6px] text-[13px] flex items-center justify-between">
          <span>{syncFeedback}</span>
          <button
            type="button"
            onClick={() => setSyncFeedback(null)}
            className="text-fg-muted hover:text-fg text-[12px] ml-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-surface p-3.5 rounded-[6px] border border-border">
          <div className="text-[11px] font-medium text-fg-muted uppercase tracking-wider">Total in View</div>
          <div className="text-[20px] font-semibold text-fg mt-1">{total}</div>
        </div>
        <div className="bg-surface p-3.5 rounded-[6px] border border-border">
          <div className="text-[11px] font-medium text-state-ok-fg uppercase tracking-wider">Matches (≥ 65)</div>
          <div className="text-[20px] font-semibold text-state-ok-fg mt-1">{metrics.highMatches}</div>
        </div>
        <div className="bg-surface p-3.5 rounded-[6px] border border-border">
          <div className="text-[11px] font-medium text-accent uppercase tracking-wider">Routed to Apply</div>
          <div className="text-[20px] font-semibold text-accent mt-1">{metrics.routed}</div>
        </div>
        <div className="bg-surface p-3.5 rounded-[6px] border border-border">
          <div className="text-[11px] font-medium text-fg-muted uppercase tracking-wider">Filtered / Skipped</div>
          <div className="text-[20px] font-semibold text-fg-muted mt-1">
            {metrics.filtered + metrics.skipped}
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-surface p-4 rounded-[6px] border border-border space-y-3">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Source Kind Toggle */}
          <div className="inline-flex rounded-[6px] p-0.5 bg-surface-subtle border border-border shrink-0 self-start">
            <button
              type="button"
              onClick={() => setSourceKind('alert_email')}
              className={`px-3 py-1.5 text-[12px] font-medium rounded-[4px] transition-colors ${
                sourceKind === 'alert_email'
                  ? 'bg-surface text-fg shadow-sm font-semibold'
                  : 'text-fg-muted hover:text-fg'
              }`}
            >
              Alert Emails Only
            </button>
            <button
              type="button"
              onClick={() => setSourceKind('all')}
              className={`px-3 py-1.5 text-[12px] font-medium rounded-[4px] transition-colors ${
                sourceKind === 'all'
                  ? 'bg-surface text-fg shadow-sm font-semibold'
                  : 'text-fg-muted hover:text-fg'
              }`}
            >
              All Ingested Jobs
            </button>
          </div>

          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="text"
              aria-label="Search job title or company"
              placeholder="Search title, company, or keyword..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full text-[13px] pl-8 pr-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>
        </div>

        {/* Dropdowns */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
          <div>
            <label htmlFor="portal-filter-select" className="block text-[11px] font-medium text-fg-muted uppercase tracking-wider mb-1">
              Source Portal
            </label>
            <select
              id="portal-filter-select"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="w-full text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <option value="">All Portals & Sources</option>
              <optgroup label="Email Alert Portals">
                <option value="whatjobs">WhatJobs</option>
                <option value="bebee">beBee</option>
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
                <option value="ambitionbox">AmbitionBox</option>
                <option value="cutshort">Cutshort</option>
              </optgroup>
              <optgroup label="Direct ATS & APIs">
                <option value="greenhouse">Greenhouse</option>
                <option value="lever">Lever</option>
                <option value="ashby">Ashby</option>
                <option value="jobicy">Jobicy</option>
                <option value="remoteok">RemoteOK</option>
                <option value="remotive">Remotive</option>
                <option value="hiring_hn">Hacker News</option>
              </optgroup>
            </select>
          </div>

          <div>
            <label htmlFor="status-filter-select" className="block text-[11px] font-medium text-fg-muted uppercase tracking-wider mb-1">
              Evaluation Status
            </label>
            <select
              id="status-filter-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <option value="">All Statuses</option>
              <option value="routed">Routed to Apply (Score ≥ 65)</option>
              <option value="filtered_out">Filtered Out (Rule Failed)</option>
              <option value="skipped">Skipped (Incomplete Data)</option>
              <option value="new">Pending Evaluation (New)</option>
            </select>
          </div>

          <div>
            <label htmlFor="min-score-filter-select" className="block text-[11px] font-medium text-fg-muted uppercase tracking-wider mb-1">
              Minimum Score
            </label>
            <select
              id="min-score-filter-select"
              value={minScoreFilter}
              onChange={(e) => setMinScoreFilter(e.target.value)}
              className="w-full text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <option value="">Any Score</option>
              <option value="80">80+ (Top Matches)</option>
              <option value="65">65+ (Strong Matches)</option>
              <option value="50">50+ (Moderate)</option>
            </select>
          </div>

          <div>
            <label htmlFor="jobs-sort-select" className="block text-[11px] font-medium text-fg-muted uppercase tracking-wider mb-1">
              Sort Order
            </label>
            <select
              id="jobs-sort-select"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as 'newest' | 'score_desc')}
              className="w-full text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <option value="newest">Newest Updated</option>
              <option value="score_desc">Highest Fit Score</option>
            </select>
          </div>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 bg-state-danger-bg border border-state-danger-border text-state-danger-fg text-[13px] rounded-[6px]">
          {error}
        </div>
      )}

      {/* Jobs List */}
      {loading && jobs.length === 0 ? (
        <div className="bg-surface p-12 text-center rounded-[6px] border border-border">
          <RefreshCw size={24} className="animate-spin text-fg-muted mx-auto mb-2" />
          <p className="text-[13px] text-fg-muted">Loading parsed jobs and scores...</p>
        </div>
      ) : jobs.length === 0 ? (
        <div className="bg-surface p-12 text-center rounded-[6px] border border-border space-y-4">
          <Mail size={32} className="text-fg-muted mx-auto" strokeWidth={1.5} />
          <div className="max-w-md mx-auto space-y-1">
            <h3 className="text-[15px] font-semibold text-fg">
              {sourceKind === 'alert_email'
                ? 'No Mail Parsed Jobs Found Yet'
                : 'No Jobs Match Your Filters'}
            </h3>
            <p className="text-[13px] text-fg-muted leading-relaxed">
              {sourceKind === 'alert_email' ? (
                <>
                  When portal alert emails (LinkedIn, Indeed, Naukri, Wellfound, etc.) arrive in
                  your connected Gmail inbox, Pigeon parses each opening and computes match scores
                  against your profile.
                </>
              ) : (
                'Try adjusting your filters or search keywords.'
              )}
            </p>
          </div>
          {sourceKind === 'alert_email' && (
            <div className="pt-2">
              <Button
                variant="primary"
                size="sm"
                icon={Mail}
                loading={syncingGmail}
                onClick={() => void handleSyncGmailAlerts()}
              >
                Sync Alerts from Gmail Now
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => {
            const isExpanded = expandedIds.has(job.id);
            const matchReasons = parseJsonArray(job.match_reasons);
            const redFlags = parseJsonArray(job.red_flags);
            const score = job.match_score;

            // Score badge color logic
            let scoreBadgeClass = 'bg-surface-subtle text-fg-muted border-border';
            let scoreLabel = 'No score';
            if (typeof score === 'number') {
              if (score >= 65) {
                scoreBadgeClass = 'bg-state-ok-bg text-state-ok-fg border-state-ok-border font-bold';
                scoreLabel = `${score}/100`;
              } else if (score >= 40) {
                scoreBadgeClass = 'bg-state-warn-bg text-state-warn-fg border-state-warn-border font-semibold';
                scoreLabel = `${score}/100`;
              } else {
                scoreBadgeClass = 'bg-surface-subtle text-fg-muted border-border';
                scoreLabel = `${score}/100`;
              }
            } else if (job.status === 'filtered_out') {
              scoreLabel = 'Filtered';
            } else if (job.status === 'skipped') {
              scoreLabel = 'Skipped';
            } else if (job.status === 'new') {
              scoreLabel = 'Pending';
            }

            return (
              <div
                key={job.id}
                className="bg-surface p-4 sm:p-5 rounded-[6px] border border-border hover:border-accent/40 transition-colors space-y-3"
              >
                {/* Header row: Company, Source Logo, Score, Status */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-[14px] text-fg">{job.company}</span>
                    <SourceLogo source={job.source} size="xs" showName />
                    {job.source_kind === 'alert_email' && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-accent/10 text-accent border border-accent/20">
                        <Mail size={10} /> Alert Email
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {/* Prominent Score Badge */}
                    <div
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[4px] border text-[12px] ${scoreBadgeClass}`}
                      title={typeof score === 'number' ? `LLM Match Score: ${score}/100` : undefined}
                    >
                      {typeof score === 'number' && score >= 65 && (
                        <Sparkles size={12} className="text-state-ok-fg shrink-0" />
                      )}
                      <span>Score: {scoreLabel}</span>
                    </div>

                    <StatusChip status={job.status} />
                  </div>
                </div>

                {/* Job Title & Location / Meta */}
                <div>
                  <h3 className="text-[15px] font-semibold text-fg hover:text-accent">
                    {job.apply_url ? (
                      <a
                        href={job.apply_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1.5 group"
                      >
                        <span>{job.title}</span>
                        <ExternalLink size={13} className="text-fg-muted group-hover:text-accent shrink-0" />
                      </a>
                    ) : (
                      job.title
                    )}
                  </h3>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-muted mt-1.5">
                    {job.location && (
                      <span className="flex items-center gap-1">
                        <span>{job.location}</span>
                      </span>
                    )}
                    <WorkplaceBadge type={getWorkplaceType(job)} />
                    {job.salary_raw && (
                      <span className="font-mono text-fg font-medium inline-flex items-center gap-1">
                        <Banknote size={12} className="text-fg-muted shrink-0" aria-hidden="true" />
                        {job.salary_raw}
                      </span>
                    )}
                    <span className="flex items-center gap-1 font-mono text-[11px]">
                      <Clock size={11} /> {new Date(job.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {/* Filter Reason Notice (if filtered out or skipped) */}
                {job.filter_reason && (
                  <div className="p-2.5 rounded-[4px] bg-surface-subtle border border-border text-[12px] text-fg-muted flex items-start gap-2">
                    <Filter size={13} className="text-fg-muted shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-fg font-medium">Filter Reason:</strong> {job.filter_reason}
                    </div>
                  </div>
                )}

                {/* Red Flags Alert (if any detected by LLM) */}
                {redFlags.length > 0 && (
                  <div className="p-2.5 rounded-[4px] bg-state-warn-bg border border-state-warn-border text-[12px] text-state-warn-fg flex items-start gap-2">
                    <AlertCircle size={14} className="text-state-warn-fg shrink-0 mt-0.5" />
                    <div>
                      <strong className="font-medium">Red Flags Identified:</strong>
                      <ul className="list-disc list-inside mt-0.5 space-y-0.5">
                        {redFlags.map((flag, idx) => (
                          <li key={idx}>{flag}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {/* Match Reasons Breakdown (LLM evaluation citing candidate facts) */}
                {matchReasons.length > 0 && (
                  <div className="border border-border/80 rounded-[4px] overflow-hidden bg-surface-subtle/40">
                    <button
                      type="button"
                      onClick={() => toggleExpand(job.id)}
                      className="w-full px-3 py-2 text-left flex items-center justify-between text-[12px] font-medium text-fg hover:bg-surface-subtle cursor-pointer transition-colors"
                    >
                      <span className="flex items-center gap-1.5 text-accent">
                        <Sparkles size={13} />
                        <span>AI Match Evaluation ({matchReasons.length} reasons cited)</span>
                      </span>
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>

                    {isExpanded && (
                      <div className="px-3 pb-3 pt-1 border-t border-border/60 text-[12px] space-y-1 text-fg leading-relaxed">
                        <ul className="list-disc list-inside space-y-1">
                          {matchReasons.map((reason, idx) => (
                            <li key={idx} className="text-fg-muted">
                              <span className="text-fg">{reason}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* Bottom Actions Row */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-border/60">
                  <div className="text-[11px] text-fg-muted font-mono">
                    Route: <span className="text-fg">{job.apply_route || 'none'}</span>
                    {job.route_reason && <span className="ml-1 text-fg-muted">({job.route_reason})</span>}
                  </div>

                  <div className="flex items-center gap-2">
                    {(job.status === 'skipped' || job.status === 'filtered_out') && (
                      <Button
                        variant="secondary"
                        size="xs"
                        icon={RefreshCw}
                        loading={requeuingJobId === job.id}
                        onClick={() => void handleRequeueJob(job.id)}
                      >
                        Re-queue
                      </Button>
                    )}
                    {job.status !== 'routed' && (
                      <Button
                        variant="secondary"
                        size="xs"
                        icon={ArrowRight}
                        loading={creatingAppJobId === job.id}
                        onClick={() => void handlePromoteToQueue(job.id)}
                      >
                        Promote to Apply
                      </Button>
                    )}
                    {job.status === 'routed' && onNavigateTab && (
                      <Button
                        variant="secondary"
                        size="xs"
                        icon={ArrowRight}
                        loading={creatingAppJobId === job.id}
                        onClick={() => void handleViewInManualApply(job.id)}
                      >
                        View in Manual Apply
                      </Button>
                    )}
                    {job.apply_url && (
                      <a
                        href={job.apply_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[4px] text-[12px] font-medium bg-surface text-fg border border-border hover:bg-surface-subtle transition-colors"
                      >
                        <span>Open Posting</span>
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {jobs.length < total && (
            <div className="pt-2 flex items-center justify-between text-[12px] text-fg-muted">
              <span className="font-mono">
                Showing {jobs.length} of {total} jobs
              </span>
              <Button
                variant="secondary"
                size="sm"
                loading={loading}
                onClick={() => setPageLimit((prev) => prev + 50)}
              >
                Load More
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
