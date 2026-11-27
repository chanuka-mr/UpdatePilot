import { NextResponse } from 'next/server';
import {
  backendOrigin,
  DEVICE_COOKIE_NAME,
  forwardHeaders,
  isSameOriginRequest,
  SESSION_COOKIE_NAME,
} from '../../../../lib/backend-proxy';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Same-origin access required.' }, { status: 403 });
  }
  try {
    if (process.env.BACKEND_API_TOKEN) {
      await fetch(new URL('/api/v1/auth/logout', backendOrigin()), {
        method: 'POST',
        headers: await forwardHeaders(request),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
    }
  } catch {
    // Always clear cookies on logout even if backend is unreachable.
  }
  const res = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  res.cookies.delete(SESSION_COOKIE_NAME);
  res.cookies.delete(DEVICE_COOKIE_NAME);
  return res;
}
