import { proxyCatalog } from '../../../lib/backend-proxy';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return proxyCatalog(request, 'history'); }
