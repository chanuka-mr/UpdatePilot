import { proxyBackend } from '../../../../lib/backend-proxy';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ type: string }> }) {
  const { type } = await context.params;
  if (type !== 'applications' && type !== 'updates') return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  return proxyBackend(request, `/api/v1/export/${type}`);
}
