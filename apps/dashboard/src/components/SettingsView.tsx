import React, { useState, useEffect, useCallback } from 'react';
import type { Profile } from '@pigeon/shared';
import { ConfirmationModal } from './ConfirmationModal.js';

interface SettingsData {
  ok: boolean;
  profile: Profile;
  dryRun: boolean;
  killSwitch: boolean;
}

interface Props {
  apiBase?: string;
  onRefresh?: () => void;
}

export function SettingsView({ apiBase = '', onRefresh }: Props): React.JSX.Element {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [killSwitch, setKillSwitch] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );

  // Kill Switch modal state
  const [showKsModal, setShowKsModal] = useState(false);
  const [targetKsState, setTargetKsState] = useState(false);

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
  const [autoApproveScore, setAutoApproveScore] = useState(85);
  const [titleFiltersText, setTitleFiltersText] = useState('');
  const [companyBlacklistText, setCompanyBlacklistText] = useState('');

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

  const handleToggleDryRun = async (activate: boolean) => {
    try {
      setSaving(true);
      const res = await fetch(`${apiBase}/api/settings/dry-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: activate }),
      });
      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errJson.error || `Failed to update DRY_RUN (${res.status})`);
      }
      setDryRun(activate);
      setFeedback({
        type: 'success',
        message: activate
          ? 'DRY_RUN mode enabled: emails will not be sent to real mailboxes.'
          : 'LIVE mode enabled: emails will be dispatched to real recipient inboxes.',
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
    if (!profile) return;

    try {
      setSaving(true);
      setFeedback(null);

      const parsedSkills = skillsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const parsedTitles = titleFiltersText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const parsedBlacklist = companyBlacklistText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const updatedProfile: Profile = {
        ...profile,
        name: name.trim(),
        email: email.trim(),
        skills: parsedSkills,
        send_settings: {
          daily_cap: Number(dailyCap),
          ramp_base: Number(rampBase),
          ramp_step: Number(rampStep),
          window: {
            start: windowStart.trim(),
            end: windowEnd.trim(),
          },
          timezone: timezone.trim(),
          auto_approve_above_score: Number(autoApproveScore),
          max_follow_ups: profile.send_settings?.max_follow_ups ?? 1,
        },
        filters: {
          ...profile.filters,
          titles: parsedTitles,
          company_blacklist: parsedBlacklist,
          locations: profile.filters?.locations ?? ['Remote'],
        },
      };

      const res = await fetch(`${apiBase}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: updatedProfile }),
      });

      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errJson.error || `Failed to save profile (${res.status})`);
      }

      const resData = (await res.json()) as { ok: boolean; profile: Profile };
      setProfile(resData.profile);
      setFeedback({
        type: 'success',
        message: 'Profile and send settings saved successfully!',
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

  if (loading && !profile) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500 text-sm">
        <span className="animate-spin mr-2">🔄</span> Loading configuration settings...
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
        <h2 className="text-base font-bold text-gray-900 flex items-center space-x-2">
          <span>⚙️</span>
          <span>System Settings & Operational Controls</span>
        </h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Configure profile facts, sending caps, ramp-up schedule, send window, and safety gates.
        </p>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-medium ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* Safety Gates Card */}
      <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm space-y-4">
        <h3 className="text-sm font-bold text-gray-900 border-b pb-2 flex items-center space-x-2">
          <span>🛡️</span>
          <span>Safety Gates & Emergency Controls</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Kill Switch Toggle */}
          <div
            className={`p-4 rounded-xl border ${
              killSwitch ? 'bg-rose-50 border-rose-300' : 'bg-gray-50 border-gray-200'
            }`}
          >
            <div className="flex items-start justify-between">
              <div>
                <span className="font-bold text-sm text-gray-900">Kill Switch</span>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                  Stored directly in KV. Checked dynamically before every email send attempt. When
                  active, no applications will be dispatched under any circumstances.
                </p>
              </div>
            </div>
            <div className="mt-4">
              <button
                type="button"
                onClick={() => {
                  setTargetKsState(!killSwitch);
                  setShowKsModal(true);
                }}
                disabled={saving}
                className={`w-full py-2 px-4 rounded-lg text-xs font-bold shadow-sm transition-colors cursor-pointer ${
                  killSwitch
                    ? 'bg-rose-600 hover:bg-rose-700 text-white'
                    : 'bg-gray-800 hover:bg-gray-900 text-white'
                }`}
              >
                {killSwitch ? '🚨 KILL SWITCH IS ACTIVE (Click to Disarm)' : 'Activate Kill Switch'}
              </button>
            </div>
          </div>

          {/* DRY RUN Toggle */}
          <div className="p-4 rounded-xl border bg-gray-50 border-gray-200">
            <div>
              <span className="font-bold text-sm text-gray-900">DRY_RUN Mode</span>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                When enabled, applications simulate the send pipeline without connecting to
                recipient mailboxes.
              </p>
            </div>
            <div className="mt-4">
              <button
                type="button"
                onClick={() => void handleToggleDryRun(!dryRun)}
                disabled={saving}
                className={`w-full py-2 px-4 rounded-lg text-xs font-bold shadow-sm transition-colors cursor-pointer ${
                  dryRun
                    ? 'bg-amber-500 hover:bg-amber-600 text-white'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                }`}
              >
                {dryRun ? 'DRY_RUN: ENABLED (Simulation)' : 'LIVE DISPATCH: ACTIVE'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Profile & Send Settings Form */}
      <form
        onSubmit={handleSaveProfile}
        className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-6"
      >
        <h3 className="text-sm font-bold text-gray-900 border-b pb-2 flex items-center space-x-2">
          <span>👤</span>
          <span>Profile & Candidate Information</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold uppercase text-gray-600 mb-1">
              Candidate Full Name
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full text-xs p-2.5 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-gray-600 mb-1">
              Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full text-xs p-2.5 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase text-gray-600 mb-1">
            Skills (comma-separated, strictly grounded in cover letters)
          </label>
          <input
            type="text"
            value={skillsText}
            onChange={(e) => setSkillsText(e.target.value)}
            className="w-full text-xs p-2.5 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="TypeScript, Cloudflare Workers, Distributed Systems, Node.js"
          />
        </div>

        <h3 className="text-sm font-bold text-gray-900 border-b pb-2 pt-2 flex items-center space-x-2">
          <span>📨</span>
          <span>Sending Rules & Schedule</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-bold uppercase text-gray-600 mb-1">
              Daily Send Cap (1 - 200)
            </label>
            <input
              type="number"
              min={1}
              max={200}
              required
              value={dailyCap}
              onChange={(e) => setDailyCap(Number(e.target.value))}
              className="w-full text-xs p-2.5 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-gray-600 mb-1">
              Ramp Base (initial daily cap)
            </label>
            <input
              type="number"
              min={1}
              value={rampBase}
              onChange={(e) => setRampBase(Number(e.target.value))}
              className="w-full text-xs p-2.5 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-gray-600 mb-1">
              Ramp Step (+sends per day)
            </label>
            <input
              type="number"
              min={1}
              value={rampStep}
              onChange={(e) => setRampStep(Number(e.target.value))}
              className="w-full text-xs p-2.5 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-bold uppercase text-gray-600 mb-1">
              Window Start (HH:MM)
            </label>
            <input
              type="text"
              required
              pattern="^([01]\d|2[0-3]):[0-5]\d$"
              value={windowStart}
              onChange={(e) => setWindowStart(e.target.value)}
              placeholder="09:00"
              className="w-full text-xs p-2.5 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-gray-600 mb-1">
              Window End (HH:MM)
            </label>
            <input
              type="text"
              required
              pattern="^([01]\d|2[0-3]):[0-5]\d$"
              value={windowEnd}
              onChange={(e) => setWindowEnd(e.target.value)}
              placeholder="18:00"
              className="w-full text-xs p-2.5 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-gray-600 mb-1">Timezone</label>
            <input
              type="text"
              required
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="UTC or Asia/Kolkata"
              className="w-full text-xs p-2.5 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold uppercase text-gray-600 mb-1">
              Auto-Approve Threshold Score (0 - 100)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={autoApproveScore}
              onChange={(e) => setAutoApproveScore(Number(e.target.value))}
              className="w-full text-xs p-2.5 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-[11px] text-gray-400 mt-1">
              Applications with match score above this threshold and trusted contact are eligible
              for safe bulk approval.
            </p>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-gray-600 mb-1">
              Company Blacklist (comma-separated)
            </label>
            <input
              type="text"
              value={companyBlacklistText}
              onChange={(e) => setCompanyBlacklistText(e.target.value)}
              placeholder="SpamCorp, BadCo, UnwantedVentures"
              className="w-full text-xs p-2.5 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div className="pt-4 border-t flex items-center justify-end">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg shadow-sm cursor-pointer disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving Settings...' : 'Save Settings'}
          </button>
        </div>
      </form>

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
    </div>
  );
}
