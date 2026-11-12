import React, { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  RefreshCw,
  Sliders,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { Button } from './ui/Button.js';
import { StatusChip } from './ui/StatusChip.js';

export interface SetupItem {
  id: string;
  name: string;
  status: 'ok' | 'missing' | 'invalid' | 'needs_action';
  message: string;
}

export interface SetupStatusResponse {
  items: SetupItem[];
  readyForDryRun: boolean;
  readyToGoLive: boolean;
}

interface Props {
  apiBase?: string;
  onNavigateTab?: (tab: string, subTab?: string) => void;
}

export function SetupView({ apiBase = '', onNavigateTab }: Props): React.JSX.Element {
  const [data, setData] = useState<SetupStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${apiBase}/api/setup/status`);
      if (!res.ok) {
        throw new Error(`Failed to load setup status (${res.status})`);
      }
      const json = (await res.json()) as SetupStatusResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const getItemAction = (item: SetupItem) => {
    switch (item.id) {
      case 'master_key':
        return null;
      case 'profile':
        return (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onNavigateTab?.('settings', 'profile')}
          >
            Configure Profile
          </Button>
        );
      case 'resume':
        return (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onNavigateTab?.('settings', 'resumes')}
          >
            Upload Resume
          </Button>
        );
      case 'llm':
      case 'google_oauth':
      case 'sheets':
      case 'telegram':
        return (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onNavigateTab?.('settings', 'integrations')}
          >
            Configure in Settings
          </Button>
        );
      case 'google_account':
        return (
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                window.location.href = `${apiBase}/auth/google/start`;
              }}
            >
              Connect Google Account
            </Button>
          </div>
        );
      default:
        return null;
    }
  };

  const getStatusIcon = (status: SetupItem['status']) => {
    switch (status) {
      case 'ok':
        return (
          <CheckCircle2
            size={18}
            strokeWidth={2}
            className="text-state-ok-fg shrink-0"
            aria-hidden="true"
          />
        );
      case 'needs_action':
      case 'invalid':
        return (
          <AlertCircle
            size={18}
            strokeWidth={2}
            className="text-state-danger-fg shrink-0"
            aria-hidden="true"
          />
        );
      default:
        return (
          <HelpCircle
            size={18}
            strokeWidth={2}
            className="text-state-unknown-fg shrink-0"
            aria-hidden="true"
          />
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="bg-surface p-5 rounded-[6px] border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Sliders
              size={18}
              strokeWidth={1.5}
              className="text-fg-muted shrink-0"
              aria-hidden="true"
            />
            <h1 className="text-[18px] font-semibold text-fg">First-Run Setup & Readiness</h1>
          </div>
          <p className="text-[13px] text-fg-muted mt-1">
            Complete these configuration milestones to prepare Pigeon for simulated runs and live
            applications.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void loadStatus()}
          loading={loading}
          className="self-start sm:self-auto"
        >
          <RefreshCw size={14} className="mr-1.5" />
          Refresh Status
        </Button>
      </div>

      {error && (
        <div className="p-4 rounded-[6px] border border-state-danger-border bg-state-danger-bg text-state-danger-fg text-[13px]">
          {error}
        </div>
      )}

      {/* Readiness Indicators */}
      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-5 rounded-[6px] border border-border bg-surface flex items-start gap-3.5">
            <div
              className={`p-2.5 rounded-[6px] ${
                data.readyForDryRun
                  ? 'bg-state-ok-bg text-state-ok-fg border border-state-ok-border'
                  : 'bg-state-unknown-bg text-state-unknown-fg border border-state-unknown-border'
              }`}
            >
              <ShieldCheck size={20} strokeWidth={1.5} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-semibold text-fg">Ready for Dry-Run</span>
                <StatusChip
                  variant={data.readyForDryRun ? 'ok' : 'unknown'}
                  label={data.readyForDryRun ? 'Ready' : 'Incomplete'}
                />
              </div>
              <p className="text-[12px] text-fg-muted mt-1 leading-relaxed">
                {data.readyForDryRun
                  ? 'Master key, user profile, and LLM provider are configured. You can safely simulate scraping and evaluation.'
                  : 'Requires valid master key, candidate profile, and LLM provider.'}
              </p>
            </div>
          </div>

          <div className="p-5 rounded-[6px] border border-border bg-surface flex items-start gap-3.5">
            <div
              className={`p-2.5 rounded-[6px] ${
                data.readyToGoLive
                  ? 'bg-state-ok-bg text-state-ok-fg border border-state-ok-border'
                  : 'bg-state-unknown-bg text-state-unknown-fg border border-state-unknown-border'
              }`}
            >
              <Zap size={20} strokeWidth={1.5} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-semibold text-fg">Ready to Go Live</span>
                <StatusChip
                  variant={data.readyToGoLive ? 'ok' : 'unknown'}
                  label={data.readyToGoLive ? 'Ready' : 'Pending'}
                />
              </div>
              <p className="text-[12px] text-fg-muted mt-1 leading-relaxed">
                {data.readyToGoLive
                  ? 'All essential external systems (Google OAuth, Gmail, and Google Sheets) are connected and verified.'
                  : 'Requires dry-run readiness plus Google Cloud OAuth, active Google sign-in, and Google Sheets tracker.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Checklist Table */}
      <div className="bg-surface rounded-[6px] border border-border overflow-hidden">
        <div className="p-4 border-b border-border bg-surface-subtle">
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-fg-muted">
            Configuration Checklist
          </h2>
        </div>

        {loading && !data ? (
          <div className="p-8 text-center text-[13px] text-fg-muted">
            Checking configuration status...
          </div>
        ) : (
          <div className="divide-y divide-border">
            {data?.items.map((item) => (
              <div
                key={item.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-surface-subtle/40 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">{getStatusIcon(item.status)}</div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-medium text-fg">{item.name}</span>
                      <StatusChip
                        variant={
                          item.status === 'ok'
                            ? 'ok'
                            : item.status === 'needs_action' || item.status === 'invalid'
                              ? 'danger'
                              : 'unknown'
                        }
                        label={
                          item.status === 'ok'
                            ? 'OK'
                            : item.status === 'needs_action'
                              ? 'Needs Action'
                              : item.status === 'invalid'
                                ? 'Invalid'
                                : 'Missing'
                        }
                      />
                    </div>
                    <p className="text-[12px] text-fg-muted mt-0.5 leading-relaxed">
                      {item.message}
                    </p>
                  </div>
                </div>
                <div className="self-end sm:self-auto shrink-0">{getItemAction(item)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
