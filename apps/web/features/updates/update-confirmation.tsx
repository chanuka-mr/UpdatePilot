'use client';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useEffect,useState} from 'react';
import {ArrowRight,ShieldAlert,ShieldCheck} from 'lucide-react';
import {AppIcon,Badge,Heading} from '../../components/ui/dashboard';
import {readStoredPreview,readStoredVerification,storeVerification,type InstallerVerification,type UpdatePreviewData} from './preview-data';

export function UpdateConfirmation({recordId,name}:{recordId:string;name:string}){
  const router=useRouter();
  const [preview,setPreview]=useState<UpdatePreviewData|null>(null);
  const [displayName,setDisplayName]=useState(name);
  const [phase,setPhase]=useState('Checking stored preview');
  const [error,setError]=useState('');
  const [attempt,setAttempt]=useState(0);
  const [loading,setLoading]=useState(false);
  const [acknowledged,setAcknowledged]=useState(false);
  const [confirmed,setConfirmed]=useState(false);
  const [starting,setStarting]=useState(false);
  const [startError,setStartError]=useState('');
  const [verification,setVerification]=useState<InstallerVerification|null>(null);
  const [verifyJob,setVerifyJob]=useState<string|null>(null);
  const [verifyPreviewCheckedAt,setVerifyPreviewCheckedAt]=useState('');
  const [verifyPhase,setVerifyPhase]=useState('');
  const [verifyError,setVerifyError]=useState('');
  const [verifying,setVerifying]=useState(false);

  useEffect(()=>{
    setConfirmed(false);setAcknowledged(false);setError('');setStarting(false);setStartError('');
    setVerification(null);setVerifyJob(null);setVerifyPreviewCheckedAt('');setVerifyPhase('');setVerifyError('');setVerifying(false);
    const stored=readStoredPreview(recordId);
    if(stored){
      setPreview(stored.preview);setDisplayName(stored.name||name);setPhase('Preview ready');setLoading(false);
      const storedVerification=readStoredVerification(recordId);
      if(storedVerification&&storedVerification.previewCheckedAt===stored.preview.checkedAt)setVerification(storedVerification.verification);
      return;
    }
    setPreview(null);
    if(attempt===0){setPhase('No stored preview');setLoading(false);return;}
    const controller=new AbortController();let stopped=false;let timer:ReturnType<typeof setTimeout>;
    setPhase('Requesting a fresh preview');setLoading(true);
    const poll=async(jobId:string)=>{
      try{
        const res=await fetch('/api/agent/status',{cache:'no-store',signal:controller.signal});
        const body=await res.json();
        if(!res.ok)throw new Error(body.error||'Preview status unavailable.');
        if(stopped)return;
        if(body.job?.id!==jobId){setError('A newer job replaced this preview request. Wait for the agent to finish, then retry.');setLoading(false);return;}
        setPhase(body.job.state);
        if(body.job.state==='completed'){
          if(body.job.preview){
            setPreview(body.job.preview);setPhase('Preview ready');
            const storedVerification=readStoredVerification(recordId);
            if(storedVerification&&storedVerification.previewCheckedAt===body.job.preview.checkedAt)setVerification(storedVerification.verification);
          }
          else setError('No preview metadata was returned.');
          setLoading(false);
          return;
        }
        if(['failed','interrupted'].includes(body.job.state)){setError(body.job.error||'Preview failed. Check the agent and run a fresh scan.');setLoading(false);return;}
        timer=setTimeout(()=>void poll(jobId),3000);
      }catch(e){if(!stopped){setError(e instanceof Error?e.message:'Preview unavailable.');setLoading(false);}}
    };
    const start=async()=>{
      try{
        const res=await fetch('/api/agent/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recordId}),signal:controller.signal});
        const body=await res.json();
        if(!res.ok)throw new Error(body.error||'Cannot request preview.');
        if(stopped)return;
        setPhase(body.state);
        await poll(body.jobId);
      }catch(e){if(!stopped){setError(e instanceof Error?e.message:'Preview unavailable.');setLoading(false);}}
    };
    void start();
    return()=>{stopped=true;controller.abort();clearTimeout(timer);};
  },[recordId,name,attempt]);

  useEffect(()=>{
    if(!verifyJob)return;
    const controller=new AbortController();let stopped=false;let timer:ReturnType<typeof setTimeout>;
    setVerifying(true);setVerifyError('');
    const poll=async()=>{
      try{
        const res=await fetch('/api/agent/status',{cache:'no-store',signal:controller.signal});
        const body=await res.json();
        if(!res.ok)throw new Error(body.error||'Verification status unavailable.');
        if(stopped)return;
        if(body.job?.id!==verifyJob){setVerifyError('A newer job replaced this verification request. Wait for the agent to finish, then retry.');setVerifying(false);return;}
        setVerifyPhase(body.job.state);
        if(body.job.state==='completed'){
          if(body.job.verification){
            setVerification(body.job.verification);
            if(verifyPreviewCheckedAt)storeVerification(recordId,verifyPreviewCheckedAt,body.job.verification);
          } else setVerifyError('No verification evidence was returned.');
          setVerifying(false);setVerifyJob(null);return;
        }
        if(['failed','interrupted'].includes(body.job.state)){
          setVerifyError(body.job.error==='verify_failed'?'Installer verification failed. The installer was not executed.':body.job.error||'Installer verification failed.');
          setVerifying(false);setVerifyJob(null);return;
        }
        timer=setTimeout(()=>void poll(),3000);
      }catch(e){if(!stopped){setVerifyError(e instanceof Error?e.message:'Verification unavailable.');setVerifying(false);setVerifyJob(null);}}
    };
    void poll();
    return()=>{stopped=true;controller.abort();clearTimeout(timer);};
  },[verifyJob,verifyPreviewCheckedAt,recordId]);

  async function requestVerification(){
    if(!preview)return;
    setVerification(null);setVerifyError('');setVerifyPreviewCheckedAt(preview.checkedAt);setVerifyPhase('Requesting');setVerifying(true);
    try{
      const res=await fetch('/api/agent/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recordId})});
      const body=await res.json();
      if(!res.ok){
        const blockers=Array.isArray(body.details?.blockers)?` ${body.details.blockers.join(', ')}`:'';
        throw new Error(`${body.error||'Cannot request installer verification.'}${blockers}`);
      }
      setVerifyJob(body.jobId);setVerifyPhase(body.state);
    }catch(e){setVerifyError(e instanceof Error?e.message:'Verification unavailable.');setVerifying(false);}
  }

  async function startUpdate(){
    if(!preview||!verification)return;
    setStarting(true);setStartError('');
    try{
      const res=await fetch('/api/agent/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recordId})});
      const body=await res.json();
      if(!res.ok){
        const blockers=Array.isArray(body.details?.blockers)?` Blockers: ${body.details.blockers.join(', ')}.`:'';
        throw new Error(`${body.error||'Cannot start the verified update.'}${blockers}`);
      }
      if(typeof body.executionId!=='string')throw new Error('The backend did not return an update execution.');
      setConfirmed(true);
      router.push(`/updates/executions/${encodeURIComponent(body.executionId)}`);
    }catch(e){setStartError(e instanceof Error?e.message:'Cannot start the verified update.');setStarting(false);}
  }

  const identityReady=!!preview&&preview.selectionValidated&&!!preview.targetVersion&&!!preview.installerType&&!!preview.installerSha256;
  const verificationReady=!!verification&&verification.signature.status==='Valid'&&verification.architectureCompatible&&verification.hashMatched;
  const canConfirm=identityReady&&verificationReady&&acknowledged&&!confirmed&&!starting;
  const executionBlockers=preview?[
    preview.selectionValidated?null:'Current-device selection was not validated',
    preview.scope==='user'||preview.scope==='machine'?null:'Installation scope is unknown',
    verification?(verification.architecture==='unknown'?'Installer architecture is unknown':verification.architectureCompatible?'':`Installer architecture ${verification.architecture} is not compatible with this device`):'Installer architecture is not verified',
    verification?(verification.signature.status==='Valid'?null:`Installer signature is ${verification.signature.status}`):'Installer signature is not verified',
    verification?(verification.hashMatched?'':'Installer file hash did not match the preview'):'Installer file and hash are not verified',
    'Backend execution must be explicitly enabled with UPDATE_EXECUTION_ENABLED=true',
  ].filter((value):value is string=>!!value):[];

  return <><Link href="/updates" className="text-xs text-muted">← Updates / Confirm Update</Link>
    <Heading title="Confirm Update" description="Review the exact target release, installer identity, and warnings before confirming."/>
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 p-6">
        <div className="flex items-center gap-3">
          <AppIcon name={displayName}/>
          <div>
            <h2 className="text-xl font-semibold">{displayName}</h2>
            <p className="mt-1 break-all text-xs text-muted">{preview?.packageId||'Resolving package identity'}</p>
          </div>
        </div>
        <Badge>{confirmed?'Update queued':identityReady&&verificationReady?'Ready to start':'Awaiting verified preview'}</Badge>
      </div>
      {!preview&&!error&&!loading&&<div className="p-6"><p role="status" className="text-muted">{attempt===0?'No stored preview for this update. Request a read-only preview to continue.':phase}</p><button className="primary-button mt-4" onClick={()=>setAttempt(value=>value+1)}>Request preview</button></div>}
      {!preview&&!error&&loading&&<p role="status" className="p-6 text-muted">{phase} · Keep the paired agent running. This reads package metadata without downloading or installing an application.</p>}
      {error&&<div role="alert" className="p-6"><p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p><button className="mt-3 text-primary underline" onClick={()=>setAttempt(value=>value+1)}>Retry preview request</button></div>}
      {preview&&<>
        <div className="grid gap-6 p-6 md:grid-cols-[1fr_auto_1fr]">
          <div className="rounded-xl bg-inset p-6"><p className="text-xs font-medium text-muted">Currently Installed</p><p className="mt-4 break-all font-mono text-4xl font-semibold">{preview.installedVersion}</p><p className="mt-3 text-xs text-muted">Reported by the latest stored scan</p></div>
          <ArrowRight className="self-center text-muted"/>
          <div className="rounded-xl bg-primary-soft/40 p-6"><p className="text-xs font-medium text-primary">Target Version</p><p className="mt-4 break-all font-mono text-4xl font-semibold text-primary">{preview.targetVersion||'Unknown'}</p><p className="mt-3 text-xs text-muted">Catalog candidate, not an approved target</p></div>
        </div>
        <dl className="mx-6 mb-6 grid gap-4 rounded-lg border border-slate-200 p-5 sm:grid-cols-2">
          {[['Installer type',preview.installerType||'Not confirmed'],['Installer SHA-256',preview.installerSha256||'Not confirmed'],['Installation scope',preview.scope],['Architecture',preview.architecture],['Publisher',preview.publisher||'Unknown'],['Source','WinGet'],['Current-device selection',preview.selectionValidated?'Validated metadata':'Not confirmed'],['Checked at',new Date(preview.checkedAt).toLocaleString()]].map(([label,value])=><div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 break-all font-medium">{value}</dd></div>)}
        </dl>
      </>}
    </section>
    {preview&&<section className="panel p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck size={20} className="text-blue-600"/>Installer verification</h2>
      <p className="mt-2 text-sm text-muted">Download the exact installer to a temporary folder and check its SHA-256, Authenticode signature, and architecture. The installer is never executed, and temporary files are removed.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button className="primary-button" disabled={!identityReady||verifying} onClick={()=>void requestVerification()}>{verifying?`Verifying · ${verifyPhase||'requesting'}`:verification?'Re-verify installer':'Verify installer'}</button>
        {verification&&<Badge>{verification.signature.status==='Valid'&&verification.architectureCompatible&&verification.hashMatched?'Verification evidence recorded':'Verification incomplete'}</Badge>}
      </div>
      {verifyError&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{verifyError}</p>}
      {verifying&&<p role="status" className="mt-3 text-sm text-muted">Keep the paired agent running. The download can take several minutes; no installer is executed.</p>}
      {verification&&<dl className="mt-5 grid gap-4 rounded-lg border border-slate-200 p-5 sm:grid-cols-2">
        {[['Architecture',verification.architecture],['Architecture compatibility',verification.architectureCompatible?'Compatible':'Not compatible'],['SHA-256 match',verification.hashMatched?'Matched':'Not matched'],['Signature status',verification.signature.status],['Signer',verification.signature.signerSubject||'Not available'],['Signer thumbprint',verification.signature.signerThumbprint||'Not available'],['Timestamped',verification.signature.timestamped?'Yes':'No'],['Publisher match',verification.publisherMatch],['Verified at',new Date(verification.verifiedAt).toLocaleString()]].map(([label,value])=><div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 break-all font-medium">{value}</dd></div>)}
      </dl>}
      <p className="mt-4 rounded-lg bg-inset p-3 text-xs leading-5 text-muted">Verification evidence is reported by the paired agent and re-bound by the backend to this preview. Publisher matching is recorded for review and is not yet a hard gate. A valid signature, matching hash, and compatible architecture are required before the execution gate can open.</p>
    </section>}
    {preview&&<section className="panel p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><ShieldAlert size={20} className="text-amber-600"/>Warnings and limitations</h2>
      <ul className="mt-4 space-y-3 text-sm leading-6">
        <li className="rounded-lg bg-amber-50 p-3 text-amber-900">{preview.reason}</li>
        <li className="rounded-lg bg-inset p-3 text-muted">{verification?'Signature and architecture evidence applies only to the downloaded file matched by the preview SHA-256. Scope compatibility and reboot requirements remain unverified.':'Installer signature and architecture have not been verified. Run Verify installer to download and inspect the exact file.'}</li>
        <li className="rounded-lg bg-inset p-3 text-muted">Scope compatibility and reboot requirements are not verified.</li>
        <li className="rounded-lg bg-inset p-3 text-muted">A catalog candidate is not an approved installation target.</li>
      </ul>
    </section>}
    {preview&&<section className="panel p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><ShieldAlert size={20} className="text-amber-600"/>Execution safety gate</h2>
      <p className="mt-2 text-sm text-muted">The controlled update workflow is hard-blocked until every check passes. Starting an update requires the backend execution flag, a fresh preview, and passing verification evidence. The agent re-downloads and rechecks the installer before launch.</p>
      <ul className="mt-4 space-y-2 text-sm">{executionBlockers.map(blocker=><li key={blocker} className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-amber-900"><ShieldAlert size={16} className="mt-0.5 shrink-0"/>{blocker}</li>)}</ul>
      <p className="mt-4 rounded-lg bg-inset p-3 text-xs leading-5 text-muted">{preview.scope==='machine'?'Machine-scope upgrades typically require administrator elevation and may show a UAC prompt.':preview.scope==='user'?'Current-user scope may not require elevation, but WinGet can still prompt.':'Elevation requirements cannot be determined while the installation scope is unknown.'}</p>
    </section>}
    <section className="panel p-6">
      <h2 className="text-lg font-semibold">Explicit confirmation</h2>
      {!preview&&<p className="mt-2 text-sm text-muted">Confirmation becomes available after the agent resolves installer identity.</p>}
      {preview&&!identityReady&&<p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Confirmation is blocked because the target version, installer type, SHA-256, or current-device selection is not verified. Request a fresh scan and preview.</p>}
      <label className={`mt-4 flex items-start gap-3 text-sm ${!identityReady?'opacity-60':''}`}><input type="checkbox" className="mt-1 size-4 accent-blue-600" checked={acknowledged} disabled={!identityReady||confirmed||starting} onChange={e=>setAcknowledged(e.target.checked)}/><span>I have reviewed the target version, installer type, SHA-256, scope, verification evidence, and warnings above, and I confirm this exact update.</span></label>
      <div className="mt-5 flex flex-wrap justify-end gap-3"><Link href="/updates" className="rounded-lg bg-white px-4 py-2 text-muted">Cancel</Link><button className="primary-button" disabled={!canConfirm} onClick={()=>void startUpdate()}><ShieldCheck size={17}/>{starting?'Starting verified update...':confirmed?'Update queued':'Confirm and start update'}</button></div>
      {!verificationReady&&identityReady&&<p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Run installer verification successfully before starting this update.</p>}
      {startError&&<div role="alert" className="mt-5 rounded-lg bg-red-50 p-4 text-sm leading-6 text-red-700">{startError}</div>}
      {confirmed&&<div role="status" className="mt-5 rounded-lg bg-green-50 p-4 text-sm leading-6 text-green-800"><strong>Update queued.</strong> Follow the execution page for live agent progress. No installer is launched until the agent re-verifies the downloaded file.</div>}
    </section>
  </>;
}
