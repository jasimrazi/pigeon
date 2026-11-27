import React, { useState, useEffect, useCallback } from 'react';
import type { Profile, SettingFieldSummary, ExperienceItem } from '@pigeon/shared';
import {
  AlertTriangle,
  Briefcase,
  Loader2,
  Mail,
  Moon,
  Palette,
  Plus,
  Shield,
  Sliders,
  Sun,
  SunMoon,
  Trash2,
  User,
  Plug,
  FileText,
} from 'lucide-react';
import { ConfirmationModal } from './ConfirmationModal.js';
import { Button } from './ui/Button.js';
import { IntegrationsSettings } from './IntegrationsSettings.js';
import { ResumesSettings } from './ResumesSettings.js';
import { DncAndDataSettings } from './DncAndDataSettings.js';
import { getStoredTheme, setStoredTheme, type ThemePreference } from '../theme.js';
import { apiFetch } from '../api.js';

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
  const [experienceYears, setExperienceYears] = useState<number>(4);
  const [dailyCap, setDailyCap] = useState(20);
  const [rampBase, setRampBase] = useState(5);
  const [rampStep, setRampStep] = useState(2);
  const [windowStart, setWindowStart] = useState('09:00');
  const [windowEnd, setWindowEnd] = useState('18:00');
  const [timezone, setTimezone] = useState('UTC');
  const [minScore, setMinScore] = useState(0);
  const [autoApproveScore, setAutoApproveScore] = useState(85);
  const [maxFollowUps, setMaxFollowUps] = useState(1);
  const [manualDailyTarget, setManualDailyTarget] = useState(10);
  const [minSalary, setMinSalary] = useState('');
  const [salaryCurrency, setSalaryCurrency] = useState('USD');
  const [requireSalary, setRequireSalary] = useState(false);
  const [expRangeMin, setExpRangeMin] = useState('');
  const [expRangeMax, setExpRangeMax] = useState('');
  const [noticePeriod, setNoticePeriod] = useState('Immediate');
  const [currentCtc, setCurrentCtc] = useState('N/A');
  const [expectedCtc, setExpectedCtc] = useState('Competitive');
  const [workAuth, setWorkAuth] = useState('Authorized');
  const [linksList, setLinksList] = useState<Array<{ label: string; url: string }>>([]);
  const [titleFiltersText, setTitleFiltersText] = useState('');
  const [titleExcludeText, setTitleExcludeText] = useState('');
  const [companyBlacklistText, setCompanyBlacklistText] = useState('');
  const [locationsText, setLocationsText] = useState('');
  const [workplaceType, setWorkplaceType] = useState<
    'all' | 'remote' | 'hybrid' | 'remote_and_hybrid' | 'onsite'
  >('all');
  const [experienceList, setExperienceList] = useState<ExperienceItem[]>([]);

  const addExperience = () => {
    setExperienceList((prev) => [
      ...prev,
      {
        title: '',
        company: '',
        start_date: '',
        end_date: '',
        current: false,
        description: '',
        highlights: [],
      },
    ]);
  };

  const removeExperience = (index: number) => {
    setExperienceList((prev) => prev.filter((_, i) => i !== index));
  };

  const updateExperience = (index: number, patch: Partial<ExperienceItem>) => {
    setExperienceList((prev) => {
      const next = [...prev];
      const cur = next[index];
      if (cur) {
        next[index] = {
          title: patch.title !== undefined ? patch.title : cur.title,
          company: patch.company !== undefined ? patch.company : cur.company,
          location: patch.location !== undefined ? patch.location : cur.location,
          start_date: patch.start_date !== undefined ? patch.start_date : cur.start_date,
          end_date: patch.end_date !== undefined ? patch.end_date : cur.end_date,
          current: patch.current !== undefined ? patch.current : cur.current,
          description: patch.description !== undefined ? patch.description : cur.description,
          highlights: patch.highlights !== undefined ? patch.highlights : cur.highlights,
        };
      }
      return next;
    });
  };

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
      const res = await apiFetch(`${apiBase}/api/settings`);
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
        const healthRes = await apiFetch(`${apiBase}/api/auth/google/health`);
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
        setExperienceYears(data.profile.experience_years ?? 4);
        setDailyCap(data.profile.send_settings?.daily_cap ?? 20);
        setRampBase(data.profile.send_settings?.ramp_base ?? 5);
        setRampStep(data.profile.send_settings?.ramp_step ?? 2);
        setWindowStart(data.profile.send_settings?.window?.start ?? '09:00');
        setWindowEnd(data.profile.send_settings?.window?.end ?? '18:00');
        setTimezone(data.profile.send_settings?.timezone ?? 'UTC');
        setMinScore(data.profile.filters?.min_score ?? 0);
        setAutoApproveScore(data.profile.send_settings?.auto_approve_above_score ?? 85);
        setMaxFollowUps(data.profile.send_settings?.max_follow_ups ?? 1);
        setManualDailyTarget(data.profile.preferences?.manual_daily_target ?? 10);
        setMinSalary(
          data.profile.filters?.min_salary !== null &&
            data.profile.filters?.min_salary !== undefined
            ? String(data.profile.filters.min_salary)
            : '',
        );
        setSalaryCurrency(data.profile.filters?.salary_currency || 'USD');
        setRequireSalary(Boolean(data.profile.filters?.require_salary));
        setExpRangeMin(
          data.profile.filters?.experience_range?.min !== undefined
            ? String(data.profile.filters.experience_range.min)
            : '',
        );
        setExpRangeMax(
          data.profile.filters?.experience_range?.max !== undefined
            ? String(data.profile.filters.experience_range.max)
            : '',
        );
        setNoticePeriod(data.profile.answers?.notice_period || 'Immediate');
        setCurrentCtc(data.profile.answers?.current_ctc || 'N/A');
        setExpectedCtc(data.profile.answers?.expected_ctc || 'Competitive');
        setWorkAuth(data.profile.answers?.work_authorisation || 'Authorized');
        const linkEntries = Object.entries(data.profile.answers?.links || {}).map(
          ([label, url]) => ({ label, url }),
        );
        setLinksList(linkEntries);
        setTitleFiltersText((data.profile.filters?.titles || []).join(', '));
        setTitleExcludeText((data.profile.filters?.title_exclude || []).join(', '));
        setCompanyBlacklistText((data.profile.filters?.company_blacklist || []).join(', '));
        const locs =
          data.profile.filters?.locations?.length
            ? data.profile.filters.locations
            : data.profile.preferences?.locations || [];
        setLocationsText(locs.join(', '));
        const wpType =
          (data.profile.filters?.workplace_type as typeof workplaceType) ||
          (data.profile.preferences?.workplace_type as typeof workplaceType) ||
          (data.profile.filters?.remote === true ? 'remote' : 'all');
        setWorkplaceType(wpType);
        setExperienceList(data.profile.experience || []);
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
      const res = await apiFetch(`${apiBase}/api/settings/kill-switch`, {
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
      const res = await apiFetch(`${apiBase}/api/settings/dry-run`, {
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
      const titleExclude = titleExcludeText
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const companyBlacklist = companyBlacklistText
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      const locations = locationsText
        .split(',')
        .map((l) => l.trim())
        .filter(Boolean);

      const parsedMinSalary = minSalary.trim() ? Number(minSalary) : null;
      const parsedExpMin = expRangeMin.trim() ? Number(expRangeMin) : undefined;
      const parsedExpMax = expRangeMax.trim() ? Number(expRangeMax) : undefined;
      const linksRecord: Record<string, string> = {};
      for (const link of linksList) {
        const k = link.label.trim();
        const v = link.url.trim();
        if (k && v) linksRecord[k] = v;
      }

      const payload = {
        name,
        email,
        skills,
        experience_years: Number(experienceYears) || 0,
        experience: experienceList,
        education: profile?.education || [],
        preferences: {
          ...(profile?.preferences || {}),
          locations,
          workplace_type: workplaceType,
          remote: workplaceType === 'remote',
          manual_daily_target: Math.max(1, Number(manualDailyTarget) || 10),
        },
        answers: {
          ...(profile?.answers || {}),
          notice_period: noticePeriod.trim() || 'Immediate',
          current_ctc: currentCtc.trim() || 'N/A',
          expected_ctc: expectedCtc.trim() || 'Competitive',
          work_authorisation: workAuth.trim() || 'Authorized',
          links: linksRecord,
          other: profile?.answers?.other || {},
        },
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
          max_follow_ups: Math.min(5, Math.max(0, Number(maxFollowUps) || 0)),
        },
        filters: {
          ...(profile?.filters || {}),
          titles,
          title_exclude: titleExclude,
          locations,
          workplace_type: workplaceType,
          remote: workplaceType === 'remote',
          company_blacklist: companyBlacklist,
          min_score: Number(minScore),
          min_salary: Number.isFinite(parsedMinSalary) ? parsedMinSalary : null,
          salary_currency: salaryCurrency.trim() || 'USD',
          require_salary: requireSalary,
          experience_range:
            parsedExpMin !== undefined || parsedExpMax !== undefined
              ? {
                  ...(parsedExpMin !== undefined && Number.isFinite(parsedExpMin)
                    ? { min: parsedExpMin }
                    : {}),
                  ...(parsedExpMax !== undefined && Number.isFinite(parsedExpMax)
                    ? { max: parsedExpMax }
                    : {}),
                }
              : undefined,
        },
      };

      const res = await apiFetch(`${apiBase}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: payload }),
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
                htmlFor="title-exclude-input"
                className="block text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-1.5"
              >
                Excluded Title Keywords (comma-separated)
              </label>
              <input
                id="title-exclude-input"
                type="text"
                value={titleExcludeText}
                onChange={(e) => setTitleExcludeText(e.target.value)}
                placeholder="telecom, network operations, qa, manager"
                className="w-full text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </div>

            <div>
              <label
                htmlFor="locations-filter-input"
                className="block text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-1.5"
              >
                Target Locations (comma-separated, e.g. India, Bengaluru, Dubai, UAE, Remote)
              </label>
              <input
                id="locations-filter-input"
                type="text"
                value={locationsText}
                onChange={(e) => setLocationsText(e.target.value)}
                placeholder="India, Bengaluru, Dubai, UAE, Remote"
                className="w-full text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </div>

            <div>
              <label
                htmlFor="workplace-type-select"
                className="block text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-1.5"
              >
                Workplace Preference
              </label>
              <select
                id="workplace-type-select"
                value={workplaceType}
                onChange={(e) =>
                  setWorkplaceType(
                    e.target.value as 'all' | 'remote' | 'hybrid' | 'remote_and_hybrid' | 'onsite',
                  )
                }
                className="w-full text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <option value="all">All Opportunities (Remote, Hybrid & On-site)</option>
                <option value="remote_and_hybrid">Remote & Hybrid Only</option>
                <option value="remote">Remote Only</option>
                <option value="hybrid">Hybrid Only</option>
                <option value="onsite">On-site Only</option>
              </select>
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

          {/* Compensation, Experience & Manual Queue Target */}
          <div className="space-y-4 pt-4 border-t border-border">
            <h4 className="text-[12px] font-medium uppercase tracking-wider text-fg-muted">
              Compensation, Experience &amp; Daily Target
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div>
                <label
                  htmlFor="experience-years-input"
                  className="block text-[11px] font-medium uppercase tracking-wider text-fg-muted mb-1"
                >
                  Years Exp
                </label>
                <input
                  id="experience-years-input"
                  type="number"
                  min={0}
                  max={60}
                  value={experienceYears}
                  onChange={(e) => setExperienceYears(Number(e.target.value))}
                  className="w-full text-[13px] font-mono tabular-nums px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>

              <div>
                <label
                  htmlFor="exp-range-min-input"
                  className="block text-[11px] font-medium uppercase tracking-wider text-fg-muted mb-1"
                >
                  Filter Min Exp
                </label>
                <input
                  id="exp-range-min-input"
                  type="number"
                  min={0}
                  value={expRangeMin}
                  onChange={(e) => setExpRangeMin(e.target.value)}
                  placeholder="Any"
                  className="w-full text-[13px] font-mono tabular-nums px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>

              <div>
                <label
                  htmlFor="exp-range-max-input"
                  className="block text-[11px] font-medium uppercase tracking-wider text-fg-muted mb-1"
                >
                  Filter Max Exp
                </label>
                <input
                  id="exp-range-max-input"
                  type="number"
                  min={0}
                  value={expRangeMax}
                  onChange={(e) => setExpRangeMax(e.target.value)}
                  placeholder="Any"
                  className="w-full text-[13px] font-mono tabular-nums px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>

              <div>
                <label
                  htmlFor="min-salary-input"
                  className="block text-[11px] font-medium uppercase tracking-wider text-fg-muted mb-1"
                >
                  Min Salary
                </label>
                <input
                  id="min-salary-input"
                  type="number"
                  min={0}
                  value={minSalary}
                  onChange={(e) => setMinSalary(e.target.value)}
                  placeholder="Optional"
                  className="w-full text-[13px] font-mono tabular-nums px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>

              <div>
                <label
                  htmlFor="salary-currency-input"
                  className="block text-[11px] font-medium uppercase tracking-wider text-fg-muted mb-1"
                >
                  Currency
                </label>
                <input
                  id="salary-currency-input"
                  type="text"
                  maxLength={10}
                  value={salaryCurrency}
                  onChange={(e) => setSalaryCurrency(e.target.value.toUpperCase())}
                  placeholder="USD / INR"
                  className="w-full text-[13px] font-mono px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>

              <div>
                <label
                  htmlFor="manual-daily-target-input"
                  className="block text-[11px] font-medium uppercase tracking-wider text-fg-muted mb-1"
                >
                  Focus Target
                </label>
                <input
                  id="manual-daily-target-input"
                  type="number"
                  min={1}
                  max={50}
                  value={manualDailyTarget}
                  onChange={(e) => setManualDailyTarget(Number(e.target.value))}
                  className="w-full text-[13px] font-mono tabular-nums px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>
            </div>

            <label className="inline-flex items-center gap-2 text-[12px] text-fg-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={requireSalary}
                onChange={(e) => setRequireSalary(e.target.checked)}
                className="rounded border-border text-accent"
              />
              <span>Filter out postings that do not list a salary</span>
            </label>
          </div>

          {/* Quick-Copy Application Answers & Links */}
          <div className="space-y-4 pt-4 border-t border-border">
            <h4 className="text-[12px] font-medium uppercase tracking-wider text-fg-muted">
              Quick-Copy Application Answers &amp; Profile Links
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label
                  htmlFor="answer-notice-input"
                  className="block text-[11px] font-medium uppercase tracking-wider text-fg-muted mb-1"
                >
                  Notice Period
                </label>
                <input
                  id="answer-notice-input"
                  type="text"
                  value={noticePeriod}
                  onChange={(e) => setNoticePeriod(e.target.value)}
                  className="w-full text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>
              <div>
                <label
                  htmlFor="answer-current-ctc-input"
                  className="block text-[11px] font-medium uppercase tracking-wider text-fg-muted mb-1"
                >
                  Current Comp / CTC
                </label>
                <input
                  id="answer-current-ctc-input"
                  type="text"
                  value={currentCtc}
                  onChange={(e) => setCurrentCtc(e.target.value)}
                  className="w-full text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>
              <div>
                <label
                  htmlFor="answer-expected-ctc-input"
                  className="block text-[11px] font-medium uppercase tracking-wider text-fg-muted mb-1"
                >
                  Expected Comp / CTC
                </label>
                <input
                  id="answer-expected-ctc-input"
                  type="text"
                  value={expectedCtc}
                  onChange={(e) => setExpectedCtc(e.target.value)}
                  className="w-full text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>
              <div>
                <label
                  htmlFor="answer-work-auth-input"
                  className="block text-[11px] font-medium uppercase tracking-wider text-fg-muted mb-1"
                >
                  Work Authorisation
                </label>
                <input
                  id="answer-work-auth-input"
                  type="text"
                  value={workAuth}
                  onChange={(e) => setWorkAuth(e.target.value)}
                  className="w-full text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wider text-fg-muted">
                  Quick-Copy Links (GitHub, LinkedIn, Portfolio)
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="xs"
                  onClick={() => setLinksList((prev) => [...prev, { label: '', url: '' }])}
                >
                  <Plus size={12} className="mr-1" /> Add Link
                </Button>
              </div>
              {linksList.map((item, idx) => (
                <div key={idx} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                  <input
                    type="text"
                    value={item.label}
                    onChange={(e) =>
                      setLinksList((prev) =>
                        prev.map((l, i) => (i === idx ? { ...l, label: e.target.value } : l)),
                      )
                    }
                    placeholder="Label (e.g. GitHub)"
                    className="sm:col-span-3 text-[12px] px-2.5 py-1.5 rounded-[6px] border border-border bg-surface text-fg"
                  />
                  <input
                    type="url"
                    value={item.url}
                    onChange={(e) =>
                      setLinksList((prev) =>
                        prev.map((l, i) => (i === idx ? { ...l, url: e.target.value } : l)),
                      )
                    }
                    placeholder="https://..."
                    className="sm:col-span-8 text-[12px] font-mono px-2.5 py-1.5 rounded-[6px] border border-border bg-surface text-fg"
                  />
                  <button
                    type="button"
                    onClick={() => setLinksList((prev) => prev.filter((_, i) => i !== idx))}
                    aria-label="Remove link"
                    className="sm:col-span-1 text-fg-muted hover:text-state-danger-fg cursor-pointer justify-self-end p-1"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Work Experience & Projects Section */}
          <div className="space-y-4 pt-6 border-t border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Briefcase
                  size={16}
                  strokeWidth={1.5}
                  className="text-fg-muted shrink-0"
                  aria-hidden="true"
                />
                <h3 className="text-[12px] font-medium uppercase tracking-wider text-fg-muted">
                  Work Experience &amp; Projects
                </h3>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={addExperience}
                className="flex items-center gap-1.5 text-[12px]"
              >
                <Plus size={14} /> Add Role
              </Button>
            </div>

            {experienceList.length === 0 ? (
              <div className="p-4 rounded-[6px] border border-dashed border-border text-center text-fg-muted text-[13px]">
                No work experience entries added yet. Click &quot;Add Role&quot; to add your professional experience.
              </div>
            ) : (
              <div className="space-y-4">
                {experienceList.map((exp, idx) => (
                  <div
                    key={idx}
                    className="p-4 rounded-[6px] border border-border bg-surface-subtle/30 space-y-3"
                  >
                    <div className="flex items-center justify-between border-b border-border pb-2">
                      <span className="text-[13px] font-semibold text-fg">
                        {exp.title || 'Untitled Role'} {exp.company ? `at ${exp.company}` : ''}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeExperience(idx)}
                        className="text-fg-muted hover:text-state-danger-fg text-[12px] flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <Trash2 size={13} /> Remove
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium uppercase tracking-wider text-fg-muted mb-1">
                          Job Title / Role
                        </label>
                        <input
                          type="text"
                          value={exp.title}
                          onChange={(e) => updateExperience(idx, { title: e.target.value })}
                          placeholder="e.g. Flutter Developer"
                          className="w-full text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium uppercase tracking-wider text-fg-muted mb-1">
                          Company / Organization
                        </label>
                        <input
                          type="text"
                          value={exp.company}
                          onChange={(e) => updateExperience(idx, { company: e.target.value })}
                          placeholder="e.g. Texol iCohort Business Ventures"
                          className="w-full text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium uppercase tracking-wider text-fg-muted mb-1">
                          Start Date
                        </label>
                        <input
                          type="text"
                          value={exp.start_date || ''}
                          onChange={(e) => updateExperience(idx, { start_date: e.target.value })}
                          placeholder="MM/YYYY (e.g. 02/2025)"
                          className="w-full text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium uppercase tracking-wider text-fg-muted mb-1">
                          End Date
                        </label>
                        <input
                          type="text"
                          value={exp.end_date || ''}
                          onChange={(e) => updateExperience(idx, { end_date: e.target.value })}
                          placeholder="MM/YYYY or Present"
                          className="w-full text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        />
                      </div>
                      <div className="flex items-center gap-2 sm:pt-6">
                        <input
                          type="checkbox"
                          id={`current-role-${idx}`}
                          checked={Boolean(exp.current)}
                          onChange={(e) => updateExperience(idx, { current: e.target.checked })}
                          className="rounded border-border text-accent focus:ring-accent"
                        />
                        <label htmlFor={`current-role-${idx}`} className="text-[12px] text-fg select-none">
                          Current Role
                        </label>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium uppercase tracking-wider text-fg-muted mb-1">
                        Company &amp; Domain Overview
                      </label>
                      <input
                        type="text"
                        value={exp.description || ''}
                        onChange={(e) => updateExperience(idx, { description: e.target.value })}
                        placeholder="Brief summary of company domain, team, or responsibilities"
                        className="w-full text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium uppercase tracking-wider text-fg-muted mb-1">
                        Bullet Points &amp; Projects (one per line)
                      </label>
                      <textarea
                        rows={4}
                        value={(exp.highlights || []).join('\n')}
                        onChange={(e) => {
                          const lines = e.target.value
                            .split('\n')
                            .map((l) => l.trim())
                            .filter(Boolean);
                          updateExperience(idx, { highlights: lines });
                        }}
                        placeholder="• Architected scalable mobile applications using Flutter and Dart&#10;• Integrated Firebase Crashlytics..."
                        className="w-full text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent font-sans"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
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

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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

              <div>
                <label
                  htmlFor="max-follow-ups-input"
                  className="block text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-1.5"
                >
                  Max Follow-ups (0 - 5)
                </label>
                <input
                  id="max-follow-ups-input"
                  type="number"
                  min={0}
                  max={5}
                  value={maxFollowUps}
                  onChange={(e) => setMaxFollowUps(Number(e.target.value))}
                  className="w-full text-[13px] font-mono tabular-nums px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
                <p className="text-[11px] text-fg-muted mt-1">
                  Follow-up email drafts created after 6 business days with no reply.
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

          <DncAndDataSettings apiBase={apiBase} onRefresh={onRefresh} />
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
