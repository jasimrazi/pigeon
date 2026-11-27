import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Bird,
  Briefcase,
  ChevronRight,
  Command,
  Moon,
  Layers,
  MoreHorizontal,
  Radio,
  Sliders,
  Sun,
  SunMoon,
  History,
  ShieldCheck,
  X,
  LogOut,
} from 'lucide-react';
import { getAppVersionInfo, type AppVersionInfo } from '@pigeon/shared';
import { getStoredToken, clearStoredToken, onUnauthorized, apiFetch } from './api.js';
import { getStoredTheme, setStoredTheme, type ThemePreference } from './theme.js';
import { LoginView } from './components/LoginView.js';
import { OverviewView } from './components/OverviewView.js';
import { JobsHubView, type JobsSubTab } from './components/JobsHubView.js';
import { ApplicationsView } from './components/ApplicationsView.js';
import { SourcesView } from './components/SourcesView.js';
import { SettingsView, type SettingsSubTab } from './components/SettingsView.js';
import { EventsView } from './components/EventsView.js';
import { SetupView } from './components/SetupView.js';
import { ConfirmationModal } from './components/ConfirmationModal.js';
import { DialogProvider, useDialog } from './components/ui/DialogProvider.js';
import { ToastProvider, useToast } from './components/ui/ToastProvider.js';
import { CommandPalette, type CommandPaletteAction } from './components/ui/CommandPalette.js';

export type TabKey =
  | 'overview'
  | 'jobs'
  | 'applications'
  | 'sources'
  | 'settings'
  | 'events'
  | 'setup';

export function App(): React.JSX.Element {
  return (
    <DialogProvider>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </DialogProvider>
  );
}

function AppContent(): React.JSX.Element {
  const dialog = useDialog();
  const toast = useToast();
  const clientVersion = useMemo(() => getAppVersionInfo(), []);
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    if (typeof window !== 'undefined' && window.location.pathname === '/setup') {
      return 'setup';
    }
    return 'overview';
  });
  const [jobsSubTab, setJobsSubTab] = useState<JobsSubTab>('review-queue');
  const [settingsSubTab, setSettingsSubTab] = useState<SettingsSubTab>('profile');

  const navigateToTab = useCallback((tab: string, subTab?: string) => {
    if (tab === 'review-queue' || tab === 'manual-apply' || tab === 'mail-jobs') {
      setActiveTab('jobs');
      setJobsSubTab(tab);
      return;
    }
    setActiveTab(tab as TabKey);
    if (tab === 'jobs' && (subTab === 'review-queue' || subTab === 'manual-apply' || subTab === 'mail-jobs')) {
      setJobsSubTab(subTab);
    } else if (tab === 'settings' && subTab) {
      setSettingsSubTab(subTab as SettingsSubTab);
    }
  }, []);
  const [headerState, setHeaderState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [killSwitch, setKillSwitch] = useState<boolean | null>(null);
  const [dryRun, setDryRun] = useState<boolean | null>(null);
  const [authHealth, setAuthHealth] = useState<'ok' | 'invalid' | 'unknown' | null>(null);
  const [reviewPendingCount, setReviewPendingCount] = useState<number>(0);
  const [manualWaitingCount, setManualWaitingCount] = useState<number>(0);
  const [apiVersion, setApiVersion] = useState<AppVersionInfo | null>(null);
  const [showKsModal, setShowKsModal] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [themePref, setThemePref] = useState<ThemePreference>(() => getStoredTheme());

  const apiBase =
    (import.meta.env?.VITE_API_BASE as string | undefined) ||
    (import.meta.env?.VITE_API_URL as string | undefined) ||
    '';

  useEffect(() => {
    const unsubscribe = onUnauthorized(() => {
      setToken(null);
    });
    return unsubscribe;
  }, []);

  const isMoreActive =
    mobileMenuOpen ||
    activeTab === 'settings' ||
    activeTab === 'events' ||
    activeTab === 'setup';

  const loadHeaderStatus = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiFetch(`${apiBase}/api/overview`);
      if (res.ok) {
        const data = (await res.json()) as {
          killSwitch?: boolean;
          dryRun?: boolean;
          authHealth?: { status: 'ok' | 'invalid' | 'unknown' };
          reviewPendingCount?: number;
          manualWaitingCount?: number;
          version?: AppVersionInfo;
        };
        if (typeof data.killSwitch === 'boolean') setKillSwitch(data.killSwitch);
        if (typeof data.dryRun === 'boolean') setDryRun(data.dryRun);
        if (typeof data.reviewPendingCount === 'number') {
          setReviewPendingCount(data.reviewPendingCount);
        }
        if (typeof data.manualWaitingCount === 'number') {
          setManualWaitingCount(data.manualWaitingCount);
        }
        if (data.version) {
          setApiVersion(data.version);
        }
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
  }, [apiBase, token]);

  useEffect(() => {
    if (token) {
      void loadHeaderStatus();
    }
  }, [loadHeaderStatus, refreshTrigger, token]);

  const handleCycleTheme = useCallback(() => {
    const order: ThemePreference[] = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(themePref) + 1) % order.length] ?? 'system';
    setThemePref(next);
    setStoredTheme(next);
    toast.info(`Theme switched to ${next}.`);
  }, [themePref, toast]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const commandActions = useMemo<CommandPaletteAction[]>(() => {
    const runAction = async (label: string, url: string) => {
      try {
        const res = await apiFetch(url, { method: 'POST' });
        if (!res.ok) {
          throw new Error(`${label} failed (${res.status})`);
        }
        toast.success(`${label} completed.`);
        setRefreshTrigger((prev) => prev + 1);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : `${label} failed`);
      }
    };

    return [
      { id: 'nav-overview', label: 'Go to Overview', group: 'Navigation', onSelect: () => navigateToTab('overview') },
      { id: 'nav-review', label: 'Jobs: Review Queue', group: 'Navigation', keywords: 'email drafts approve', onSelect: () => navigateToTab('jobs', 'review-queue') },
      { id: 'nav-manual', label: 'Jobs: Manual Apply', group: 'Navigation', keywords: 'portal focus kit', onSelect: () => navigateToTab('jobs', 'manual-apply') },
      { id: 'nav-jobs', label: 'Jobs: Parsed Jobs', group: 'Navigation', keywords: 'alerts scores mail', onSelect: () => navigateToTab('jobs', 'mail-jobs') },
      { id: 'nav-apps', label: 'Go to Applications', group: 'Navigation', keywords: 'outcomes ledger history', onSelect: () => setActiveTab('applications') },
      { id: 'nav-sources', label: 'Go to Sources', group: 'Navigation', keywords: 'ats circuits rss', onSelect: () => setActiveTab('sources') },
      {
        id: 'nav-settings-profile',
        label: 'Settings: Profile & Answers',
        group: 'Navigation',
        onSelect: () => {
          setSettingsSubTab('profile');
          setActiveTab('settings');
        },
      },
      {
        id: 'nav-settings-resumes',
        label: 'Settings: Resumes',
        group: 'Navigation',
        onSelect: () => {
          setSettingsSubTab('resumes');
          setActiveTab('settings');
        },
      },
      {
        id: 'nav-settings-integrations',
        label: 'Settings: Integrations',
        group: 'Navigation',
        onSelect: () => {
          setSettingsSubTab('integrations');
          setActiveTab('settings');
        },
      },
      {
        id: 'nav-settings-safety',
        label: 'Settings: Safety, DNC & Data',
        group: 'Navigation',
        onSelect: () => {
          setSettingsSubTab('safety');
          setActiveTab('settings');
        },
      },
      { id: 'nav-events', label: 'Go to Audit Events', group: 'Navigation', onSelect: () => setActiveTab('events') },
      { id: 'nav-setup', label: 'Go to Setup Checklist', group: 'Navigation', onSelect: () => setActiveTab('setup') },
      {
        id: 'act-sync-gmail',
        label: 'Sync Job Alerts from Gmail',
        group: 'Actions',
        keywords: 'alerts ingest email',
        onSelect: () => runAction('Gmail alert sync', `${apiBase}/api/alerts/sync`),
      },
      {
        id: 'act-run-pipeline',
        label: 'Run Scoring & Routing Pipeline',
        group: 'Actions',
        keywords: 'llm score filter',
        onSelect: () => runAction('Scoring pipeline', `${apiBase}/api/pipeline/run`),
      },
      {
        id: 'act-poll-inbox',
        label: 'Poll Inbox for Employer Replies',
        group: 'Actions',
        keywords: 'replies follow up bounce',
        onSelect: () => runAction('Inbox poll', `${apiBase}/api/inbox/poll`),
      },
      {
        id: 'act-sync-sheet',
        label: 'Sync Applications to Google Sheet',
        group: 'Actions',
        keywords: 'spreadsheet export',
        onSelect: () => runAction('Google Sheet sync', `${apiBase}/api/sync/sheet`),
      },
      {
        id: 'theme-cycle',
        label: `Cycle Theme (current: ${themePref})`,
        group: 'Appearance',
        keywords: 'dark light system',
        onSelect: handleCycleTheme,
      },
    ];
  }, [apiBase, handleCycleTheme, navigateToTab, themePref, toast]);

  const handleToggleKillSwitch = async (activate: boolean) => {
    try {
      const res = await apiFetch(`${apiBase}/api/settings/kill-switch`, {
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
      void dialog.alert({
        title: 'Kill Switch Update Failed',
        message: err instanceof Error ? err.message : String(err),
        variant: 'danger',
      });
    } finally {
      setShowKsModal(false);
    }
  };

  if (!token) {
    return (
      <LoginView
        onLoginSuccess={(newToken) => {
          setToken(newToken);
        }}
        apiBase={apiBase}
      />
    );
  }

  const jobsPendingTotal = reviewPendingCount + manualWaitingCount;

  const navItems: Array<{ key: TabKey; label: string; count?: number | undefined }> = [
    { key: 'overview', label: 'Overview' },
    {
      key: 'jobs',
      label: 'Jobs',
      count: jobsPendingTotal > 0 ? jobsPendingTotal : undefined,
    },
    { key: 'applications', label: 'Applications' },
    { key: 'sources', label: 'Sources' },
    { key: 'settings', label: 'Settings' },
    { key: 'events', label: 'Events' },
  ];

  const ThemeIcon = themePref === 'dark' ? Moon : themePref === 'light' ? Sun : SunMoon;

  return (
    <div className="min-h-screen flex flex-col bg-canvas text-fg">
      {/* Top Header */}
      <header className="border-b border-border bg-surface sticky top-0 z-40">
        <div className="max-w-[1440px] mx-auto px-3 sm:px-6 flex flex-wrap items-center justify-between min-h-14 gap-x-4">
          <button
            onClick={() => setActiveTab('overview')}
            className="flex items-center gap-2 h-14 cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-[4px] shrink-0 order-1"
          >
            <Bird size={18} strokeWidth={1.5} className="text-fg shrink-0" aria-hidden="true" />
            <span className="text-[16px] font-semibold tracking-tight text-fg">Pigeon</span>
          </button>

          {/* Navigation Tabs (Desktop: single row on xl+, dedicated full-width bar on md..lg so nothing clips) */}
          <nav className="hidden md:flex items-center flex-wrap gap-0.5 lg:gap-1 w-full xl:w-auto xl:flex-1 xl:pl-2 border-t border-border/60 xl:border-t-0 h-11 xl:h-14 order-3 xl:order-2">
            {navItems.map((item) => {
              const isActive = activeTab === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => setActiveTab(item.key)}
                  className={`h-full px-2.5 text-[13px] font-medium transition-colors cursor-pointer border-b-2 flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'border-accent text-fg bg-surface-subtle/50'
                      : 'border-transparent text-fg-muted hover:text-fg hover:bg-surface-subtle/30'
                  }`}
                >
                  <span>{item.label}</span>
                  {item.count !== undefined && (
                    <span
                      data-testid={`nav-badge-${item.key}`}
                      className="text-[10px] font-mono font-semibold tabular-nums px-1.5 py-0.2 rounded-[4px] bg-accent/15 text-accent border border-accent/25 leading-tight"
                    >
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Right Header Status Indicators (Compact Dot + Label Chips) */}
          <div className="flex items-center gap-1.5 sm:gap-2 h-14 shrink-0 order-2 xl:order-3">
            <button
              type="button"
              onClick={() => setCommandOpen(true)}
              data-testid="header-command-palette-button"
              title="Open Command Palette (Ctrl/Cmd + K)"
              aria-label="Open command palette"
              className="hidden lg:inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-medium rounded-[4px] border border-border bg-surface-subtle text-fg-muted hover:text-fg hover:bg-surface transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Command size={11} aria-hidden="true" />
              <span className="font-mono">K</span>
            </button>

            <button
              type="button"
              onClick={handleCycleTheme}
              data-testid="header-theme-toggle"
              title={`Theme: ${themePref} (click to switch)`}
              aria-label={`Switch theme (current: ${themePref})`}
              className="inline-flex items-center justify-center p-1 rounded-[4px] border border-border bg-surface-subtle text-fg-muted hover:text-fg hover:bg-surface transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ThemeIcon size={13} aria-hidden="true" />
            </button>
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

                {/* Sign Out Button */}
                <button
                  type="button"
                  onClick={() => {
                    clearStoredToken();
                    setToken(null);
                  }}
                  data-testid="header-signout-button"
                  title="Sign out / Lock dashboard"
                  aria-label="Sign out"
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] sm:text-[12px] font-medium rounded-[4px] border border-border bg-surface-subtle text-fg-muted hover:text-fg hover:bg-surface transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <LogOut size={13} aria-hidden="true" />
                  <span className="hidden 2xl:inline">Sign Out</span>
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
            apiBase={apiBase}
            onNavigateTab={navigateToTab}
            onDataRefresh={() => setRefreshTrigger((prev) => prev + 1)}
          />
        )}
        {activeTab === 'jobs' && (
          <JobsHubView
            apiBase={apiBase}
            initialSubTab={jobsSubTab}
            onSubTabChange={setJobsSubTab}
            reviewPendingCount={reviewPendingCount}
            manualWaitingCount={manualWaitingCount}
            onActionComplete={() => setRefreshTrigger((prev) => prev + 1)}
            onNavigateTab={navigateToTab}
          />
        )}
        {activeTab === 'applications' && <ApplicationsView apiBase={apiBase} />}
        {activeTab === 'sources' && <SourcesView apiBase={apiBase} />}
        {activeTab === 'settings' && (
          <SettingsView
            apiBase={apiBase}
            initialSubTab={settingsSubTab}
            onSubTabChange={setSettingsSubTab}
            onRefresh={() => setRefreshTrigger((prev) => prev + 1)}
          />
        )}
        {activeTab === 'events' && <EventsView apiBase={apiBase} />}
        {activeTab === 'setup' && (
          <SetupView
            apiBase={apiBase}
            onNavigateTab={navigateToTab}
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
            className={`flex flex-col items-center justify-center py-1 transition-colors cursor-pointer relative ${
              activeTab === 'overview'
                ? 'text-accent font-semibold'
                : 'text-fg-muted hover:text-fg'
            }`}
          >
            <Bird size={17} strokeWidth={activeTab === 'overview' ? 2 : 1.5} className="shrink-0" aria-hidden="true" />
            <span className="text-[9px] font-medium leading-none tracking-tight mt-1 truncate">Overview</span>
          </button>

          {/* 2. Jobs (Review Queue + Manual Apply + Parsed Jobs) */}
          <button
            type="button"
            onClick={() => {
              setActiveTab('jobs');
              setMobileMenuOpen(false);
            }}
            className={`flex flex-col items-center justify-center py-1 transition-colors cursor-pointer relative ${
              activeTab === 'jobs'
                ? 'text-accent font-semibold'
                : 'text-fg-muted hover:text-fg'
            }`}
          >
            <div className="relative">
              <Briefcase size={17} strokeWidth={activeTab === 'jobs' ? 2 : 1.5} className="shrink-0" aria-hidden="true" />
              {jobsPendingTotal > 0 && (
                <span className="absolute -top-1.5 -right-2.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-accent text-accent-fg text-[9px] font-mono font-semibold flex items-center justify-center">
                  {jobsPendingTotal > 99 ? '99+' : jobsPendingTotal}
                </span>
              )}
            </div>
            <span className="text-[9px] font-medium leading-none tracking-tight mt-1 truncate max-w-full px-0.5">Jobs</span>
          </button>

          {/* 3. Applications */}
          <button
            type="button"
            onClick={() => {
              setActiveTab('applications');
              setMobileMenuOpen(false);
            }}
            className={`flex flex-col items-center justify-center py-1 transition-colors cursor-pointer relative ${
              activeTab === 'applications'
                ? 'text-accent font-semibold'
                : 'text-fg-muted hover:text-fg'
            }`}
          >
            <Layers size={17} strokeWidth={activeTab === 'applications' ? 2 : 1.5} className="shrink-0" aria-hidden="true" />
            <span className="text-[9px] font-medium leading-none tracking-tight mt-1 truncate max-w-full px-0.5">Applications</span>
          </button>

          {/* 4. Sources */}
          <button
            type="button"
            onClick={() => {
              setActiveTab('sources');
              setMobileMenuOpen(false);
            }}
            className={`flex flex-col items-center justify-center py-1 transition-colors cursor-pointer relative ${
              activeTab === 'sources'
                ? 'text-accent font-semibold'
                : 'text-fg-muted hover:text-fg'
            }`}
          >
            <Radio size={17} strokeWidth={activeTab === 'sources' ? 2 : 1.5} className="shrink-0" aria-hidden="true" />
            <span className="text-[9px] font-medium leading-none tracking-tight mt-1 truncate max-w-full px-0.5">Sources</span>
          </button>

          {/* 5. More */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label="More - Toggle navigation menu"
            className={`flex flex-col items-center justify-center py-1 transition-colors cursor-pointer relative ${
              isMoreActive
                ? 'text-accent font-semibold'
                : 'text-fg-muted hover:text-fg'
            }`}
          >
            <MoreHorizontal size={17} strokeWidth={isMoreActive ? 2 : 1.5} className="shrink-0" aria-hidden="true" />
            <span className="text-[9px] font-medium leading-none tracking-tight mt-1 truncate">More</span>
          </button>
        </div>
      </nav>

      {/* Mobile Navigation Drawer / Sheet */}
      {mobileMenuOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="md:hidden fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-xs transition-opacity"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            className="bg-surface border-t border-border rounded-t-[20px] p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Grab handle indicator */}
            <div className="w-10 h-1 rounded-full bg-border mx-auto mb-1" aria-hidden="true" />

            <div className="flex items-center justify-between pb-2 border-b border-border">
              <div>
                <h3 className="text-[15px] font-semibold text-fg">More Options</h3>
                <p className="text-[12px] text-fg-muted mt-0.5">Configuration & system monitoring</p>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 rounded-[6px] text-fg-muted hover:text-fg hover:bg-surface-subtle cursor-pointer transition-colors"
                aria-label="Close navigation menu"
              >
                <X size={16} strokeWidth={1.5} aria-hidden="true" />
              </button>
            </div>

            {/* List of Remaining Sections Only */}
            <div className="space-y-2">
              {/* 1. Settings */}
              <button
                type="button"
                aria-label="Settings"
                onClick={() => {
                  setActiveTab('settings');
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between p-3 rounded-[8px] border text-left transition-colors cursor-pointer ${
                  activeTab === 'settings'
                    ? 'bg-surface-subtle border-accent ring-1 ring-accent text-fg font-semibold'
                    : 'bg-surface border-border hover:bg-surface-subtle text-fg-muted hover:text-fg'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-[6px] bg-surface-subtle border border-border flex items-center justify-center shrink-0">
                    <Sliders size={16} strokeWidth={1.5} className={activeTab === 'settings' ? 'text-accent' : 'text-fg-muted'} aria-hidden="true" />
                  </div>
                  <div>
                    <span className="text-[13px] font-medium text-fg block">Settings</span>
                    <span className="text-[11px] text-fg-muted block mt-0.5">Profile facts, resumes, daily caps & integrations</span>
                  </div>
                </div>
                <ChevronRight size={15} strokeWidth={1.5} className="text-fg-muted shrink-0" aria-hidden="true" />
              </button>

              {/* 2. Events */}
              <button
                type="button"
                aria-label="Events"
                onClick={() => {
                  setActiveTab('events');
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between p-3 rounded-[8px] border text-left transition-colors cursor-pointer ${
                  activeTab === 'events'
                    ? 'bg-surface-subtle border-accent ring-1 ring-accent text-fg font-semibold'
                    : 'bg-surface border-border hover:bg-surface-subtle text-fg-muted hover:text-fg'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-[6px] bg-surface-subtle border border-border flex items-center justify-center shrink-0">
                    <History size={16} strokeWidth={1.5} className={activeTab === 'events' ? 'text-accent' : 'text-fg-muted'} aria-hidden="true" />
                  </div>
                  <div>
                    <span className="text-[13px] font-medium text-fg block">Events</span>
                    <span className="text-[11px] text-fg-muted block mt-0.5">Audit log, system events & status changes</span>
                  </div>
                </div>
                <ChevronRight size={15} strokeWidth={1.5} className="text-fg-muted shrink-0" aria-hidden="true" />
              </button>

              {/* 3. Setup */}
              <button
                type="button"
                aria-label="Setup"
                onClick={() => {
                  setActiveTab('setup');
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between p-3 rounded-[8px] border text-left transition-colors cursor-pointer ${
                  activeTab === 'setup'
                    ? 'bg-surface-subtle border-accent ring-1 ring-accent text-fg font-semibold'
                    : 'bg-surface border-border hover:bg-surface-subtle text-fg-muted hover:text-fg'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-[6px] bg-surface-subtle border border-border flex items-center justify-center shrink-0">
                    <ShieldCheck size={16} strokeWidth={1.5} className={activeTab === 'setup' ? 'text-accent' : 'text-fg-muted'} aria-hidden="true" />
                  </div>
                  <div>
                    <span className="text-[13px] font-medium text-fg block">Setup</span>
                    <span className="text-[11px] text-fg-muted block mt-0.5">First-run configuration & milestone checklist</span>
                  </div>
                </div>
                <ChevronRight size={15} strokeWidth={1.5} className="text-fg-muted shrink-0" aria-hidden="true" />
              </button>
            </div>

            {/* Footer Status Pill */}
            <div className="pt-3 border-t border-border flex items-center justify-between text-[11px] text-fg-muted">
              <span data-testid="mobile-version-counter" className="font-mono">
                Pigeon {clientVersion.label}
              </span>
              <span className="font-mono tabular-nums px-1.5 py-0.5 bg-surface-subtle border border-border rounded-[4px]">
                {dryRun ? 'Simulation Mode' : 'Live Sending Mode'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Desktop Footer with Version Counter */}
      <footer className="hidden md:block border-t border-border bg-surface/60">
        <div className="max-w-[1200px] mx-auto px-6 py-2.5 flex items-center justify-between text-[11px] text-fg-muted">
          <div className="flex items-center gap-3">
            <span>Pigeon Job Dispatch</span>
            <span
              data-testid="app-version-counter"
              className="font-mono tabular-nums px-1.5 py-0.5 rounded-[4px] border border-border bg-surface-subtle text-fg"
              title={`UI: ${clientVersion.label}${apiVersion ? ` | API: ${apiVersion.label}` : ''}`}
            >
              {clientVersion.label}
            </span>
            {apiVersion && apiVersion.build !== clientVersion.build && (
              <span className="font-mono text-state-warn-fg">
                API #{apiVersion.build}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setCommandOpen(true)}
              className="hover:text-fg transition-colors cursor-pointer font-mono"
            >
              Ctrl/Cmd+K Commands
            </button>
          </div>
        </div>
      </footer>

      <CommandPalette
        isOpen={commandOpen}
        onClose={() => setCommandOpen(false)}
        actions={commandActions}
      />

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
