import React, { useCallback, useEffect, useState } from 'react';
import { Ban, Download, History, Plus, Trash2, Upload } from 'lucide-react';
import { getAppVersionInfo } from '@pigeon/shared';
import { Button } from './ui/Button.js';
import { useDialog } from './ui/DialogProvider.js';
import { useToast } from './ui/ToastProvider.js';
import { apiFetch } from '../api.js';

interface DncEntry {
  value: string;
  reason: string;
  created_at: string;
}

interface RecentContacted {
  company_normalized: string;
  last_contacted_at: string;
  last_channel: string;
}

interface ImportPreviewChange {
  key: string;
  oldValue: string;
  newValue: string;
}

interface Props {
  apiBase?: string | undefined;
  onRefresh?: (() => void) | undefined;
}

export function DncAndDataSettings({ apiBase = '', onRefresh }: Props): React.JSX.Element {
  const dialog = useDialog();
  const toast = useToast();
  const versionInfo = getAppVersionInfo();

  // DNC state
  const [entries, setEntries] = useState<DncEntry[]>([]);
  const [recentContacted, setRecentContacted] = useState<RecentContacted[]>([]);
  const [dncLoaded, setDncLoaded] = useState(false);
  const [newDncValue, setNewDncValue] = useState('');
  const [newDncReason, setNewDncReason] = useState('USER_BLOCKED');
  const [dismissPending, setDismissPending] = useState(true);
  const [savingDnc, setSavingDnc] = useState(false);

  // Export/Import state
  const [exporting, setExporting] = useState(false);
  const [importText, setImportText] = useState('');
  const [importPreview, setImportPreview] = useState<ImportPreviewChange[] | null>(null);
  const [importing, setImporting] = useState(false);

  // Retention purge state
  const [purging, setPurging] = useState(false);

  const loadDnc = useCallback(async () => {
    try {
      const res = await apiFetch(`${apiBase}/api/dnc`);
      if (!res.ok) return;
      const json = (await res.json()) as {
        ok?: boolean;
        entries?: DncEntry[];
        recentContacted?: RecentContacted[];
      };
      setEntries(json.entries || []);
      setRecentContacted(json.recentContacted || []);
      setDncLoaded(true);
    } catch {
      // Non-blocking if endpoint unavailable in isolated component tests
    }
  }, [apiBase]);

  useEffect(() => {
    void loadDnc();
  }, [loadDnc]);

  const handleAddDnc = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newDncValue.trim();
    if (!trimmed) return;
    try {
      setSavingDnc(true);
      const res = await apiFetch(`${apiBase}/api/dnc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          value: trimmed,
          reason: newDncReason.trim() || 'USER_BLOCKED',
          dismiss_pending: dismissPending,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        dismissedCount?: number;
      };
      if (!res.ok) {
        throw new Error(json.error || `Failed to add DNC (${res.status})`);
      }
      setNewDncValue('');
      const dismissedNote =
        json.dismissedCount && json.dismissedCount > 0
          ? ` Dismissed ${json.dismissedCount} pending application(s).`
          : '';
      toast.success(`Added "${trimmed.toLowerCase()}" to Do-Not-Contact.${dismissedNote}`);
      await loadDnc();
      onRefresh?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add DNC entry');
    } finally {
      setSavingDnc(false);
    }
  };

  const handleRemoveDnc = async (value: string) => {
    try {
      const res = await apiFetch(`${apiBase}/api/dnc/${encodeURIComponent(value)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        throw new Error(`Failed to remove DNC (${res.status})`);
      }
      toast.success(`Removed "${value}" from Do-Not-Contact.`);
      await loadDnc();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove DNC entry');
    }
  };

  const handleExportSettings = async () => {
    try {
      setExporting(true);
      const res = await apiFetch(`${apiBase}/api/settings/export`);
      if (!res.ok) {
        throw new Error(`Export failed (${res.status})`);
      }
      const json = (await res.json()) as { settings?: Record<string, string> };
      const payload = JSON.stringify({ settings: json.settings || {} }, null, 2);
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pigeon-settings-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Exported non-secret settings JSON.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleImportSettings = async (apply: boolean) => {
    try {
      setImporting(true);
      const parsed = JSON.parse(importText) as { settings?: Record<string, unknown> } | Record<string, unknown>;
      const settingsObj =
        parsed && typeof parsed === 'object' && 'settings' in parsed && parsed.settings
          ? parsed.settings
          : parsed;
      const res = await apiFetch(`${apiBase}/api/settings/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: settingsObj, apply }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        changes?: ImportPreviewChange[];
        imported?: number;
      };
      if (!res.ok) {
        throw new Error(json.error || `Import failed (${res.status})`);
      }
      if (!apply) {
        setImportPreview(json.changes || []);
        toast.info(`Preview ready: ${(json.changes || []).length} setting(s) checked.`);
      } else {
        setImportPreview(null);
        setImportText('');
        toast.success(`Imported ${json.imported ?? 0} setting(s).`);
        onRefresh?.();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid settings JSON');
    } finally {
      setImporting(false);
    }
  };

  const handleRetentionPurge = async () => {
    const confirmed = await dialog.confirm({
      title: 'Purge Stale Job Data?',
      message:
        'This deletes expired job descriptions (90+ days old) and old filtered/skipped jobs per retention policy. Submitted applications and events are preserved.',
      confirmLabel: 'Run Retention Purge',
      isDanger: true,
    });
    if (!confirmed) return;

    try {
      setPurging(true);
      const res = await apiFetch(`${apiBase}/api/retention/purge`, { method: 'POST' });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        purgedCount?: number;
        deletedFilteredCount?: number;
      };
      if (!res.ok) {
        throw new Error(json.error || `Purge failed (${res.status})`);
      }
      toast.success(
        `Retention purge complete: ${json.purgedCount ?? 0} description(s) scrubbed, ${json.deletedFilteredCount ?? 0} old filtered job(s) removed.`,
      );
      onRefresh?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Retention purge failed');
    } finally {
      setPurging(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Do-Not-Contact & 90-Day Cooldowns */}
      <div className="bg-surface p-5 rounded-[6px] border border-border space-y-4">
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <Ban size={16} strokeWidth={1.5} className="text-fg-muted shrink-0" aria-hidden="true" />
          <h3 className="text-[12px] font-medium uppercase tracking-wider text-fg-muted">
            Do-Not-Contact (DNC) &amp; Company Cooldowns
          </h3>
        </div>

        <form onSubmit={handleAddDnc} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              type="text"
              aria-label="DNC email, domain, or company"
              value={newDncValue}
              onChange={(e) => setNewDncValue(e.target.value)}
              placeholder="domain.com, hr@co.com, or Company"
              className="sm:col-span-2 text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <input
              type="text"
              aria-label="DNC reason"
              value={newDncReason}
              onChange={(e) => setNewDncReason(e.target.value)}
              placeholder="Reason (e.g. USER_BLOCKED)"
              className="text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-[12px] text-fg-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={dismissPending}
                onChange={(e) => setDismissPending(e.target.checked)}
                className="rounded border-border text-accent"
              />
              <span>Also dismiss currently pending applications for this match</span>
            </label>
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              icon={Plus}
              loading={savingDnc}
              disabled={!newDncValue.trim()}
            >
              Add to DNC
            </Button>
          </div>
        </form>

        {dncLoaded && entries.length === 0 ? (
          <p className="text-[12px] text-fg-muted">No Do-Not-Contact entries configured.</p>
        ) : (
          <div className="divide-y divide-border-subtle border border-border rounded-[6px] max-h-48 overflow-y-auto">
            {entries.map((entry) => (
              <div
                key={entry.value}
                className="flex items-center justify-between gap-3 px-3 py-2 text-[12px]"
              >
                <div className="min-w-0">
                  <span className="font-mono font-semibold text-fg">{entry.value}</span>
                  <span className="text-fg-muted ml-2">({entry.reason})</span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRemoveDnc(entry.value)}
                  aria-label={`Remove ${entry.value} from DNC`}
                  className="text-fg-muted hover:text-state-danger-fg cursor-pointer p-1"
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}

        {recentContacted.length > 0 && (
          <div className="pt-2 space-y-1.5">
            <div className="text-[11px] font-medium uppercase tracking-wider text-fg-muted">
              Recent Contacted Companies (90-Day Cooldown Guard)
            </div>
            <div className="flex flex-wrap gap-1.5">
              {recentContacted.slice(0, 12).map((c) => (
                <span
                  key={c.company_normalized}
                  className="text-[11px] font-mono px-2 py-0.5 rounded-[4px] bg-surface-subtle border border-border text-fg-muted"
                >
                  {c.company_normalized} · {new Date(c.last_contacted_at).toLocaleDateString()}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Config Export / Import & Data Retention */}
      <div className="bg-surface p-5 rounded-[6px] border border-border space-y-4">
        <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
          <div className="flex items-center gap-2">
            <History
              size={16}
              strokeWidth={1.5}
              className="text-fg-muted shrink-0"
              aria-hidden="true"
            />
            <h3 className="text-[12px] font-medium uppercase tracking-wider text-fg-muted">
              Data Hygiene, Export &amp; Build Version
            </h3>
          </div>
          <span
            data-testid="settings-version-counter"
            className="text-[11px] font-mono px-2 py-0.5 rounded-[4px] bg-surface-subtle border border-border text-fg"
          >
            {versionInfo.label}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            variant="secondary"
            size="sm"
            icon={Download}
            loading={exporting}
            onClick={() => void handleExportSettings()}
          >
            Export Settings JSON
          </Button>
          <Button
            variant="destructive"
            size="sm"
            icon={Trash2}
            loading={purging}
            onClick={() => void handleRetentionPurge()}
          >
            Run 90-Day Retention Purge
          </Button>
        </div>

        <div className="space-y-2 pt-2 border-t border-border-subtle">
          <label
            htmlFor="settings-import-json"
            className="block text-[12px] font-medium uppercase tracking-wider text-fg-muted"
          >
            Import Non-Secret Settings JSON
          </label>
          <textarea
            id="settings-import-json"
            rows={3}
            value={importText}
            onChange={(e) => {
              setImportText(e.target.value);
              setImportPreview(null);
            }}
            placeholder='{"settings":{"LLM_PROVIDER":"workers-ai"}}'
            className="w-full text-[12px] font-mono p-2.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="xs"
              icon={Upload}
              loading={importing}
              disabled={!importText.trim()}
              onClick={() => void handleImportSettings(false)}
            >
              Preview Diff
            </Button>
            {importPreview !== null && (
              <Button
                variant="primary"
                size="xs"
                loading={importing}
                onClick={() => void handleImportSettings(true)}
              >
                Apply {importPreview.length} Setting(s)
              </Button>
            )}
          </div>
          {importPreview && importPreview.length > 0 && (
            <div className="p-2.5 rounded-[6px] bg-surface-subtle border border-border text-[11px] font-mono space-y-1">
              {importPreview.map((ch) => (
                <div key={ch.key}>
                  <span className="font-semibold text-fg">{ch.key}:</span>{' '}
                  <span className="text-fg-muted">{ch.oldValue || '(empty)'}</span> -&gt;{' '}
                  <span className="text-accent">{ch.newValue}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
