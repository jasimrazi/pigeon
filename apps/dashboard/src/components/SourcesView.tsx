import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Loader2, Radio, RefreshCw } from 'lucide-react';
import { Button } from './ui/Button.js';
import { StatusChip } from './ui/StatusChip.js';

export interface SourceStatusItem {
  name: string;
  kind: 'api' | 'ats' | 'alert_email';
  circuit_state: 'closed' | 'half-open' | 'open';
  failure_count: number;
  last_run: string | null;
  last_error: string | null;
  parser_empty_streak?: number | null;
  is_suspect?: boolean;
  untrusted?: boolean;
  boards_total?: number | null;
  boards_failed?: number | null;
}

interface Props {
  apiBase?: string;
}

export function SourcesView({ apiBase = '' }: Props): React.JSX.Element {
  const [sources, setSources] = useState<SourceStatusItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSources = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${apiBase}/api/sources`);
      if (!res.ok) {
        throw new Error(`Failed to load sources (${res.status})`);
      }
      const data = (await res.json()) as { ok: boolean; sources: SourceStatusItem[] };
      setSources(data.sources || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-surface p-5 rounded-[6px] border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Radio
              size={16}
              strokeWidth={1.5}
              className="text-fg-muted shrink-0"
              aria-hidden="true"
            />
            <h2 className="text-[16px] font-semibold text-fg">Job Sources & Ingestion Health</h2>
          </div>
          <p className="text-[13px] text-fg-muted mt-1">
            Monitor API connectors, ATS scrapers, circuit breaker states, and email parser health
            streaks.
          </p>
        </div>

        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => void loadSources()}>
          Refresh Status
        </Button>
      </div>

      {loading && sources.length === 0 ? (
        <div className="p-12 text-center text-[13px] text-fg-muted flex items-center justify-center gap-2">
          <Loader2 className="animate-spin shrink-0" size={16} aria-hidden="true" />
          <span>Loading sources...</span>
        </div>
      ) : error ? (
        <div className="p-4 bg-state-danger-bg text-state-danger-fg text-[13px] rounded-[6px] border border-state-danger-border">
          {error}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sources.map((src) => {
            const isSuspect = Boolean(src.is_suspect || (src.parser_empty_streak ?? 0) >= 3);
            return (
              <div
                key={src.name}
                className={`bg-surface rounded-[6px] border p-5 space-y-3 transition-colors ${
                  isSuspect
                    ? 'border-state-warn-border ring-1 ring-state-warn-border'
                    : src.circuit_state === 'open'
                      ? 'border-state-danger-border ring-1 ring-state-danger-border'
                      : 'border-border'
                }`}
              >
                {/* Header line */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-[14px] text-fg capitalize">{src.name}</h3>
                    <span className="text-[11px] font-mono text-fg-muted uppercase">
                      {src.kind}
                    </span>
                  </div>
                  <StatusChip
                    status={src.circuit_state}
                    label={`Circuit: ${src.circuit_state}`}
                    size="sm"
                  />
                </div>

                {/* Parser Health Warning Banner */}
                {isSuspect && (
                  <div className="p-2.5 bg-state-warn-bg border border-state-warn-border rounded-[4px] text-state-warn-fg text-[12px] space-y-1">
                    <div className="font-semibold flex items-center gap-1.5">
                      <AlertTriangle
                        size={14}
                        strokeWidth={1.5}
                        className="shrink-0"
                        aria-hidden="true"
                      />
                      <span>Parser Suspect Warning</span>
                    </div>
                    <p className="text-state-warn-fg/90">
                      {src.parser_empty_streak} consecutive emails yielded 0 jobs. Portal HTML
                      structure may have changed.
                    </p>
                  </div>
                )}

                {/* Metrics */}
                <div className="space-y-1.5 text-[12px] text-fg border-t border-border-subtle pt-3">
                  <div className="flex justify-between">
                    <span className="text-fg-muted">Failures:</span>
                    <span className="font-mono tabular-nums font-semibold text-fg">
                      {src.failure_count}
                    </span>
                  </div>

                  {src.boards_total !== undefined &&
                    src.boards_total !== null &&
                    src.boards_total > 0 && (
                      <div className="flex justify-between">
                        <span className="text-fg-muted">Boards:</span>
                        <span
                          className={`font-mono tabular-nums font-semibold ${
                            src.boards_failed ? 'text-state-warn-fg' : 'text-fg'
                          }`}
                        >
                          {src.boards_failed ?? 0} of {src.boards_total} boards failed
                        </span>
                      </div>
                    )}

                  <div className="flex justify-between">
                    <span className="text-fg-muted">Last Run:</span>
                    <span className="font-mono tabular-nums text-fg-muted">
                      {src.last_run ? new Date(src.last_run).toLocaleString() : 'Never'}
                    </span>
                  </div>

                  {src.last_error && (
                    <div className="pt-1">
                      <span className="text-state-danger-fg text-[11px] font-mono break-all line-clamp-2">
                        {src.last_error}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
