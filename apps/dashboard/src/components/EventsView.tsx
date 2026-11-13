import React, { useState, useEffect, useCallback } from 'react';
import { History, Loader2, RefreshCw } from 'lucide-react';
import { Button } from './ui/Button.js';
import { StatusChip } from './ui/StatusChip.js';
import { apiFetch } from '../api.js';

export interface AuditEventItem {
  id: string;
  entity: string;
  entity_id: string;
  type: string;
  payload: unknown;
  created_at: string;
}

interface Props {
  apiBase?: string;
}

export function EventsView({ apiBase = '' }: Props): React.JSX.Element {
  const [events, setEvents] = useState<AuditEventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [entityFilter, setEntityFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadEvents = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      params.set('limit', '100');
      if (entityFilter) params.set('entity', entityFilter);
      if (typeFilter) params.set('type', typeFilter);

      const res = await apiFetch(`${apiBase}/api/events?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Failed to load events (${res.status})`);
      }
      const data = (await res.json()) as { ok: boolean; events: AuditEventItem[] };
      setEvents(data.events || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [apiBase, entityFilter, typeFilter]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  return (
    <div className="space-y-6">
      {/* Header & Filter Controls */}
      <div className="bg-surface p-5 rounded-[6px] border border-border space-y-4">
        <div>
          <div className="flex items-center gap-2">
            <History
              size={16}
              strokeWidth={1.5}
              className="text-fg-muted shrink-0"
              aria-hidden="true"
            />
            <h2 className="text-[16px] font-semibold text-fg">Audit Events Log</h2>
            <span className="text-[12px] bg-surface-subtle text-fg-muted font-medium font-mono tabular-nums px-2 py-0.5 rounded-[4px] border border-border">
              {events.length}
            </span>
          </div>
          <p className="text-[13px] text-fg-muted mt-1">
            Immutable log of state changes, notifications, sending operations, and configuration
            updates.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-3">
          <select
            aria-label="Filter by audit entity"
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="w-full sm:w-auto text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">All Entities</option>
            <option value="settings">settings</option>
            <option value="application">application</option>
            <option value="job">job</option>
            <option value="auth">auth</option>
            <option value="source">source</option>
          </select>

          <input
            type="text"
            aria-label="Filter by event type"
            placeholder="Filter by event type (e.g. approved, kill_switch)..."
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="w-full sm:w-auto sm:min-w-[280px] text-[13px] px-3 py-1.5 rounded-[6px] border border-border bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />

          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => void loadEvents()} className="self-start sm:self-auto shrink-0">
            Refresh
          </Button>
        </div>
      </div>

      {/* Events List */}
      <div className="bg-surface rounded-[6px] border border-border overflow-hidden">
        {loading && events.length === 0 ? (
          <div className="p-12 text-center text-[13px] text-fg-muted flex items-center justify-center gap-2">
            <Loader2 className="animate-spin shrink-0" size={16} aria-hidden="true" />
            <span>Loading audit events...</span>
          </div>
        ) : error ? (
          <div className="p-4 bg-state-danger-bg text-state-danger-fg text-[13px]">{error}</div>
        ) : events.length === 0 ? (
          <div className="p-12 text-center text-[13px] text-fg-muted">
            No events found matching your filter.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[640px]">
            <table className="w-full text-left border-collapse text-[13px]">
              <thead className="sticky top-0 bg-surface-subtle border-b border-border z-10">
                <tr className="text-fg-muted uppercase text-[11px] font-medium tracking-wider">
                  <th className="py-2.5 px-4">Timestamp</th>
                  <th className="py-2.5 px-4">Entity</th>
                  <th className="py-2.5 px-4">Entity ID</th>
                  <th className="py-2.5 px-4">Event Type</th>
                  <th className="py-2.5 px-4 text-right">Payload</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle font-mono text-[12px]">
                {events.map((evt) => {
                  const isExpanded = expandedId === evt.id;
                  return (
                    <React.Fragment key={evt.id}>
                      <tr className="hover:bg-surface-subtle/50 transition-colors">
                        <td className="py-2.5 px-4 text-fg-muted whitespace-nowrap tabular-nums">
                          {new Date(evt.created_at).toLocaleString()}
                        </td>

                        <td className="py-2.5 px-4">
                          <StatusChip variant="unknown" dot={false} label={evt.entity} size="sm" />
                        </td>

                        <td className="py-2.5 px-4 text-fg truncate max-w-[140px]">
                          {evt.entity_id}
                        </td>

                        <td className="py-2.5 px-4 font-semibold text-fg">{evt.type}</td>

                        <td className="py-2.5 px-4 text-right font-sans">
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => setExpandedId(isExpanded ? null : evt.id)}
                          >
                            {isExpanded ? 'Hide' : 'View Payload'}
                          </Button>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-surface-subtle">
                          <td colSpan={5} className="p-4">
                            <pre className="text-[12px] font-mono bg-surface p-3 rounded-[6px] border border-border text-fg overflow-x-auto whitespace-pre-wrap">
                              {JSON.stringify(evt.payload, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
