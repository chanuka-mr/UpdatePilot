'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowRight, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { AppIcon, Badge, Heading } from '../../components/ui/dashboard';
import { blockerInfo } from '../../lib/status';
import { readStoredPreview, readStoredVerification, storeVerification, type InstallerVerification, type UpdatePreviewData } from './preview-data';

type ExecutionReadiness = {
  state: 'ready' | 'blocked';
  canStart: boolean;
  blockers: string[];
  executionEnabled: boolean;
  agentOnline: boolean;
  activeJob: boolean;
  profile: string | null;
  previewAvailable: boolean;
  verificationAvailable: boolean;
};

type DetailResponse = {
  state?: string;
  record?: { name?: string };
  evidence?: { preview?: { preview?: unknown } | null };
  execution?: ExecutionReadiness | null;
  error?: string;
};

export function UpdateConfirmation({ recordId, name }: { recordId: string; name: string }) {
  const router = useRouter();
  const [preview, setPreview] = useState<UpdatePreviewData | null>(null);
  const [displayName, setDisplayName] = useState(name);
  const [phase, setPhase] = useState('Checking stored preview');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const [startBlockers, setStartBlockers] = useState<string[]>([]);
  const [verification, setVerification] = useState<InstallerVerification | null>(null);
  const [verifyJob, setVerifyJob] = useState<string | null>(null);
  const [verifyPreviewCheckedAt, setVerifyPreviewCheckedAt] = useState('');
  const [verifyPhase, setVerifyPhase] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [verifyBlockers, setVerifyBlockers] = useState<string[]>([]);
  const [verifying, setVerifying] = useState(false);
  const [verifyStartedAt, setVerifyStartedAt] = useState<number | null>(null);
  const [verifyElapsed, setVerifyElapsed] = useState(0);
  const [readiness, setReadiness] = useState<ExecutionReadiness | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(true);
  const [readinessError, setReadinessError] = useState('');
  const [readinessRevision, setReadinessRevision] = useState(0);

  useEffect(() => {
    setConfirmed(false); setAcknowledged(false); setError(''); setStarting(false); setStartError(''); setStartBlockers([]);
    setVerification(null); setVerifyJob(null); setVerifyPreviewCheckedAt(''); setVerifyPhase(''); setVerifyError(''); setVerifyBlockers([]); setVerifying(false);
    const stored = readStoredPreview(recordId);
    if (stored) {
      setPreview(stored.preview); setDisplayName(stored.name || name); setPhase('Preview ready'); setLoading(false);
      const storedVerification = readStoredVerification(recordId);
      if (storedVerification && storedVerification.previewCheckedAt === stored.preview.checkedAt) setVerification(storedVerification.verification);
      return;
    }
    setPreview(null);
    if (attempt === 0) { setPhase('No stored preview'); setLoading(false); return; }
    const controller = new AbortController(); let stopped = false; let timer: ReturnType<typeof setTimeout>;
    setPhase('Requesting a fresh preview'); setLoading(true);
    const poll = async (jobId: string) => {
      try {
        const response = await fetch('/api/agent/status', { cache: 'no-store', signal: controller.signal });
        const body = await response.json() as { error?: string; job?: { id: string; state: string; preview?: UpdatePreviewData; error?: string }; jobId?: string };
        if (!response.ok) throw new Error(body.error || 'Preview status unavailable.');
        if (stopped) return;
        if (body.job?.id !== jobId) { setError('A newer job replaced this preview request. Wait for the agent to finish, then retry.'); setLoading(false); return; }
        setPhase(body.job.state);
        if (body.job.state === 'completed') {
          if (body.job.preview) {
            setPreview(body.job.preview); setPhase('Preview ready');
            setReadinessRevision(value => value + 1);
            const storedVerification = readStoredVerification(recordId);
            if (storedVerification && storedVerification.previewCheckedAt === body.job.preview.checkedAt) setVerification(storedVerification.verification);
          } else setError('No preview metadata was returned.');
          setLoading(false);
          return;
        }
        if (['failed', 'interrupted'].includes(body.job.state)) { setError(body.job.error || 'Preview failed. Check the agent and run a fresh scan.'); setLoading(false); return; }
        timer = setTimeout(() => void poll(jobId), 1000);
      } catch (caught) { if (!stopped) { setError(caught instanceof Error ? caught.message : 'Preview unavailable.'); setLoading(false); } }
    };
    const start = async () => {
      try {
        const response = await fetch('/api/agent/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recordId }), signal: controller.signal });
        const body = await response.json() as { error?: string; jobId?: string; state?: string };
        if (!response.ok) throw new Error(body.error || 'Cannot request preview.');
        if (stopped) return;
        setPhase(body.state || 'queued');
        if (body.jobId) await poll(body.jobId);
      } catch (caught) { if (!stopped) { setError(caught instanceof Error ? caught.message : 'Preview unavailable.'); setLoading(false); } }
    };
    void start();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [recordId, name, attempt]);

  useEffect(() => {
    const controller = new AbortController(); let stopped = false;
    setReadinessLoading(true); setReadinessError('');
    fetch(`/api/updates/${encodeURIComponent(recordId)}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await response.json() as DetailResponse;
        if (!response.ok) throw new Error(body.error || `Readiness request failed (${response.status})`);
        if (stopped) return;
        setReadiness(body.execution ?? null);
        if (body.record?.name) setDisplayName(body.record.name);
        const evidencePreview = body.evidence?.preview?.preview;
        if (!preview && evidencePreview && typeof evidencePreview === 'object' && 'checkedAt' in evidencePreview) setPreview(evidencePreview as UpdatePreviewData);
      })
      .catch(caught => { if (!stopped) setReadinessError(caught instanceof Error ? caught.message : 'Unable to check execution readiness.'); })
      .finally(() => { if (!stopped) setReadinessLoading(false); });
    return () => { stopped = true; controller.abort(); };
  }, [recordId, readinessRevision, verification, preview?.checkedAt]);

  useEffect(() => {
    if (!verifying || !verifyStartedAt) return;
    setVerifyElapsed(Math.max(0, Math.floor((Date.now() - verifyStartedAt) / 1000)));
    const ticker = window.setInterval(() => {
      setVerifyElapsed(Math.max(0, Math.floor((Date.now() - verifyStartedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(ticker);
  }, [verifying, verifyStartedAt]);

  useEffect(() => {
    if (!verifyJob) return;
    const controller = new AbortController(); let stopped = false; let timer: ReturnType<typeof setTimeout>;
    setVerifying(true); setVerifyError(''); setVerifyBlockers([]);
    const poll = async () => {
      try {
        const response = await fetch('/api/agent/status', { cache: 'no-store', signal: controller.signal });
        const body = await response.json() as { error?: string; job?: { id: string; state: string; verification?: InstallerVerification; error?: string } };
        if (!response.ok) throw new Error(body.error || 'Verification status unavailable.');
        if (stopped) return;
        if (body.job?.id !== verifyJob) { setVerifyError('A newer job replaced this verification request. Wait for the agent to finish, then retry.'); setVerifying(false); return; }
        setVerifyPhase(body.job.state);
        if (body.job.state === 'completed') {
          if (body.job.verification) {
            setVerification(body.job.verification);
            setReadinessRevision(value => value + 1);
            if (verifyPreviewCheckedAt) storeVerification(recordId, verifyPreviewCheckedAt, body.job.verification);
          } else setVerifyError('No verification evidence was returned.');
          setVerifying(false); setVerifyJob(null); return;
        }
        if (['failed', 'interrupted'].includes(body.job.state)) {
          setVerifyError(body.job.error === 'verify_failed' ? 'Installer verification failed. The installer was not executed.' : body.job.error || 'Installer verification failed.');
          setVerifying(false); setVerifyJob(null); return;
        }
        timer = setTimeout(() => void poll(), 1000);
      } catch (caught) { if (!stopped) { setVerifyError(caught instanceof Error ? caught.message : 'Verification unavailable.'); setVerifying(false); setVerifyJob(null); } }
    };
    void poll();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [verifyJob, verifyPreviewCheckedAt, recordId]);

  async function requestVerification() {
    if (!preview) return;
    setVerification(null); setVerifyError(''); setVerifyBlockers([]); setVerifyPreviewCheckedAt(preview.checkedAt); setVerifyPhase('Requesting'); setVerifyStartedAt(Date.now()); setVerifyElapsed(0); setVerifying(true);
    try {
      const response = await fetch('/api/agent/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recordId }) });
      const body = await response.json() as { error?: string; details?: { blockers?: string[] }; jobId?: string; state?: string };
      if (!response.ok) {
        setVerifyBlockers(Array.isArray(body.details?.blockers) ? body.details.blockers : []);
        throw new Error(body.error || 'Cannot request installer verification.');
      }
      setVerifyJob(body.jobId || null); setVerifyPhase(body.state || 'queued');
    } catch (caught) { setVerifyError(caught instanceof Error ? caught.message : 'Verification unavailable.'); setVerifying(false); }
  }

  async function startUpdate() {
    if (!preview || !verification) return;
    setStarting(true); setStartError(''); setStartBlockers([]);
    try {
      const response = await fetch('/api/agent/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recordId }) });
      const body = await response.json() as { error?: string; details?: { blockers?: string[] }; executionId?: string };
      if (!response.ok) {
        setStartBlockers(Array.isArray(body.details?.blockers) ? body.details.blockers : []);
        throw new Error(body.error || 'Cannot start the verified update.');
      }
      if (typeof body.executionId !== 'string') throw new Error('The backend did not return an update execution.');
      setConfirmed(true);
      router.push(`/updates/executions/${encodeURIComponent(body.executionId)}`);
    } catch (caught) { setStartError(caught instanceof Error ? caught.message : 'Cannot start the verified update.'); setStarting(false); setReadinessRevision(value => value + 1); }
  }

  const verifyPercent = verification ? 100
    : verifyError ? Math.min(90, Math.max(20, 20 + verifyElapsed * 2))
      : !verifying ? 0
        : verifyPhase === 'Requesting' ? 12
          : verifyPhase === 'queued' ? 25
            : Math.min(92, Math.round(32 + 58 * (1 - Math.exp(-verifyElapsed / 18))));
  const verifyStageLabel = verification ? 'Verification complete'
    : verifyError ? 'Verification failed'
      : verifyPhase === 'running' ? 'Downloading and checking SHA-256, signature, and architecture'
        : verifyPhase === 'queued' ? 'Waiting for paired agent to claim verification'
          : 'Requesting verification';

  const identityReady = !!preview && preview.selectionValidated && !!preview.targetVersion && !!preview.installerType && !!preview.installerSha256;
  const verificationReady = !!verification && verification.signature.status === 'Valid' && verification.architectureCompatible && verification.hashMatched;
  const canConfirm = identityReady && verificationReady && acknowledged && !confirmed && !starting && !readinessLoading && !!readiness?.canStart;
  const readinessBlockers = readiness?.blockers ?? [];
  const badge = confirmed ? { label: 'Update queued', tone: 'success' as const }
    : readiness?.canStart ? { label: 'Ready to start', tone: 'success' as const }
      : readiness ? { label: 'Blocked', tone: 'danger' as const }
        : { label: 'Awaiting verified preview', tone: 'warning' as const };

  return <><Link href="/updates" className="text-xs text-muted">Updates / Confirm Update</Link>
    <Heading title="Confirm Update" description="Step 3 of 3: review the exact release, verify the installer, then confirm the update." />
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 p-6">
        <div className="flex items-center gap-3">
          <AppIcon name={displayName} />
          <div>
            <h2 className="text-xl font-semibold">{displayName}</h2>
            <p className="mt-1 break-all text-xs text-muted">{preview?.packageId || 'Resolving package identity'}</p>
          </div>
        </div>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>
      {!preview && !error && !loading && <div className="p-6"><p role="status" className="text-muted">{attempt === 0 ? 'No stored preview for this update. Request a read-only preview to continue.' : phase}</p><button className="primary-button mt-4" onClick={() => setAttempt(value => value + 1)}>Request preview</button></div>}
      {!preview && !error && loading && <p role="status" className="p-6 text-muted">{phase} - Keep the paired agent running. This reads package metadata without downloading or installing an application.</p>}
      {error && <div role="alert" className="p-6"><p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p><button className="mt-3 text-primary underline" onClick={() => setAttempt(value => value + 1)}>Retry preview request</button></div>}
      {preview && <>
        <div className="grid gap-6 p-6 md:grid-cols-[1fr_auto_1fr]">
          <div className="rounded-xl bg-inset p-6"><p className="text-xs font-medium text-muted">Currently Installed</p><p className="mt-4 break-all font-mono text-4xl font-semibold">{preview.installedVersion}</p><p className="mt-3 text-xs text-muted">Reported by the latest stored scan</p></div>
          <ArrowRight className="self-center text-muted" />
          <div className="rounded-xl bg-primary-soft/40 p-6"><p className="text-xs font-medium text-primary">Target Version</p><p className="mt-4 break-all font-mono text-4xl font-semibold text-primary">{preview.targetVersion || 'Unknown'}</p><p className="mt-3 text-xs text-muted">Catalog candidate, not an approved target</p></div>
        </div>
        <dl className="mx-6 mb-6 grid gap-4 rounded-lg border border-slate-200 p-5 sm:grid-cols-2">
          {[['Installer type', preview.installerType || 'Not confirmed'], ['Installer SHA-256', preview.installerSha256 || 'Not confirmed'], ['Installation scope', preview.scope], ['Architecture', preview.architecture], ['Publisher', preview.publisher || 'Unknown'], ['Source', 'WinGet'], ['Current-device selection', preview.selectionValidated ? 'Validated metadata' : 'Not confirmed'], ['Checked at', new Date(preview.checkedAt).toLocaleString()]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 break-all font-medium">{value}</dd></div>)}
        </dl>
      </>}
    </section>
    {preview && <section className="panel p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck size={20} className="text-blue-600" />Installer verification</h2>
      <p className="mt-2 text-sm text-muted">Download the exact installer to a temporary folder and check its SHA-256, Authenticode signature, and architecture. The installer is never executed, and temporary files are removed.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button className="primary-button" disabled={!identityReady || verifying} onClick={() => void requestVerification()}>{verifying ? `Verifying - ${verifyPhase || 'requesting'}` : verification ? 'Re-verify installer' : 'Verify installer'}</button>
        {verification && <Badge tone={verificationReady ? 'success' : 'danger'}>{verificationReady ? 'Verification evidence recorded' : 'Verification incomplete'}</Badge>}
      </div>
      {(verifying || verification || verifyError) && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-medium text-foreground">{verifyStageLabel}</span>
            <div className="flex items-center gap-3 text-muted">
              {verifying && <span>Elapsed {verifyElapsed}s</span>}
              <span className="font-semibold text-foreground">{verifyPercent}%</span>
            </div>
          </div>
          <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="Installer verification progress" aria-valuenow={verifyPercent} aria-valuemin={0} aria-valuemax={100}>
            <div
              className={`progress-fill h-full rounded-full ${verifying ? 'is-active bg-primary' : verification ? (verificationReady ? 'bg-green-500' : 'bg-amber-500') : 'bg-red-500'}`}
              style={{ width: `${verifyPercent}%` }}
            />
          </div>
        </div>
      )}
      {verifyError && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{verifyError}</p>}
      {verifyBlockers.map(code => { const info = blockerInfo(code); return <div key={code} className="mt-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900"><strong>{info.label}.</strong> {info.description} {info.action}</div>; })}
      {verifying && <p role="status" className="mt-3 text-sm text-muted">Keep the paired agent running. The download can take several minutes; no installer is executed.</p>}
      {verification && <dl className="mt-5 grid gap-4 rounded-lg border border-slate-200 p-5 sm:grid-cols-2">
        {[['Architecture', verification.architecture], ['Architecture compatibility', verification.architectureCompatible ? 'Compatible' : 'Not compatible'], ['SHA-256 match', verification.hashMatched ? 'Matched' : 'Not matched'], ['Signature status', verification.signature.status], ['Signer', verification.signature.signerSubject || 'Not available'], ['Signer thumbprint', verification.signature.signerThumbprint || 'Not available'], ['Timestamped', verification.signature.timestamped ? 'Yes' : 'No'], ['Publisher match', verification.publisherMatch], ['Verified at', new Date(verification.verifiedAt).toLocaleString()]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 break-all font-medium">{value}</dd></div>)}
      </dl>}
      <p className="mt-4 rounded-lg bg-inset p-3 text-xs leading-5 text-muted">Verification evidence is reported by the paired agent and re-bound by the backend to this preview. Publisher matching is recorded for review and is not yet a hard gate. A valid signature, matching hash, and compatible architecture are required before the execution gate can open.</p>
    </section>}
    {preview && <section className="panel p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><ShieldAlert size={20} className="text-amber-600" />Warnings and limitations</h2>
      <ul className="mt-4 space-y-3 text-sm leading-6">
        <li className="rounded-lg bg-amber-50 p-3 text-amber-900">{preview.reason}</li>
        <li className="rounded-lg bg-inset p-3 text-muted">{verification ? 'Signature and architecture evidence applies only to the downloaded file matched by the preview SHA-256. Scope compatibility and reboot requirements remain unverified.' : 'Installer signature and architecture have not been verified. Run Verify installer to download and inspect the exact file.'}</li>
        <li className="rounded-lg bg-inset p-3 text-muted">Scope compatibility and reboot requirements are not verified.</li>
        <li className="rounded-lg bg-inset p-3 text-muted">A catalog candidate is not an approved installation target.</li>
      </ul>
    </section>}
    {preview && <section className="panel p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck size={20} className={readiness?.canStart ? 'text-green-600' : 'text-amber-600'} />Execution readiness</h2>
        <button className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs" disabled={readinessLoading} onClick={() => setReadinessRevision(value => value + 1)}><RefreshCw size={14} className={readinessLoading ? 'animate-spin' : ''} />Recheck</button>
      </div>
      <p className="mt-2 text-sm text-muted">The backend checks the execution flag, agent heartbeat, current scan, installer identity, and verification evidence before an update can start.</p>
      {readinessLoading && <p role="status" className="mt-4 rounded-lg bg-inset p-3 text-sm text-muted">Checking execution readiness...</p>}
      {readinessError && <div role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{readinessError} <button className="underline" onClick={() => setReadinessRevision(value => value + 1)}>Retry</button></div>}
      {!readinessLoading && !readinessError && readiness?.canStart && <div className="mt-4 rounded-lg bg-green-50 p-4 text-sm leading-6 text-green-800"><strong>All execution checks pass.</strong> You can start after you review the evidence and tick the confirmation box. The agent will re-download and recheck the exact installer before launch.</div>}
      {!readinessLoading && !readinessError && readiness && !readiness.canStart && <ul className="mt-4 space-y-2">
        {readinessBlockers.map(code => { const info = blockerInfo(code); return <li key={code} className="rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-900"><strong>{info.label}.</strong> {info.description} {info.action && <span className="font-medium">{info.action}</span>}</li>; })}
      </ul>}
      {readiness?.profile && <p className="mt-4 rounded-lg bg-inset p-3 text-xs text-muted">Allowlisted execution profile: <span className="font-mono">{String(readiness.profile)}</span></p>}
      <p className="mt-4 rounded-lg bg-inset p-3 text-xs leading-5 text-muted">{preview.scope === 'machine' ? 'Machine-scope upgrades typically require administrator elevation and may show a UAC prompt.' : preview.scope === 'user' ? 'Current-user scope may not require elevation, but WinGet can still prompt.' : 'Elevation requirements cannot be determined while the installation scope is unknown.'}</p>
    </section>}
    <section className="panel p-6">
      <h2 className="text-lg font-semibold">Explicit confirmation</h2>
      {!preview && <p className="mt-2 text-sm text-muted">Confirmation becomes available after the agent resolves installer identity.</p>}
      {preview && !identityReady && <p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Confirmation is blocked because the target version, installer type, SHA-256, or current-device selection is not verified. Request a fresh scan and preview.</p>}
      <label className={`mt-4 flex items-start gap-3 text-sm ${!identityReady ? 'opacity-60' : ''}`}><input type="checkbox" className="mt-1 size-4 accent-blue-600" checked={acknowledged} disabled={!identityReady || confirmed || starting} onChange={event => setAcknowledged(event.target.checked)} /><span>I have reviewed the target version, installer type, SHA-256, scope, verification evidence, and warnings above, and I confirm this exact update.</span></label>
      <div className="mt-5 flex flex-wrap justify-end gap-3"><Link href="/updates" className="rounded-lg bg-white px-4 py-2 text-muted">Cancel</Link><button className="primary-button" disabled={!canConfirm} onClick={() => void startUpdate()}><ShieldCheck size={17} />{starting ? 'Starting verified update...' : confirmed ? 'Update queued' : 'Confirm and start update'}</button></div>
      {!verificationReady && identityReady && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Run installer verification successfully before starting this update.</p>}
      {readiness && !readiness.canStart && identityReady && verificationReady && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Resolve the execution readiness blockers above before starting this update.</p>}
      {startError && <div role="alert" className="mt-5 rounded-lg bg-red-50 p-4 text-sm leading-6 text-red-700"><strong>{startError}</strong>{startBlockers.map(code => { const info = blockerInfo(code); return <p key={code}>{info.label}: {info.description} {info.action}</p>; })}</div>}
      {confirmed && <div role="status" className="mt-5 rounded-lg bg-green-50 p-4 text-sm leading-6 text-green-800"><strong>Update queued.</strong> Follow the execution page for live agent progress. No installer is launched until the agent re-verifies the downloaded file.</div>}
    </section>
  </>;
}
