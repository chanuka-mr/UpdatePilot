import { NextResponse } from 'next/server';
import {
  backendOrigin,
  DEVICE_COOKIE_NAME,
  forwardHeaders,
  isSameOriginRequest,
  proxyBackend,
} from '../../../lib/backend-proxy';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return proxyBackend(request, '/api/v1/devices');
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Same-origin access required.' }, { status: 403 });
  }
  if (!process.env.BACKEND_API_TOKEN) {
    return NextResponse.json({ error: 'Backend API is not configured.' }, { status: 503 });
  }
  try {
    const payload = await request.text();
    const headers = await forwardHeaders(request);
    headers['Content-Type'] = 'application/json';
    const response = await fetch(new URL('/api/v1/devices', backendOrigin()), {
      method: 'POST',
      headers,
      body: payload,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    const data = (await response.json()) as { device?: { id: string }; error?: string };
    const res = NextResponse.json(data, {
      status: response.status,
      headers: { 'Cache-Control': 'no-store' },
    });
    if (response.ok && data.device?.id) {
      res.cookies.set(DEVICE_COOKIE_NAME, data.device.id, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
      });
    }
    return res;
  } catch {
    return NextResponse.json({ error: 'Device service unavailable.' }, { status: 503 });
  }
}
