'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAgentStatus } from '../../components/providers/agent-status-provider';

const configuredApiUrl = process.env.NEXT_PUBLIC_AGENT_API_URL || 'https://updatepilot-ju60.onrender.com';
const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://update-pilot-eight.vercel.app';
const agentDownloadUrl = process.env.NEXT_PUBLIC_AGENT_DOWNLOAD_URL || 'https://github.com/chanuka-mr/UpdatePilot/releases/download/UpdatePilot-Agent/UpdatePilot-Agent-win-x64.zip';
const installerUrl = `${appUrl.replace(/\/$/, '')}/install.ps1`;
const installCommand = `$env:UPDATEPILOT_API_URL = "${configuredApiUrl}"\n$env:UPDATEPILOT_AGENT_URL = "${agentDownloadUrl}"\nirm "${installerUrl}" | iex`;
const pairCommand = `$env:UPDATEPILOT_API_URL = "${configuredApiUrl}"\n$env:UPDATEPILOT_ALLOWED_HOST = "${configuredApiUrl.replace(/^https?:\/\//, '')}"\n& "$env:LOCALAPPDATA\\UpdatePilot\\UpdatePilot.Agent.exe" --pair`;
const listenCommand = `$env:UPDATEPILOT_API_URL = "${configuredApiUrl}"\n$env:UPDATEPILOT_ALLOWED_HOST = "${configuredApiUrl.replace(/^https?:\/\//, '')}"\n& "$env:LOCALAPPDATA\\UpdatePilot\\UpdatePilot.Agent.exe" --listen`;

export function AgentControls({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const { status, error: statusError, refresh } = useAgentStatus();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pair, setPair] = useState<{ code: string; expiresAt: string } | null>(null);
  const [copiedPair, setCopiedPair] = useState(false);
  const [copiedListen, setCopiedListen] = useState(false);
  const [copiedInstall, setCopiedInstall] = useState(false);
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
        <p className="font-medium text-foreground">Set up this Windows computer</p>
        <ol className="mt-2 list-decimal space-y-2 pl-5">
          <li>Click <strong className="text-foreground">Generate Pairing Code</strong> above. Keep the code visible; it expires in 5 minutes.</li>
          <li>On the Windows computer, open PowerShell and run <strong className="text-foreground">Step 1</strong>. It downloads the agent, installs it, and then asks for the pairing code.</li>
          <li>Paste the pairing code into PowerShell and press Enter.</li>
          <li>After pairing succeeds, run <strong className="text-foreground">Step 3</strong> and leave that PowerShell window open.</li>
        </ol>
      </div>
      {agentDownloadUrl && <a className="inline-flex rounded-lg bg-inset px-3 py-2 font-medium text-foreground hover:bg-slate-200" href={agentDownloadUrl}>Download agent ZIP</a>}
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <div className="flex items-center justify-between bg-inset px-3 py-2 text-xs font-medium text-foreground">
          <span>Step 1 — Download, install, and pair</span>
          <button className="text-primary" onClick={() => { void navigator.clipboard.writeText(installCommand); setCopiedInstall(true); }}>{copiedInstall ? 'Copied' : 'Copy'}</button>
        </div>
        <pre className="overflow-auto bg-white p-3 text-xs">{installCommand}</pre>
      </div>
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950"><strong>Copy commands exactly.</strong> Use <code>https://</code>, never <code>https\://</code>. The installer address ends in <code>/install.ps1</code>; do not use the website home-page address.</p>
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <div className="flex items-center justify-between bg-inset px-3 py-2 text-xs font-medium text-foreground">
          <span>Step 2 — Pair an agent that is already installed</span>
          <button className="text-primary" onClick={() => { void navigator.clipboard.writeText(pairCommand); setCopiedPair(true); }}>{copiedPair ? 'Copied' : 'Copy'}</button>
        </div>
        <pre className="overflow-auto bg-white p-3 text-xs">{pairCommand}</pre>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <div className="flex items-center justify-between bg-inset px-3 py-2 text-xs font-medium text-foreground">
          <span>Step 3 — Start the agent listener after pairing</span>
          <button className="text-primary" onClick={() => { void navigator.clipboard.writeText(listenCommand); setCopiedListen(true); }}>{copiedListen ? 'Copied' : 'Copy'}</button>
        </div>
        <pre className="overflow-auto bg-white p-3 text-xs">{listenCommand}</pre>
      </div>
      <p>Machine-scope installers require an elevated agent process. Credentials stay encrypted on this Windows user account; PostgreSQL and user session secrets are never given to the agent.</p>
    </div>}
  </section>;
}
