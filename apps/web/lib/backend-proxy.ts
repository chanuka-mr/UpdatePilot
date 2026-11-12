import { NextResponse } from 'next/server';

function localRequest(request: Request) {
  const url = new URL(request.url);
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
    (!request.headers.get('origin') || request.headers.get('origin') === url.origin);
}

function backendOrigin() {
  const origin = new URL(process.env.BACKEND_API_URL || 'http://127.0.0.1:4010');
  if (!['localhost', '127.0.0.1'].includes(origin.hostname) || origin.protocol !== 'http:') throw new Error('Local backend required');
  return origin;
}

export async function proxyBackend(request: Request, path: string, timeoutMs = 20000) {
  if (!localRequest(request)) return NextResponse.json({ error: 'Local same-origin access required.' }, { status: 403 });
  if (!process.env.BACKEND_API_TOKEN) return NextResponse.json({ error: 'Backend API is not configured.' }, { status: 503 });
  try {
    const target = new URL(path, backendOrigin());
    target.search = new URL(request.url).search;
    const response = await fetch(target, { headers: { Authorization: `Bearer ${process.env.BACKEND_API_TOKEN}` },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return NextResponse.json({ error: response.status === 400 ? 'Invalid request parameters.' : 'Inventory backend unavailable. Check the API and database.' },
      { status: response.status === 400 ? 400 : 503 });
    const headers = new Headers({ 'Cache-Control': 'no-store' });
    for (const name of ['content-type', 'content-disposition']) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new NextResponse(await response.arrayBuffer(), { status: response.status, headers });
  } catch {
    return NextResponse.json({ error: 'Cannot reach the local backend. Start the API and try again.' }, { status: 503 });
  }
}

export async function proxyCatalog(request: Request, endpoint: 'applications' | 'updates' | 'history') {
  return proxyBackend(request, `/api/v1/${endpoint}`);
}
