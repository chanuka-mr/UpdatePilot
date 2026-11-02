import { NextResponse } from 'next/server';
export const dynamic='force-dynamic';
async function forward(request:Request,context:{params:Promise<{action:string}>}) {
  const {action}=await context.params;const url=new URL(request.url);
  // Next.js can normalize request.url to localhost even when the browser used
  // 127.0.0.1. Compare against the validated HTTP Host, not forwarded headers.
  const host=request.headers.get('host')||url.host;
  let browserOrigin:URL;
  try{browserOrigin=new URL(`${url.protocol}//${host}`);}catch{return NextResponse.json({error:'Invalid local host'},{status:403});}
  if(!['status','pairing','revoke','scan','preview'].includes(action))return NextResponse.json({error:'Not found'},{status:404});
  if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||!['localhost','127.0.0.1','[::1]'].includes(browserOrigin.hostname)||browserOrigin.port!==url.port||(request.method==='POST'&&request.headers.get('origin')!==browserOrigin.origin))return NextResponse.json({error:'Local same-origin access required'},{status:403});
  const token=process.env.BACKEND_API_TOKEN;if(!token)return NextResponse.json({error:'API not configured'},{status:503});
  try {
    const origin=new URL(process.env.BACKEND_API_URL||'http://127.0.0.1:4010');
    if(origin.protocol!=='http:'||!['localhost','127.0.0.1'].includes(origin.hostname))throw new Error('Local backend required');
    const payload=action==='preview'?JSON.stringify(await request.json()):undefined;
    const response=await fetch(new URL(`/api/v1/control/${action}`,origin),{method:request.method,headers:{Authorization:`Bearer ${token}`,...(payload?{'Content-Type':'application/json'}:{})},body:payload,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
    const result=await response.json();return NextResponse.json(result,{status:response.status,headers:{'Cache-Control':'no-store'}});
  }catch{return NextResponse.json({error:'Agent control unavailable. Check the backend and database migration.'},{status:503});}
}
export const GET=forward;export const POST=forward;
