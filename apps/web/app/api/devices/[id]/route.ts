import { NextResponse } from 'next/server';
import {
  backendOrigin,
  forwardHeaders,
  isSameOriginRequest,
} from '../../../../lib/backend-proxy';

export const dynamic = 'force-dynamic';

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Same-origin access required.' }, { status: 403 });
  }
  if (!process.env.BACKEND_API_TOKEN) {
    return NextResponse.json({ error: 'Backend API is not configured.' }, { status: 503 });
  }
  const { id } = await context.params;
  try {
    const response = await fetch(new URL(`/api/v1/devices/${encodeURIComponent(id)}`, backendOrigin()), {
      method: 'DELETE',
      headers: await forwardHeaders(request),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    return NextResponse.json(data, {
      status: response.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ error: 'Device service unavailable.' }, { status: 503 });
  }
}
