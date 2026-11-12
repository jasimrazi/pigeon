import React, { useState, useEffect, useCallback } from 'react';
import {
  Bird,
  Mail,
  Send,
  Layers,
  MoreHorizontal,
  Radio,
  Sliders,
  History,
  ShieldCheck,
  X,
} from 'lucide-react';
import { OverviewView } from './components/OverviewView.js';
import { ReviewQueueView } from './components/ReviewQueueView.js';
import { ManualQueueView } from './components/ManualQueueView.js';
import { ApplicationsView } from './components/ApplicationsView.js';
import { SourcesView } from './components/SourcesView.js';
import { SettingsView, type SettingsSubTab } from './components/SettingsView.js';
import { EventsView } from './components/EventsView.js';
import { SetupView } from './components/SetupView.js';
import { ConfirmationModal } from './components/ConfirmationModal.js';

export type TabKey =
  | 'overview'
  | 'review-queue'
  | 'manual-apply'
  | 'applications'
  | 'sources'
  | 'settings'
  | 'events'
  | 'setup';

export function App(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    if (typeof window !== 'undefined' && window.location.pathname === '/setup') {
      return 'setup';
    }
    return 'overview';
  });
  const [settingsSubTab, setSettingsSubTab] = useState<SettingsSubTab>('profile');
  const [headerState, setHeaderState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [killSwitch, setKillSwitch] = useState<boolean | null>(null);
  const [dryRun, setDryRun] = useState<boolean | null>(null);
  const [authHealth, setAuthHealth] = useState<'ok' | 'invalid' | 'unknown' | null>(null);
  const [showKsModal, setShowKsModal] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isMoreActive =
    mobileMenuOpen ||
    activeTab === 'sources' ||
    activeTab === 'settings' ||
    activeTab === 'events' ||
    activeTab === 'setup';

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

  const navItems: Array<{ key: TabKey; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'review-queue', label: 'Review Queue' },
    { key: 'manual-apply', label: 'Manual Apply' },
    { key: 'applications', label: 'Applications' },
    { key: 'sources', label: 'Sources' },
    { key: 'settings', label: 'Settings' },
    { key: 'events', label: 'Events' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-canvas text-fg">
      {/* Top Header */}
      <header className="border-b border-border bg-surface sticky top-0 z-40">
        <div className="max-w-[1200px] mx-auto px-3 sm:px-6 flex items-center justify-between h-14">
          <div className="flex items-center gap-6">
            <button
              onClick={() => setActiveTab('overview')}
              className="flex items-center gap-2 cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-[4px]"
            >
              <Bird size={18} strokeWidth={1.5} className="text-fg shrink-0" aria-hidden="true" />
              <span className="text-[16px] font-semibold tracking-tight text-fg">Pigeon</span>
            </button>

            {/* Navigation Tabs (Desktop: text-only, 2px underline active indicator) */}
            <nav className="hidden md:flex items-center gap-1 h-14">
              {navItems.map((item) => {
                const isActive = activeTab === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => setActiveTab(item.key)}
                    className={`h-full px-3 text-[13px] font-medium transition-colors cursor-pointer border-b-2 flex items-center ${
                      isActive
                        ? 'border-accent text-fg bg-surface-subtle/50'
                        : 'border-transparent text-fg-muted hover:text-fg hover:bg-surface-subtle/30'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Right Header Status Indicators (Compact Dot + Label Chips) */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {headerState === 'loading' ? (
              <>
                <span
                  data-testid="badge-google-loading"
                  className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 text-[12px] font-medium rounded-[4px] border border-border bg-surface-subtle text-fg-muted"
                  title="Checking Google OAuth status..."
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-state-unknown-fg shrink-0"
                    aria-hidden="true"
                  />
                  Google: Loading...
                </span>
                <span
                  data-testid="badge-dryrun-loading"
                  className="inline-flex items-center gap-1.5 px-1.5 sm:px-2 py-0.5 text-[11px] sm:text-[12px] font-medium rounded-[4px] border border-border bg-surface-subtle text-fg-muted shrink-0"
                  title="Checking DRY_RUN mode..."
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-state-unknown-fg shrink-0"
                    aria-hidden="true"
                  />
                  DRY_RUN: Loading...
                </span>
                <button
                  type="button"
                  disabled
                  data-testid="badge-killswitch-loading"
                  className="inline-flex items-center gap-1.5 px-1.5 sm:px-2 py-0.5 text-[11px] sm:text-[12px] font-medium rounded-[4px] border border-border bg-surface-subtle text-fg-muted cursor-not-allowed shrink-0"
                  title="Checking Kill Switch status from KV..."
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-state-unknown-fg shrink-0"
                    aria-hidden="true"
                  />
                  Kill Switch: unknown
                </button>
              </>
            ) : headerState === 'error' ? (
              <>
                <span
                  data-testid="badge-google-error"
                  className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 text-[12px] font-medium rounded-[4px] border border-state-danger-border bg-state-danger-bg text-state-danger-fg"
                  title="Backend API is unreachable"
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-state-danger-fg shrink-0"
                    aria-hidden="true"
                  />
                  Google: API unreachable
                </span>
                <span
                  data-testid="badge-dryrun-error"
                  className="inline-flex items-center gap-1.5 px-1.5 sm:px-2 py-0.5 text-[11px] sm:text-[12px] font-medium rounded-[4px] border border-state-danger-border bg-state-danger-bg text-state-danger-fg shrink-0"
                  title="Backend API is unreachable"
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-state-danger-fg shrink-0"
                    aria-hidden="true"
                  />
                  DRY_RUN: API unreachable
                </span>
                <button
                  type="button"
                  disabled
                  data-testid="badge-killswitch-error"
                  className="inline-flex items-center gap-1.5 px-1.5 sm:px-2 py-0.5 text-[11px] sm:text-[12px] font-medium rounded-[4px] border border-state-danger-border bg-state-danger-bg text-state-danger-fg cursor-not-allowed shrink-0"
                  title="Backend API is unreachable"
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-state-danger-fg shrink-0"
                    aria-hidden="true"
                  />
                  Kill Switch: API unreachable
                </button>
              </>
            ) : (
              <>
                {/* Google Auth Status Chip */}
                {authHealth === 'ok' ? (
                  <span
                    data-testid="badge-google-ok"
                    className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 text-[12px] font-medium rounded-[4px] border border-state-ok-border bg-state-ok-bg text-state-ok-fg"
                    title="Google OAuth token healthy"
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-state-ok-fg shrink-0"
                      aria-hidden="true"
                    />
                    Google OK
                  </span>
                ) : authHealth === 'invalid' ? (
                  <a
                    href="/auth/google/start"
                    data-testid="badge-google-invalid"
                    className="inline-flex items-center gap-1.5 px-1.5 sm:px-2 py-0.5 text-[11px] sm:text-[12px] font-medium rounded-[4px] border border-state-danger-border bg-state-danger-bg text-state-danger-fg hover:opacity-90 transition-opacity shrink-0"
                    title="Google OAuth expired or revoked. Click to reconnect."
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-state-danger-fg shrink-0"
                      aria-hidden="true"
                    />
                    Google: reconnect
                  </a>
                ) : (
                  <a
                    href="/auth/google/start"
                    data-testid="badge-google-unknown"
                    className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 text-[12px] font-medium rounded-[4px] border border-border bg-surface-subtle text-fg-muted hover:text-fg transition-colors"
                    title="Google OAuth not connected. Click to authenticate."
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-state-unknown-fg shrink-0"
                      aria-hidden="true"
                    />
                    Google: not connected
                  </a>
                )}

                {/* DRY RUN Status Chip */}
                <span
                  className={`inline-flex items-center gap-1.5 px-1.5 sm:px-2 py-0.5 text-[11px] sm:text-[12px] font-medium rounded-[4px] border shrink-0 ${
                    dryRun
                      ? 'border-state-warn-border bg-state-warn-bg text-state-warn-fg'
                      : 'border-state-ok-border bg-state-ok-bg text-state-ok-fg'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      dryRun ? 'bg-state-warn-fg' : 'bg-state-ok-fg'
                    }`}
                    aria-hidden="true"
                  />
                  {dryRun ? 'DRY_RUN' : 'LIVE'}
                </span>

                {/* Kill Switch Toggle Button */}
                <button
                  type="button"
                  onClick={() => setShowKsModal(true)}
                  data-testid={killSwitch ? 'badge-killswitch-active' : 'badge-killswitch-off'}
                  className={`inline-flex items-center gap-1.5 px-1.5 sm:px-2 py-0.5 text-[11px] sm:text-[12px] font-medium rounded-[4px] border cursor-pointer transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    killSwitch
                      ? 'border-state-danger-border bg-state-danger-bg text-state-danger-fg font-semibold'
                      : 'border-border bg-surface-subtle text-fg-muted hover:text-fg hover:bg-surface'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      killSwitch ? 'bg-state-danger-fg' : 'bg-state-unknown-fg'
                    }`}
                    aria-hidden="true"
                  />
                  {killSwitch ? 'KILL SWITCH ON' : 'Kill Switch Off'}
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main Operations Content Area */}
      <main className="flex-1 max-w-[1200px] mx-auto w-full px-3 sm:px-6 pt-4 sm:pt-6 pb-24 md:pb-6">
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
          <SettingsView
            initialSubTab={settingsSubTab}
            onSubTabChange={setSettingsSubTab}
            onRefresh={() => setRefreshTrigger((prev) => prev + 1)}
          />
        )}
        {activeTab === 'events' && <EventsView />}
        {activeTab === 'setup' && (
          <SetupView
            onNavigateTab={(tab, subTab) => {
              setActiveTab(tab as TabKey);
              if (subTab) {
                setSettingsSubTab(subTab as SettingsSubTab);
              }
            }}
          />
        )}
      </main>

      {/* Mobile App Fixed Bottom Navigation Bar */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-surface/95 backdrop-blur-md border-t border-border shadow-lg pb-[env(safe-area-inset-bottom)]"
      >
        <div className="grid grid-cols-5 h-14 max-w-[600px] mx-auto px-1">
          {/* 1. Overview */}
          <button
            type="button"
            onClick={() => {
              setActiveTab('overview');
              setMobileMenuOpen(false);
            }}
            className={`flex flex-col items-center justify-center gap-0.5 py-1 transition-colors cursor-pointer ${
              activeTab === 'overview'
                ? 'text-accent font-semibold'
                : 'text-fg-muted hover:text-fg'
            }`}
          >
            <Bird size={18} strokeWidth={activeTab === 'overview' ? 2 : 1.5} className="shrink-0" aria-hidden="true" />
            <span className="text-[10px] leading-tight font-medium">Overview</span>
          </button>

          {/* 2. Review Queue */}
          <button
            type="button"
            onClick={() => {
              setActiveTab('review-queue');
              setMobileMenuOpen(false);
            }}
            className={`flex flex-col items-center justify-center gap-0.5 py-1 transition-colors cursor-pointer ${
              activeTab === 'review-queue'
                ? 'text-accent font-semibold'
                : 'text-fg-muted hover:text-fg'
            }`}
          >
            <Mail size={18} strokeWidth={activeTab === 'review-queue' ? 2 : 1.5} className="shrink-0" aria-hidden="true" />
            <span className="text-[10px] leading-tight font-medium truncate max-w-full px-0.5">Review Queue</span>
          </button>

          {/* 3. Manual Apply */}
          <button
            type="button"
            onClick={() => {
              setActiveTab('manual-apply');
              setMobileMenuOpen(false);
            }}
            className={`flex flex-col items-center justify-center gap-0.5 py-1 transition-colors cursor-pointer ${
              activeTab === 'manual-apply'
                ? 'text-accent font-semibold'
                : 'text-fg-muted hover:text-fg'
            }`}
          >
            <Send size={18} strokeWidth={activeTab === 'manual-apply' ? 2 : 1.5} className="shrink-0" aria-hidden="true" />
            <span className="text-[10px] leading-tight font-medium truncate max-w-full px-0.5">Manual Apply</span>
          </button>

          {/* 4. Applications */}
          <button
            type="button"
            onClick={() => {
              setActiveTab('applications');
              setMobileMenuOpen(false);
            }}
            className={`flex flex-col items-center justify-center gap-0.5 py-1 transition-colors cursor-pointer ${
              activeTab === 'applications'
                ? 'text-accent font-semibold'
                : 'text-fg-muted hover:text-fg'
            }`}
          >
            <Layers size={18} strokeWidth={activeTab === 'applications' ? 2 : 1.5} className="shrink-0" aria-hidden="true" />
            <span className="text-[10px] leading-tight font-medium truncate max-w-full px-0.5">Applications</span>
          </button>

          {/* 5. More */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label="Toggle navigation menu"
            className={`flex flex-col items-center justify-center gap-0.5 py-1 transition-colors cursor-pointer ${
              isMoreActive
                ? 'text-accent font-semibold'
                : 'text-fg-muted hover:text-fg'
            }`}
          >
            <MoreHorizontal size={18} strokeWidth={isMoreActive ? 2 : 1.5} className="shrink-0" aria-hidden="true" />
            <span className="text-[10px] leading-tight font-medium">More</span>
          </button>
        </div>
      </nav>

      {/* Mobile Navigation Drawer / Sheet */}
      {mobileMenuOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="md:hidden fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-xs"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            className="bg-surface border-t border-border rounded-t-[16px] p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Bird size={18} strokeWidth={1.5} className="text-fg shrink-0" aria-hidden="true" />
                <span className="text-[15px] font-semibold text-fg">Pigeon Navigation</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1 rounded-[4px] text-fg-muted hover:text-fg hover:bg-surface-subtle cursor-pointer"
                aria-label="Close navigation menu"
              >
                <X size={18} strokeWidth={1.5} aria-hidden="true" />
              </button>
            </div>

            {/* Grid of All Destination Tabs */}
            <div className="grid grid-cols-2 gap-2.5">
              {navItems.map((item) => {
                const isActive = activeTab === item.key;
                const Icon =
                  item.key === 'overview'
                    ? Bird
                    : item.key === 'review-queue'
                      ? Mail
                      : item.key === 'manual-apply'
                        ? Send
                        : item.key === 'applications'
                          ? Layers
                          : item.key === 'sources'
                            ? Radio
                            : item.key === 'settings'
                              ? Sliders
                              : History;

                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.key);
                      setMobileMenuOpen(false);
                    }}
                    className={`flex flex-col items-start p-3 rounded-[8px] border text-left transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-surface-subtle border-accent ring-1 ring-accent text-fg font-semibold'
                        : 'bg-surface border-border hover:bg-surface-subtle text-fg-muted hover:text-fg'
                    }`}
                  >
                    <Icon size={18} className={`mb-1.5 ${isActive ? 'text-accent' : 'text-fg-muted'}`} strokeWidth={1.5} />
                    <span className="text-[13px] font-medium text-fg">{item.label}</span>
                  </button>
                );
              })}

              {/* Setup Milestone Tab */}
              <button
                type="button"
                onClick={() => {
                  setActiveTab('setup');
                  setMobileMenuOpen(false);
                }}
                className={`flex flex-col items-start p-3 rounded-[8px] border text-left transition-colors cursor-pointer ${
                  activeTab === 'setup'
                    ? 'bg-surface-subtle border-accent ring-1 ring-accent text-fg font-semibold'
                    : 'bg-surface border-border hover:bg-surface-subtle text-fg-muted hover:text-fg'
                }`}
              >
                <ShieldCheck size={18} className={`mb-1.5 ${activeTab === 'setup' ? 'text-accent' : 'text-fg-muted'}`} strokeWidth={1.5} />
                <span className="text-[13px] font-medium text-fg">Setup</span>
              </button>
            </div>

            <div className="pt-2 border-t border-border flex items-center justify-between text-[12px] text-fg-muted">
              <span>Single-user Job Automation</span>
              <span className="font-mono">{dryRun ? 'DRY_RUN' : 'LIVE'}</span>
            </div>
          </div>
        </div>
      )}

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
