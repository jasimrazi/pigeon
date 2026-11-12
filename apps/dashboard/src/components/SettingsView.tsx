import React, { useState, useEffect, useCallback } from 'react';
import type { Profile, SettingFieldSummary } from '@pigeon/shared';
import {
  AlertTriangle,
  Loader2,
  Mail,
  Moon,
  Palette,
  Shield,
  Sliders,
  Sun,
  SunMoon,
  User,
  Plug,
  FileText,
} from 'lucide-react';
import { ConfirmationModal } from './ConfirmationModal.js';
import { Button } from './ui/Button.js';
import { IntegrationsSettings } from './IntegrationsSettings.js';
import { ResumesSettings } from './ResumesSettings.js';
import { getStoredTheme, setStoredTheme, type ThemePreference } from '../theme.js';

export type SettingsSubTab = 'profile' | 'resumes' | 'integrations' | 'safety';

interface SettingsData {
  ok?: boolean;
  profile: Profile;
  dryRun: boolean;
  killSwitch: boolean;
  settings?: SettingFieldSummary[];
  masterKeyConfigured?: boolean;
  masterKeyError?: string | null;
  legacyEnvKeys?: string[];
}

interface Props {
  apiBase?: string;
  initialSubTab?: SettingsSubTab | undefined;
  onSubTabChange?: ((subTab: SettingsSubTab) => void) | undefined;
  onRefresh?: (() => void) | undefined;
}

export function SettingsView({
  apiBase = '',
  initialSubTab = 'profile',
  onSubTabChange,
  onRefresh,
}: Props): React.JSX.Element {
  const [subTab, setSubTab] = useState<SettingsSubTab>(initialSubTab);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settingsList, setSettingsList] = useState<SettingFieldSummary[]>([]);
  const [masterKeyConfigured, setMasterKeyConfigured] = useState<boolean>(true);
  const [masterKeyError, setMasterKeyError] = useState<string | null>(null);
  const [legacyEnvKeys, setLegacyEnvKeys] = useState<string[]>([]);
  const [authHealth, setAuthHealth] = useState<{
    status: 'ok' | 'invalid' | 'unknown';
    reason: string | null;
    checked_at: string | null;
  }>({ status: 'unknown', reason: null, checked_at: null });

  const [dryRun, setDryRun] = useState(true);
  const [killSwitch, setKillSwitch] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );
  const [themePref, setThemePref] = useState<ThemePreference>('system');

  // Kill Switch & Dry Run modal state
  const [showKsModal, setShowKsModal] = useState(false);
  const [targetKsState, setTargetKsState] = useState(false);
  const [showDryRunModal, setShowDryRunModal] = useState(false);

  // Form input fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [skillsText, setSkillsText] = useState('');
  const [dailyCap, setDailyCap] = useState(20);
  const [rampBase, setRampBase] = useState(5);
  const [rampStep, setRampStep] = useState(2);
  const [windowStart, setWindowStart] = useState('09:00');
  const [windowEnd, setWindowEnd] = useState('18:00');
  const [timezone, setTimezone] = useState('UTC');
  const [minScore, setMinScore] = useState(0);
  const [autoApproveScore, setAutoApproveScore] = useState(85);
  const [titleFiltersText, setTitleFiltersText] = useState('');
  const [companyBlacklistText, setCompanyBlacklistText] = useState('');

  // Sync initialSubTab when parent changes it
  useEffect(() => {
    if (initialSubTab) {
      setSubTab(initialSubTab);
    }
  }, [initialSubTab]);

  const handleSubTabClick = (tab: SettingsSubTab) => {
    setSubTab(tab);
    onSubTabChange?.(tab);
  };

  // Initialize theme from storage
  useEffect(() => {
    setThemePref(getStoredTheme());
  }, []);

  const handleThemeChange = (newPref: ThemePreference) => {
    setThemePref(newPref);
    setStoredTheme(newPref);
  };

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      setFeedback(null);
      const res = await fetch(`${apiBase}/api/settings`);
      if (!res.ok) {
        throw new Error(`Failed to load settings (${res.status})`);
      }
      const data = (await res.json()) as SettingsData;
      setProfile(data.profile);
      setDryRun(data.dryRun);
      setKillSwitch(data.killSwitch);
      setSettingsList(data.settings || []);
      setMasterKeyConfigured(data.masterKeyConfigured ?? true);
      setMasterKeyError(data.masterKeyError || null);
      setLegacyEnvKeys(data.legacyEnvKeys || []);

      // Also fetch auth health for the Google status card
      try {
        const healthRes = await fetch(`${apiBase}/api/auth/google/health`);
        if (healthRes.ok) {
          const hData = (await healthRes.json()) as {
            health?: {
              status: 'ok' | 'invalid' | 'unknown';
              reason: string | null;
              checked_at: string | null;
            };
          };
          if (hData.health) {
            setAuthHealth(hData.health);
          }
        }
      } catch {
        // Fallback
      }

      // Populate form state
      if (data.profile) {
        setName(data.profile.name || '');
        setEmail(data.profile.email || '');
        setSkillsText((data.profile.skills || []).join(', '));
        setDailyCap(data.profile.send_settings?.daily_cap ?? 20);
        setRampBase(data.profile.send_settings?.ramp_base ?? 5);
        setRampStep(data.profile.send_settings?.ramp_step ?? 2);
        setWindowStart(data.profile.send_settings?.window?.start ?? '09:00');
        setWindowEnd(data.profile.send_settings?.window?.end ?? '18:00');
        setTimezone(data.profile.send_settings?.timezone ?? 'UTC');
        setMinScore(data.profile.filters?.min_score ?? 0);
        setAutoApproveScore(data.profile.send_settings?.auto_approve_above_score ?? 85);
        setTitleFiltersText((data.profile.filters?.titles || []).join(', '));
        setCompanyBlacklistText((data.profile.filters?.company_blacklist || []).join(', '));
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const handleToggleKillSwitch = async (activate: boolean) => {
    try {
      setSaving(true);
      const res = await fetch(`${apiBase}/api/settings/kill-switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kill_switch: activate, confirmed: true }),
      });
      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errJson.error || `Failed to update Kill Switch (${res.status})`);
      }
      setKillSwitch(activate);
      setFeedback({
        type: 'success',
        message: activate
          ? 'Kill Switch activated: all email dispatch paused immediately.'
          : 'Kill Switch deactivated: normal sending resumed.',
      });
      onRefresh?.();
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
      setShowKsModal(false);
    }
  };

  const handleToggleDryRun = async (isDryRun: boolean, confirmed = false) => {
    try {
      setSaving(true);
      const res = await fetch(`${apiBase}/api/settings/dry-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: isDryRun, confirmed: isDryRun ? true : confirmed }),
      });
      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errJson.error || `Failed to update DRY_RUN (${res.status})`);
      }
      setDryRun(isDryRun);
      setFeedback({
        type: 'success',
        message: isDryRun
          ? 'DRY_RUN enabled: emails will be simulated and not transmitted.'
          : 'LIVE dispatch enabled: approved emails will send to actual recipients.',
      });
      onRefresh?.();
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      setFeedback(null);

      const skills = skillsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const titles = titleFiltersText
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const companyBlacklist = companyBlacklistText
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);

      const payload = {
        name,
        email,
        skills,
        send_settings: {
          daily_cap: Number(dailyCap),
          ramp_base: Number(rampBase),
          ramp_step: Number(rampStep),
          window: {
            start: windowStart,
            end: windowEnd,
          },
          timezone,
          auto_approve_above_score: Number(autoApproveScore),
        },
        filters: {
          titles,
          company_blacklist: companyBlacklist,
          min_score: Number(minScore),
        },
      };

      const res = await fetch(`${apiBase}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errJson.error || `Failed to save settings (${res.status})`);
      }

      setFeedback({ type: 'success', message: 'Settings saved successfully.' });
      onRefresh?.();
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading && !profile) {
    return (
      <div className="flex items-center justify-center py-20 text-fg-muted text-[14px] gap-2">
        <Loader2 className="animate-spin shrink-0" size={16} aria-hidden="true" />
        <span>Loading configuration settings...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="bg-surface p-5 rounded-[6px] border border-border">
        <div className="flex items-center gap-2">
          <Sliders
            size={16}
            strokeWidth={1.5}
            className="text-fg-muted shrink-0"
            aria-hidden="true"
          />
          <h2 className="text-[16px] font-semibold text-fg">
            System Settings & Operational Controls
          </h2>
        </div>
        <p className="text-[13px] text-fg-muted mt-1">
          Configure profile facts, integrations, sending caps, ramp-up schedule, and safety gates.
        </p>

        {/* Sub-Navigation Tabs */}
        <div className="flex items-center gap-1 sm:gap-2 border-b border-border mt-5 pt-1 overflow-x-auto scrollbar-none">
          <button
            type="button"
            onClick={() => handleSubTabClick('profile')}
            className={`px-3 py-2 text-[13px] font-medium border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 whitespace-nowrap ${
              subTab === 'profile'
                ? 'border-accent text-fg font-semibold'
                : 'border-transparent text-fg-muted hover:text-fg hover:border-border'
            }`}
          >
            <User size={14} />
            <span>Profile</span>
          </button>
          <button
            type="button"
            onClick={() => handleSubTabClick('resumes')}
            className={`px-3 py-2 text-[13px] font-medium border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 whitespace-nowrap ${
              subTab === 'resumes'
                ? 'border-accent text-fg font-semibold'
                : 'border-transparent text-fg-muted hover:text-fg hover:border-border'
            }`}
          >
            <FileText size={14} />
            <span>Resumes</span>
          </button>
          <button
            type="button"
            onClick={() => handleSubTabClick('integrations')}
            className={`px-3 py-2 text-[13px] font-medium border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 whitespace-nowrap ${
              subTab === 'integrations'
                ? 'border-accent text-fg font-semibold'
                : 'border-transparent text-fg-muted hover:text-fg hover:border-border'
            }`}
          >
            <Plug size={14} />
            <span>Integrations</span>
          </button>
          <button
            type="button"
            onClick={() => handleSubTabClick('safety')}
            className={`px-3 py-2 text-[13px] font-medium border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 whitespace-nowrap ${
              subTab === 'safety'
                ? 'border-accent text-fg font-semibold'
                : 'border-transparent text-fg-muted hover:text-fg hover:border-border'
            }`}
          >
            <Shield size={14} />
            <span>Safety</span>
          </button>
        </div>
      </div>

      {/* Blocking Master Key Alert Banner */}
      {(!masterKeyConfigured || masterKeyError) && (
        <div className="p-4 rounded-[6px] border border-state-danger-border bg-state-danger-bg text-state-danger-fg text-[13px] flex items-start gap-3">
          <AlertTriangle size={18} className="shrink-0 mt-0.5 text-state-danger-fg" />
          <div>
            <strong className="block font-semibold">
              Master Encryption Key Missing or Invalid
            </strong>
            <p className="mt-1 leading-relaxed">
              Pigeon requires a 32-byte master encryption key (<code>SETTINGS_ENCRYPTION_KEY</code>)
              to store secrets securely at rest. Secret reads and writes are blocked until
              configured. Run <code>pnpm setup:secrets</code> to initialize it.
            </p>
          </div>
        </div>
      )}

      {/* Notice for Legacy Environment Variables */}
      {legacyEnvKeys.length > 0 && (
        <div className="p-3.5 rounded-[6px] border border-state-warn-border bg-state-warn-bg/30 text-fg text-[12px] flex items-start gap-2.5">
          <AlertTriangle size={16} className="text-state-warn-fg shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            <span className="font-semibold text-state-warn-fg">
              Legacy environment variables detected:{' '}
            </span>
            <code className="font-mono text-[11px] bg-surface-subtle px-1 py-0.5 rounded text-fg">
              {legacyEnvKeys.join(', ')}
            </code>
            . In staging and production environments, values must be configured via{' '}
            <button
              type="button"
              onClick={() => handleSubTabClick('integrations')}
              className="text-accent underline font-medium cursor-pointer"
            >
              Settings &gt; Integrations
            </button>
            .
          </div>
        </div>
      )}

      {feedback && (
        <div
          className={`p-3.5 rounded-[6px] border text-[13px] font-medium ${
            feedback.type === 'success'
              ? 'bg-state-ok-bg border-state-ok-border text-state-ok-fg'
              : 'bg-state-danger-bg border-state-danger-border text-state-danger-fg'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* SUB-TAB 1: Profile */}
      {subTab === 'profile' && (
        <form
          onSubmit={handleSaveProfile}
          className="bg-surface p-6 rounded-[6px] border border-border space-y-6"
        >
          <div className="flex items-center gap-2 border-b border-border pb-2">
            <User
              size={16}
              strokeWidth={1.5}
              className="text-fg-muted shrink-0"
              aria-hidden="true"
            />
            <h3 className="text-[12px] font-medium uppercase tracking-wider text-fg-muted">
              Profile & Candidate Information
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="candidate-name-input"
                className="block text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-1.5"
              >
                Candidate Full Name
              </label>
              <input
                id="candidate-name-input"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </div>

            <div>
              <label
                htmlFor="candidate-email-input"
                className="block text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-1.5"
              >
                Email Address
              </label>
              <input
                id="candidate-email-input"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="candidate-skills-input"
              className="block text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-1.5"
            >
              Skills (comma-separated, strictly grounded in cover letters)
            </label>
            <input
              id="candidate-skills-input"
              type="text"
              value={skillsText}
              onChange={(e) => setSkillsText(e.target.value)}
              className="w-full text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              placeholder="TypeScript, Cloudflare Workers, Distributed Systems, Node.js"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="title-filters-input"
                className="block text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-1.5"
              >
                Target Job Titles (comma-separated)
              </label>
              <input
                id="title-filters-input"
                type="text"
                value={titleFiltersText}
                onChange={(e) => setTitleFiltersText(e.target.value)}
                placeholder="Software Engineer, Backend Developer"
                className="w-full text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </div>

            <div>
              <label
                htmlFor="company-blacklist-input"
                className="block text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-1.5"
              >
                Company Blacklist (comma-separated)
              </label>
              <input
                id="company-blacklist-input"
                type="text"
                value={companyBlacklistText}
                onChange={(e) => setCompanyBlacklistText(e.target.value)}
                placeholder="SpamCorp, BadCo, UnwantedVentures"
                className="w-full text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </div>

            <div>
              <label
                htmlFor="min-score-input"
                className="block text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-1.5"
              >
                Minimum Score Threshold (0 - 100)
              </label>
              <input
                id="min-score-input"
                type="number"
                min={0}
                max={100}
                value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value))}
                className="w-full text-[13px] font-mono tabular-nums px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-border flex items-center justify-end">
            <Button variant="primary" size="md" loading={saving} type="submit" className="w-full sm:w-auto">
              {saving ? 'Saving Profile...' : 'Save Profile'}
            </Button>
          </div>
        </form>
      )}

      {/* SUB-TAB 2: Resumes */}
      {subTab === 'resumes' && <ResumesSettings apiBase={apiBase} />}

      {/* SUB-TAB 3: Integrations */}
      {subTab === 'integrations' && (
        <IntegrationsSettings
          apiBase={apiBase}
          settings={settingsList}
          authHealth={authHealth}
          connectedAccountEmail={email}
          onRefreshSettings={loadSettings}
          disabled={!masterKeyConfigured || Boolean(masterKeyError)}
        />
      )}

      {/* SUB-TAB 3: Safety */}
      {subTab === 'safety' && (
        <div className="space-y-6">
          {/* Safety Gates Card */}
          <div className="bg-surface p-5 rounded-[6px] border border-border space-y-4">
            <div className="flex items-center gap-2 border-b border-border pb-2">
              <Shield
                size={16}
                strokeWidth={1.5}
                className="text-fg-muted shrink-0"
                aria-hidden="true"
              />
              <h3 className="text-[12px] font-medium uppercase tracking-wider text-fg-muted">
                Safety Gates & Emergency Controls
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Kill Switch Toggle */}
              <div
                className={`p-4 rounded-[6px] border ${
                  killSwitch
                    ? 'bg-state-danger-bg border-state-danger-border'
                    : 'bg-surface-subtle border-border'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <span className="font-semibold text-[14px] text-fg block">Kill Switch</span>
                    <p className="text-[12px] text-fg-muted mt-1 leading-relaxed">
                      Stored directly in KV. Checked dynamically before every email send attempt.
                      When active, no applications will be dispatched under any circumstances.
                    </p>
                  </div>
                </div>
                <div className="mt-4">
                  <Button
                    variant={killSwitch ? 'destructive' : 'secondary'}
                    size="md"
                    loading={saving}
                    onClick={() => {
                      setTargetKsState(!killSwitch);
                      setShowKsModal(true);
                    }}
                    className="w-full"
                  >
                    {killSwitch
                      ? 'KILL SWITCH IS ACTIVE (Click to Disarm)'
                      : 'Activate Kill Switch'}
                  </Button>
                </div>
              </div>

              {/* DRY RUN Toggle */}
              <div className="p-4 rounded-[6px] border bg-surface-subtle border-border">
                <div>
                  <span className="font-semibold text-[14px] text-fg block">DRY_RUN Mode</span>
                  <p className="text-[12px] text-fg-muted mt-1 leading-relaxed">
                    When enabled, applications simulate the send pipeline without connecting to
                    recipient mailboxes.
                  </p>
                </div>
                <div className="mt-4">
                  <Button
                    variant={dryRun ? 'secondary' : 'primary'}
                    size="md"
                    loading={saving}
                    onClick={() => {
                      if (dryRun) {
                        setShowDryRunModal(true);
                      } else {
                        void handleToggleDryRun(true);
                      }
                    }}
                    className="w-full"
                  >
                    {dryRun ? 'DRY_RUN: ENABLED (Simulation)' : 'LIVE DISPATCH: ACTIVE'}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Sending Rules & Schedule Form */}
          <form
            onSubmit={handleSaveProfile}
            className="bg-surface p-6 rounded-[6px] border border-border space-y-6"
          >
            <div className="flex items-center gap-2 border-b border-border pb-2">
              <Mail
                size={16}
                strokeWidth={1.5}
                className="text-fg-muted shrink-0"
                aria-hidden="true"
              />
              <h3 className="text-[12px] font-medium uppercase tracking-wider text-fg-muted">
                Sending Rules & Schedule
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label
                  htmlFor="daily-cap-input"
                  className="block text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-1.5"
                >
                  Daily Send Cap (1 - 200)
                </label>
                <input
                  id="daily-cap-input"
                  type="number"
                  min={1}
                  max={200}
                  required
                  value={dailyCap}
                  onChange={(e) => setDailyCap(Number(e.target.value))}
                  className="w-full text-[13px] font-mono tabular-nums px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>

              <div>
                <label
                  htmlFor="ramp-base-input"
                  className="block text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-1.5"
                >
                  Ramp Base (initial daily cap)
                </label>
                <input
                  id="ramp-base-input"
                  type="number"
                  min={1}
                  value={rampBase}
                  onChange={(e) => setRampBase(Number(e.target.value))}
                  className="w-full text-[13px] font-mono tabular-nums px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>

              <div>
                <label
                  htmlFor="ramp-step-input"
                  className="block text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-1.5"
                >
                  Ramp Step (+sends per day)
                </label>
                <input
                  id="ramp-step-input"
                  type="number"
                  min={1}
                  value={rampStep}
                  onChange={(e) => setRampStep(Number(e.target.value))}
                  className="w-full text-[13px] font-mono tabular-nums px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label
                  htmlFor="window-start-input"
                  className="block text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-1.5"
                >
                  Window Start (HH:MM)
                </label>
                <input
                  id="window-start-input"
                  type="text"
                  required
                  pattern="^([01]\d|2[0-3]):[0-5]\d$"
                  value={windowStart}
                  onChange={(e) => setWindowStart(e.target.value)}
                  placeholder="09:00"
                  className="w-full text-[13px] font-mono px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>

              <div>
                <label
                  htmlFor="window-end-input"
                  className="block text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-1.5"
                >
                  Window End (HH:MM)
                </label>
                <input
                  id="window-end-input"
                  type="text"
                  required
                  pattern="^([01]\d|2[0-3]):[0-5]\d$"
                  value={windowEnd}
                  onChange={(e) => setWindowEnd(e.target.value)}
                  placeholder="18:00"
                  className="w-full text-[13px] font-mono px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>

              <div>
                <label
                  htmlFor="timezone-input"
                  className="block text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-1.5"
                >
                  Timezone
                </label>
                <input
                  id="timezone-input"
                  type="text"
                  required
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="UTC or Asia/Kolkata"
                  className="w-full text-[13px] font-mono px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="safety-min-score-input"
                  className="block text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-1.5"
                >
                  Minimum Score Threshold (0 - 100)
                </label>
                <input
                  id="safety-min-score-input"
                  type="number"
                  min={0}
                  max={100}
                  value={minScore}
                  onChange={(e) => setMinScore(Number(e.target.value))}
                  className="w-full text-[13px] font-mono tabular-nums px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
                <p className="text-[11px] text-fg-muted mt-1">
                  Jobs with fit score below min_score are filtered out during evaluation.
                </p>
              </div>

              <div>
                <label
                  htmlFor="auto-approve-score-input"
                  className="block text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-1.5"
                >
                  Auto-Approve Threshold Score (0 - 100)
                </label>
                <input
                  id="auto-approve-score-input"
                  type="number"
                  min={0}
                  max={100}
                  value={autoApproveScore}
                  onChange={(e) => setAutoApproveScore(Number(e.target.value))}
                  className="w-full text-[13px] font-mono tabular-nums px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
                <p className="text-[11px] text-fg-muted mt-1">
                  Applications with match score above this threshold and trusted contact are
                  eligible for safe bulk approval.
                </p>
              </div>
            </div>

            <div className="pt-4 border-t border-border flex items-center justify-end">
              <Button variant="primary" size="md" loading={saving} type="submit" className="w-full sm:w-auto">
                {saving ? 'Saving Safety Settings...' : 'Save Safety Settings'}
              </Button>
            </div>
          </form>

          {/* Appearance & Theme Selector */}
          <div className="bg-surface p-5 rounded-[6px] border border-border space-y-3">
            <div className="flex items-center gap-2 border-b border-border pb-2">
              <Palette
                size={16}
                strokeWidth={1.5}
                className="text-fg-muted shrink-0"
                aria-hidden="true"
              />
              <h3 className="text-[12px] font-medium uppercase tracking-wider text-fg-muted">
                Appearance & Theme
              </h3>
            </div>
            <div className="flex flex-wrap gap-3 pt-1">
              <button
                type="button"
                onClick={() => handleThemeChange('system')}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-[6px] border text-[13px] font-medium cursor-pointer transition-colors ${
                  themePref === 'system'
                    ? 'bg-surface-subtle border-accent text-fg ring-1 ring-accent'
                    : 'bg-surface border-border text-fg-muted hover:text-fg hover:bg-surface-subtle'
                }`}
              >
                <SunMoon size={14} strokeWidth={1.5} aria-hidden="true" />
                <span>System Default</span>
              </button>
              <button
                type="button"
                onClick={() => handleThemeChange('light')}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-[6px] border text-[13px] font-medium cursor-pointer transition-colors ${
                  themePref === 'light'
                    ? 'bg-surface-subtle border-accent text-fg ring-1 ring-accent'
                    : 'bg-surface border-border text-fg-muted hover:text-fg hover:bg-surface-subtle'
                }`}
              >
                <Sun size={14} strokeWidth={1.5} aria-hidden="true" />
                <span>Light Theme</span>
              </button>
              <button
                type="button"
                onClick={() => handleThemeChange('dark')}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-[6px] border text-[13px] font-medium cursor-pointer transition-colors ${
                  themePref === 'dark'
                    ? 'bg-surface-subtle border-accent text-fg ring-1 ring-accent'
                    : 'bg-surface border-border text-fg-muted hover:text-fg hover:bg-surface-subtle'
                }`}
              >
                <Moon size={14} strokeWidth={1.5} aria-hidden="true" />
                <span>Dark Theme</span>
              </button>
            </div>
          </div>
        </div>
      )}

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
        message="Disabling DRY_RUN will activate live email dispatch. Outgoing applications will be transmitted directly to employer inboxes via Gmail API. Are you sure you want to proceed?"
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
