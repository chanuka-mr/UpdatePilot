'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Circle, RefreshCw, ShieldAlert } from 'lucide-react';
import { AppIcon, Badge, Heading } from '../../components/ui/dashboard';
import { executionStatus } from '../../lib/status';

type Job = { id: string; operation: string; state: string; progress: unknown; error: string | null; createdAt: string; startedAt: string | null; finishedAt: string | null; snapshotId: string | null };
type Execution = {
  id: string; name: string; packageId: string; installedVersion: string; targetVersion: string;
  status: string; stage: string; progress: number; message: string | null; error: string | null;
  profile: string; installerType: string; installerSha256: string; scope: string;
  createdAt: string; startedAt: string | null; finishedAt: string | null; confirmedAt: string | null;
  result: Record<string, unknown> | null; jobs: Job[];
};
type Result = { state: string; execution?: Execution };

const active = new Set(['queued', 'running', 'confirming', 'awaiting_restart']);
const steps = ['Queued', 'Verify installer', 'Install', 'Confirm', 'Done'] as const;
const stageLabels: Record<string, string> = {
  preparing: 'Preparing the exact installer', downloading: 'Downloading the exact installer',
  verifying: 'Re-checking hash, signature, and architecture', installing: 'Running the allowlisted installer',
  confirming: 'Confirming the installed version', completed: 'Finished',
};

function currentStep(execution: Execution) {
  if (execution.status === 'succeeded') return 4;
  if (['confirming', 'awaiting_restart', 'verification_failed'].includes(execution.status)) return 3;
  if (execution.status === 'running' && ['preparing', 'downloading', 'verifying'].includes(execution.stage)) return 1;
  if (['running', 'failed', 'blocked', 'cancelled', 'interrupted', 'expired'].includes(execution.status)) return 2;
  if (execution.status === 'queued') return 0;
  return Math.min(4, Math.max(0, Math.round(execution.progress / 25)));
}

function stepPercent(execution: Execution, index: number, step: number) {
  const done = index < step || execution.status === 'succeeded';
  if (done) return 100;
  if (index > step) return 0;
  const failed = ['failed', 'blocked', 'verification_failed', 'interrupted', 'expired', 'cancelled'].includes(execution.status);
  if (index === 0) return execution.status === 'queued' ? Math.max(5, execution.progress || 5) : 100;
  if (index === 1) {
    if (failed && step === 1) return Math.max(15, execution.progress || 15);
    if (execution.stage === 'preparing') return 15;
    if (execution.stage === 'downloading') return 45;
    if (execution.stage === 'verifying') return 80;
    return step > 1 ? 100 : 10;
  }
  if (index === 2) {
    if (failed && step === 2) return Math.max(10, execution.progress || 10);
    if (execution.stage === 'installing') return Math.max(25, execution.progress || 75);
    return step > 2 ? 100 : 10;
  }
  if (index === 3) {
    if (execution.status === 'verification_failed') return 100;
    if (execution.status === 'awaiting_restart') return 90;
    if (execution.stage === 'confirming' || execution.status === 'confirming') return 60;
    return 20;
  }
  return execution.status === 'succeeded' ? 100 : 0;
}

export function LiveExecution({ id }: { id: string }) {
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [acting, setActing] = useState('');
  const [actionError, setActionError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const ticker = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(ticker);
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const response = await fetch(`/api/executions/${encodeURIComponent(id)}`, { cache: 'no-store' });
        const body = await response.json() as Result & { error?: string };
        if (!response.ok) throw new Error(body.error || 'Update execution unavailable.');
        if (stopped) return;
        setData(body); setError(''); setLastUpdated(new Date());
        if (body.execution && active.has(body.execution.status)) timer = setTimeout(() => void load(), 1000);
      } catch (failure) { if (!stopped) setError(failure instanceof Error ? failure.message : 'Update execution unavailable.'); }
      finally { if (!stopped) setLoading(false); }
    };
    void load();
    return () => { stopped = true; clearTimeout(timer); };
  }, [id, revision]);

  const execution = data?.execution;
  const status = execution ? executionStatus(execution.status) : null;
  const step = execution ? currentStep(execution) : 0;
  const stageText = execution ? stageLabels[execution.stage] || execution.stage.replaceAll('_', ' ') : '';

  async function runAction(action: 'cancel' | 'scan') {
    if (!execution) return;
    setActing(action); setActionError('');
    try {
      const body = action === 'cancel' ? { executionId: execution.id } : {};
      const response = await fetch(`/api/agent/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string; details?: { blockers?: string[] } };
      if (!response.ok) {
        const blockers = Array.isArray(result.details?.blockers) ? ` ${result.details.blockers.join(', ')}` : '';
        throw new Error(`${result.error || 'The action could not be completed.'}${blockers}`);
      }
      setRevision(value => value + 1);
    } catch (failure) { setActionError(failure instanceof Error ? failure.message : 'The action could not be completed.'); }
    finally { setActing(''); }
  }

  return <>
    <Link href="/updates" className="text-xs text-muted hover:text-primary">Updates / Execution</Link>
    <Heading title={status?.label || 'Update execution'} description={status?.description || 'Loading stored update execution.'} action={<div className="flex flex-wrap gap-2">
      {execution?.status === 'queued' && <button className="rounded-lg border border-slate-200 bg-white px-4 py-2" disabled={!!acting} onClick={() => void runAction('cancel')}>{acting === 'cancel' ? 'Cancelling...' : 'Cancel before launch'}</button>}
      {execution?.status === 'awaiting_restart' && <button className="primary-button" disabled={!!acting} onClick={() => void runAction('scan')}>{acting === 'scan' ? 'Starting scan...' : 'Run confirming scan'}</button>}
      {execution && ['failed', 'blocked', 'verification_failed', 'interrupted', 'expired', 'cancelled'].includes(execution.status) && <Link className="primary-button" href="/updates">Start a fresh update</Link>}
      <button className="rounded-lg bg-inset px-4 py-2" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw className={loading ? 'animate-spin' : 'mr-2 inline'} size={16} />Refresh</button>
    </div>} />
    {loading && !execution && <p role="status" className="panel p-10 text-center text-muted">Loading update execution...</p>}
    {error && !execution && <div role="alert" className="panel p-8"><h2 className="font-semibold">Execution unavailable</h2><p className="mt-2 text-muted">{error}</p><button className="mt-3 text-primary underline" onClick={() => setRevision(value => value + 1)}>Try again</button></div>}
    {!loading && !error && data && !execution && <div className="panel p-10 text-center"><h2 className="font-semibold">Execution not found</h2><p className="mt-2 text-muted">This update execution is not available for the configured device.</p></div>}
    {execution && status && <>
      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 p-6">
          <div className="flex items-center gap-3"><AppIcon name={execution.name} /><div><h2 className="text-xl font-semibold">{execution.name}</h2><p className="mt-1 text-sm text-muted">{execution.installedVersion} <ArrowRight size={14} className="inline" /> <span className="text-primary">{execution.targetVersion}</span></p></div></div>
          <div className="flex flex-wrap items-center gap-3"><Badge tone={status.tone}>{status.label}</Badge>{execution && active.has(execution.status) && <span className="text-xs text-muted">Elapsed {Math.max(0, Math.floor((nowMs - new Date(execution.createdAt).getTime()) / 1000))}s</span>}{lastUpdated && <span className="text-xs text-muted">Updated {lastUpdated.toLocaleTimeString()}</span>}</div>
        </div>
        <div className="p-6">
          <p className="text-sm text-muted">Step {step + 1} of {steps.length}: <span className="font-medium text-foreground">{stageText || steps[step]}</span></p>
          <ol className="mt-5 grid gap-3 sm:grid-cols-5">
            {steps.map((label, index) => {
              const done = index < step || execution.status === 'succeeded';
              const current = index === step && execution.status !== 'succeeded';
              const failed = current && ['failed', 'blocked', 'verification_failed', 'interrupted', 'expired', 'cancelled'].includes(execution.status);
              const percent = stepPercent(execution, index, step);
              const bar = done ? 'bg-green-500' : failed ? 'bg-red-500' : current ? 'bg-primary' : 'bg-slate-200';
              return <li key={label} className={`rounded-xl border p-3 ${done ? 'border-green-200 bg-green-50/40' : current ? failed ? 'border-red-200 bg-red-50/40' : 'border-blue-200 bg-primary-soft/30' : 'border-slate-200 bg-white'}`}>
                <div className="flex items-center gap-2">
                  {done ? <CheckCircle2 size={18} className="shrink-0 text-green-600" /> : <Circle size={18} className={`shrink-0 ${current ? failed ? 'text-red-600' : 'text-primary' : 'text-muted'}`} />}
                  <span className={`text-xs font-semibold ${done ? 'text-green-800' : current ? failed ? 'text-red-800' : 'text-primary' : 'text-muted'}`}>{label}</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label={`${label} progress`} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
                  <div className={`progress-fill h-full rounded-full ${current && !failed ? 'is-active' : ''} ${bar}`} style={{ width: `${percent}%` }} />
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-muted"><span>{percent}%</span><span>{done ? 'Complete' : current ? failed ? 'Needs attention' : 'In progress' : 'Waiting'}</span></div>
              </li>;
            })}
          </ol>
          {execution.message && <p role="status" className="mt-4 rounded-lg bg-inset p-3 text-sm text-muted">{execution.message}</p>}
          {execution.error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{execution.error}</p>}
          {actionError && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{actionError}</p>}
          {execution.status === 'awaiting_restart' && <p className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><ShieldAlert size={17} className="mt-0.5 shrink-0" />Restart Windows, then run the confirming scan.</p>}
          {execution.status === 'succeeded' && <p className="mt-4 flex items-start gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-800"><CheckCircle2 size={17} className="mt-0.5 shrink-0" />Update confirmed{execution.confirmedAt ? ` at ${new Date(execution.confirmedAt).toLocaleString()}` : ''}.</p>}
          {status.action && !['succeeded', 'awaiting_restart'].includes(execution.status) && <p className="mt-4 rounded-lg bg-inset p-3 text-sm text-muted">{status.action}</p>}
        </div>
      </section>
      <details className="panel overflow-hidden">
        <summary className="cursor-pointer list-none p-6 font-semibold">Technical details <span className="ml-2 text-xs font-normal text-muted">(optional)</span></summary>
        <div className="border-t border-slate-100 p-6">
          <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[['Package ID', execution.packageId], ['Execution profile', execution.profile], ['Installer type', execution.installerType], ['Installer SHA-256', execution.installerSha256],
              ['Scope', execution.scope], ['Queued at', new Date(execution.createdAt).toLocaleString()],
              ['Started at', execution.startedAt ? new Date(execution.startedAt).toLocaleString() : 'Not started'],
              ['Finished at', execution.finishedAt ? new Date(execution.finishedAt).toLocaleString() : 'Not finished'],
              ['Execution ID', execution.id]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 break-all font-medium">{value}</dd></div>)}
          </dl>
        </div>
      </details>
      <details className="panel overflow-hidden">
        <summary className="cursor-pointer list-none p-6 font-semibold">Activity log <span className="ml-2 text-xs font-normal text-muted">(optional)</span></summary>
        <div className="border-t border-slate-100 p-6">
          {execution.jobs.length ? <div className="overflow-x-auto"><table className="w-full"><thead><tr><th>Operation</th><th>State</th><th>Created</th><th>Finished</th></tr></thead><tbody>{execution.jobs.map(job => <tr key={job.id}><td className="text-xs font-medium">{job.operation}</td><td><Badge>{job.state}</Badge>{job.error && <p className="mt-1 text-xs text-red-700">{job.error}</p>}</td><td className="text-xs">{new Date(job.createdAt).toLocaleString()}</td><td className="text-xs">{job.finishedAt ? new Date(job.finishedAt).toLocaleString() : 'Pending'}</td></tr>)}</tbody></table></div>
            : <p className="text-sm text-muted">No linked agent jobs are recorded yet.</p>}
        </div>
      </details>
      <div className="flex flex-wrap justify-end gap-3"><Link className="rounded-lg border border-slate-200 bg-white px-4 py-2" href="/history">View history</Link><Link className="primary-button" href="/updates">Back to updates</Link></div>
    </>}
  </>;
}
