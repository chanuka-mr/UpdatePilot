'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react';
import { AppIcon, Badge, Heading, SearchField } from '../../components/ui/dashboard';

type Finding = { cveId: string; description: string; severity: string; score: number | null; cvssVersion: string | null;
  published: string | null; lastModified: string | null; matchedRanges: string[]; url: string };
type Row = { id: string; name: string; packageId: string; installedVersion: string | null; normalizedVersion: string | null;
  mappingStatus: 'mapped' | 'unmapped' | 'unparseable'; status: 'findings' | 'none' | 'unavailable' | 'unparseable' | 'unmapped';
  mapping: { vendor: string; product: string } | null; findings: Finding[]; error?: string; note?: string };
type Result = { state: 'ready' | 'empty'; deviceName?: string; snapshotId?: string; scannedAt?: string; checkedAt?: string;
  nvdApiKeyConfigured?: boolean; summary?: { packages: number; mapped: number; packagesWithFindings: number; findings: number;
    unmapped: number; unparseable: number; unavailable: number; truncatedProducts: number }; rows?: Row[] };
const severityClass = (severity: string) => severity === 'CRITICAL' ? 'bg-red-100 text-red-800' : severity === 'HIGH' ? 'bg-orange-100 text-orange-800'
  : severity === 'MEDIUM' ? 'bg-amber-100 text-amber-900' : severity === 'LOW' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-700';

export function LiveSecurity() {
  const [data, setData] = useState<Result | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [query, setQuery] = useState(''); const [findingsOnly, setFindingsOnly] = useState(false); const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let stopped = false;
    setLoading(true); setError('');
    fetch('/api/security', { cache: 'no-store', signal: controller.signal }).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Security insights unavailable.');
      if (!stopped) setData(body);
    }).catch(failure => { if (!stopped) setError(failure instanceof Error ? failure.message : 'Security insights unavailable.'); })
      .finally(() => { if (!stopped) setLoading(false); });
    return () => { stopped = true; controller.abort(); };
  }, [revision]);
  const rows = (data?.rows ?? []).filter(row => {
    if (findingsOnly && row.status !== 'findings') return false;
    const search = query.trim().toLowerCase();
    return !search || row.name.toLowerCase().includes(search) || row.packageId.toLowerCase().includes(search) || row.findings.some(value => value.cveId.toLowerCase().includes(search));
  });
  return <>
    <Heading title="Security Insights" description="NVD advisories checked against curated WinGet package identities and the latest stored scan." action={<button disabled={loading} onClick={() => setRevision(value => value + 1)} className="primary-button"><RefreshCw size={17} className={loading ? 'animate-spin' : ''}/>Refresh findings</button>}/>
    {loading && !data && <section className="panel p-10 text-center"><p role="status" className="font-semibold">Checking NVD advisories...</p><p className="mt-2 text-sm text-muted">The first check can take several minutes without an NVD API key. Results are cached locally for six hours.</p></section>}
    {error && !data && <section className="panel p-8"><h2 className="font-semibold">Security insights unavailable</h2><p role="alert" className="mt-2 text-muted">{error}</p><button className="mt-4 text-primary underline" onClick={() => setRevision(value => value + 1)}>Try again</button></section>}
    {!loading && !error && data?.state === 'empty' && <section className="panel p-10 text-center"><ShieldCheck className="mx-auto text-slate-400" size={32}/><h2 className="mt-4 text-lg font-semibold">No stored inventory yet</h2><p className="mt-2 text-muted">Run an agent scan before checking advisories.</p><Link href="/" className="mt-5 inline-block text-primary underline">Return to dashboard</Link></section>}
    {data?.state === 'ready' && data.summary && <>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[['Packages checked', data.summary.packages], ['Mapped to NVD', data.summary.mapped], ['Verified findings', data.summary.findings], ['Not evaluated', data.summary.unmapped + data.summary.unparseable]].map(([label, value]) => <div key={label} className="panel p-5"><p className="text-xs text-muted">{label}</p><p className="mt-2 text-3xl font-semibold">{value}</p></div>)}
      </section>
      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-5">
          <SearchField placeholder="Search application, package ID, or CVE" value={query} onChange={setQuery}/>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-blue-600" checked={findingsOnly} onChange={event => setFindingsOnly(event.target.checked)}/>Only verified findings</label>
          <span className="ml-auto text-xs text-muted">{data.deviceName} - scan {data.scannedAt ? new Date(data.scannedAt).toLocaleString() : 'unknown'}</span>
        </div>
        {!rows.length ? <div className="p-10 text-center"><h2 className="font-semibold">No packages match this view</h2><p className="mt-2 text-muted">Clear the search or show packages without findings.</p><button className="mt-4 text-primary underline" onClick={() => { setQuery(''); setFindingsOnly(false); }}>Clear filters</button></div>
          : <div className="divide-y divide-slate-100">{rows.map(row => <article key={row.id} className="p-5">
            <div className="flex flex-wrap items-start gap-3">
              <AppIcon name={row.name}/>
              <div className="min-w-0 flex-1"><h2 className="font-semibold">{row.name}</h2><p className="mt-1 break-all text-xs text-muted">{row.packageId} - installed {row.installedVersion ?? 'unknown'}{row.normalizedVersion && row.normalizedVersion !== row.installedVersion ? ` (checked ${row.normalizedVersion})` : ''}</p>
                {row.mapping && <p className="mt-1 break-all font-mono text-[10px] text-muted">{row.mapping.vendor}:{row.mapping.product}</p>}</div>
              <Badge>{row.status === 'findings' ? `${row.findings.length} verified finding${row.findings.length === 1 ? '' : 's'}` : row.status.replaceAll('_', ' ')}</Badge>
              <Link href={`/applications/${encodeURIComponent(row.id)}`} className="text-xs text-primary hover:underline">Open application</Link>
            </div>
            {row.findings.length > 0 ? <div className="mt-4 space-y-3">{row.findings.map(finding => <div key={finding.cveId} className="rounded-lg border border-slate-200 p-4">
              <div className="flex flex-wrap items-center gap-2"><a href={finding.url} target="_blank" rel="noreferrer" className="font-mono text-sm font-semibold text-primary hover:underline">{finding.cveId}<ExternalLink className="ml-1 inline" size={12}/></a><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${severityClass(finding.severity)}`}>{finding.severity}</span><span className="text-xs text-muted">{finding.score === null ? 'No CVSS score' : `CVSS ${finding.score}${finding.cvssVersion ? ` (${finding.cvssVersion})` : ''}`}</span></div>
              <p className="mt-2 text-sm leading-6">{finding.description}</p>
              <p className="mt-2 text-xs text-muted">Matched installed version against NVD range: {finding.matchedRanges.join(' or ')}</p>
            </div>)}</div>
              : <p className="mt-3 text-sm text-muted">{row.status === 'unmapped' ? 'No verified finding available. This package is not in the curated NVD mapping.' : row.status === 'unparseable' ? 'No verified finding available. The installed version could not be parsed safely.' : row.status === 'unavailable' ? row.error : 'No verified finding available for this installed version.'}</p>}
            {row.note && <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900"><AlertTriangle className="mt-0.5 shrink-0" size={14}/>{row.note}</p>}
          </article>)}</div>}
        <div className="flex flex-wrap justify-between gap-3 border-t border-slate-100 p-5 text-xs text-muted"><span>{data.summary.packagesWithFindings} packages with verified findings - {data.summary.unavailable} NVD queries unavailable - checked {data.checkedAt ? new Date(data.checkedAt).toLocaleString() : 'just now'}</span><span>{data.nvdApiKeyConfigured ? 'NVD API key configured' : 'No NVD API key; cache is used to respect rate limits'}</span></div>
      </section>
      <p className="text-xs leading-5 text-muted">Security insights are conservative: a finding is shown only when NVD publishes a vulnerable CPE version range containing the installed version. Packages without a curated package-to-CPE mapping, with unparseable versions, or with unavailable NVD responses are shown as having no verified finding; that is not proof the software is vulnerability-free. NVD data can lag vendor advisories. Always verify a CVE and vendor guidance before acting.</p>
    </>}
  </>;
}
