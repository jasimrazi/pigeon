import React, { useState, useEffect } from 'react';
import type { SettingFieldSummary } from '@pigeon/shared';
import {
  Cloud,
  FileSpreadsheet,
  Cpu,
  Bell,
  Mail,
  Copy,
  Check,
  ExternalLink,
  ChevronDown,
  AlertTriangle,
  Play,
  RotateCw,
} from 'lucide-react';
import { Button } from './ui/Button.js';
import { StatusChip } from './ui/StatusChip.js';
import { SecretSettingField } from './SecretSettingField.js';
import { ConfirmationModal } from './ConfirmationModal.js';

interface Props {
  apiBase?: string;
  settings: SettingFieldSummary[];
  authHealth?:
    | { status: 'ok' | 'invalid' | 'unknown'; reason: string | null; checked_at: string | null }
    | undefined;
  connectedAccountEmail?: string | undefined;
  onRefreshSettings: () => Promise<void>;
  disabled?: boolean;
}

interface TestResult {
  ok: boolean;
  message: string;
}

export function IntegrationsSettings({
  apiBase = '',
  settings,
  authHealth,
  connectedAccountEmail,
  onRefreshSettings,
  disabled = false,
}: Props): React.JSX.Element {
  // Helper to find setting summary
  const getSummary = (key: string): SettingFieldSummary | undefined =>
    settings.find((s) => s.key === key);

  // Card 1: Google Cloud
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleClientSecret, setGoogleClientSecret] = useState('');
  const [savingGoogle, setSavingGoogle] = useState(false);
  const [showGoogleConfirm, setShowGoogleConfirm] = useState(false);
  const [pendingGoogleAction, setPendingGoogleAction] = useState<'save' | 'clear' | null>(null);
  const [pendingGoogleClearKey, setPendingGoogleClearKey] = useState<string | null>(null);
  const [copiedRedirect, setCopiedRedirect] = useState(false);

  // Card 2: Google Sheets
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [sheetTabApps, setSheetTabApps] = useState('');
  const [sheetTabMetrics, setSheetTabMetrics] = useState('');
  const [savingSheets, setSavingSheets] = useState(false);
  const [testingSheets, setTestingSheets] = useState(false);
  const [sheetsTestResult, setSheetsTestResult] = useState<TestResult | null>(null);
  const [showSheetsConfirm, setShowSheetsConfirm] = useState(false);

  // Card 3: LLM
  const [llmProvider, setLlmProvider] = useState<'workers-ai' | 'gemini'>('workers-ai');
  const [llmModel, setLlmModel] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [savingLlm, setSavingLlm] = useState(false);
  const [testingLlm, setTestingLlm] = useState(false);
  const [llmTestResult, setLlmTestResult] = useState<TestResult | null>(null);

  // Card 4: Telegram
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [savingTelegram, setSavingTelegram] = useState(false);
  const [testingTelegram, setTestingTelegram] = useState(false);
  const [telegramTestResult, setTelegramTestResult] = useState<TestResult | null>(null);

  // Card 5: Identity
  const [userAgentEmail, setUserAgentEmail] = useState('');
  const [timezone, setTimezone] = useState('');
  const [alertForwarding, setAlertForwarding] = useState('');
  const [savingIdentity, setSavingIdentity] = useState(false);

  // General feedback
  const [cardFeedback, setCardFeedback] = useState<
    Record<string, { type: 'success' | 'error'; message: string }>
  >({});

  // Populate local form fields from settings summary
  useEffect(() => {
    const sId = getSummary('GOOGLE_SHEET_ID')?.value || '';
    setSpreadsheetId(sId);
    setSheetTabApps(getSummary('SHEET_TAB_APPLICATIONS')?.value || 'Applications');
    setSheetTabMetrics(getSummary('SHEET_TAB_METRICS')?.value || 'Metrics');

    const providerVal = getSummary('LLM_PROVIDER')?.value;
    setLlmProvider(providerVal === 'gemini' ? 'gemini' : 'workers-ai');
    setLlmModel(getSummary('LLM_MODEL')?.value || '@cf/meta/llama-3.3-70b-instruct');

    setTelegramChatId(getSummary('TELEGRAM_CHAT_ID')?.value || '');

    setUserAgentEmail(getSummary('USER_AGENT_CONTACT_EMAIL')?.value || '');
    setTimezone(getSummary('TIMEZONE')?.value || 'UTC');
    setAlertForwarding(getSummary('ALERT_FORWARDING_ADDRESS')?.value || '');
  }, [settings]);

  const computedRedirectUri =
    typeof window !== 'undefined' ? `${window.location.origin}/auth/google/callback` : '';

  const handleCopyRedirectUri = async () => {
    try {
      await navigator.clipboard.writeText(computedRedirectUri);
      setCopiedRedirect(true);
      setTimeout(() => setCopiedRedirect(false), 2000);
    } catch {
      // Fallback
    }
  };

  const updateSetting = async (key: string, value: string) => {
    const res = await fetch(`${apiBase}/api/settings/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    if (!res.ok) {
      const errJson = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errJson.error || `Failed to update ${key} (${res.status})`);
    }
  };

  const clearSetting = async (key: string) => {
    const res = await fetch(`${apiBase}/api/settings/${key}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const errJson = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errJson.error || `Failed to clear ${key} (${res.status})`);
    }
  };

  // Google Cloud Save / Clear logic
  const handleSaveGoogle = async () => {
    try {
      setSavingGoogle(true);
      setCardFeedback((prev) => ({ ...prev, google: { type: 'success', message: '' } }));

      if (googleClientId) {
        await updateSetting('GOOGLE_CLIENT_ID', googleClientId);
      }
      if (googleClientSecret) {
        await updateSetting('GOOGLE_CLIENT_SECRET', googleClientSecret);
      }

      setGoogleClientId('');
      setGoogleClientSecret('');
      await onRefreshSettings();
      setCardFeedback((prev) => ({
        ...prev,
        google: { type: 'success', message: 'Google Cloud credentials updated.' },
      }));
    } catch (err) {
      setCardFeedback((prev) => ({
        ...prev,
        google: { type: 'error', message: err instanceof Error ? err.message : String(err) },
      }));
    } finally {
      setSavingGoogle(false);
      setShowGoogleConfirm(false);
      setPendingGoogleAction(null);
    }
  };

  const handleClearGoogleSecret = async (key: string) => {
    setPendingGoogleClearKey(key);
    setPendingGoogleAction('clear');
    setShowGoogleConfirm(true);
  };

  const executeClearGoogle = async () => {
    if (!pendingGoogleClearKey) return;
    try {
      setSavingGoogle(true);
      await clearSetting(pendingGoogleClearKey);
      await onRefreshSettings();
      setCardFeedback((prev) => ({
        ...prev,
        google: { type: 'success', message: `Cleared ${pendingGoogleClearKey}.` },
      }));
    } catch (err) {
      setCardFeedback((prev) => ({
        ...prev,
        google: { type: 'error', message: err instanceof Error ? err.message : String(err) },
      }));
    } finally {
      setSavingGoogle(false);
      setShowGoogleConfirm(false);
      setPendingGoogleClearKey(null);
      setPendingGoogleAction(null);
    }
  };

  // Google Sheets Save logic
  const handleSaveSheets = async () => {
    try {
      setSavingSheets(true);
      setSheetsTestResult(null);
      await updateSetting('GOOGLE_SHEET_ID', spreadsheetId);
      await updateSetting('SHEET_TAB_APPLICATIONS', sheetTabApps);
      await updateSetting('SHEET_TAB_METRICS', sheetTabMetrics);
      await onRefreshSettings();
      setCardFeedback((prev) => ({
        ...prev,
        sheets: { type: 'success', message: 'Google Sheets configuration saved.' },
      }));
    } catch (err) {
      setCardFeedback((prev) => ({
        ...prev,
        sheets: { type: 'error', message: err instanceof Error ? err.message : String(err) },
      }));
    } finally {
      setSavingSheets(false);
      setShowSheetsConfirm(false);
    }
  };

  const handleTestSheets = async () => {
    try {
      setTestingSheets(true);
      setSheetsTestResult(null);
      const res = await fetch(`${apiBase}/api/settings/test/sheets`, {
        method: 'POST',
      });
      const data = (await res.json()) as { ok: boolean; message: string };
      setSheetsTestResult(data);
    } catch (err) {
      setSheetsTestResult({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTestingSheets(false);
    }
  };

  // LLM Save logic
  const handleSaveLlm = async () => {
    try {
      setSavingLlm(true);
      setLlmTestResult(null);
      await updateSetting('LLM_PROVIDER', llmProvider);
      await updateSetting('LLM_MODEL', llmModel);
      if (llmProvider === 'gemini' && geminiApiKey) {
        await updateSetting('GEMINI_API_KEY', geminiApiKey);
        setGeminiApiKey('');
      }
      await onRefreshSettings();
      setCardFeedback((prev) => ({
        ...prev,
        llm: {
          type: 'success',
          message: 'LLM configuration saved. New drafts will use this model.',
        },
      }));
    } catch (err) {
      setCardFeedback((prev) => ({
        ...prev,
        llm: { type: 'error', message: err instanceof Error ? err.message : String(err) },
      }));
    } finally {
      setSavingLlm(false);
    }
  };

  const handleTestLlm = async () => {
    try {
      setTestingLlm(true);
      setLlmTestResult(null);
      const res = await fetch(`${apiBase}/api/settings/test/llm`, {
        method: 'POST',
      });
      const data = (await res.json()) as { ok: boolean; message: string };
      setLlmTestResult(data);
    } catch (err) {
      setLlmTestResult({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTestingLlm(false);
    }
  };

  // Telegram Save logic
  const handleSaveTelegram = async () => {
    try {
      setSavingTelegram(true);
      setTelegramTestResult(null);
      if (telegramToken) {
        await updateSetting('TELEGRAM_BOT_TOKEN', telegramToken);
        setTelegramToken('');
      }
      await updateSetting('TELEGRAM_CHAT_ID', telegramChatId);
      await onRefreshSettings();
      setCardFeedback((prev) => ({
        ...prev,
        telegram: { type: 'success', message: 'Notifications configuration saved.' },
      }));
    } catch (err) {
      setCardFeedback((prev) => ({
        ...prev,
        telegram: { type: 'error', message: err instanceof Error ? err.message : String(err) },
      }));
    } finally {
      setSavingTelegram(false);
    }
  };

  const handleTestTelegram = async () => {
    try {
      setTestingTelegram(true);
      setTelegramTestResult(null);
      const res = await fetch(`${apiBase}/api/settings/test/telegram`, {
        method: 'POST',
      });
      const data = (await res.json()) as { ok: boolean; message: string };
      setTelegramTestResult(data);
    } catch (err) {
      setTelegramTestResult({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTestingTelegram(false);
    }
  };

  // Identity Save logic
  const handleSaveIdentity = async () => {
    try {
      setSavingIdentity(true);
      await updateSetting('USER_AGENT_CONTACT_EMAIL', userAgentEmail);
      await updateSetting('TIMEZONE', timezone);
      if (alertForwarding) {
        await updateSetting('ALERT_FORWARDING_ADDRESS', alertForwarding);
      } else if (getSummary('ALERT_FORWARDING_ADDRESS')?.isSet) {
        await clearSetting('ALERT_FORWARDING_ADDRESS');
      }
      await onRefreshSettings();
      setCardFeedback((prev) => ({
        ...prev,
        identity: { type: 'success', message: 'Sending identity settings saved.' },
      }));
    } catch (err) {
      setCardFeedback((prev) => ({
        ...prev,
        identity: { type: 'error', message: err instanceof Error ? err.message : String(err) },
      }));
    } finally {
      setSavingIdentity(false);
    }
  };

  // Determine unsaved states
  const hasUnsavedGoogle = Boolean(googleClientId || googleClientSecret);
  const currentSheetId = getSummary('GOOGLE_SHEET_ID')?.value || '';
  const currentSheetApps = getSummary('SHEET_TAB_APPLICATIONS')?.value || 'Applications';
  const currentSheetMetrics = getSummary('SHEET_TAB_METRICS')?.value || 'Metrics';
  const hasUnsavedSheets =
    spreadsheetId !== currentSheetId ||
    sheetTabApps !== currentSheetApps ||
    sheetTabMetrics !== currentSheetMetrics;

  const currentProvider = getSummary('LLM_PROVIDER')?.value || 'workers-ai';
  const currentModel = getSummary('LLM_MODEL')?.value || '@cf/meta/llama-3.3-70b-instruct';
  const hasUnsavedLlm =
    llmProvider !== currentProvider ||
    llmModel !== currentModel ||
    Boolean(llmProvider === 'gemini' && geminiApiKey);

  const currentChatId = getSummary('TELEGRAM_CHAT_ID')?.value || '';
  const hasUnsavedTelegram = Boolean(telegramToken) || telegramChatId !== currentChatId;

  const currentUaEmail = getSummary('USER_AGENT_CONTACT_EMAIL')?.value || '';
  const currentTimezone = getSummary('TIMEZONE')?.value || 'UTC';
  const currentAlertFwd = getSummary('ALERT_FORWARDING_ADDRESS')?.value || '';
  const hasUnsavedIdentity =
    userAgentEmail !== currentUaEmail ||
    timezone !== currentTimezone ||
    alertForwarding !== currentAlertFwd;

  return (
    <div className="space-y-6">
      {/* CARD 1: Google Cloud */}
      <div className="bg-surface p-4 sm:p-6 rounded-[6px] border border-border space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex items-center gap-2.5">
            <Cloud size={18} strokeWidth={1.5} className="text-fg-muted shrink-0" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[14px] font-semibold text-fg">
                  Google Cloud & Gmail Connection
                </h3>
                {hasUnsavedGoogle && (
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-[4px] border border-state-warn-border bg-state-warn-bg text-state-warn-fg">
                    Unsaved changes
                  </span>
                )}
              </div>
              <p className="text-[12px] text-fg-muted mt-0.5">
                OAuth 2.0 Web application credentials for Gmail dispatch and Sheets synchronization.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <StatusChip
              variant={
                authHealth?.status === 'ok'
                  ? 'ok'
                  : authHealth?.status === 'invalid'
                    ? 'danger'
                    : 'unknown'
              }
              label={
                authHealth?.status === 'ok'
                  ? 'Connected & Healthy'
                  : authHealth?.status === 'invalid'
                    ? 'Action Required'
                    : 'Not Connected'
              }
            />
          </div>
        </div>

        {cardFeedback.google?.message && (
          <div
            className={`p-3 rounded-[6px] border text-[13px] ${
              cardFeedback.google.type === 'success'
                ? 'bg-state-ok-bg border-state-ok-border text-state-ok-fg'
                : 'bg-state-danger-bg border-state-danger-border text-state-danger-fg'
            }`}
          >
            {cardFeedback.google.message}
          </div>
        )}

        {/* 7-Day Refresh Token Warning */}
        <div className="p-3.5 rounded-[6px] border border-state-warn-border bg-state-warn-bg/40 flex items-start gap-2.5">
          <AlertTriangle
            size={16}
            strokeWidth={1.5}
            className="text-state-warn-fg shrink-0 mt-0.5"
          />
          <div className="text-[12px] text-fg leading-relaxed">
            <strong className="font-semibold text-state-warn-fg">Important: </strong>
            If your Google OAuth consent screen is set to <em>External</em> and left in{' '}
            <em>Testing</em> status, Google refresh tokens expire every 7 days. In Google Cloud
            Console, publish your OAuth consent screen to <strong>In production</strong> (the
            unverified app warning on sign-in is standard and safe for personal use).
          </div>
        </div>

        {/* Computed Redirect URI */}
        <div className="space-y-1.5">
          <label className="block text-[12px] font-medium uppercase tracking-wider text-fg-muted">
            Authorized Redirect URI
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={computedRedirectUri}
              className="flex-1 text-[13px] font-mono px-3 py-1.5 rounded-[6px] border border-border bg-surface-subtle text-fg select-all"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void handleCopyRedirectUri()}
              disabled={disabled}
              className="shrink-0"
            >
              {copiedRedirect ? (
                <>
                  <Check size={13} className="mr-1 text-state-ok-fg" />
                  Copied
                </>
              ) : (
                <>
                  <Copy size={13} className="mr-1" />
                  Copy
                </>
              )}
            </Button>
          </div>
          <p className="text-[11px] text-fg-muted">
            Paste this exact URL into the &quot;Authorized redirect URIs&quot; list in your Google
            Cloud Console OAuth client.
          </p>
        </div>

        {/* Client ID & Client Secret */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SecretSettingField
            id="google-client-id"
            label="Google Client ID"
            placeholder="xxxxxx.apps.googleusercontent.com"
            summary={getSummary('GOOGLE_CLIENT_ID')}
            value={googleClientId}
            onChange={setGoogleClientId}
            onClear={() => handleClearGoogleSecret('GOOGLE_CLIENT_ID')}
            disabled={disabled}
          />

          <SecretSettingField
            id="google-client-secret"
            label="Google Client Secret"
            placeholder="GOCSPX-xxxxxx"
            summary={getSummary('GOOGLE_CLIENT_SECRET')}
            value={googleClientSecret}
            onChange={setGoogleClientSecret}
            onClear={() => handleClearGoogleSecret('GOOGLE_CLIENT_SECRET')}
            disabled={disabled}
          />
        </div>

        {/* Collapsible How to get this */}
        <details className="text-[12px] text-fg-muted border border-border/70 rounded-[6px] p-3 bg-surface-subtle/40 group">
          <summary className="font-medium text-fg cursor-pointer select-none flex items-center justify-between">
            <span>How to get Google Cloud credentials</span>
            <ChevronDown size={14} className="group-open:rotate-180 transition-transform" />
          </summary>
          <ol className="mt-2.5 list-decimal list-inside space-y-1.5 pt-2 border-t border-border/50 text-[12px] leading-relaxed">
            <li>
              Go to{' '}
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noreferrer"
                className="text-accent underline font-medium inline-flex items-center gap-0.5"
              >
                Google Cloud Console Credentials
                <ExternalLink size={11} className="inline ml-0.5" />
              </a>
              .
            </li>
            <li>
              Configure OAuth Consent Screen: select <strong>External</strong>, then publish to{' '}
              <strong>Production</strong>.
            </li>
            <li>
              Click <strong>+ Create Credentials &gt; OAuth client ID</strong>. Application type:{' '}
              <strong>Web application</strong>.
            </li>
            <li>
              Add the Authorized Redirect URI shown above to &quot;Authorized redirect URIs&quot;.
            </li>
            <li>
              Copy the generated Client ID and Client Secret, paste them above, and click{' '}
              <strong>Save Google Credentials</strong>.
            </li>
            <li>
              Click <strong>Connect Google Account</strong> below to authorize access.
            </li>
          </ol>
        </details>

        {/* Actions Row */}
        <div className="pt-3 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-[12px] text-fg-muted">
            {connectedAccountEmail ? (
              <span>
                Connected as: <strong className="text-fg">{connectedAccountEmail}</strong>
              </span>
            ) : (
              <span>Not currently authenticated with Google.</span>
            )}
          </div>

          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                window.location.href = `${apiBase}/auth/google/start`;
              }}
              disabled={disabled}
              className="w-full sm:w-auto"
            >
              <RotateCw size={13} className="mr-1.5" />
              {authHealth?.status === 'ok' ? 'Reconnect Google Account' : 'Connect Google Account'}
            </Button>

            <Button
              type="button"
              variant="primary"
              size="sm"
              loading={savingGoogle}
              disabled={disabled || !hasUnsavedGoogle}
              onClick={() => {
                setPendingGoogleAction('save');
                setShowGoogleConfirm(true);
              }}
              className="w-full sm:w-auto"
            >
              Save Google Credentials
            </Button>
          </div>
        </div>
      </div>

      {/* CARD 2: Google Sheets */}
      <div className="bg-surface p-4 sm:p-6 rounded-[6px] border border-border space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex items-center gap-2.5">
            <FileSpreadsheet size={18} strokeWidth={1.5} className="text-fg-muted shrink-0" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[14px] font-semibold text-fg">Google Sheets Tracker</h3>
                {hasUnsavedSheets && (
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-[4px] border border-state-warn-border bg-state-warn-bg text-state-warn-fg">
                    Unsaved changes
                  </span>
                )}
              </div>
              <p className="text-[12px] text-fg-muted mt-0.5">
                One-way spreadsheet view of synced applications and summary performance metrics.
              </p>
            </div>
          </div>
        </div>

        {cardFeedback.sheets?.message && (
          <div
            className={`p-3 rounded-[6px] border text-[13px] ${
              cardFeedback.sheets.type === 'success'
                ? 'bg-state-ok-bg border-state-ok-border text-state-ok-fg'
                : 'bg-state-danger-bg border-state-danger-border text-state-danger-fg'
            }`}
          >
            {cardFeedback.sheets.message}
          </div>
        )}

        {sheetsTestResult && (
          <div
            className={`p-3 rounded-[6px] border text-[12px] ${
              sheetsTestResult.ok
                ? 'bg-state-ok-bg border-state-ok-border text-state-ok-fg'
                : 'bg-state-danger-bg border-state-danger-border text-state-danger-fg'
            }`}
          >
            <strong>
              {sheetsTestResult.ok ? 'Connection Verified: ' : 'Connection Test Failed: '}
            </strong>
            {sheetsTestResult.message}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label
              htmlFor="sheet-id-input"
              className="block text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-1"
            >
              Spreadsheet ID or URL
            </label>
            <input
              id="sheet-id-input"
              type="text"
              value={spreadsheetId}
              disabled={disabled}
              onChange={(e) => setSpreadsheetId(e.target.value)}
              placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms or paste full URL"
              className="w-full text-[13px] font-mono px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <p className="text-[11px] text-fg-muted mt-1">
              You can paste the entire Google Sheet URL; Pigeon automatically extracts and
              normalizes the ID.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="sheet-apps-tab-input"
                className="block text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-1"
              >
                Applications Tab Name
              </label>
              <input
                id="sheet-apps-tab-input"
                type="text"
                value={sheetTabApps}
                disabled={disabled}
                onChange={(e) => setSheetTabApps(e.target.value)}
                placeholder="Applications"
                className="w-full text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </div>

            <div>
              <label
                htmlFor="sheet-metrics-tab-input"
                className="block text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-1"
              >
                Metrics Tab Name
              </label>
              <input
                id="sheet-metrics-tab-input"
                type="text"
                value={sheetTabMetrics}
                disabled={disabled}
                onChange={(e) => setSheetTabMetrics(e.target.value)}
                placeholder="Metrics"
                className="w-full text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </div>
          </div>
        </div>

        <details className="text-[12px] text-fg-muted border border-border/70 rounded-[6px] p-3 bg-surface-subtle/40 group">
          <summary className="font-medium text-fg cursor-pointer select-none flex items-center justify-between">
            <span>How to get Google Sheets configuration</span>
            <ChevronDown size={14} className="group-open:rotate-180 transition-transform" />
          </summary>
          <ol className="mt-2.5 list-decimal list-inside space-y-1.5 pt-2 border-t border-border/50 text-[12px] leading-relaxed">
            <li>
              Create a new spreadsheet at{' '}
              <a
                href="https://sheets.new"
                target="_blank"
                rel="noreferrer"
                className="text-accent underline font-medium inline-flex items-center gap-0.5"
              >
                sheets.new
                <ExternalLink size={11} className="inline ml-0.5" />
              </a>
              .
            </li>
            <li>Copy the spreadsheet URL from your browser address bar and paste it above.</li>
            <li>
              Create tabs named &quot;Applications&quot; and &quot;Metrics&quot; in your
              spreadsheet.
            </li>
            <li>Ensure the connected Google account has write permission to the sheet.</li>
            <li>
              Click <strong>Test Sheets Connection</strong> to verify metadata access.
            </li>
          </ol>
        </details>

        <div className="pt-3 border-t border-border flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={testingSheets}
            disabled={disabled || !spreadsheetId}
            onClick={() => void handleTestSheets()}
            className="w-full sm:w-auto"
          >
            <Play size={13} className="mr-1.5" />
            Test Sheets Connection
          </Button>

          <Button
            type="button"
            variant="primary"
            size="sm"
            loading={savingSheets}
            disabled={disabled || !hasUnsavedSheets}
            onClick={() => {
              if (spreadsheetId !== currentSheetId && currentSheetId) {
                setShowSheetsConfirm(true);
              } else {
                void handleSaveSheets();
              }
            }}
            className="w-full sm:w-auto"
          >
            Save Sheets Settings
          </Button>
        </div>
      </div>

      {/* CARD 3: LLM Configuration */}
      <div className="bg-surface p-4 sm:p-6 rounded-[6px] border border-border space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex items-center gap-2.5">
            <Cpu size={18} strokeWidth={1.5} className="text-fg-muted shrink-0" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[14px] font-semibold text-fg">LLM Provider & Model</h3>
                {hasUnsavedLlm && (
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-[4px] border border-state-warn-border bg-state-warn-bg text-state-warn-fg">
                    Unsaved changes
                  </span>
                )}
              </div>
              <p className="text-[12px] text-fg-muted mt-0.5">
                Inference engine for parsing job criteria, calculating fit scores, and generating
                cover letters.
              </p>
            </div>
          </div>
        </div>

        {cardFeedback.llm?.message && (
          <div
            className={`p-3 rounded-[6px] border text-[13px] ${
              cardFeedback.llm.type === 'success'
                ? 'bg-state-ok-bg border-state-ok-border text-state-ok-fg'
                : 'bg-state-danger-bg border-state-danger-border text-state-danger-fg'
            }`}
          >
            {cardFeedback.llm.message}
          </div>
        )}

        {llmTestResult && (
          <div
            className={`p-3 rounded-[6px] border text-[12px] ${
              llmTestResult.ok
                ? 'bg-state-ok-bg border-state-ok-border text-state-ok-fg'
                : 'bg-state-danger-bg border-state-danger-border text-state-danger-fg'
            }`}
          >
            <strong>{llmTestResult.ok ? 'LLM Test Succeeded: ' : 'LLM Test Failed: '}</strong>
            {llmTestResult.message}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="llm-provider-select"
              className="block text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-1"
            >
              LLM Provider
            </label>
            <select
              id="llm-provider-select"
              value={llmProvider}
              disabled={disabled}
              onChange={(e) => {
                const nextProvider = e.target.value as 'workers-ai' | 'gemini';
                setLlmProvider(nextProvider);
                if (nextProvider === 'workers-ai' && !llmModel.startsWith('@cf/')) {
                  setLlmModel('@cf/meta/llama-3.3-70b-instruct');
                } else if (nextProvider === 'gemini' && llmModel.startsWith('@cf/')) {
                  setLlmModel('gemini-1.5-flash');
                }
              }}
              className="w-full text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <option value="workers-ai">
                Cloudflare Workers AI (Default, No API Key Required)
              </option>
              <option value="gemini">Google Gemini (Requires API Key)</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="llm-model-input"
              className="block text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-1"
            >
              Model Name / ID
            </label>
            <input
              id="llm-model-input"
              type="text"
              value={llmModel}
              disabled={disabled}
              onChange={(e) => setLlmModel(e.target.value)}
              placeholder={
                llmProvider === 'workers-ai'
                  ? '@cf/meta/llama-3.3-70b-instruct'
                  : 'gemini-1.5-flash'
              }
              className="w-full text-[13px] font-mono px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>
        </div>

        {llmProvider === 'gemini' ? (
          <SecretSettingField
            id="gemini-api-key"
            label="Gemini API Key"
            placeholder="AIzaSy..."
            summary={getSummary('GEMINI_API_KEY')}
            value={geminiApiKey}
            onChange={setGeminiApiKey}
            onClear={async () => {
              await clearSetting('GEMINI_API_KEY');
              await onRefreshSettings();
            }}
            disabled={disabled}
          />
        ) : (
          <div className="p-3 rounded-[6px] border border-border bg-surface-subtle/50 text-[12px] text-fg-muted">
            Cloudflare Workers AI runs directly inside your Cloudflare Workers environment and
            requires no API key.
          </div>
        )}

        <details className="text-[12px] text-fg-muted border border-border/70 rounded-[6px] p-3 bg-surface-subtle/40 group">
          <summary className="font-medium text-fg cursor-pointer select-none flex items-center justify-between">
            <span>How to get LLM keys and models</span>
            <ChevronDown size={14} className="group-open:rotate-180 transition-transform" />
          </summary>
          <div className="mt-2.5 space-y-2 pt-2 border-t border-border/50 text-[12px] leading-relaxed">
            <p>
              <strong>Workers AI:</strong> Included with Cloudflare Workers. Default recommended
              model is{' '}
              <code className="font-mono text-[11px] bg-surface-subtle px-1 py-0.5 rounded">
                @cf/meta/llama-3.3-70b-instruct
              </code>
              .
            </p>
            <p>
              <strong>Google Gemini:</strong> Visit{' '}
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-accent underline font-medium inline-flex items-center gap-0.5"
              >
                Google AI Studio API Keys
                <ExternalLink size={11} className="inline ml-0.5" />
              </a>
              , create a key, select &quot;gemini&quot; above, and paste your API key. Default model
              is{' '}
              <code className="font-mono text-[11px] bg-surface-subtle px-1 py-0.5 rounded">
                gemini-1.5-flash
              </code>
              .
            </p>
          </div>
        </details>

        <div className="pt-3 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <span className="text-[11px] text-fg-muted">
            Changes apply to newly routed jobs. Existing drafts keep their recorded model.
          </span>

          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto shrink-0">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={testingLlm}
              disabled={disabled}
              onClick={() => void handleTestLlm()}
              className="w-full sm:w-auto"
            >
              <Play size={13} className="mr-1.5" />
              Test LLM Completion
            </Button>

            <Button
              type="button"
              variant="primary"
              size="sm"
              loading={savingLlm}
              disabled={disabled || !hasUnsavedLlm}
              onClick={() => void handleSaveLlm()}
              className="w-full sm:w-auto"
            >
              Save LLM Settings
            </Button>
          </div>
        </div>
      </div>

      {/* CARD 4: Notifications (Telegram) */}
      <div className="bg-surface p-4 sm:p-6 rounded-[6px] border border-border space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex items-center gap-2.5">
            <Bell size={18} strokeWidth={1.5} className="text-fg-muted shrink-0" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[14px] font-semibold text-fg">
                  Notifications & Alerts (Telegram)
                </h3>
                {hasUnsavedTelegram && (
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-[4px] border border-state-warn-border bg-state-warn-bg text-state-warn-fg">
                    Unsaved changes
                  </span>
                )}
              </div>
              <p className="text-[12px] text-fg-muted mt-0.5">
                Instant alerts for daily send summaries, auth health alerts, and urgent manual
                review items.
              </p>
            </div>
          </div>
        </div>

        {cardFeedback.telegram?.message && (
          <div
            className={`p-3 rounded-[6px] border text-[13px] ${
              cardFeedback.telegram.type === 'success'
                ? 'bg-state-ok-bg border-state-ok-border text-state-ok-fg'
                : 'bg-state-danger-bg border-state-danger-border text-state-danger-fg'
            }`}
          >
            {cardFeedback.telegram.message}
          </div>
        )}

        {telegramTestResult && (
          <div
            className={`p-3 rounded-[6px] border text-[12px] ${
              telegramTestResult.ok
                ? 'bg-state-ok-bg border-state-ok-border text-state-ok-fg'
                : 'bg-state-danger-bg border-state-danger-border text-state-danger-fg'
            }`}
          >
            <strong>
              {telegramTestResult.ok ? 'Notification Sent: ' : 'Notification Failed: '}
            </strong>
            {telegramTestResult.message}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SecretSettingField
            id="telegram-bot-token"
            label="Telegram Bot Token"
            placeholder="123456789:ABCdefGhIJKlmNoPQRstUVwxyZ"
            summary={getSummary('TELEGRAM_BOT_TOKEN')}
            value={telegramToken}
            onChange={setTelegramToken}
            onClear={async () => {
              await clearSetting('TELEGRAM_BOT_TOKEN');
              await onRefreshSettings();
            }}
            disabled={disabled}
          />

          <div>
            <label
              htmlFor="telegram-chat-id-input"
              className="block text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-1"
            >
              Telegram Chat ID
            </label>
            <input
              id="telegram-chat-id-input"
              type="text"
              value={telegramChatId}
              disabled={disabled}
              onChange={(e) => setTelegramChatId(e.target.value)}
              placeholder="e.g. 987654321"
              className="w-full text-[13px] font-mono px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>
        </div>

        <details className="text-[12px] text-fg-muted border border-border/70 rounded-[6px] p-3 bg-surface-subtle/40 group">
          <summary className="font-medium text-fg cursor-pointer select-none flex items-center justify-between">
            <span>How to create a Telegram bot</span>
            <ChevronDown size={14} className="group-open:rotate-180 transition-transform" />
          </summary>
          <ol className="mt-2.5 list-decimal list-inside space-y-1.5 pt-2 border-t border-border/50 text-[12px] leading-relaxed">
            <li>
              Open Telegram and search for{' '}
              <a
                href="https://t.me/botfather"
                target="_blank"
                rel="noreferrer"
                className="text-accent underline font-medium inline-flex items-center gap-0.5"
              >
                @BotFather
                <ExternalLink size={11} className="inline ml-0.5" />
              </a>
              .
            </li>
            <li>
              Send <code>/newbot</code> and follow prompts to choose a display name and unique bot
              username.
            </li>
            <li>
              Copy the HTTP API token provided by BotFather and paste it into the Bot Token field
              above.
            </li>
            <li>
              Open your newly created bot in Telegram and press <strong>Start</strong>.
            </li>
            <li>
              Find your personal Chat ID by messaging <code>@userinfobot</code> in Telegram.
            </li>
            <li>
              Paste your Chat ID above and click <strong>Test Telegram Notification</strong>.
            </li>
          </ol>
        </details>

        <div className="pt-3 border-t border-border flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={testingTelegram}
            disabled={disabled || !getSummary('TELEGRAM_BOT_TOKEN')?.isSet}
            onClick={() => void handleTestTelegram()}
            className="w-full sm:w-auto"
          >
            <Play size={13} className="mr-1.5" />
            Test Telegram Notification
          </Button>

          <Button
            type="button"
            variant="primary"
            size="sm"
            loading={savingTelegram}
            disabled={disabled || !hasUnsavedTelegram}
            onClick={() => void handleSaveTelegram()}
            className="w-full sm:w-auto"
          >
            Save Notifications
          </Button>
        </div>
      </div>

      {/* CARD 5: Sending Identity */}
      <div className="bg-surface p-4 sm:p-6 rounded-[6px] border border-border space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex items-center gap-2.5">
            <Mail size={18} strokeWidth={1.5} className="text-fg-muted shrink-0" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[14px] font-semibold text-fg">Sending Identity & Headers</h3>
                {hasUnsavedIdentity && (
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-[4px] border border-state-warn-border bg-state-warn-bg text-state-warn-fg">
                    Unsaved changes
                  </span>
                )}
              </div>
              <p className="text-[12px] text-fg-muted mt-0.5">
                Contact information embedded in outbound HTTP requests and local timezone alignment.
              </p>
            </div>
          </div>
        </div>

        {cardFeedback.identity?.message && (
          <div
            className={`p-3 rounded-[6px] border text-[13px] ${
              cardFeedback.identity.type === 'success'
                ? 'bg-state-ok-bg border-state-ok-border text-state-ok-fg'
                : 'bg-state-danger-bg border-state-danger-border text-state-danger-fg'
            }`}
          >
            {cardFeedback.identity.message}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label
              htmlFor="ua-email-input"
              className="block text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-1"
            >
              User-Agent Contact Email
            </label>
            <input
              id="ua-email-input"
              type="email"
              value={userAgentEmail}
              disabled={disabled}
              onChange={(e) => setUserAgentEmail(e.target.value)}
              placeholder="operator@example.com"
              className="w-full text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>

          <div>
            <label
              htmlFor="timezone-setting-input"
              className="block text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-1"
            >
              System Timezone (IANA)
            </label>
            <input
              id="timezone-setting-input"
              type="text"
              value={timezone}
              disabled={disabled}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="UTC or America/New_York"
              className="w-full text-[13px] font-mono px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>

          <div>
            <label
              htmlFor="alert-fwd-input"
              className="block text-[12px] font-medium uppercase tracking-wider text-fg-muted mb-1"
            >
              Alert Forwarding Address (Optional)
            </label>
            <input
              id="alert-fwd-input"
              type="email"
              value={alertForwarding}
              disabled={disabled}
              onChange={(e) => setAlertForwarding(e.target.value)}
              placeholder="alerts@example.com"
              className="w-full text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>
        </div>

        <details className="text-[12px] text-fg-muted border border-border/70 rounded-[6px] p-3 bg-surface-subtle/40 group">
          <summary className="font-medium text-fg cursor-pointer select-none flex items-center justify-between">
            <span>Why is this required?</span>
            <ChevronDown size={14} className="group-open:rotate-180 transition-transform" />
          </summary>
          <div className="mt-2.5 space-y-1.5 pt-2 border-t border-border/50 text-[12px] leading-relaxed">
            <p>
              Public job endpoints and ATS feeds require a contact email in the User-Agent header so
              API administrators can notify you of rate limits or terms updates.
            </p>
            <p>
              The system timezone aligns daily send cap resets, ramp schedules, and dispatch windows
              to your local working hours.
            </p>
          </div>
        </details>

        <div className="pt-3 border-t border-border flex flex-col sm:flex-row items-stretch sm:items-center justify-end">
          <Button
            type="button"
            variant="primary"
            size="sm"
            loading={savingIdentity}
            disabled={disabled || !hasUnsavedIdentity}
            onClick={() => void handleSaveIdentity()}
            className="w-full sm:w-auto"
          >
            Save Sending Identity
          </Button>
        </div>
      </div>

      {/* Confirmation Modal for Google Cloud Credential Changes */}
      <ConfirmationModal
        isOpen={showGoogleConfirm}
        title="Invalidate Google Connection?"
        message="Changing or clearing Google client credentials will invalidate your active Google authorization and pause outgoing applications and Sheets sync until you reconnect your account."
        confirmLabel={pendingGoogleAction === 'clear' ? 'Clear Credentials' : 'Save & Disconnect'}
        isDanger={true}
        onConfirm={() => {
          if (pendingGoogleAction === 'clear') {
            void executeClearGoogle();
          } else {
            void handleSaveGoogle();
          }
        }}
        onCancel={() => {
          setShowGoogleConfirm(false);
          setPendingGoogleAction(null);
          setPendingGoogleClearKey(null);
        }}
      />

      {/* Confirmation Modal for Spreadsheet ID Change */}
      <ConfirmationModal
        isOpen={showSheetsConfirm}
        title="Change Google Spreadsheet ID?"
        message="Changing the Spreadsheet ID resets the synchronization cursors. Historical applications from D1 will be backfilled into the new spreadsheet. The existing spreadsheet will remain untouched."
        confirmLabel="Change Spreadsheet"
        isDanger={true}
        onConfirm={() => void handleSaveSheets()}
        onCancel={() => setShowSheetsConfirm(false)}
      />
    </div>
  );
}
