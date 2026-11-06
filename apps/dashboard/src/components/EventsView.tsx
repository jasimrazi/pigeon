import React, { useState, useEffect, useCallback } from 'react';

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

      const res = await fetch(`${apiBase}/api/events?${params.toString()}`);
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

  const getEntityBadge = (entity: string) => {
    switch (entity) {
      case 'settings':
        return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'application':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'job':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'auth':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'source':
        return 'bg-indigo-50 text-indigo-700 border-indigo-200';
      default:
        return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Filter Controls */}
      <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm space-y-4">
        <div>
          <h2 className="text-base font-bold text-gray-900 flex items-center space-x-2">
            <span>📜</span>
            <span>Audit Events Log</span>
            <span className="text-xs bg-gray-100 text-gray-600 font-semibold px-2 py-0.5 rounded-full">
              {events.length}
            </span>
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Immutable log of state changes, notifications, sending operations, and configuration
            updates.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="text-xs p-2.5 rounded-lg border border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
            placeholder="Filter by event type (e.g. approved, kill_switch)..."
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="text-xs p-2.5 rounded-lg border border-gray-300 min-w-[280px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />

          <button
            onClick={() => void loadEvents()}
            className="px-3.5 py-2 text-xs font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg cursor-pointer"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Events List */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {loading && events.length === 0 ? (
          <div className="p-12 text-center text-xs text-gray-400">Loading audit events...</div>
        ) : error ? (
          <div className="p-4 bg-rose-50 text-rose-700 text-xs">{error}</div>
        ) : events.length === 0 ? (
          <div className="p-12 text-center text-xs text-gray-500">
            No events found matching your filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 uppercase font-semibold">
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Entity</th>
                  <th className="py-3 px-4">Entity ID</th>
                  <th className="py-3 px-4">Event Type</th>
                  <th className="py-3 px-4 text-right">Payload</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 font-mono text-[11px]">
                {events.map((evt) => {
                  const isExpanded = expandedId === evt.id;
                  return (
                    <React.Fragment key={evt.id}>
                      <tr className="hover:bg-gray-50/70 transition-colors">
                        <td className="py-3 px-4 text-gray-500 whitespace-nowrap">
                          {new Date(evt.created_at).toLocaleString()}
                        </td>

                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getEntityBadge(
                              evt.entity,
                            )}`}
                          >
                            {evt.entity}
                          </span>
                        </td>

                        <td className="py-3 px-4 text-gray-700 truncate max-w-[120px]">
                          {evt.entity_id}
                        </td>

                        <td className="py-3 px-4 font-semibold text-gray-900">{evt.type}</td>

                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => setExpandedId(isExpanded ? null : evt.id)}
                            className="text-xs text-indigo-600 hover:text-indigo-800 font-sans cursor-pointer"
                          >
                            {isExpanded ? 'Hide' : 'View Payload'}
                          </button>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-gray-50">
                          <td colSpan={5} className="p-4">
                            <pre className="text-[11px] font-mono bg-white p-3 rounded-lg border border-gray-200 text-gray-800 overflow-x-auto whitespace-pre-wrap">
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
