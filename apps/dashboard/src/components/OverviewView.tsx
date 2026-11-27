import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, ArrowRight, Clock, Mail, Play } from 'lucide-react';
import { ConfirmationModal } from './ConfirmationModal.js';
import { AlertBanner } from './ui/AlertBanner.js';
import { MetricCard } from './ui/MetricCard.js';
import { Button } from './ui/Button.js';
import { useDialog } from './ui/DialogProvider.js';
import { apiFetch, getGoogleAuthStartUrl } from '../api.js';

export interface CronJobInfo {
  id: string;
  name: string;
  cron: string;
  schedule: string;
  description: string;
  lastRunAt: string | null;
}

interface OverviewData {
  sendsToday: number;
  effectiveCap: number;
  dailyCap: number;
  bounceRate: number;
  failureRate: number;
  jobsByStatus: Record<string, number>;
  jobsByRoute: Record<string, number>;
  manualWaitingCount: number;
  authHealth: {
    status: 'ok' | 'invalid' | 'unknown';
    reason: string | null;
    checked_at: string | null;
  };
  dryRun: boolean;
  killSwitch: boolean;
  cronJobs?: CronJobInfo[];
}

function formatRelativeTime(isoString: string | null | undefined): string {
  if (!isoString) return 'Never';
  const date = new Date(isoString);
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 0) return 'Just now';
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

interface Props {
  apiBase?: string;
  onNavigateTab?: (tab: string) => void;
  onDataRefresh?: () => void;
}

export function OverviewView({
  apiBase = '',
  onNavigateTab,
  onDataRefresh,
}: Props): React.JSX.Element {
  const dialog = useDialog();
  const [data, setData] = useState<OverviewData | null>(null);
  const [setupStatus, setSetupStatus] = useState<{
    readyForDryRun: boolean;
    readyToGoLive: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showKsModal, setShowKsModal] = useState(false);
  const [targetKsState, setTargetKsState] = useState(false);
  const [showDryRunModal, setShowDryRunModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineResult, setPipelineResult] = useState<string | null>(null);
  const [syncingGmail, setSyncingGmail] = useState(false);
  const [gmailSyncResult, setGmailSyncResult] = useState<string | null>(null);
  const [runningCronIds, setRunningCronIds] = useState<Record<string, boolean>>({});
  const [cronFeedback, setCronFeedback] = useState<{
    id: string;
    ok: boolean;
    message: string;
  } | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch(`${apiBase}/api/overview`);
      if (!res.ok) {
        throw new Error(`Failed to load overview (${res.status})`);
      }
      const json = (await res.json()) as OverviewData;
      setData(json);

      // Check setup status
      try {
        const setupRes = await apiFetch(`${apiBase}/api/setup/status`);
        if (setupRes.ok) {
          const sJson = (await setupRes.json()) as {
            readyForDryRun: boolean;
            readyToGoLive: boolean;
          };
          setSetupStatus(sJson);
        }
      } catch {
        // Non-blocking setup check
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const handleSyncGmailAlerts = async () => {
    try {
      setSyncingGmail(true);
      setGmailSyncResult(null);
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
          setGmailSyncResult(
            `Gmail alerts synced: ${processed} alert email(s) processed, ${newJobs} new jobs queued for scoring!`,
          );
        } else {
          setGmailSyncResult(
            `Gmail checked: ${json.messagesFound ?? 0} matching alert email(s) found, 0 new unparsed emails.`,
          );
        }
        await loadOverview();
        onDataRefresh?.();
        setTimeout(() => setGmailSyncResult(null), 6000);
      } else {
        const errJson = await res.json().catch(() => ({}));
        setGmailSyncResult(`Gmail sync failed: ${(errJson as { error?: string }).error || res.statusText}`);
        setTimeout(() => setGmailSyncResult(null), 6000);
      }
    } catch (err) {
      setGmailSyncResult(`Gmail sync error: ${err instanceof Error ? err.message : String(err)}`);
      setTimeout(() => setGmailSyncResult(null), 6000);
    } finally {
      setSyncingGmail(false);
    }
  };

  const handleToggleKillSwitch = async (activate: boolean) => {
    try {
      setActionLoading(true);
      const res = await apiFetch(`${apiBase}/api/settings/kill-switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kill_switch: activate, confirmed: true }),
      });
      if (!res.ok) {
        throw new Error(`Failed to update Kill Switch (${res.status})`);
      }
      await loadOverview();
      onDataRefresh?.();
    } catch (err) {
      void dialog.alert({
        title: 'Kill Switch Update Failed',
        message: err instanceof Error ? err.message : String(err),
        variant: 'danger',
      });
    } finally {
      setActionLoading(false);
      setShowKsModal(false);
    }
  };

  const handleToggleDryRun = async (dryRun: boolean, confirmed = false) => {
    try {
      setActionLoading(true);
      const res = await apiFetch(`${apiBase}/api/settings/dry-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: dryRun, confirmed: dryRun ? true : confirmed }),
      });
      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errJson.error || `Failed to update DRY_RUN (${res.status})`);
      }
      await loadOverview();
      onDataRefresh?.();
    } catch (err) {
      void dialog.alert({
        title: 'DRY_RUN Update Failed',
        message: err instanceof Error ? err.message : String(err),
        variant: 'danger',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleRunPipeline = async () => {
    try {
      setPipelineRunning(true);
      setPipelineResult(null);
      const res = await apiFetch(`${apiBase}/api/pipeline/run`, {
        method: 'POST',
      });
      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errJson.error || `Pipeline failed (${res.status})`);
      }
      const json = (await res.json()) as {
        ok: boolean;
        stats?: {
          processed: number;
          routed: number;
          filtered_out: number;
          low_score_skipped: number;
        };
      };
      if (json.stats) {
        setPipelineResult(
          `Processed ${json.stats.processed} jobs: ${json.stats.routed} routed, ${json.stats.filtered_out} filtered, ${json.stats.low_score_skipped} skipped low score.`,
        );
      } else {
        setPipelineResult('Pipeline run complete.');
      }
      await loadOverview();
      onDataRefresh?.();
    } catch (err) {
      setPipelineResult(err instanceof Error ? err.message : String(err));
    } finally {
      setPipelineRunning(false);
    }
  };

  const handleRunCron = async (jobId: string, jobName: string) => {
    try {
      setRunningCronIds((prev) => ({ ...prev, [jobId]: true }));
      setCronFeedback(null);
      const res = await apiFetch(`${apiBase}/api/cron/${encodeURIComponent(jobId)}/run`, {
        method: 'POST',
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(json.error || `Failed to run ${jobName} (${res.status})`);
      }
      setCronFeedback({
        id: jobId,
        ok: true,
        message: `${jobName}: ${json.message || 'Triggered successfully.'}`,
      });
      await loadOverview();
      onDataRefresh?.();
    } catch (err) {
      setCronFeedback({
        id: jobId,
        ok: false,
        message: `${jobName}: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setRunningCronIds((prev) => ({ ...prev, [jobId]: false }));
    }
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-20 text-fg-muted text-[14px] gap-2">
        <Loader2 className="animate-spin shrink-0" size={16} aria-hidden="true" />
        <span>Loading system overview...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-4 bg-state-danger-bg border border-state-danger-border rounded-[6px] text-state-danger-fg text-[14px]">
        <strong>Error:</strong> {error || 'Failed to load system metrics.'}
        <button
          onClick={() => void loadOverview()}
          className="ml-4 underline font-medium hover:opacity-80 cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  const isAuthInvalid = data.authHealth?.status !== 'ok';

  return (
    <div className="space-y-6">
      {/* First-Run Setup Banner */}
      {setupStatus && !setupStatus.readyForDryRun && (
        <AlertBanner
          variant="warn"
          title="Initial Setup Incomplete"
          description="Pigeon requires basic configuration (master encryption key, candidate profile, default resume, and LLM provider) before running simulations or processing applications."
          action={
            <Button variant="primary" size="sm" onClick={() => onNavigateTab?.('setup')}>
              Open Setup Checklist
            </Button>
          }
        />
      )}

      {/* Kill Switch Alert Banner */}
      {data.killSwitch && (
        <AlertBanner
          variant="danger"
          title="KILL SWITCH IS ACTIVE"
          description="All outbound emails are suspended immediately. Even approved applications will not be sent."
          action={
            <Button
              variant="destructive"
              size="sm"
              loading={actionLoading}
              onClick={() => {
                setTargetKsState(false);
                setShowKsModal(true);
              }}
            >
              Turn Off Kill Switch
            </Button>
          }
        />
      )}

      {/* Auth Health Banner */}
      <AlertBanner
        variant={isAuthInvalid ? 'danger' : 'ok'}
        title={`Google Auth Health: ${isAuthInvalid ? 'Action Required' : 'Connected & Healthy'}`}
        description={
          isAuthInvalid
            ? `Auth error: ${data.authHealth?.reason || 'OAuth token revoked or expired'}. Mail sending and Sheet sync are paused.`
            : 'Gmail API and Google Sheets tokens are active with automatic refresh.'
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            {!isAuthInvalid && (
              <Button
                variant="primary"
                size="sm"
                icon={Mail}
                loading={syncingGmail}
                onClick={() => void handleSyncGmailAlerts()}
              >
                {syncingGmail ? 'Checking Gmail...' : 'Sync Alerts from Gmail'}
              </Button>
            )}
            <a
              href={getGoogleAuthStartUrl(apiBase)}
              className={`inline-flex items-center justify-center font-medium rounded-[6px] h-7 px-2.5 text-[13px] transition-colors ${
                isAuthInvalid
                  ? 'bg-state-danger-bg text-state-danger-fg border border-state-danger-border hover:opacity-90'
                  : 'bg-surface text-fg border border-border hover:bg-surface-subtle'
              }`}
            >
              {isAuthInvalid ? 'Reconnect Google Account' : 'Re-authenticate Google'}
            </a>
          </div>
        }
      />

      {gmailSyncResult && (
        <div className="p-3 bg-surface border border-accent/40 rounded-[6px] text-[13px] text-fg flex items-center justify-between">
          <span>{gmailSyncResult}</span>
          <button
            type="button"
            onClick={() => setGmailSyncResult(null)}
            className="text-fg-muted hover:text-fg text-[12px] ml-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Key Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Sends Today vs Cap */}
        <MetricCard
          label="Today's Sends"
          value={
            <span className="flex items-baseline gap-1.5">
              <span>{data.sendsToday}</span>
              <span className="text-[14px] font-normal text-fg-muted font-sans">
                / {data.effectiveCap} cap
              </span>
            </span>
          }
          caption={`Profile base cap: ${data.dailyCap} (ramp/brake effective: ${data.effectiveCap})`}
        />

        {/* Bounce Rate */}
        <MetricCard
          label="Bounce Rate"
          value={
            <span className={data.bounceRate > 10 ? 'text-state-danger-fg' : 'text-fg'}>
              {data.bounceRate}%
            </span>
          }
          caption={
            data.bounceRate > 10
              ? 'Warning: Bounce brake halves sending cap when >10%'
              : 'Within safe delivery limits (<10%)'
          }
        />

        {/* 24h Failure Rate */}
        <MetricCard
          label="24h Failure Rate"
          value={
            <span className={data.failureRate > 20 ? 'text-state-danger-fg' : 'text-fg'}>
              {data.failureRate}%
            </span>
          }
          caption={
            data.failureRate > 20
              ? 'Telegram alert triggers when send failure rate >20%'
              : 'Normal system operation'
          }
        />

        {/* Manual Queue */}
        <div className="bg-surface border border-border rounded-[6px] p-4 flex flex-col justify-between">
          <div className="text-[12px] font-medium uppercase tracking-wider text-fg-muted">
            Manual Queue
          </div>
          <div className="mt-2 text-[24px] font-semibold font-mono tabular-nums text-fg flex items-baseline gap-1.5">
            <span>{data.manualWaitingCount}</span>
            <span className="text-[14px] font-normal text-fg-muted font-sans">waiting</span>
          </div>
          <button
            onClick={() => onNavigateTab?.('manual-apply')}
            className="mt-2 text-[12px] font-medium text-accent hover:underline cursor-pointer inline-flex items-center gap-1 self-start"
          >
            <span>Open Manual Apply Queue</span>
            <ArrowRight size={12} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Operations Controls */}
      <div className="bg-surface p-4 sm:p-5 rounded-[6px] border border-border">
        <h3 className="text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-4">
          Operations Controls
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          {/* DRY_RUN toggle row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-surface-subtle rounded-[6px] border border-border-subtle">
            <div>
              <span className="font-semibold text-[14px] text-fg block">DRY_RUN Mode</span>
              <p className="text-[12px] text-fg-muted mt-0.5">
                {data.dryRun
                  ? 'Active: Outgoing emails are simulated and not sent to recipients'
                  : 'Live: Real emails are transmitted via Gmail API'}
              </p>
            </div>
            <Button
              variant={data.dryRun ? 'secondary' : 'primary'}
              size="sm"
              loading={actionLoading}
              className="self-start sm:self-auto shrink-0"
              onClick={() => {
                if (data.dryRun) {
                  setShowDryRunModal(true);
                } else {
                  void handleToggleDryRun(true);
                }
              }}
            >
              {data.dryRun ? 'DRY RUN: ON' : 'LIVE SENDING: ON'}
            </Button>
          </div>

          {/* Kill Switch Toggle row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-surface-subtle rounded-[6px] border border-border-subtle">
            <div>
              <span className="font-semibold text-[14px] text-fg block">Kill Switch</span>
              <p className="text-[12px] text-fg-muted mt-0.5">
                {data.killSwitch
                  ? 'Active: All sends blocked immediately'
                  : 'Standby: Send workers operate according to profile settings'}
              </p>
            </div>
            <Button
              variant={data.killSwitch ? 'destructive' : 'secondary'}
              size="sm"
              loading={actionLoading}
              className="self-start sm:self-auto shrink-0"
              onClick={() => {
                setTargetKsState(!data.killSwitch);
                setShowKsModal(true);
              }}
            >
              {data.killSwitch ? 'KILL SWITCH: ACTIVE' : 'KILL SWITCH: OFF'}
            </Button>
          </div>
        </div>
      </div>

      {/* Scheduled Cron Jobs */}
      <div className="bg-surface p-4 sm:p-5 rounded-[6px] border border-border">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Clock size={16} strokeWidth={1.5} className="text-fg-muted shrink-0" aria-hidden="true" />
            <h3 className="text-[12px] font-medium uppercase tracking-wider text-fg-muted">
              Scheduled Cron Jobs (Cloudflare Workers)
            </h3>
          </div>
          <span className="text-[11px] text-fg-muted font-mono bg-surface-subtle px-2 py-0.5 rounded border border-border">
            3 active triggers
          </span>
        </div>

        {cronFeedback && (
          <div
            role="status"
            className={`mb-3 p-2.5 rounded-[6px] border text-[12px] flex items-center justify-between gap-2 ${
              cronFeedback.ok
                ? 'bg-surface border-accent/40 text-fg'
                : 'bg-state-danger-bg border-state-danger-border text-state-danger-fg'
            }`}
          >
            <span>{cronFeedback.message}</span>
            <button
              type="button"
              onClick={() => setCronFeedback(null)}
              className="text-fg-muted hover:text-fg text-[11px] shrink-0 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {(data.cronJobs || [
            {
              id: 'ingest',
              name: 'Job Ingestion',
              cron: '0 */3 * * *',
              schedule: 'Every 3 hours',
              description: 'Fetches active ATS & job boards, purges stale records',
              lastRunAt: null,
            },
            {
              id: 'score',
              name: 'Scoring & Pipeline',
              cron: '*/10 * * * *',
              schedule: 'Every 10 minutes',
              description: 'Evaluates new jobs with LLM & syncs Google Sheets',
              lastRunAt: null,
            },
            {
              id: 'inbox',
              name: 'Inbox & Health',
              cron: '*/15 * * * *',
              schedule: 'Every 15 minutes',
              description: 'Polls Gmail for employer replies & verifies auth',
              lastRunAt: null,
            },
          ]).map((job) => (
            <div
              key={job.id}
              className="p-3.5 rounded-[6px] border border-border bg-surface-subtle/40 flex flex-col justify-between space-y-2.5"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-[13px] text-fg">{job.name}</span>
                  <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-surface border border-border text-fg-muted">
                    {job.cron}
                  </span>
                </div>
                <p className="text-[12px] text-fg-muted mt-1 leading-snug">{job.description}</p>
              </div>

              <div className="pt-2 border-t border-border/60 flex items-center justify-between gap-2 text-[12px]">
                <div>
                  <span className="text-fg-muted block">{job.schedule}</span>
                  <div
                    className="flex items-center gap-1.5 mt-0.5"
                    title={job.lastRunAt ? new Date(job.lastRunAt).toLocaleString() : undefined}
                  >
                    <span
                      className={`inline-block w-1.5 h-1.5 rounded-full ${
                        job.lastRunAt ? 'bg-state-ok-fg' : 'bg-fg-muted/40'
                      }`}
                      aria-hidden="true"
                    />
                    <span className="font-medium font-mono text-fg text-[11px]">
                      {formatRelativeTime(job.lastRunAt)}
                    </span>
                    {job.lastRunAt && (
                      <span className="text-[10px] text-fg-muted font-mono">
                        ·{' '}
                        {new Date(job.lastRunAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="xs"
                  icon={Play}
                  loading={Boolean(runningCronIds[job.id])}
                  disabled={Boolean(runningCronIds[job.id])}
                  onClick={() => void handleRunCron(job.id, job.name)}
                  aria-label={`Run ${job.name} now`}
                  data-testid={`run-cron-${job.id}`}
                >
                  {runningCronIds[job.id] ? 'Running...' : 'Run Now'}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Jobs by Status & Jobs by Route */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        {/* Jobs by Status */}
        <div className="bg-surface p-5 rounded-[6px] border border-border">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h3 className="text-[12px] font-medium uppercase tracking-wider text-fg-muted">
              Jobs by Status
            </h3>
            {data.jobsByStatus['new'] ? (
              <Button
                variant="secondary"
                size="xs"
                loading={pipelineRunning}
                onClick={() => void handleRunPipeline()}
              >
                Score New Jobs ({data.jobsByStatus['new']})
              </Button>
            ) : null}
          </div>
          {pipelineResult && (
            <div className="mb-3 p-2.5 rounded-[4px] bg-surface-subtle border border-border text-[12px] text-fg">
              {pipelineResult}
            </div>
          )}
          <div className="space-y-1.5">
            {Object.keys(data.jobsByStatus).length === 0 ? (
              <p className="text-[13px] text-fg-muted py-2">No jobs ingested yet.</p>
            ) : (
              Object.entries(data.jobsByStatus).map(([status, count]) => (
                <div
                  key={status}
                  className="flex items-center justify-between py-1.5 px-3 bg-surface-subtle rounded-[4px] text-[13px]"
                >
                  <span className="font-mono text-fg">{status}</span>
                  <span className="font-mono font-semibold tabular-nums text-fg">{count}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Jobs by Route */}
        <div className="bg-surface p-5 rounded-[6px] border border-border">
          <h3 className="text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-3">
            Jobs by Apply Route
          </h3>
          <div className="space-y-1.5">
            {Object.keys(data.jobsByRoute).length === 0 ? (
              <p className="text-[13px] text-fg-muted py-2">No routed jobs yet.</p>
            ) : (
              Object.entries(data.jobsByRoute).map(([route, count]) => (
                <div
                  key={route}
                  className="flex items-center justify-between py-1.5 px-3 bg-surface-subtle rounded-[4px] text-[13px]"
                >
                  <span className="font-mono text-fg">{route}</span>
                  <span className="font-mono font-semibold tabular-nums text-fg">{count}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Kill Switch Confirmation Modal */}
      <ConfirmationModal
        isOpen={showKsModal}
        title={targetKsState ? 'Activate Kill Switch?' : 'Deactivate Kill Switch?'}
        message={
          targetKsState
            ? 'Activating the Kill Switch will immediately stop ALL outgoing application emails. Even drafts approved by you will remain on hold until the Kill Switch is turned off.'
            : 'Deactivating the Kill Switch will resume normal email dispatch during scheduled send windows for any approved applications.'
        }
        confirmLabel={targetKsState ? 'Yes, Activate Kill Switch' : 'Resume Sending'}
        isDanger={targetKsState}
        onConfirm={() => void handleToggleKillSwitch(targetKsState)}
        onCancel={() => setShowKsModal(false)}
      />

      {/* DRY_RUN Live Mode Confirmation Modal */}
      <ConfirmationModal
        isOpen={showDryRunModal}
        title="Switch to LIVE Sending Mode?"
        message="Disabling DRY_RUN will activate live email sending. Outgoing applications will be transmitted directly to employer inboxes via Gmail API. Are you sure you want to proceed?"
        confirmLabel="Switch to LIVE"
        isDanger={true}
        onConfirm={() => {
          setShowDryRunModal(false);
          void handleToggleDryRun(false, true);
        }}
        onCancel={() => setShowDryRunModal(false)}
      />
    </div>
  );
}
