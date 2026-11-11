import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, ArrowRight } from 'lucide-react';
import { ConfirmationModal } from './ConfirmationModal.js';
import { AlertBanner } from './ui/AlertBanner.js';
import { MetricCard } from './ui/MetricCard.js';
import { Button } from './ui/Button.js';

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

  const loadOverview = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${apiBase}/api/overview`);
      if (!res.ok) {
        throw new Error(`Failed to load overview (${res.status})`);
      }
      const json = (await res.json()) as OverviewData;
      setData(json);

      // Check setup status
      try {
        const setupRes = await fetch(`${apiBase}/api/setup/status`);
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

  const handleToggleKillSwitch = async (activate: boolean) => {
    try {
      setActionLoading(true);
      const res = await fetch(`${apiBase}/api/settings/kill-switch`, {
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
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(false);
      setShowKsModal(false);
    }
  };

  const handleToggleDryRun = async (dryRun: boolean, confirmed = false) => {
    try {
      setActionLoading(true);
      const res = await fetch(`${apiBase}/api/settings/dry-run`, {
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
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(false);
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
          description="Pigeon requires basic configuration (master encryption key, candidate profile, and LLM provider) before running simulations or processing applications."
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
          <a
            href={`${apiBase}/auth/google/start`}
            className={`inline-flex items-center justify-center font-medium rounded-[6px] h-7 px-2.5 text-[13px] transition-colors ${
              isAuthInvalid
                ? 'bg-state-danger-bg text-state-danger-fg border border-state-danger-border hover:opacity-90'
                : 'bg-surface text-fg border border-border hover:bg-surface-subtle'
            }`}
          >
            {isAuthInvalid ? 'Reconnect Google Account' : 'Re-authenticate Google'}
          </a>
        }
      />

      {/* Key Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
      <div className="bg-surface p-5 rounded-[6px] border border-border">
        <h3 className="text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-4">
          Operations Controls
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* DRY_RUN toggle row */}
          <div className="flex items-center justify-between p-3.5 bg-surface-subtle rounded-[6px] border border-border-subtle">
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
          <div className="flex items-center justify-between p-3.5 bg-surface-subtle rounded-[6px] border border-border-subtle">
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

      {/* Jobs by Status & Jobs by Route */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Jobs by Status */}
        <div className="bg-surface p-5 rounded-[6px] border border-border">
          <h3 className="text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-3">
            Jobs by Status
          </h3>
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
