'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, RefreshCw } from 'lucide-react';
import { AppIcon, Badge, Heading } from '../../components/ui/dashboard';

type RecordRow = {
  id: string; kind: 'registry' | 'winget'; name: string; installedVersion: string | null;
  publisher?: string | null; packageId?: string | null; source?: string | null; status: string;
  scope?: string | null; registryView?: string | null; availableVersions?: string[];
  matchStatus?: string; discoverySource?: string; registryPath?: string; isUpdateAvailable?: boolean;
};
type Evidence = { id: string; createdAt: string; finishedAt: string | null; request: unknown; preview: unknown; verification: unknown };
type Result = { state: string; kind?: string; record?: RecordRow; snapshot?: { snapshotId: string; scannedAt: string; importedAt: string; wingetStatus: string; stale: boolean; warningCount: number };
  evidence?: { preview: Evidence | null; verification: Evidence | null } | null };

const statusLabel: Record<string, string> = { update: 'Update available', matched: 'No known update', unmatched: 'Unmatched' };
const text = (value: unknown, key: string) => {
  if (!value || typeof value !== 'object' || !(key in value)) return null;
  const found = (value as Record<string, unknown>)[key];
  return typeof found === 'string' || typeof found === 'number' || typeof found === 'boolean' ? String(found) : null;
};

export function LiveRecordDetail({ id, updates }: { id: string; updates: boolean }) {
  const [data, setData] = useState<Result | null>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setData(null);
    fetch(`/api/${updates ? 'updates' : 'applications'}/${encodeURIComponent(id)}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Stored record unavailable.'); setData(body); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Stored record unavailable.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, updates, revision]);
  const record = data?.record;
  const preview = data?.evidence?.preview ?? null;
  const verification = data?.evidence?.verification ?? null;
  return <>
    <Link href={updates ? '/updates' : '/applications'} className="inline-flex items-center gap-2 text-xs text-muted hover:text-primary"><ArrowLeft size={14}/>{updates ? 'Available updates' : 'Installed applications'}</Link>
    <Heading title={record?.name || (updates ? 'Update record' : 'Application record')} description="Stored inventory and verified agent evidence for this exact record." />
    {loading && <p role="status" className="panel p-10 text-center text-muted">Loading stored record...</p>}
    {error && <div role="alert" className="panel p-8"><h2 className="font-semibold">Record unavailable</h2><p className="mt-2 text-muted">{error}</p><button className="mt-3 text-primary underline" onClick={() => setRevision(value => value + 1)}>Try again</button></div>}
    {!loading && !error && data && !record && <div className="panel p-10 text-center"><h2 className="font-semibold">Record not found</h2><p className="mt-2 text-muted">This record is not part of the latest stored scan. Refresh the inventory or run a fresh scan.</p></div>}
    {record && <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 p-6">
        <div className="flex items-center gap-3"><AppIcon name={record.name}/><div><h2 className="text-xl font-semibold">{record.name}</h2><p className="mt-1 break-all text-xs text-muted">{record.packageId || record.publisher || 'Registered desktop application'}</p></div></div>
        <Badge>{statusLabel[record.status] || record.status}</Badge>
      </div>
      <dl className="grid gap-5 p-6 sm:grid-cols-2 lg:grid-cols-3">
        {[
          ['Installed version', record.installedVersion || 'Unknown'], ['Source', record.kind === 'registry' ? 'Desktop registry' : 'WinGet'],
          ['Status', statusLabel[record.status] || record.status], ['Package ID', record.packageId || 'Not matched'],
          ['Publisher', record.publisher || 'Not recorded'], ['Scope', record.scope || 'Not established'],
          ['Registry view', record.registryView || 'Not applicable'], ['Match status', record.matchStatus || 'Not applicable'],
          ['Record ID', record.id],
        ].map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 break-all font-medium">{value}</dd></div>)}
      </dl>
      {record.availableVersions && record.availableVersions.length > 0 && <div className="border-t border-slate-100 p-6">
        <h3 className="font-semibold">Catalog versions</h3><p className="mt-2 text-xs text-muted">Historical releases may be included. A version is not an approved installation target.</p>
        <p className="mt-3 break-all rounded-lg bg-inset p-3 font-mono text-xs">{record.availableVersions.join(', ')}</p>
      </div>}
      <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 p-6">
        {record.status === 'update' && <Link className="primary-button" href={`/updates/${record.id}/confirm?name=${encodeURIComponent(record.name)}`}>Review and verify <ArrowRight size={16}/></Link>}
        <button className="rounded-lg bg-inset px-4 py-2" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw className="mr-2 inline" size={15}/>Refresh</button>
      </div>
    </section>}
    {record && <section className="panel p-6">
      <h2 className="text-lg font-semibold">Agent evidence</h2>
      <p className="mt-2 text-xs text-muted">Evidence is read from completed preview and verification jobs. It is not a live agent query.</p>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 p-4"><h3 className="font-semibold">Latest preview</h3>{preview ? <dl className="mt-3 space-y-3 text-sm">
          {[['Target version', text(preview.preview, 'targetVersion') || 'Unknown'], ['Installer type', text(preview.preview, 'installerType') || 'Not confirmed'],
            ['Installer SHA-256', text(preview.preview, 'installerSha256') || 'Not confirmed'], ['Selection validated', text(preview.preview, 'selectionValidated') || 'Not confirmed'],
            ['Checked at', new Date(preview.createdAt).toLocaleString()]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 break-all">{value}</dd></div>)}
        </dl> : <p className="mt-3 text-sm text-muted">No completed preview is recorded for this package.</p>}</div>
        <div className="rounded-lg border border-slate-200 p-4"><h3 className="font-semibold">Latest verification</h3>{verification ? <dl className="mt-3 space-y-3 text-sm">
          {[['Architecture', text(verification.verification, 'architecture') || 'Unknown'], ['Hash matched', text(verification.verification, 'hashMatched') || 'Unknown'],
            ['Signature', text((verification.verification as Record<string, unknown> | null)?.signature, 'status') || 'Unknown'], ['Verified at', new Date(verification.createdAt).toLocaleString()]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 break-all">{value}</dd></div>)}
        </dl> : <p className="mt-3 text-sm text-muted">No completed installer verification is recorded for this package.</p>}</div>
      </div>
      {record.status === 'update' && <p className="mt-5 rounded-lg bg-inset p-3 text-xs leading-5 text-muted">Starting an update requires a fresh preview, passing installer verification, and the backend execution gate. The agent re-downloads and rechecks the exact installer before launch.</p>}
    </section>}
    {data?.snapshot && <p className="text-xs text-muted">Stored scan: {new Date(data.snapshot.scannedAt).toLocaleString()} | WinGet: {data.snapshot.wingetStatus}{data.snapshot.stale ? ' | Over 24 hours old' : ''}{data.snapshot.warningCount ? ` | ${data.snapshot.warningCount} warning(s)` : ''}</p>}
  </>;
}
