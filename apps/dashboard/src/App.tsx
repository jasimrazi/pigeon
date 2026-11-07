import React, { useState, useEffect, useCallback } from 'react';
import { OverviewView } from './components/OverviewView.js';
import { ReviewQueueView } from './components/ReviewQueueView.js';
import { ManualQueueView } from './components/ManualQueueView.js';
import { ApplicationsView } from './components/ApplicationsView.js';
import { SourcesView } from './components/SourcesView.js';
import { SettingsView } from './components/SettingsView.js';
import { EventsView } from './components/EventsView.js';
import { ConfirmationModal } from './components/ConfirmationModal.js';

export type TabKey =
  'overview' | 'review-queue' | 'manual-apply' | 'applications' | 'sources' | 'settings' | 'events';

export function App(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [headerState, setHeaderState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [killSwitch, setKillSwitch] = useState<boolean | null>(null);
  const [dryRun, setDryRun] = useState<boolean | null>(null);
  const [authHealth, setAuthHealth] = useState<'ok' | 'invalid' | 'unknown' | null>(null);
  const [showKsModal, setShowKsModal] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const loadHeaderStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/overview');
      if (res.ok) {
        const data = (await res.json()) as {
          killSwitch?: boolean;
          dryRun?: boolean;
          authHealth?: { status: 'ok' | 'invalid' | 'unknown' };
        };
        if (typeof data.killSwitch === 'boolean') setKillSwitch(data.killSwitch);
        if (typeof data.dryRun === 'boolean') setDryRun(data.dryRun);
        if (data.authHealth?.status === 'ok') {
          setAuthHealth('ok');
        } else if (data.authHealth?.status === 'invalid') {
          setAuthHealth('invalid');
        } else {
          setAuthHealth('unknown');
        }
        setHeaderState('ready');
      } else {
        setHeaderState('error');
      }
    } catch {
      setHeaderState('error');
    }
  }, []);

  useEffect(() => {
    void loadHeaderStatus();
  }, [loadHeaderStatus, refreshTrigger]);

  const handleToggleKillSwitch = async (activate: boolean) => {
    try {
      const res = await fetch('/api/settings/kill-switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kill_switch: activate, confirmed: true }),
      });
      if (!res.ok) {
        throw new Error('Failed to toggle Kill Switch');
      }
      setKillSwitch(activate);
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setShowKsModal(false);
    }
  };

  const navItems: Array<{ key: TabKey; label: string; icon: string }> = [
    { key: 'overview', label: 'Overview', icon: '📊' },
    { key: 'review-queue', label: 'Review Queue', icon: '📫' },
    { key: 'manual-apply', label: 'Manual Apply', icon: '✍️' },
    { key: 'applications', label: 'Applications', icon: '🗂️' },
    { key: 'sources', label: 'Sources', icon: '🔌' },
    { key: 'settings', label: 'Settings', icon: '⚙️' },
    { key: 'events', label: 'Events', icon: '📜' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 text-gray-900">
      {/* Top Header */}
      <header className="border-b bg-white shadow-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
          <div className="flex items-center space-x-6">
            <button
              onClick={() => setActiveTab('overview')}
              className="flex items-center space-x-2.5 cursor-pointer text-left focus:outline-none"
            >
              <span className="text-2xl">🕊️</span>
              <span className="text-lg font-black tracking-tight text-gray-900">Pigeon</span>
            </button>

            {/* Navigation Tabs (Desktop) */}
            <nav className="hidden md:flex items-center space-x-1">
              {navItems.map((item) => {
                const isActive = activeTab === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => setActiveTab(item.key)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center space-x-1.5 ${
                      isActive
                        ? 'bg-gray-100 text-indigo-700'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                  >
                    <span>{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Right Header Status Indicators */}
          <div className="flex items-center space-x-2.5">
            {headerState === 'loading' ? (
              <>
                <span
                  data-testid="badge-google-loading"
                  className="hidden sm:inline-flex px-2.5 py-1 text-[11px] font-semibold rounded-full bg-gray-100 text-gray-500 border border-gray-200"
                  title="Checking Google OAuth status..."
                >
                  ⚪ Google: Loading...
                </span>
                <span
                  data-testid="badge-dryrun-loading"
                  className="px-2.5 py-1 text-[11px] font-bold rounded-full bg-gray-100 text-gray-500 border border-gray-200"
                  title="Checking DRY_RUN mode..."
                >
                  DRY_RUN: Loading...
                </span>
                <button
                  type="button"
                  disabled
                  data-testid="badge-killswitch-loading"
                  className="px-2.5 py-1 text-[11px] font-bold rounded-full bg-gray-100 text-gray-500 border border-gray-200 cursor-not-allowed"
                  title="Checking Kill Switch status from KV..."
                >
                  Kill Switch: unknown
                </button>
              </>
            ) : headerState === 'error' ? (
              <>
                <span
                  data-testid="badge-google-error"
                  className="hidden sm:inline-flex px-2.5 py-1 text-[11px] font-semibold rounded-full bg-rose-50 text-rose-700 border border-rose-200"
                  title="Backend API is unreachable"
                >
                  ⚠️ Google: API unreachable
                </span>
                <span
                  data-testid="badge-dryrun-error"
                  className="px-2.5 py-1 text-[11px] font-bold rounded-full bg-rose-50 text-rose-700 border border-rose-200"
                  title="Backend API is unreachable"
                >
                  DRY_RUN: API unreachable
                </span>
                <button
                  type="button"
                  disabled
                  data-testid="badge-killswitch-error"
                  className="px-2.5 py-1 text-[11px] font-bold rounded-full bg-rose-50 text-rose-700 border border-rose-200 cursor-not-allowed"
                  title="Backend API is unreachable"
                >
                  Kill Switch: API unreachable
                </button>
              </>
            ) : (
              <>
                {/* Google Auth Status Badge */}
                {authHealth === 'ok' ? (
                  <span
                    data-testid="badge-google-ok"
                    className="hidden sm:inline-flex px-2.5 py-1 text-[11px] font-semibold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200"
                    title="Google OAuth token healthy"
                  >
                    ✅ Google OK
                  </span>
                ) : authHealth === 'invalid' ? (
                  <a
                    href="/auth/google/start"
                    data-testid="badge-google-invalid"
                    className="px-2.5 py-1 text-[11px] font-bold rounded-full bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition-colors"
                    title="Google OAuth expired or revoked. Click to reconnect."
                  >
                    Google: reconnect
                  </a>
                ) : (
                  <a
                    href="/auth/google/start"
                    data-testid="badge-google-unknown"
                    className="hidden sm:inline-flex px-2.5 py-1 text-[11px] font-semibold rounded-full bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200 transition-colors"
                    title="Google OAuth not connected. Click to authenticate."
                  >
                    Google: not connected
                  </a>
                )}

                {/* DRY RUN Badge */}
                <span
                  className={`px-2.5 py-1 text-[11px] font-bold rounded-full border ${
                    dryRun
                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                      : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  }`}
                >
                  {dryRun ? 'DRY_RUN' : 'LIVE'}
                </span>

                {/* Kill Switch Toggle Button */}
                <button
                  type="button"
                  onClick={() => setShowKsModal(true)}
                  data-testid={killSwitch ? 'badge-killswitch-active' : 'badge-killswitch-off'}
                  className={`px-2.5 py-1 text-[11px] font-bold rounded-full border shadow-xs cursor-pointer transition-colors ${
                    killSwitch
                      ? 'bg-rose-600 text-white border-rose-700 animate-pulse'
                      : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200'
                  }`}
                >
                  {killSwitch ? '🚨 KILL SWITCH ON' : '🛡️ Kill Switch Off'}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Mobile Navigation Tabs */}
        <div className="md:hidden flex overflow-x-auto border-t px-2 py-1 space-x-1">
          {navItems.map((item) => {
            const isActive = activeTab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setActiveTab(item.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                  isActive ? 'bg-gray-100 text-indigo-700' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {item.icon} {item.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 p-4 sm:p-6 max-w-7xl mx-auto w-full">
        {activeTab === 'overview' && (
          <OverviewView
            onNavigateTab={(tab) => setActiveTab(tab as TabKey)}
            onDataRefresh={() => setRefreshTrigger((prev) => prev + 1)}
          />
        )}
        {activeTab === 'review-queue' && (
          <ReviewQueueView onActionComplete={() => setRefreshTrigger((prev) => prev + 1)} />
        )}
        {activeTab === 'manual-apply' && <ManualQueueView />}
        {activeTab === 'applications' && <ApplicationsView />}
        {activeTab === 'sources' && <SourcesView />}
        {activeTab === 'settings' && (
          <SettingsView onRefresh={() => setRefreshTrigger((prev) => prev + 1)} />
        )}
        {activeTab === 'events' && <EventsView />}
      </main>

      {/* Header Kill Switch Confirmation Modal */}
      <ConfirmationModal
        isOpen={showKsModal}
        title={killSwitch ? 'Deactivate Kill Switch?' : 'Activate Kill Switch?'}
        message={
          killSwitch
            ? 'Deactivating the Kill Switch will allow scheduled email sending to resume for approved applications.'
            : 'Activating the Kill Switch immediately stops all email dispatch. Even approved drafts will remain in queue.'
        }
        confirmLabel={killSwitch ? 'Resume Sending' : 'Yes, Activate Kill Switch'}
        isDanger={!killSwitch}
        onConfirm={() => void handleToggleKillSwitch(!killSwitch)}
        onCancel={() => setShowKsModal(false)}
      />
    </div>
  );
}

export default App;
