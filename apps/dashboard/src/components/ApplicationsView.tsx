import React, { useState, useEffect, useCallback } from 'react';

export interface ApplicationItem {
  id: string;
  job_id: string;
  kind: string;
  channel: string;
  status: string;
  cover_letter: string | null;
  subject: string | null;
  sent_at: string | null;
  applied_at: string | null;
  outcome: string | null;
  outcome_at: string | null;
  notes: string | null;
  updated_at: string;
  title: string;
  company: string;
  source: string;
  location: string | null;
  match_score: number | null;
  contact_email: string | null;
  apply_url: string | null;
}

interface Props {
  apiBase?: string;
}

export function ApplicationsView({ apiBase = '' }: Props): React.JSX.Element {
  const [apps, setApps] = useState<ApplicationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [channelFilter, setChannelFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');

  // Outcome modal state
  const [selectedApp, setSelectedApp] = useState<ApplicationItem | null>(null);
  const [outcomeChoice, setOutcomeChoice] = useState<
    'replied' | 'interview' | 'rejected' | 'offer'
  >('interview');
  const [outcomeNotes, setOutcomeNotes] = useState('');
  const [savingOutcome, setSavingOutcome] = useState(false);

  const loadApplications = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (statusFilter) params.set('status', statusFilter);
      if (channelFilter) params.set('channel', channelFilter);
      if (sourceFilter) params.set('source', sourceFilter);

      const res = await fetch(`${apiBase}/api/applications?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Failed to load applications (${res.status})`);
      }
      const data = (await res.json()) as { ok: boolean; applications: ApplicationItem[] };
      setApps(data.applications || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [apiBase, search, statusFilter, channelFilter, sourceFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadApplications();
    }, 200);
    return () => clearTimeout(timer);
  }, [loadApplications]);

  const handleRecordOutcome = async () => {
    if (!selectedApp) return;
    try {
      setSavingOutcome(true);
      const res = await fetch(`${apiBase}/api/applications/${selectedApp.id}/outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcome: outcomeChoice,
          notes: outcomeNotes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        throw new Error(`Failed to record outcome (${res.status})`);
      }
      setSelectedApp(null);
      setOutcomeNotes('');
      await loadApplications();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingOutcome(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'interview':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'offer':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'sent':
      case 'applied':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'replied':
        return 'bg-indigo-100 text-indigo-800 border-indigo-200';
      case 'draft':
      case 'manual_pending':
        return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'needs_review':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'bounced':
      case 'rejected':
      case 'failed':
        return 'bg-rose-100 text-rose-800 border-rose-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Filter Controls */}
      <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm space-y-4">
        <div>
          <h2 className="text-base font-bold text-gray-900 flex items-center space-x-2">
            <span>🗂️</span>
            <span>All Applications</span>
            <span className="text-xs bg-gray-100 text-gray-600 font-semibold px-2 py-0.5 rounded-full">
              {apps.length}
            </span>
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Search, filter by route and status, and record responses and interview outcomes.
          </p>
        </div>

        {/* Filter Inputs Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          <input
            type="text"
            placeholder="Search company or title..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-xs p-2.5 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full text-xs p-2.5 rounded-lg border border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="needs_review">Needs Review</option>
            <option value="approved">Approved</option>
            <option value="sent">Sent</option>
            <option value="manual_pending">Manual Pending</option>
            <option value="applied">Applied</option>
            <option value="replied">Replied</option>
            <option value="interview">Interview</option>
            <option value="offer">Offer</option>
            <option value="rejected">Rejected</option>
            <option value="bounced">Bounced</option>
          </select>

          <select
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
            className="w-full text-xs p-2.5 rounded-lg border border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All Channels</option>
            <option value="email">Email</option>
            <option value="manual">Manual</option>
          </select>

          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="w-full text-xs p-2.5 rounded-lg border border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All Sources</option>
            <option value="greenhouse">Greenhouse</option>
            <option value="lever">Lever</option>
            <option value="ashby">Ashby</option>
            <option value="adzuna">Adzuna</option>
            <option value="remoteok">RemoteOK</option>
            <option value="remotive">Remotive</option>
            <option value="weworkremotely">WeWorkRemotely</option>
            <option value="alert_email">Alert Email</option>
          </select>
        </div>
      </div>

      {/* Applications Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {loading && apps.length === 0 ? (
          <div className="p-12 text-center text-xs text-gray-400">Loading applications...</div>
        ) : error ? (
          <div className="p-4 bg-rose-50 text-rose-700 text-xs">{error}</div>
        ) : apps.length === 0 ? (
          <div className="p-12 text-center text-xs text-gray-500">
            No applications match your filter criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 uppercase font-semibold">
                  <th className="py-3 px-4">Company & Role</th>
                  <th className="py-3 px-4">Channel</th>
                  <th className="py-3 px-4">Source</th>
                  <th className="py-3 px-4">Score</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {apps.map((app) => (
                  <tr key={app.id} className="hover:bg-gray-50/70 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-bold text-gray-900">{app.company}</div>
                      <div className="text-gray-600 truncate max-w-xs">{app.title}</div>
                      {app.location && (
                        <div className="text-[11px] text-gray-400">{app.location}</div>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${
                          app.channel === 'email'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        }`}
                      >
                        {app.channel}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-gray-600 font-mono text-[11px]">{app.source}</td>

                    <td className="py-3 px-4">
                      <span className="font-bold text-gray-900">
                        {app.match_score !== null ? `${app.match_score}%` : '—'}
                      </span>
                    </td>

                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${getStatusBadge(
                          app.status,
                        )}`}
                      >
                        {app.status}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-gray-500 text-[11px]">
                      {app.sent_at || app.applied_at
                        ? new Date(app.sent_at || app.applied_at || '').toLocaleDateString()
                        : new Date(app.updated_at).toLocaleDateString()}
                    </td>

                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedApp(app)}
                        className="px-2.5 py-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-lg cursor-pointer transition-colors"
                      >
                        Record Outcome
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Record Outcome Modal */}
      {selectedApp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl border border-gray-100">
            <h3 className="text-base font-bold text-gray-900">
              Record Outcome: {selectedApp.company}
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              Position: <span className="font-medium text-gray-700">{selectedApp.title}</span>
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-bold uppercase text-gray-600 mb-1">
                  Outcome Type
                </label>
                <select
                  value={outcomeChoice}
                  onChange={(e) =>
                    setOutcomeChoice(
                      e.target.value as 'replied' | 'interview' | 'rejected' | 'offer',
                    )
                  }
                  className="w-full text-xs p-2.5 rounded-lg border border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="interview">🎉 Interview Scheduled</option>
                  <option value="replied">💬 Recruiter Replied</option>
                  <option value="offer">🏆 Offer Received</option>
                  <option value="rejected">❌ Rejection</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-gray-600 mb-1">
                  Notes (optional)
                </label>
                <textarea
                  rows={3}
                  value={outcomeNotes}
                  onChange={(e) => setOutcomeNotes(e.target.value)}
                  placeholder="e.g. Technical round scheduled for next Tuesday with engineering director"
                  className="w-full text-xs p-2.5 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end space-x-2">
              <button
                type="button"
                onClick={() => setSelectedApp(null)}
                className="px-3.5 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleRecordOutcome()}
                disabled={savingOutcome}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg cursor-pointer disabled:opacity-50"
              >
                {savingOutcome ? 'Saving...' : 'Save Outcome'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
