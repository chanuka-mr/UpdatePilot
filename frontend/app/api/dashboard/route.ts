import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(requestUrl.hostname) ||
      (request.headers.get('origin') && request.headers.get('origin') !== requestUrl.origin))
    return NextResponse.json({ error: 'Local same-origin access required.' }, { status: 403 });
  const token = process.env.BACKEND_API_TOKEN;
  if (!token) return NextResponse.json({ error: "The dashboard API is not configured. Set the server-only backend connection in frontend/.env.local." }, { status: 503 });
  try {
    const origin = new URL(process.env.BACKEND_API_URL || "http://127.0.0.1:4010");
    if (!['127.0.0.1', 'localhost'].includes(origin.hostname) || origin.protocol !== 'http:') throw new Error('Local backend required');
    const response = await fetch(new URL('/api/v1/dashboard', origin), {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(10000), redirect: 'error',
    });
    if (!response.ok) return NextResponse.json({ error: 'Dashboard backend unavailable. Check that the API is running and its database connection is configured.' }, { status: 503 });
    return NextResponse.json(await response.json(), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Cannot reach the local backend. Start it with npm run dev in backend.' }, { status: 503 });
  }
}
