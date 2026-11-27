'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAgentStatus } from '../../components/providers/agent-status-provider';

const configuredApiUrl = process.env.NEXT_PUBLIC_AGENT_API_URL || 'https://YOUR-API-HOST';
const setupCommands = `$env:UPDATEPILOT_API_URL="${configuredApiUrl}"\n.\\UpdatePilot.Agent.exe --pair\n.\\UpdatePilot.Agent.exe --listen`;

export function AgentControls({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const { status, error: statusError, refresh } = useAgentStatus();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pair, setPair] = useState<{ code: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const requested = useRef<string | null>(null);

  useEffect(() => {
    if (requested.current && status.job?.id === requested.current && ['completed', 'failed', 'interrupted'].includes(status.job.state)) {
      requested.current = null;
      void refresh();
      router.refresh();
    }
  }, [status.job, refresh, router]);

  async function action(name: string) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/agent/${name}`, { method: 'POST' });
      const body = await response.json() as { error?: string; jobId?: string; code?: string; expiresAt?: string };
      if (!response.ok) throw new Error(body.error || 'Request failed');
      if (name === 'pairing' && body.code && body.expiresAt) setPair({ code: body.code, expiresAt: body.expiresAt });
      if (name === 'scan' && body.jobId) requested.current = body.jobId;
      if (name === 'revoke') setPair(null);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  const stateLabel = status.online ? status.activeJob ? 'Connected - job active' : 'Connected - heartbeat received' : status.paired ? 'Paired - offline' : 'Not paired';
  const jobLabel = status.job?.operation || 'scan';

  return <section className="panel space-y-4 p-5">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h2 className="font-semibold">Windows Agent ({status.deviceName})</h2>
        <p className="mt-1 text-sm text-muted">{stateLabel}</p>
        {status.lastSeenAt && <p className="mt-1 text-xs text-muted">Last seen: {new Date(status.lastSeenAt).toLocaleString()}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="primary-button" disabled={busy || !status.online || status.activeJob} onClick={() => void action('scan')}>Scan Now</button>
        {compact ? <Link href="/settings" className="rounded-lg bg-inset px-3 py-2">Agent Settings</Link> : <>
          <button disabled={busy} className="rounded-lg bg-inset px-3 py-2" onClick={() => void action('pairing')}>Generate Pairing Code</button>
          <button disabled={busy || !status.paired} className="rounded-lg bg-red-50 px-3 py-2 text-red-700" onClick={() => { if (window.confirm('Revoke the agent credential and interrupt pending jobs?')) void action('revoke'); }}>Revoke Agent</button>
        </>}
      </div>
    </div>
    {status.job && <p role="status" className="rounded-lg bg-inset p-3 text-xs">Latest agent job ({jobLabel}): {status.job.state}{status.job.error ? ` - ${status.job.error}` : ''}</p>}
    {(error || statusError) && <p role="alert" className="text-sm text-red-700">{error || statusError}</p>}
    {!compact && pair && <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
      <h3 className="font-semibold">Single-use pairing code</h3>
      <p className="mt-2 select-all break-all font-mono text-sm">{pair.code}</p>
      <p className="mt-2 text-xs text-muted">Expires {new Date(pair.expiresAt).toLocaleTimeString()}. Keep this code private. Pairing again replaces the previous credential.</p>
    </div>}
    {!compact && <div className="space-y-3 text-sm leading-6 text-muted">
      <div>
        <p className="font-medium text-foreground">Hosted agent setup checklist</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Generate a short-lived, single-use pairing code here (expires in 5 minutes).</li>
          <li>Run the commands below on your Windows PC (no inbound firewall port or router change is needed).</li>
          <li>Enter the pairing code when prompted. The device credential is encrypted with Windows DPAPI.</li>
          <li>Keep the agent listening while running scans, previews, verification, or approved updates.</li>
        </ol>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <div className="flex items-center justify-between bg-inset px-3 py-2 text-xs font-medium text-foreground">
          <span>PowerShell commands</span>
          <button className="text-primary" onClick={() => { void navigator.clipboard.writeText(setupCommands); setCopied(true); }}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
        <pre className="overflow-auto bg-white p-3 text-xs">{setupCommands}</pre>
      </div>
      <p>Machine-scope installers require an elevated agent process. Credentials stay encrypted on this Windows user account; PostgreSQL and user session secrets are never given to the agent.</p>
    </div>}
  </section>;
}
