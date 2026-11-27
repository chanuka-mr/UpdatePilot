import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const SESSION_COOKIE_NAME = 'up_session';
export const DEVICE_COOKIE_NAME = 'up_device';

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || url.host;
  const proto = request.headers.get('x-forwarded-proto') || url.protocol.replace(':', '');
  const expectedOrigin = `${proto}://${host}`;
  if (origin === expectedOrigin || origin === url.origin) return true;
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL;
  if (configuredOrigin) {
    try {
      if (origin === new URL(configuredOrigin).origin) return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function backendOrigin(): URL {
  const raw = process.env.BACKEND_API_URL || 'http://127.0.0.1:4010';
  const origin = new URL(raw);
  const isLoopback = ['localhost', '127.0.0.1'].includes(origin.hostname);
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && isLoopback)) {
    throw new Error('BACKEND_API_URL must use HTTPS (or http://localhost / http://127.0.0.1 in development).');
  }
  return origin;
}

export async function forwardHeaders(request: Request): Promise<Record<string, string>> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const deviceId = request.headers.get('x-device-id') || cookieStore.get(DEVICE_COOKIE_NAME)?.value;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${process.env.BACKEND_API_TOKEN || ''}`,
  };
  if (sessionToken) headers['x-session-token'] = sessionToken;
  if (deviceId) headers['x-device-id'] = deviceId;
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) headers['x-forwarded-for'] = forwardedFor;
  return headers;
}

export async function proxyBackend(request: Request, path: string, timeoutMs = 20000) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Same-origin access required.' }, { status: 403 });
  }
  if (!process.env.BACKEND_API_TOKEN) {
    return NextResponse.json({ error: 'Backend API is not configured.' }, { status: 503 });
  }
  try {
    const target = new URL(path, backendOrigin());
    target.search = new URL(request.url).search;
    const response = await fetch(target, {
      headers: await forwardHeaders(request),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      let message =
        response.status === 401
          ? 'Authentication required.'
          : response.status === 400
            ? 'Invalid request parameters.'
            : 'Inventory backend unavailable. Check the API and database.';
      try {
        const body = (await response.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        // Keep safe fallback message.
      }
      return NextResponse.json(
        { error: message },
        { status: response.status === 401 || response.status === 400 || response.status === 404 || response.status === 429 ? response.status : 503 },
      );
    }
    const headers = new Headers({ 'Cache-Control': 'no-store' });
    for (const name of ['content-type', 'content-disposition']) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new NextResponse(await response.arrayBuffer(), { status: response.status, headers });
  } catch {
    return NextResponse.json({ error: 'Cannot reach the backend API. Try again shortly.' }, { status: 503 });
  }
}

export async function proxyCatalog(request: Request, endpoint: 'applications' | 'updates' | 'history') {
  return proxyBackend(request, `/api/v1/${endpoint}`);
}
