import React, { useState } from 'react';
import { Bird, Lock, KeyRound, AlertCircle, ArrowRight } from 'lucide-react';
import { setStoredToken } from '../api.js';

export interface LoginViewProps {
  onLoginSuccess: (token: string) => void;
  apiBase?: string;
  initialError?: string | null;
}

export function LoginView({
  onLoginSuccess,
  apiBase =
    (import.meta.env?.VITE_API_BASE as string | undefined) ||
    (import.meta.env?.VITE_API_URL as string | undefined) ||
    '',
  initialError = null,
}: LoginViewProps): React.JSX.Element {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = password.trim();
    if (!trimmed) {
      setError('Please enter your admin password.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${apiBase}/api/overview`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${trimmed}`,
        },
      });

      if (res.ok) {
        setStoredToken(trimmed);
        onLoginSuccess(trimmed);
      } else if (res.status === 401) {
        setError('Invalid admin password. Please try again.');
      } else if (res.status === 503) {
        setError('Service Unavailable: Admin password is not configured on the worker.');
      } else {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error || `Authentication failed with status HTTP ${res.status}.`);
      }
    } catch {
      setError('Failed to connect to the Pigeon worker. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center items-center bg-canvas text-fg p-4">
      <div className="w-full max-w-[400px] bg-surface border border-border rounded-[6px] shadow-sm p-6 sm:p-8">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 rounded-full bg-surface-subtle border border-border flex items-center justify-center mb-3 text-accent">
            <Bird size={24} strokeWidth={1.5} aria-hidden="true" />
          </div>
          <h1 className="text-[20px] font-semibold tracking-tight text-fg">Pigeon</h1>
          <p className="text-[13px] text-fg-muted mt-1">
            Personal job application automation engine
          </p>
        </div>

        {/* Security / Login Title */}
        <div className="border-t border-border pt-5 mb-5">
          <div className="flex items-center gap-2 mb-1.5">
            <Lock size={15} className="text-fg-muted shrink-0" aria-hidden="true" />
            <h2 className="text-[14px] font-medium text-fg">Owner Authentication</h2>
          </div>
          <p className="text-[12px] text-fg-muted">
            Enter your admin password to access the Pigeon dashboard.
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div
            role="alert"
            data-testid="login-error-alert"
            className="mb-4 p-3 rounded-[6px] bg-state-danger-bg border border-state-danger-border text-state-danger-fg text-[13px] flex items-start gap-2"
          >
            <AlertCircle size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
            <span className="leading-snug">{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="admin-password"
              className="block text-[12px] font-medium text-fg-muted mb-1.5"
            >
              Admin Password
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-fg-muted">
                <KeyRound size={15} aria-hidden="true" />
              </div>
              <input
                id="admin-password"
                data-testid="admin-password-input"
                type="password"
                autoComplete="current-password"
                autoFocus
                disabled={loading}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="Enter password..."
                className="w-full pl-9 pr-3 py-2 text-[14px] bg-canvas border border-border rounded-[6px] text-fg placeholder:text-fg-muted/60 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-shadow disabled:opacity-60"
              />
            </div>
          </div>

          <button
            type="submit"
            data-testid="login-submit-button"
            disabled={loading || !password.trim()}
            className="w-full py-2 px-4 bg-accent text-accent-fg font-medium text-[13px] rounded-[6px] hover:opacity-95 active:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {loading ? (
              <span>Verifying...</span>
            ) : (
              <>
                <span>Sign In</span>
                <ArrowRight size={14} aria-hidden="true" />
              </>
            )}
          </button>
        </form>
      </div>

      <p className="text-[11px] text-fg-muted mt-6">
        Protected single-owner instance
      </p>
    </div>
  );
}
