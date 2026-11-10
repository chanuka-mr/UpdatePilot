import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { IncomingMessage } from 'node:http';
import type { PrismaClient } from '../generated/prisma/client.js';
import { contentHash, snapshotSchema } from './inventory.js';
import { saveSnapshot } from './save-snapshot.js';
import { previewRequestSchema, previewResultSchema } from './preview.js';
export const hashSecret = (value:string) => createHash('sha256').update(value).digest('hex');
export const isOnline = (last:Date|null, revoked:Date|null, now=Date.now()) => !revoked && !!last && now-last.getTime()<45000;
export class ApiError extends Error { constructor(public status:number,message:string){super(message);} }
export async function body(req:IncomingMessage) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new ApiError(415,'JSON required');
  const chunks:Buffer[]=[];let length=0;
  for await (const chunk of req) {length+=chunk.length;if(length>20*1024*1024)throw new ApiError(413,'Payload too large');chunks.push(Buffer.from(chunk));}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ApiError(400,'Invalid JSON');}
}
async function expire(db:PrismaClient,deviceId:string) {
  await db.scanJob.updateMany({where:{deviceId,state:{in:['queued','running']},expiresAt:{lt:new Date()}},data:{state:'interrupted',finishedAt:new Date(),error:'Job expired. No automatic retry was performed.'}});
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
    const job=await db.scanJob.findFirst({where:{deviceId:device.id},orderBy:{createdAt:'desc'},select:{id:true,state:true,operation:true,request:true,preview:true,createdAt:true,startedAt:true,finishedAt:true,error:true,snapshotId:true}});
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
    const claimed=await db.scanJob.updateMany({where:{id:job.id,state:'queued',expiresAt:{gt:new Date()}},data:{state:'running',agentId:agent.id,leaseHash:hashSecret(lease),startedAt:new Date(),expiresAt:new Date(Date.now()+10*60000)}});
    return {job:claimed.count?{id:job.id,operation:job.operation,request:job.request,lease}:null};
  }
  if(action==='result') {
    const result=z.object({jobId:z.uuid(),lease:z.string().regex(/^[a-f0-9]{64}$/),snapshot:snapshotSchema.optional(),preview:previewResultSchema.optional(),error:z.enum(['scan_failed','scan_timeout','preview_failed']).optional()}).strict().refine(v=>[v.snapshot,v.preview,v.error].filter(Boolean).length===1).parse(await body(req));
    return db.$transaction(async tx=>{
      const validAgent=await tx.agentCredential.findUnique({where:{id:agent.id}});
      if(!validAgent||validAgent.revokedAt)throw new ApiError(401,'Agent revoked');
      const job=await tx.scanJob.findFirst({where:{id:result.jobId,deviceId:agent.deviceId,agentId:agent.id,leaseHash:hashSecret(result.lease)}});
      if(!job)throw new ApiError(403,'Job does not belong to this agent');
      if(job.operation==='scan'&&result.preview||job.operation==='preview'&&result.snapshot)throw new ApiError(400,'Result does not match job operation');
      if(result.preview){const requested=previewRequestSchema.parse(job.request);if(result.preview.packageId!==requested.packageId)throw new ApiError(400,'Preview package identity mismatch');}
      const fingerprint=result.snapshot?contentHash(result.snapshot):result.preview?hashSecret(JSON.stringify(result.preview)):result.error!;
      if(['completed','failed'].includes(job.state)&&job.resultHash===fingerprint)return {ok:true,snapshotId:job.snapshotId};
      if(job.state!=='running'||job.expiresAt.getTime()<Date.now())throw new ApiError(409,'Job is no longer running');
      const stored=result.snapshot?await saveSnapshot(tx,agent.deviceId,result.snapshot):null;
      const saved=await tx.scanJob.updateMany({where:{id:job.id,state:'running'},data:{state:stored||result.preview?'completed':'failed',preview:result.preview,finishedAt:new Date(),snapshotId:stored?.id,resultHash:fingerprint,error:result.error??null}});
      if(saved.count!==1)throw new ApiError(409,'Job state changed');
      return {ok:true,snapshotId:stored?.id??null};
    },{isolationLevel:'Serializable',timeout:30000});
  }
  throw new ApiError(404,'Unknown agent operation');
}
