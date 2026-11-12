'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { AppIcon, Badge, Heading } from '../../components/ui/dashboard';

type Job = { id: string; operation: string; state: string; progress: unknown; error: string | null; createdAt: string; startedAt: string | null; finishedAt: string | null; snapshotId: string | null };
type Execution = {
  id: string; name: string; packageId: string; installedVersion: string; targetVersion: string;
  status: string; stage: string; progress: number; message: string | null; error: string | null;
  profile: string; installerType: string; installerSha256: string; scope: string;
  createdAt: string; startedAt: string | null; finishedAt: string | null; confirmedAt: string | null;
  result: Record<string, unknown> | null; jobs: Job[];
};
type Result = { state: string; execution?: Execution };

const titles: Record<string, [string, string]> = {
  queued: ['Update queued', 'Waiting for the paired agent to claim this exact update job.'],
  running: ['Preparing verified update', 'The agent is re-downloading and re-checking the installer before launch.'],
  confirming: ['Installation finished, confirming version', 'The agent will run a fresh scan to confirm the installed version.'],
  awaiting_restart: ['Restart required', 'Restart Windows, then run a confirming scan to verify the installed version.'],
  succeeded: ['Update confirmed', 'A fresh scan reported the target version on this device.'],
  verification_failed: ['Version confirmation failed', 'The confirming scan did not report the expected version.'],
  failed: ['Update failed', 'The controlled update did not complete successfully.'],
  blocked: ['Update blocked', 'A safety check prevented installer execution.'],
  cancelled: ['Update cancelled', 'The update was cancelled before any installer started.'],
  interrupted: ['Update interrupted', 'The job or agent was interrupted. Reconcile the state before retrying.'],
};

const active = new Set(['queued', 'running', 'confirming', 'awaiting_restart']);
const stagePercent = (stage: string, fallback: number) => stage === 'preparing' ? 10 : stage === 'downloading' ? 30 : stage === 'verifying' ? 55
  : stage === 'installing' ? 75 : stage === 'confirming' ? 90 : stage === 'completed' ? 100 : fallback;

export function LiveExecution({ id }: { id: string }) {
  const [data, setData] = useState<Result | null>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0); const [acting, setActing] = useState(''); const [actionError, setActionError] = useState('');
  useEffect(() => {
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const response = await fetch(`/api/executions/${encodeURIComponent(id)}`, { cache: 'no-store' });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Update execution unavailable.');
        if (stopped) return;
        setData(body); setError('');
        if (body.execution && active.has(body.execution.status)) timer = setTimeout(() => void load(), 3000);
      } catch (failure) { if (!stopped) setError(failure instanceof Error ? failure.message : 'Update execution unavailable.'); }
      finally { if (!stopped) setLoading(false); }
    };
    void load();
    return () => { stopped = true; clearTimeout(timer); };
  }, [id, revision]);
  const execution = data?.execution;
  async function runAction(action: 'cancel' | 'scan') {
    if (!execution) return;
    setActing(action); setActionError('');
    try {
      const body = action === 'cancel' ? { executionId: execution.id } : {};
      const response = await fetch(`/api/agent/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) {
        const blockers = Array.isArray(result.details?.blockers) ? ` ${result.details.blockers.join(', ')}` : '';
        throw new Error(`${result.error || 'The action could not be completed.'}${blockers}`);
      }
      setRevision(value => value + 1);
    } catch (failure) { setActionError(failure instanceof Error ? failure.message : 'The action could not be completed.'); }
    finally { setActing(''); }
  }
  const percent = execution ? stagePercent(execution.stage, execution.progress) : 0;
  const heading = execution ? titles[execution.status] ?? ['Update execution', 'Review the current execution state.'] : ['Update execution', 'Loading stored update execution.'];
  return <>
    <Link href="/updates" className="text-xs text-muted hover:text-primary">Updates / Execution</Link>
    <Heading title={heading[0]} description={heading[1]} action={<div className="flex flex-wrap gap-2">
      {execution?.status === 'queued' && <button className="rounded-lg border border-slate-200 bg-white px-4 py-2" disabled={!!acting} onClick={() => void runAction('cancel')}>{acting === 'cancel' ? 'Cancelling...' : 'Cancel before launch'}</button>}
      {execution?.status === 'awaiting_restart' && <button className="primary-button" disabled={!!acting} onClick={() => void runAction('scan')}>{acting === 'scan' ? 'Starting scan...' : 'Run confirming scan'}</button>}
      <button className="rounded-lg bg-inset px-4 py-2" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw className={loading ? 'animate-spin' : 'mr-2 inline'} size={16}/>Refresh</button>
    </div>}/>
    {loading && !execution && <p role="status" className="panel p-10 text-center text-muted">Loading update execution...</p>}
    {error && !execution && <div role="alert" className="panel p-8"><h2 className="font-semibold">Execution unavailable</h2><p className="mt-2 text-muted">{error}</p><button className="mt-3 text-primary underline" onClick={() => setRevision(value => value + 1)}>Try again</button></div>}
    {!loading && !error && data && !execution && <div className="panel p-10 text-center"><h2 className="font-semibold">Execution not found</h2><p className="mt-2 text-muted">This update execution is not available for the configured device.</p></div>}
    {execution && <>
      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 p-6">
          <div className="flex items-center gap-3"><AppIcon name={execution.name}/><div><h2 className="text-xl font-semibold">{execution.name}</h2><p className="mt-1 break-all text-xs text-muted">{execution.packageId}</p></div></div>
          <Badge>{execution.status.replaceAll('_',' ')}</Badge>
        </div>
        <div className="p-6">
          <div className="flex flex-wrap items-center gap-3 font-mono text-sm"><span>{execution.installedVersion}</span><ArrowRight size={16}/><span className="text-primary">{execution.targetVersion}</span></div>
          <div className="mt-6 h-3 overflow-hidden rounded-full bg-inset" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><div className={`h-full transition-all ${execution.status === 'failed' || execution.status === 'blocked' || execution.status === 'verification_failed' ? 'bg-red-500' : execution.status === 'succeeded' ? 'bg-green-500' : 'bg-primary'}`} style={{ width: `${percent}%` }}/></div>
          <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-muted"><span>{execution.stage.replaceAll('_',' ')} - {percent}%</span><span>{execution.message || (active.has(execution.status) ? 'The agent is working on this job.' : 'No further agent action is expected.')}</span></div>
          {execution.error && <p role="alert" className="mt-5 rounded-lg bg-red-50 p-3 text-sm text-red-700">{execution.error}</p>}
          {actionError && <p role="alert" className="mt-5 rounded-lg bg-red-50 p-3 text-sm text-red-700">{actionError}</p>}
          {execution.status === 'awaiting_restart' && <p className="mt-5 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><ShieldAlert size={17} className="mt-0.5 shrink-0"/>Restart Windows before running the confirming scan. The installer was not automatically retried or relaunched after reporting a restart requirement.</p>}
          {execution.status === 'succeeded' && <p className="mt-5 flex items-start gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-800"><CheckCircle2 size={17} className="mt-0.5 shrink-0"/>Confirmed by a fresh agent scan{execution.confirmedAt ? ` at ${new Date(execution.confirmedAt).toLocaleString()}` : ''}.</p>}
        </div>
      </section>
      <section className="panel p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck size={20} className="text-blue-600"/>Verified execution details</h2>
        <dl className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[['Execution profile', execution.profile], ['Installer type', execution.installerType], ['Installer SHA-256', execution.installerSha256],
            ['Scope', execution.scope], ['Queued at', new Date(execution.createdAt).toLocaleString()],
            ['Started at', execution.startedAt ? new Date(execution.startedAt).toLocaleString() : 'Not started'],
            ['Finished at', execution.finishedAt ? new Date(execution.finishedAt).toLocaleString() : 'Not finished'],
            ['Execution ID', execution.id]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 break-all font-medium">{value}</dd></div>)}
        </dl>
        <p className="mt-5 rounded-lg bg-inset p-3 text-xs leading-5 text-muted">The agent re-downloads the exact target version, checks it against the preview SHA-256, verifies its Authenticode signature and architecture, then runs an allowlisted installer profile. Execution failures are recorded and never retried automatically.</p>
      </section>
      <section className="panel p-6">
        <h2 className="text-lg font-semibold">Linked agent jobs</h2>
        {execution.jobs.length ? <div className="mt-4 overflow-x-auto"><table className="w-full"><thead><tr><th>Operation</th><th>State</th><th>Created</th><th>Finished</th><th>Snapshot</th></tr></thead><tbody>{execution.jobs.map(job => <tr key={job.id}><td className="text-xs font-medium">{job.operation}</td><td><Badge>{job.state}</Badge>{job.error && <p className="mt-1 text-xs text-red-700">{job.error}</p>}</td><td className="text-xs">{new Date(job.createdAt).toLocaleString()}</td><td className="text-xs">{job.finishedAt ? new Date(job.finishedAt).toLocaleString() : 'Pending'}</td><td className="break-all font-mono text-xs text-muted">{job.snapshotId || 'None'}</td></tr>)}</tbody></table></div>
          : <p className="mt-3 text-sm text-muted">No linked agent jobs are recorded yet.</p>}
      </section>
      <div className="flex flex-wrap justify-end gap-3"><Link className="rounded-lg border border-slate-200 bg-white px-4 py-2" href="/history">View history</Link><Link className="primary-button" href="/updates">Back to updates</Link></div>
    </>}
  </>;
}
