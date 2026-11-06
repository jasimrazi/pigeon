import React, { useState, useEffect, useCallback } from 'react';
import { ConfirmationModal } from './ConfirmationModal.js';

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
    status: 'ok' | 'invalid';
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
      <div className="flex items-center justify-center py-20 text-gray-500 text-sm">
        <span className="animate-spin mr-2">🔄</span> Loading system overview...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm">
        <strong>Error:</strong> {error || 'Failed to load system metrics.'}
        <button
          onClick={() => void loadOverview()}
          className="ml-4 underline font-medium hover:text-rose-900 cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  const isAuthInvalid = data.authHealth.status !== 'ok';

  return (
    <div className="space-y-6">
      {/* Kill Switch Alert Banner */}
      {data.killSwitch && (
        <div className="p-4 bg-rose-600 text-white rounded-xl shadow-sm flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="text-2xl">🚨</span>
            <div>
              <h2 className="font-bold text-base">KILL SWITCH IS ACTIVE</h2>
              <p className="text-xs text-rose-100">
                All outbound emails are suspended immediately. Even approved applications will not
                be sent.
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              setTargetKsState(false);
              setShowKsModal(true);
            }}
            disabled={actionLoading}
            className="px-3.5 py-1.5 bg-white text-rose-700 font-semibold text-xs rounded-lg shadow-sm hover:bg-rose-50 cursor-pointer transition-colors"
          >
            Turn Off Kill Switch
          </button>
        </div>
      )}

      {/* Auth Health Banner */}
      <div
        className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm ${
          isAuthInvalid
            ? 'bg-amber-50 border-amber-300 text-amber-900'
            : 'bg-emerald-50 border-emerald-200 text-emerald-900'
        }`}
      >
        <div className="flex items-center space-x-3">
          <span className="text-2xl">{isAuthInvalid ? '⚠️' : '✅'}</span>
          <div>
            <h3 className="font-semibold text-sm">
              Google Auth Health: {isAuthInvalid ? 'Action Required' : 'Connected & Healthy'}
            </h3>
            <p className="text-xs mt-0.5 text-gray-600">
              {isAuthInvalid
                ? `Auth error: ${data.authHealth.reason || 'OAuth token revoked or expired'}. Mail sending and Sheet sync are paused.`
                : 'Gmail API and Google Sheets tokens are active with automatic refresh.'}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <a
            href={`${apiBase}/auth/google/start`}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-colors cursor-pointer inline-flex items-center ${
              isAuthInvalid
                ? 'bg-amber-600 hover:bg-amber-700 text-white'
                : 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-200'
            }`}
          >
            {isAuthInvalid ? 'Reconnect Google Account' : 'Re-authenticate Google'}
          </a>
        </div>
      </div>

      {/* Key Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Sends Today vs Cap */}
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between text-gray-500 text-xs font-semibold uppercase tracking-wider">
            <span>Today's Sends</span>
            <span>✉️</span>
          </div>
          <div className="mt-2 flex items-baseline space-x-2">
            <span className="text-3xl font-bold text-gray-900">{data.sendsToday}</span>
            <span className="text-sm text-gray-500">/ {data.effectiveCap} cap</span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Profile base cap: {data.dailyCap} (ramp/brake effective: {data.effectiveCap})
          </p>
        </div>

        {/* Bounce Rate */}
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between text-gray-500 text-xs font-semibold uppercase tracking-wider">
            <span>Bounce Rate</span>
            <span>📉</span>
          </div>
          <div className="mt-2 flex items-baseline space-x-2">
            <span
              className={`text-3xl font-bold ${
                data.bounceRate > 10 ? 'text-rose-600' : 'text-gray-900'
              }`}
            >
              {data.bounceRate}%
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {data.bounceRate > 10
              ? 'Warning: Bounce brake halves sending cap when >10%'
              : 'Within safe delivery limits (<10%)'}
          </p>
        </div>

        {/* 24h Failure Rate */}
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between text-gray-500 text-xs font-semibold uppercase tracking-wider">
            <span>24h Failure Rate</span>
            <span>⚠️</span>
          </div>
          <div className="mt-2 flex items-baseline space-x-2">
            <span
              className={`text-3xl font-bold ${
                data.failureRate > 20 ? 'text-rose-600' : 'text-gray-900'
              }`}
            >
              {data.failureRate}%
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {data.failureRate > 20
              ? 'Telegram alert triggers when send failure rate >20%'
              : 'Normal system operation'}
          </p>
        </div>

        {/* Manual Items Waiting */}
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between text-gray-500 text-xs font-semibold uppercase tracking-wider">
            <span>Manual Queue</span>
            <span>📝</span>
          </div>
          <div className="mt-2 flex items-baseline space-x-2">
            <span className="text-3xl font-bold text-gray-900">{data.manualWaitingCount}</span>
            <span className="text-sm text-gray-500">waiting</span>
          </div>
          <button
            onClick={() => onNavigateTab?.('manual-apply')}
            className="mt-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 cursor-pointer"
          >
            Open Manual Apply Queue &rarr;
          </button>
        </div>
      </div>

      {/* Control Switches Card */}
      <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
        <h3 className="text-sm font-bold text-gray-900 mb-4 flex items-center space-x-2">
          <span>⚙️</span>
          <span>Operations Controls</span>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* DRY_RUN toggle */}
          <div className="flex items-center justify-between p-3.5 bg-gray-50 rounded-lg border border-gray-100">
            <div>
              <span className="font-semibold text-sm text-gray-800">DRY_RUN Mode</span>
              <p className="text-xs text-gray-500">
                {data.dryRun
                  ? 'Active: Outgoing emails are simulated and not sent to recipients'
                  : 'Live: Real emails are transmitted via Gmail API'}
              </p>
            </div>
            <button
              onClick={() => {
                if (data.dryRun) {
                  setShowDryRunModal(true);
                } else {
                  void handleToggleDryRun(true);
                }
              }}
              disabled={actionLoading}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                data.dryRun
                  ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                  : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
              }`}
            >
              {data.dryRun ? 'DRY RUN: ON' : 'LIVE SENDING: ON'}
            </button>
          </div>

          {/* Kill Switch Toggle */}
          <div className="flex items-center justify-between p-3.5 bg-gray-50 rounded-lg border border-gray-100">
            <div>
              <span className="font-semibold text-sm text-gray-800">Kill Switch</span>
              <p className="text-xs text-gray-500">
                {data.killSwitch
                  ? 'Active: All sends blocked immediately'
                  : 'Standby: Send workers operate according to profile settings'}
              </p>
            </div>
            <button
              onClick={() => {
                setTargetKsState(!data.killSwitch);
                setShowKsModal(true);
              }}
              disabled={actionLoading}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                data.killSwitch
                  ? 'bg-rose-600 text-white hover:bg-rose-700'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              {data.killSwitch ? 'KILL SWITCH: ACTIVE' : 'KILL SWITCH: OFF'}
            </button>
          </div>
        </div>
      </div>

      {/* Jobs by Status & Jobs by Route */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Jobs by Status */}
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
          <h3 className="text-sm font-bold text-gray-900 mb-3">Jobs by Status</h3>
          <div className="space-y-2">
            {Object.keys(data.jobsByStatus).length === 0 ? (
              <p className="text-xs text-gray-400">No jobs ingested yet.</p>
            ) : (
              Object.entries(data.jobsByStatus).map(([status, count]) => (
                <div
                  key={status}
                  className="flex items-center justify-between py-1.5 px-3 bg-gray-50 rounded-lg text-xs"
                >
                  <span className="font-mono text-gray-700">{status}</span>
                  <span className="font-bold text-gray-900">{count}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Jobs by Route */}
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
          <h3 className="text-sm font-bold text-gray-900 mb-3">Jobs by Apply Route</h3>
          <div className="space-y-2">
            {Object.keys(data.jobsByRoute).length === 0 ? (
              <p className="text-xs text-gray-400">No routed jobs yet.</p>
            ) : (
              Object.entries(data.jobsByRoute).map(([route, count]) => (
                <div
                  key={route}
                  className="flex items-center justify-between py-1.5 px-3 bg-gray-50 rounded-lg text-xs"
                >
                  <span className="font-mono text-gray-700">{route}</span>
                  <span className="font-bold text-gray-900">{count}</span>
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
