'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { AppIcon, Badge, SearchField } from '../../components/ui/dashboard';

type Execution = { id: string; name: string; packageId: string; installedVersion: string; targetVersion: string;
  status: string; stage: string; progress: number; message: string | null; error: string | null;
  createdAt: string; startedAt: string | null; finishedAt: string | null; confirmedAt: string | null };
type Result = { state: string; rows: Execution[]; total: number; page: number; pageSize: number };
const active = new Set(['queued', 'running', 'confirming', 'awaiting_restart']);

export function ExecutionHistory() {
  const [q, setQ] = useState(''); const [status, setStatus] = useState('all'); const [page, setPage] = useState(1);
  const [data, setData] = useState<Result | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let stopped = false; let timer: ReturnType<typeof setTimeout>;
    setLoading(true); setError('');
    const load = async () => {
      try {
        const params = new URLSearchParams({ q, status, page: String(page), pageSize: '5' });
        const response = await fetch(`/api/executions?${params}`, { cache: 'no-store', signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Update activity unavailable.');
        if (stopped) return;
        setData(body); setLoading(false);
        if (body.rows?.some((row: Execution) => active.has(row.status))) timer = setTimeout(() => void load(), 3000);
      } catch (failure) { if (!stopped) { setError(failure instanceof Error ? failure.message : 'Update activity unavailable.'); setLoading(false); } }
    };
    const debounce = setTimeout(() => void load(), 200);
    return () => { stopped = true; clearTimeout(debounce); clearTimeout(timer); controller.abort(); };
  }, [q, status, page, revision]);
  const clear = () => { setQ(''); setStatus('all'); setPage(1); };
  return <section className="panel overflow-hidden">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 p-5">
      <div><h2 className="text-lg font-semibold">Update activity</h2><p className="mt-1 text-sm text-muted">Verified update executions and their confirmation state.</p></div>
      <button disabled={loading} onClick={() => setRevision(value => value + 1)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"><RefreshCw size={15} className={loading ? 'mr-2 inline animate-spin' : 'mr-2 inline'}/>Refresh</button>
    </div>
    <div className="flex flex-wrap gap-3 border-b border-slate-100 p-5">
      <SearchField placeholder="Search app or package ID" value={q} onChange={value => { setQ(value); setPage(1); }}/>
      <select aria-label="Update execution status" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }} className="rounded-lg border border-slate-200 bg-white p-2">
        <option value="all">All execution states</option>
        {['queued','running','confirming','awaiting_restart','succeeded','verification_failed','failed','blocked','cancelled','interrupted'].map(value => <option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}
      </select>
    </div>
    {loading && !data ? <p role="status" className="p-8 text-center text-muted">Loading update activity...</p>
      : error ? <div role="alert" className="p-6"><p className="text-red-700">{error}</p><button className="mt-3 text-primary underline" onClick={() => setRevision(value => value + 1)}>Try again</button></div>
        : data && !data.rows.length ? <div className="p-8 text-center"><h3 className="font-semibold">{q || status !== 'all' ? 'No updates match these filters' : 'No verified updates yet'}</h3><p className="mt-2 text-muted">{q || status !== 'all' ? 'Adjust the search or execution state.' : 'Start a verified update from an update confirmation page.'}</p><button className="mt-4 text-primary underline" onClick={clear}>Clear filters</button></div>
          : data && <div className="overflow-x-auto"><table className="w-full"><thead><tr>{['Application','Version','State','Queued','Action'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{data.rows.map(row => <tr key={row.id}>
            <td><div className="flex items-center gap-3"><AppIcon name={row.name}/><div><p className="font-semibold">{row.name}</p><p className="mt-1 break-all text-[11px] text-muted">{row.packageId}</p></div></div></td>
            <td className="whitespace-nowrap font-mono text-xs">{row.installedVersion}<ArrowRight className="mx-1 inline" size={12}/>{row.targetVersion}</td>
            <td><Badge>{row.status.replaceAll('_',' ')}</Badge><p className="mt-2 text-xs text-muted">{row.stage.replaceAll('_',' ')} - {row.progress}%</p>{row.error && <p className="mt-1 max-w-xs text-xs text-red-700">{row.error}</p>}</td>
            <td className="whitespace-nowrap text-xs">{new Date(row.createdAt).toLocaleString()}</td>
            <td><Link className="text-xs font-medium text-primary hover:underline" href={`/updates/executions/${encodeURIComponent(row.id)}`}>Open</Link></td>
          </tr>)}</tbody></table></div>}
    {!loading && !error && data && <div className="flex flex-wrap justify-between gap-4 border-t border-slate-100 p-5 text-xs text-muted"><span>{data.total ? `${(data.page - 1) * data.pageSize + 1}-${Math.min(data.page * data.pageSize, data.total)} of ${data.total}` : '0'} executions</span><div className="flex gap-4"><button disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>Previous</button><span>Page {data.page}</span><button disabled={data.page * data.pageSize >= data.total} onClick={() => setPage(data.page + 1)}>Next</button></div></div>}
  </section>;
}
