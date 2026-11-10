'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {ArrowRight,ShieldAlert,ShieldCheck} from 'lucide-react';
import {AppIcon,Badge,Heading} from '../../components/ui/dashboard';
import {readStoredPreview,type UpdatePreviewData} from './preview-data';

export function UpdateConfirmation({recordId,name}:{recordId:string;name:string}){
  const [preview,setPreview]=useState<UpdatePreviewData|null>(null);
  const [displayName,setDisplayName]=useState(name);
  const [phase,setPhase]=useState('Checking stored preview');
  const [error,setError]=useState('');
  const [attempt,setAttempt]=useState(0);
  const [loading,setLoading]=useState(false);
  const [acknowledged,setAcknowledged]=useState(false);
  const [confirmed,setConfirmed]=useState(false);

  useEffect(()=>{
    setConfirmed(false);setAcknowledged(false);setError('');
    const stored=readStoredPreview(recordId);
    if(stored){setPreview(stored.preview);setDisplayName(stored.name||name);setPhase('Preview ready');setLoading(false);return;}
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
          if(body.job.preview){setPreview(body.job.preview);setPhase('Preview ready');}
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

  const identityReady=!!preview&&preview.selectionValidated&&!!preview.targetVersion&&!!preview.installerType&&!!preview.installerSha256;
  const canConfirm=identityReady&&acknowledged&&!confirmed;

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
        <Badge>{confirmed?'Confirmed for review':identityReady?'Ready to confirm':'Awaiting verified preview'}</Badge>
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
      <h2 className="flex items-center gap-2 text-lg font-semibold"><ShieldAlert size={20} className="text-amber-600"/>Warnings and limitations</h2>
      <ul className="mt-4 space-y-3 text-sm leading-6">
        <li className="rounded-lg bg-amber-50 p-3 text-amber-900">{preview.reason}</li>
        <li className="rounded-lg bg-inset p-3 text-muted">Installer signature verification is not available. The SHA-256 is reported metadata, not proof the file is safe.</li>
        <li className="rounded-lg bg-inset p-3 text-muted">Architecture, scope compatibility, and reboot requirements are not verified.</li>
        <li className="rounded-lg bg-inset p-3 text-muted">A catalog candidate is not an approved installation target.</li>
      </ul>
    </section>}
    <section className="panel p-6">
      <h2 className="text-lg font-semibold">Explicit confirmation</h2>
      {!preview&&<p className="mt-2 text-sm text-muted">Confirmation becomes available after the agent resolves installer identity.</p>}
      {preview&&!identityReady&&<p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Confirmation is blocked because the target version, installer type, SHA-256, or current-device selection is not verified. Request a fresh scan and preview.</p>}
      <label className={`mt-4 flex items-start gap-3 text-sm ${!identityReady?'opacity-60':''}`}><input type="checkbox" className="mt-1 size-4 accent-blue-600" checked={acknowledged} disabled={!identityReady||confirmed} onChange={e=>setAcknowledged(e.target.checked)}/><span>I have reviewed the target version, installer type, SHA-256, scope, and warnings above, and I confirm this update for review.</span></label>
      <div className="mt-5 flex flex-wrap justify-end gap-3"><Link href="/updates" className="rounded-lg bg-white px-4 py-2 text-muted">Cancel</Link><button className="primary-button" disabled={!canConfirm} onClick={()=>setConfirmed(true)}><ShieldCheck size={17}/>{confirmed?'Confirmed':'Confirm for review'}</button></div>
      {confirmed&&<div role="status" className="mt-5 rounded-lg bg-green-50 p-4 text-sm leading-6 text-green-800"><strong>Confirmed.</strong> This build does not download, execute, or install the installer. No system changes were made.</div>}
    </section>
  </>;
}
