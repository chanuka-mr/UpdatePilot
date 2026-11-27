'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/signup';
      const body = mode === 'login' ? { email, password } : { email, password, ...(name.trim() ? { name: name.trim() } : {}) };
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Authentication failed.');
      router.replace('/');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="panel w-full max-w-md space-y-6 p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-white">
            <ShieldCheck size={24} />
          </span>
          <div>
            <h1 className="text-lg font-semibold">UpdatePilot</h1>
            <p className="text-xs text-muted">
              {mode === 'login' ? 'Sign in to manage your Windows devices' : 'Create your private UpdatePilot account'}
            </p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          {mode === 'signup' && (
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Name (optional)</span>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                maxLength={80}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary"
                placeholder="Your name"
              />
            </label>
          )}

          <label className="block space-y-1 text-sm">
            <span className="font-medium">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary"
              placeholder="you@example.com"
            />
          </label>

          <label className="block space-y-1 text-sm">
            <span className="font-medium">Password</span>
            <input
              type="password"
              required
              minLength={mode === 'signup' ? 12 : 1}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary"
              placeholder={mode === 'signup' ? 'At least 12 characters' : 'Enter your password'}
            />
          </label>

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}

          <button type="submit" disabled={busy} className="primary-button w-full justify-center py-2.5">
            {busy ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div className="border-t border-slate-100 pt-4 text-center text-xs text-muted">
          {mode === 'login' ? (
            <button type="button" className="text-primary hover:underline" onClick={() => { setMode('signup'); setError(''); }}>
              Need an account? Sign up
            </button>
          ) : (
            <button type="button" className="text-primary hover:underline" onClick={() => { setMode('login'); setError(''); }}>
              Already have an account? Sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
