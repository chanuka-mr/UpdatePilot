'use client';
import { useEffect, useState } from 'react';
import { RefreshCw, Database, Download, Grip } from 'lucide-react';
import { AppIcon, Heading } from '../../components/ui/dashboard';

type Dashboard = { state: 'ready'; deviceName: string; scannedAt: string; importedAt: string; stale: boolean;
  wingetStatus: string; warningCount: number; registryEntries: number; wingetEntries: number | null;
  updatesAvailable: number | null; matched: number | null; unmatched: number | null;
  updatePreview: { id: string; name: string; packageId: string; installedVersion: string | null }[] } | { state: 'empty' };
export function LiveOverview() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setData(null);
    fetch('/api/dashboard', { cache: 'no-store', signal: controller.signal }).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Unable to load dashboard.');
      if (!['ready', 'empty'].includes(body.state)) throw new Error('Unexpected dashboard response.');
      setData(body);
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Unable to load dashboard.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);
  return <><Heading title="Overview" description="Software inventory from your latest imported Windows agent scan."
    action={<button className="primary-button" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={17} className={loading ? 'animate-spin' : ''}/>Refresh stored data</button>}/>
    {loading && <div role="status" className="panel p-10 text-center text-muted">Loading the latest scan from PostgreSQL…</div>}
    {error && <div role="alert" className="panel border border-red-100 p-6"><h2 className="font-semibold">Dashboard unavailable</h2><p className="mt-2 text-muted">{error}</p><button className="mt-4 text-primary underline" onClick={() => setRefresh(value => value + 1)}>Try again</button></div>}
    {!loading && data?.state === 'empty' && <section className="panel p-10 text-center"><Database className="mx-auto text-primary"/><h2 className="mt-4 text-lg font-semibold">No imported scans yet</h2><p className="mt-2 text-muted">Import an agent snapshot into the configured device, then refresh this page.</p></section>}
    {!loading && data?.state === 'ready' && <>
      <section className="panel p-5"><h2 className="font-semibold">{data.deviceName}</h2><p className="mt-2 text-sm text-muted">Last imported scan: {new Date(data.scannedAt).toLocaleString()}</p><p className="mt-1 text-xs text-muted">Imported {new Date(data.importedAt).toLocaleString()} · Live agent connection unknown</p>
        {(data.stale || data.warningCount > 0 || data.wingetStatus !== 'completed') && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">{data.stale ? 'Scan is over 24 hours old. ' : ''}{data.warningCount > 0 ? `${data.warningCount} scan warning(s). ` : ''}{data.wingetStatus !== 'completed' ? 'WinGet scan was not completed; update counts are unknown.' : ''}</p>}
      </section>
      <div className="grid gap-4 sm:grid-cols-3">{[['Desktop registry entries', data.registryEntries, Grip], ['Updates available', data.updatesAvailable, Download], ['WinGet inventory entries', data.wingetEntries, Database]].map(([label,count,Icon]) => {const I=Icon as typeof Grip;return <section className="panel p-6" key={String(label)}><div className="flex justify-between gap-2"><h2 className="metric-label">{String(label)}</h2><I size={23} className="text-primary"/></div><p className="metric-number">{count === null ? 'Unknown' : String(count)}</p></section>;})}</div>
      <p className="text-xs text-muted">Registry and WinGet entries cover different sets and are not added together. Catalog matched: {data.matched ?? 'unknown'} · Unmatched: {data.unmatched ?? 'unknown'}. Unmatched entries are not classified as up to date.</p>
      <section className="panel overflow-hidden"><div className="p-6"><h2 className="text-xl font-semibold">Available Updates</h2><p className="mt-2 text-xs text-muted">First five matched update candidates from the stored scan. Installation targets still require a separate verified preview.</p></div>
        {data.updatePreview.length ? <div className="overflow-x-auto"><table className="w-full"><thead><tr><th>Application</th><th>Package ID</th><th>Installed version</th><th>Status</th></tr></thead><tbody>{data.updatePreview.map(app => <tr key={app.id}><td><div className="flex items-center gap-3"><AppIcon name={app.name}/><strong>{app.name}</strong></div></td><td className="font-mono text-xs text-muted">{app.packageId}</td><td><span className="version">{app.installedVersion || 'Unknown'}</span></td><td className="whitespace-nowrap text-xs text-primary">Update available</td></tr>)}</tbody></table></div> : <p className="px-6 pb-6 text-muted">{data.wingetStatus === 'completed' ? 'No matched update candidates in this scan.' : 'Update information is unavailable for this scan.'}</p>}
      </section>
      <p className="text-xs text-muted">Refresh reloads PostgreSQL data; it does not start an agent scan. Applications, update-review, and history pages still use labelled demo data.</p>
    </>}
  </>;
}
