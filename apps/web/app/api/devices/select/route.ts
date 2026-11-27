import { NextResponse } from 'next/server';
import { DEVICE_COOKIE_NAME, isSameOriginRequest } from '../../../../lib/backend-proxy';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Same-origin access required.' }, { status: 403 });
  }
  const body = (await request.json()) as { deviceId?: string };
  if (!body.deviceId || !/^[0-9a-f-]{36}$/i.test(body.deviceId)) {
    return NextResponse.json({ error: 'Invalid device ID.' }, { status: 400 });
  }
  const res = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  res.cookies.set(DEVICE_COOKIE_NAME, body.deviceId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
  return res;
}
