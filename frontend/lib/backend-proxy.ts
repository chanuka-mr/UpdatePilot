import { NextResponse } from 'next/server';
export async function proxyCatalog(request: Request, endpoint: 'applications' | 'updates') {
  const url = new URL(request.url);
  if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname) || (request.headers.get('origin') && request.headers.get('origin') !== url.origin))
    return NextResponse.json({ error: 'Local same-origin access required.' }, { status: 403 });
  if (!process.env.BACKEND_API_TOKEN) return NextResponse.json({ error: 'Backend API is not configured.' }, { status: 503 });
  try {
    const origin = new URL(process.env.BACKEND_API_URL || 'http://127.0.0.1:4010');
    if (!['localhost','127.0.0.1'].includes(origin.hostname) || origin.protocol !== 'http:') throw new Error('Local backend required');
    const target = new URL(`/api/v1/${endpoint}`, origin); target.search = url.search;
    const response = await fetch(target, { headers: { Authorization: `Bearer ${process.env.BACKEND_API_TOKEN}` }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) return NextResponse.json({ error: response.status === 400 ? 'Invalid search or filter parameters.' : 'Inventory backend unavailable. Check the API and database.' }, { status: response.status === 400 ? 400 : 503 });
    return NextResponse.json(await response.json(), { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Cannot reach the local inventory API. Start the backend and try again.' }, { status: 503 }); }
}
