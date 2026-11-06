import React, { useState, useEffect, useCallback } from 'react';

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

  const getCircuitBadge = (state: string) => {
    switch (state) {
      case 'closed':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'half-open':
        return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'open':
        return 'bg-rose-100 text-rose-800 border-rose-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-gray-900 flex items-center space-x-2">
            <span>🔌</span>
            <span>Job Sources & Ingestion Health</span>
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Monitor API connectors, ATS scrapers, circuit breaker states, and email parser health
            streaks.
          </p>
        </div>

        <button
          onClick={() => void loadSources()}
          className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg transition-colors cursor-pointer self-start sm:self-auto"
        >
          Refresh Status
        </button>
      </div>

      {loading && sources.length === 0 ? (
        <div className="p-12 text-center text-xs text-gray-400">Loading sources...</div>
      ) : error ? (
        <div className="p-4 bg-rose-50 text-rose-700 text-xs rounded-xl">{error}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sources.map((src) => {
            const isSuspect = Boolean(src.is_suspect || (src.parser_empty_streak ?? 0) >= 3);
            return (
              <div
                key={src.name}
                className={`bg-white rounded-xl border p-5 shadow-sm space-y-3 transition-all ${
                  isSuspect
                    ? 'border-amber-300 ring-1 ring-amber-300'
                    : src.circuit_state === 'open'
                      ? 'border-rose-300 ring-1 ring-rose-300'
                      : 'border-gray-200'
                }`}
              >
                {/* Header line */}
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-bold text-sm text-gray-900 capitalize">{src.name}</h3>
                    <span className="text-[11px] font-mono text-gray-500 uppercase">
                      {src.kind}
                    </span>
                  </div>
                  <span
                    className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${getCircuitBadge(
                      src.circuit_state,
                    )}`}
                  >
                    Circuit: {src.circuit_state}
                  </span>
                </div>

                {/* Parser Health Warning Banner */}
                {isSuspect && (
                  <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-[11px] font-medium space-y-0.5">
                    <div className="font-bold flex items-center space-x-1">
                      <span>⚠️</span>
                      <span>Parser Suspect Warning</span>
                    </div>
                    <p>
                      {src.parser_empty_streak} consecutive emails yielded 0 jobs. Portal HTML
                      structure may have changed.
                    </p>
                  </div>
                )}

                {/* Metrics */}
                <div className="space-y-1.5 text-xs text-gray-600 border-t pt-3">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Failures:</span>
                    <span className="font-medium text-gray-800">{src.failure_count}</span>
                  </div>

                  {src.parser_empty_streak !== undefined && src.parser_empty_streak !== null && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">Empty Streak:</span>
                      <span
                        className={`font-semibold ${
                          (src.parser_empty_streak ?? 0) >= 3 ? 'text-amber-600' : 'text-gray-800'
                        }`}
                      >
                        {src.parser_empty_streak}
                      </span>
                    </div>
                  )}

                  <div className="flex justify-between">
                    <span className="text-gray-400">Last Run:</span>
                    <span className="text-gray-800 text-[11px]">
                      {src.last_run ? new Date(src.last_run).toLocaleString() : 'Never'}
                    </span>
                  </div>

                  {src.last_error && (
                    <div className="mt-2 p-2 bg-rose-50 text-rose-700 rounded text-[11px] break-words">
                      <span className="font-semibold">Error:</span> {src.last_error}
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
