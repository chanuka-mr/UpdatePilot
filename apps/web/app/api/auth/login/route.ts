import { NextResponse } from 'next/server';
import {
  backendOrigin,
  isSameOriginRequest,
  SESSION_COOKIE_NAME,
} from '../../../../lib/backend-proxy';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Same-origin access required.' }, { status: 403 });
  }
  if (!process.env.BACKEND_API_TOKEN) {
    return NextResponse.json({ error: 'Backend API is not configured.' }, { status: 503 });
  }
  try {
    const payload = await request.text();
    const response = await fetch(new URL('/api/v1/auth/login', backendOrigin()), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.BACKEND_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: payload,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    const data = (await response.json()) as {
      user?: unknown;
      sessionToken?: string;
      expiresAt?: string;
      error?: string;
    };
    if (!response.ok || !data.sessionToken || !data.expiresAt) {
      return NextResponse.json(
        { error: data.error || 'Sign-in failed.' },
        { status: response.status || 401, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const res = NextResponse.json(
      { user: data.user },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
    res.cookies.set(SESSION_COOKIE_NAME, data.sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: new Date(data.expiresAt),
    });
    return res;
  } catch {
    return NextResponse.json({ error: 'Authentication service unavailable.' }, { status: 503 });
  }
}
