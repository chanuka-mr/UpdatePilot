import { proxyBackend } from '../../../../lib/backend-proxy';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return proxyBackend(request, `/api/v1/updates/${encodeURIComponent(id)}`);
}
