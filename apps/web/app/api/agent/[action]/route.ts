import { NextResponse } from 'next/server';
import { backendOrigin, forwardHeaders, isSameOriginRequest } from '../../../../lib/backend-proxy';

export const dynamic = 'force-dynamic';

async function forward(request: Request, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  if (!['status', 'pairing', 'revoke', 'scan', 'preview', 'verify', 'update', 'cancel'].includes(action)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Same-origin access required.' }, { status: 403 });
  }
  if (!process.env.BACKEND_API_TOKEN) {
    return NextResponse.json({ error: 'API not configured' }, { status: 503 });
  }
  try {
    const origin = backendOrigin();
    const payload = ['preview', 'verify', 'update', 'cancel'].includes(action)
      ? JSON.stringify(await request.json())
      : undefined;
    const headers = await forwardHeaders(request);
    if (payload) headers['Content-Type'] = 'application/json';
    const response = await fetch(new URL(`/api/v1/control/${action}`, origin), {
      method: request.method,
      headers,
      body: payload,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    return NextResponse.json(result, { status: response.status, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json(
      { error: 'Agent control unavailable. Check the backend and database migration.' },
      { status: 503 },
    );
  }
}

export const GET = forward;
export const POST = forward;
