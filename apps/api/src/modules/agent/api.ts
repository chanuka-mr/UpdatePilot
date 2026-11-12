import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { IncomingMessage } from 'node:http';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import { contentHash, snapshotSchema } from '../inventory/inventory.js';
import { saveSnapshot } from '../inventory/save-snapshot.js';
import { previewRequestSchema, previewResultSchema } from './preview.js';
import { derivePreviewRequest, evaluateUpdateGate, record, updateControlSchema, updateRequestSchema } from './update.js';
import { statusForResult, updateExecutionResultSchema, updateProgressSchema, versionMatches } from './execution.js';
import { verificationResultSchema, verifyControlSchema } from './verify.js';
export const hashSecret = (value:string) => createHash('sha256').update(value).digest('hex');
export const isOnline = (last:Date|null, revoked:Date|null, now=Date.now()) => !revoked && !!last && now-last.getTime()<45000;
export class ApiError extends Error { constructor(public status:number,message:string,public details?:Record<string,unknown>){super(message);} }
export async function body(req:IncomingMessage) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new ApiError(415,'JSON required');
  const chunks:Buffer[]=[];let length=0;
  for await (const chunk of req) {length+=chunk.length;if(length>20*1024*1024)throw new ApiError(413,'Payload too large');chunks.push(Buffer.from(chunk));}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ApiError(400,'Invalid JSON');}
}
async function expire(db:PrismaClient,deviceId:string) {
  const now=new Date();
  const expiring=await db.scanJob.findMany({where:{deviceId,state:{in:['queued','running']},expiresAt:{lt:now}},
    select:{updateExecutionId:true}});
  const expired=await db.scanJob.updateMany({where:{deviceId,state:{in:['queued','running']},expiresAt:{lt:now}},
    data:{state:'interrupted',finishedAt:now,error:'Job expired. No automatic retry was performed.'}});
  const executionIds=[...new Set(expiring.flatMap(job=>job.updateExecutionId?[job.updateExecutionId]:[]))];
  if(expired.count&&executionIds.length)await db.updateExecution.updateMany({
    where:{deviceId,id:{in:executionIds},status:{in:['queued','running']}},
    data:{status:'interrupted',stage:'interrupted',finishedAt:now,error:'Update job expired. Check the agent before retrying.'}});
}
async function latestCompletedJob(tx:Prisma.TransactionClient,deviceId:string,operation:string,packageId?:string) {
  const jobs=await tx.scanJob.findMany({where:{deviceId,operation,state:'completed'},orderBy:{createdAt:'desc'},take:20});
  if(!packageId)return jobs[0]??null;
  return jobs.find(job=>record(job.request)?.packageId===packageId)??null;
}
async function confirmExecutions(tx:Prisma.TransactionClient,deviceId:string,snapshot:{id:string;wingetStatus:string}) {
  if(snapshot.wingetStatus!=='completed')return;
  const executions=await tx.updateExecution.findMany({where:{deviceId,status:{in:['confirming','awaiting_restart']}}});
  for(const execution of executions){
    const pkg=await tx.winGetPackage.findFirst({where:{snapshotId:snapshot.id,packageId:execution.packageId}});
    const now=new Date();
    if(pkg&&versionMatches(pkg.installedVersion,execution.targetVersion)){
      await tx.updateExecution.updateMany({where:{id:execution.id,deviceId,status:{in:['confirming','awaiting_restart']}},
        data:{status:'succeeded',stage:'completed',progress:100,message:`Confirmed installed version ${pkg.installedVersion}.`,error:null,confirmedAt:now,finishedAt:execution.finishedAt??now}});
    }else{
      await tx.updateExecution.updateMany({where:{id:execution.id,deviceId,status:{in:['confirming','awaiting_restart']}},
        data:{status:'verification_failed',stage:'failed',progress:100,error:pkg?'The confirming scan did not report the target version.':'The confirming scan did not contain this package.',confirmedAt:now}});
    }
  }
}
export async function control(db:PrismaClient,key:string,action:string,method:string,payload?:unknown) {
  let device=await db.device.findUnique({where:{key}});
  // Pairing is the secure bootstrap path for a newly installed backend. A scan
  // cannot create the first device because scans are agent-authenticated.
  if(!device&&action==='pairing'&&method==='POST')device=await db.device.create({data:{key,name:'Local Windows PC'}});
  if(!device&&action==='status'&&method==='GET')return {paired:false,online:false,lastSeenAt:null,job:null};
  if(!device)throw new ApiError(409,'Generate a pairing code before requesting agent work.');
  await expire(db,device.id);
  if(action==='status'&&method==='GET') {
    const agent=await db.agentCredential.findFirst({where:{deviceId:device.id,revokedAt:null},orderBy:{createdAt:'desc'}});
    const job=await db.scanJob.findFirst({where:{deviceId:device.id},orderBy:{createdAt:'desc'},select:{id:true,state:true,operation:true,request:true,preview:true,verification:true,progress:true,updateExecutionId:true,createdAt:true,startedAt:true,finishedAt:true,error:true,snapshotId:true}});
    return {paired:!!agent,online:agent?isOnline(agent.lastSeenAt,agent.revokedAt):false,lastSeenAt:agent?.lastSeenAt??null,job};
  }
  if(action==='pairing'&&method==='POST') {
    const code=randomBytes(24).toString('hex');const expiresAt=new Date(Date.now()+5*60000);
    await db.$transaction(async tx=>{await tx.pairingTicket.updateMany({where:{deviceId:device.id,usedAt:null},data:{usedAt:new Date()}});await tx.pairingTicket.create({data:{deviceId:device.id,codeHash:hashSecret(code),expiresAt}});});
    return {code,expiresAt};
  }
  if(action==='revoke'&&method==='POST') {
    await db.$transaction(async tx=>{
      await tx.agentCredential.updateMany({where:{deviceId:device.id,revokedAt:null},data:{revokedAt:new Date()}});
      await tx.pairingTicket.updateMany({where:{deviceId:device.id,usedAt:null},data:{usedAt:new Date()}});
      await tx.scanJob.updateMany({where:{deviceId:device.id,state:{in:['queued','running']}},data:{state:'interrupted',finishedAt:new Date(),error:'Agent revoked; result uploads are no longer accepted.'}});
    });return {revoked:true};
  }
  if(action==='scan'&&method==='POST') {
    return db.$transaction(async tx=>{
      const agent=await tx.agentCredential.findFirst({where:{deviceId:device.id,revokedAt:null},orderBy:{createdAt:'desc'}});
      if(!agent||!isOnline(agent.lastSeenAt,agent.revokedAt))throw new ApiError(409,'Start the paired agent before requesting a scan.');
      const active=await tx.scanJob.findFirst({where:{deviceId:device.id,state:{in:['queued','running']}}});
      if(active)return {jobId:active.id,state:active.state};
      const job=await tx.scanJob.create({data:{deviceId:device.id,state:'queued',expiresAt:new Date(Date.now()+10*60000)}});
      return {jobId:job.id,state:job.state};
    },{isolationLevel:'Serializable'});
  }
  if(action==='preview'&&method==='POST') {
    const {recordId}=z.object({recordId:z.uuid()}).strict().parse(payload);
    return db.$transaction(async tx=>{
      const agent=await tx.agentCredential.findFirst({where:{deviceId:device.id,revokedAt:null}});
      if(!agent||!isOnline(agent.lastSeenAt,agent.revokedAt))throw new ApiError(409,'Start the paired agent to resolve a fresh preview.');
      const latest=await tx.inventorySnapshot.findFirst({where:{deviceId:device.id},orderBy:{scannedAt:'desc'}});
      if(!latest||Date.now()-latest.scannedAt.getTime()>86400000)throw new ApiError(409,'Run a fresh scan before previewing updates.');
      const pkg=await tx.winGetPackage.findFirst({where:{id:recordId,snapshotId:latest.id,matchStatus:'matched',isUpdateAvailable:true,source:{equals:'winget',mode:'insensitive'}}});
      if(!pkg||!pkg.installedVersion)throw new ApiError(409,'This package is no longer an update candidate in the latest scan.');
      const request=previewRequestSchema.parse({packageId:pkg.packageId,installedVersion:pkg.installedVersion,snapshotId:latest.id});
      const active=await tx.scanJob.findFirst({where:{deviceId:device.id,state:{in:['queued','running']}}});
      if(active)throw new ApiError(409,'Wait for the active scan or preview job to finish.');
      const job=await tx.scanJob.create({data:{deviceId:device.id,operation:'preview',request,state:'queued',expiresAt:new Date(Date.now()+10*60000)}});
      return {jobId:job.id,state:job.state};
    },{isolationLevel:'Serializable'});
  }
  if(action==='verify'&&method==='POST') {
    const {recordId}=verifyControlSchema.parse(payload);
    return db.$transaction(async tx=>{
      const agent=await tx.agentCredential.findFirst({where:{deviceId:device.id,revokedAt:null},orderBy:{createdAt:'desc'}});
      const latest=await tx.inventorySnapshot.findFirst({where:{deviceId:device.id},orderBy:{scannedAt:'desc'}});
      const candidate=latest?await tx.winGetPackage.findFirst({where:{id:recordId,snapshotId:latest.id}}):null;
      const previewJob=await latestCompletedJob(tx,device.id,'preview',candidate?.packageId);
      const active=await tx.scanJob.findFirst({where:{deviceId:device.id,state:{in:['queued','running']}}});
      const binding=derivePreviewRequest({
        snapshot:latest?{id:latest.id,scannedAt:latest.scannedAt,wingetStatus:latest.wingetStatus}:null,
        candidate:candidate?{id:candidate.id,packageId:candidate.packageId,installedVersion:candidate.installedVersion,source:candidate.source,isUpdateAvailable:candidate.isUpdateAvailable,matchStatus:candidate.matchStatus}:null,
        previewJob:previewJob?{id:previewJob.id,state:previewJob.state,createdAt:previewJob.createdAt,request:previewJob.request,preview:previewJob.preview}:null,
      });
      const online=!!agent&&isOnline(agent.lastSeenAt,agent.revokedAt);
      const blockers=[...(binding.ok?[]:binding.blockers),...(!online?['agent_offline' as const]:[]),...(active?['job_active' as const]:[])];
      if(!binding.ok||!online||active)throw new ApiError(409,'Installer verification is blocked by safety checks.',{blockers});
      const job=await tx.scanJob.create({data:{deviceId:device.id,operation:'verify',request:binding.request,state:'queued',expiresAt:new Date(Date.now()+20*60000)}});
      return {jobId:job.id,state:job.state};
    },{isolationLevel:'Serializable'});
  }
  if(action==='update'&&method==='POST') {
    const {recordId}=updateControlSchema.parse(payload);
    return db.$transaction(async tx=>{
      const agent=await tx.agentCredential.findFirst({where:{deviceId:device.id,revokedAt:null},orderBy:{createdAt:'desc'}});
      const latest=await tx.inventorySnapshot.findFirst({where:{deviceId:device.id},orderBy:{scannedAt:'desc'}});
      const candidate=latest?await tx.winGetPackage.findFirst({where:{id:recordId,snapshotId:latest.id}}):null;
      const previewJob=await latestCompletedJob(tx,device.id,'preview',candidate?.packageId);
      const verificationJob=await latestCompletedJob(tx,device.id,'verify',candidate?.packageId);
      const active=await tx.scanJob.findFirst({where:{deviceId:device.id,state:{in:['queued','running']}}});
      const gate=evaluateUpdateGate({
        executionEnabled:process.env.UPDATE_EXECUTION_ENABLED==='true',
        agentOnline:!!agent&&isOnline(agent.lastSeenAt,agent.revokedAt),
        snapshot:latest?{id:latest.id,scannedAt:latest.scannedAt,wingetStatus:latest.wingetStatus}:null,
        candidate:candidate?{id:candidate.id,packageId:candidate.packageId,installedVersion:candidate.installedVersion,source:candidate.source,isUpdateAvailable:candidate.isUpdateAvailable,matchStatus:candidate.matchStatus}:null,
        previewJob:previewJob?{id:previewJob.id,state:previewJob.state,createdAt:previewJob.createdAt,request:previewJob.request,preview:previewJob.preview}:null,
        verificationJob:verificationJob?{id:verificationJob.id,state:verificationJob.state,createdAt:verificationJob.createdAt,request:verificationJob.request,verification:verificationJob.verification}:null,
        activeJob:!!active,
      });
      if(!gate.ok)throw new ApiError(409,'Update execution is blocked by safety checks.',{blockers:gate.blockers});
      if(!candidate||!previewJob||!verificationJob)throw new ApiError(409,'Update execution is blocked by safety checks.',{blockers:['candidate_missing']});
      const execution=await tx.updateExecution.create({data:{
        deviceId:device.id,name:candidate.name,packageId:gate.request.packageId,
        installedVersion:gate.request.installedVersion,targetVersion:gate.request.targetVersion,
        sourceSnapshotId:gate.request.snapshotId,previewJobId:gate.request.previewJobId,
        verificationJobId:verificationJob.id,installerType:gate.request.installerType,
        installerSha256:gate.request.installerSha256,scope:gate.request.scope,profile:gate.request.profile,
      }});
      const job=await tx.scanJob.create({data:{deviceId:device.id,operation:'update',request:gate.request,state:'queued',expiresAt:new Date(Date.now()+35*60000),updateExecutionId:execution.id}});
      return {jobId:job.id,executionId:execution.id,state:job.state};
    },{isolationLevel:'Serializable'});
  }
  if(action==='cancel'&&method==='POST') {
    const {executionId}=z.object({executionId:z.uuid()}).strict().parse(payload);
    return db.$transaction(async tx=>{
      const cancelled=await tx.updateExecution.updateMany({where:{id:executionId,deviceId:device.id,status:'queued'},
        data:{status:'cancelled',stage:'cancelled',finishedAt:new Date(),error:'Cancelled before the installer started.'}});
      if(cancelled.count!==1)throw new ApiError(409,'Only a queued update can be cancelled before launch.');
      await tx.scanJob.updateMany({where:{deviceId:device.id,updateExecutionId:executionId,state:'queued'},
        data:{state:'interrupted',finishedAt:new Date(),error:'Update cancelled before launch.'}});
      return {cancelled:true};
    },{isolationLevel:'Serializable'});
  }
  throw new ApiError(405,'Unsupported control operation');
}
export async function agentRequest(db:PrismaClient,req:IncomingMessage,action:string) {
  if(req.method!=='POST')throw new ApiError(405,'POST required');
  if(action==='pair') {
    const {code}=z.object({code:z.string().regex(/^[a-f0-9]{48}$/)}).strict().parse(await body(req));
    const token=randomBytes(32).toString('hex');
    await db.$transaction(async tx=>{
      const ticket=await tx.pairingTicket.findUnique({where:{codeHash:hashSecret(code)}});
      if(!ticket||ticket.usedAt||ticket.expiresAt.getTime()<Date.now())throw new ApiError(401,'Invalid or expired pairing code');
      const claimed=await tx.pairingTicket.updateMany({where:{id:ticket.id,usedAt:null,expiresAt:{gt:new Date()}},data:{usedAt:new Date()}});
      if(claimed.count!==1)throw new ApiError(401,'Pairing code already used');
      await tx.agentCredential.updateMany({where:{deviceId:ticket.deviceId,revokedAt:null},data:{revokedAt:new Date()}});
      await tx.scanJob.updateMany({where:{deviceId:ticket.deviceId,state:{in:['queued','running']}},data:{state:'interrupted',finishedAt:new Date(),error:'Pairing replaced.'}});
      await tx.agentCredential.create({data:{deviceId:ticket.deviceId,tokenHash:hashSecret(token),lastSeenAt:new Date()}});
    });return {token};
  }
  const bearer=req.headers.authorization;
  if(!bearer?.match(/^Bearer [a-f0-9]{64}$/))throw new ApiError(401,'Agent authentication required');
  const agent=await db.agentCredential.findUnique({where:{tokenHash:hashSecret(bearer.slice(7))}});
  if(!agent||agent.revokedAt)throw new ApiError(401,'Agent credential revoked or unknown');
  await expire(db,agent.deviceId);
  if(action==='heartbeat') {await db.agentCredential.updateMany({where:{id:agent.id,revokedAt:null},data:{lastSeenAt:new Date()}});return {ok:true};}
  if(action==='claim') {
    const job=await db.scanJob.findFirst({where:{deviceId:agent.deviceId,state:'queued',expiresAt:{gt:new Date()}},orderBy:{createdAt:'asc'}});
    if(!job)return {job:null};
    const lease=randomBytes(32).toString('hex');
    const leaseMs=job.operation==='update'?35*60000:job.operation==='verify'?30*60000:10*60000;
    const claimed=await db.scanJob.updateMany({where:{id:job.id,state:'queued',expiresAt:{gt:new Date()}},data:{state:'running',agentId:agent.id,leaseHash:hashSecret(lease),startedAt:new Date(),expiresAt:new Date(Date.now()+leaseMs)}});
    if(claimed.count&&job.updateExecutionId)await db.updateExecution.updateMany({where:{id:job.updateExecutionId,deviceId:agent.deviceId,status:'queued'},
      data:{status:'running',stage:'preparing',startedAt:new Date(),message:'The agent claimed the update job.'}});
    return {job:claimed.count?{id:job.id,operation:job.operation,request:job.request,lease}:null};
  }
  if(action==='progress') {
    const progress=updateProgressSchema.parse(await body(req));
    return db.$transaction(async tx=>{
      const job=await tx.scanJob.findFirst({where:{id:progress.jobId,deviceId:agent.deviceId,agentId:agent.id,
        operation:'update',state:'running',leaseHash:hashSecret(progress.lease)}});
      if(!job)throw new ApiError(403,'Update job does not belong to this agent');
      if(job.expiresAt.getTime()<Date.now())throw new ApiError(409,'Update job lease expired');
      await tx.scanJob.updateMany({where:{id:job.id,state:'running'},
        data:{progress:{stage:progress.stage,percent:progress.percent,message:progress.message??null,updatedAt:new Date().toISOString()},
          expiresAt:new Date(Date.now()+15*60000)}});
      if(job.updateExecutionId)await tx.updateExecution.updateMany({where:{id:job.updateExecutionId,deviceId:agent.deviceId,status:'running'},
        data:{stage:progress.stage,progress:progress.percent,message:progress.message??null}});
      return {ok:true};
    },{isolationLevel:'Serializable'});
  }
  if(action==='result') {
    const result=z.object({jobId:z.uuid(),lease:z.string().regex(/^[a-f0-9]{64}$/),snapshot:snapshotSchema.optional(),preview:previewResultSchema.optional(),verification:verificationResultSchema.optional(),updateResult:updateExecutionResultSchema.optional(),error:z.enum(['scan_failed','scan_timeout','preview_failed','update_blocked','update_failed','verify_failed']).optional()}).strict().refine(v=>[v.snapshot,v.preview,v.verification,v.updateResult,v.error].filter(Boolean).length===1).parse(await body(req));
    return db.$transaction(async tx=>{
      const validAgent=await tx.agentCredential.findUnique({where:{id:agent.id}});
      if(!validAgent||validAgent.revokedAt)throw new ApiError(401,'Agent revoked');
      const job=await tx.scanJob.findFirst({where:{id:result.jobId,deviceId:agent.deviceId,agentId:agent.id,leaseHash:hashSecret(result.lease)}});
      if(!job)throw new ApiError(403,'Job does not belong to this agent');
      if(!['scan','preview','update','verify'].includes(job.operation))throw new ApiError(400,'Unsupported job operation');
      const allowedErrors:Record<string,string[]>={scan:['scan_failed','scan_timeout'],preview:['preview_failed'],update:['update_blocked','update_failed'],verify:['verify_failed']};
      if((job.operation==='scan'&&(result.preview||result.verification||result.updateResult))||
        (job.operation==='preview'&&(result.snapshot||result.verification||result.updateResult))||
        (job.operation==='update'&&(result.snapshot||result.preview||result.verification))||
        (job.operation==='verify'&&(result.snapshot||result.preview||result.updateResult))||
        (result.error!==undefined&&!allowedErrors[job.operation]?.includes(result.error)))
        throw new ApiError(400,'Result does not match job operation');
      if(result.updateResult){
        const requested=updateRequestSchema.parse(job.request);
        if(result.updateResult.profile!==requested.profile||result.updateResult.installerType!==requested.installerType||
          result.updateResult.installerSha256.toLowerCase()!==requested.installerSha256)
          throw new ApiError(400,'Update execution evidence mismatch');
      }
      if(result.preview){const requested=previewRequestSchema.parse(job.request);if(result.preview.packageId!==requested.packageId)throw new ApiError(400,'Preview package identity mismatch');}
      let verification=result.verification;
      if(verification){
        const requested=updateRequestSchema.parse(job.request);
        if(verification.packageId!==requested.packageId||verification.targetVersion!==requested.targetVersion||
          verification.installerType!==requested.installerType||verification.installerSha256.toLowerCase()!==requested.installerSha256)
          throw new ApiError(400,'Verification evidence mismatch');
        const previewJob=await tx.scanJob.findFirst({where:{id:requested.previewJobId,deviceId:agent.deviceId,operation:'preview',state:'completed'}});
        const preview=record(previewJob?.preview);
        const publisher=typeof preview?.publisher==='string'?preview.publisher.trim():'';
        const signer=verification.signature.signerSubject;
        const publisherMatch=publisher&&signer?(signer.toLocaleLowerCase().includes(publisher.toLocaleLowerCase())?'matched':'mismatch'):'unverified';
        verification={...verification,publisherMatch};
      }
      const updateResult=result.updateResult;
      const fingerprint=result.snapshot?contentHash(result.snapshot):result.preview?hashSecret(JSON.stringify(result.preview)):verification?hashSecret(JSON.stringify(verification)):updateResult?hashSecret(JSON.stringify(updateResult)):result.error!;
      if(['completed','failed'].includes(job.state)&&job.resultHash===fingerprint)return {ok:true,snapshotId:job.snapshotId};
      if(job.state!=='running'||job.expiresAt.getTime()<Date.now())throw new ApiError(409,'Job is no longer running');
      const finishedAt=new Date();
      const stored=result.snapshot?await saveSnapshot(tx,agent.deviceId,result.snapshot):null;
      const saved=await tx.scanJob.updateMany({where:{id:job.id,state:'running'},data:{state:stored||result.preview||verification||updateResult?'completed':'failed',preview:result.preview,verification,finishedAt,snapshotId:stored?.id,resultHash:fingerprint,error:result.error??null}});
      if(saved.count!==1)throw new ApiError(409,'Job state changed');
      if(job.operation==='update'&&job.updateExecutionId){
        if(updateResult){
          const stage=updateResult.status==='succeeded'?'confirming':updateResult.status==='restart_required'?'awaiting_restart':updateResult.status;
          await tx.updateExecution.updateMany({where:{id:job.updateExecutionId,deviceId:agent.deviceId,status:'running'},data:{
            status:statusForResult(updateResult.status),stage,progress:100,
            message:updateResult.status==='succeeded'?'Installer completed. Waiting for a confirming scan.':updateResult.reason,
            error:updateResult.status==='succeeded'||updateResult.status==='restart_required'?null:updateResult.reason,
            result:updateResult,finishedAt,confirmedAt:null}});
          if(updateResult.status==='succeeded')await tx.scanJob.create({data:{deviceId:agent.deviceId,operation:'scan',state:'queued',
            expiresAt:new Date(Date.now()+20*60000),updateExecutionId:job.updateExecutionId}});
        }else{
          await tx.updateExecution.updateMany({where:{id:job.updateExecutionId,deviceId:agent.deviceId,status:{in:['queued','running']}},data:{
            status:'failed',stage:'failed',finishedAt,error:result.error==='update_failed'?'The agent reported an unexpected update execution failure.':'The update did not start.'}});
        }
      }
      if(stored&&result.snapshot&&result.snapshot.winget.status==='completed')
        await confirmExecutions(tx,agent.deviceId,{id:stored.id,wingetStatus:result.snapshot.winget.status});
      return {ok:true,snapshotId:stored?.id??null};
    },{isolationLevel:'Serializable',timeout:30000});
  }
  throw new ApiError(404,'Unknown agent operation');
}
