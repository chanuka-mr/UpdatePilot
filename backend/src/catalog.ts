import { z } from 'zod';
import type { PrismaClient, Prisma } from '../generated/prisma/client.js';
const querySchema = z.object({
  q: z.string().trim().max(200).default(''),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  source: z.enum(['registry', 'winget']).default('registry'),
  status: z.enum(['all', 'update', 'matched', 'unmatched']).default('all'),
  sort: z.enum(['name', 'installedVersion']).default('name'),
  direction: z.enum(['asc', 'desc']).default('asc'),
}).strict();
export function parseCatalogQuery(params: URLSearchParams) {
  for (const key of new Set(params.keys())) if (params.getAll(key).length !== 1) throw new Error('Duplicate query parameter');
  return querySchema.parse(Object.fromEntries(params));
}
export async function readCatalog(db: PrismaClient, deviceKey: string, params: URLSearchParams, updates: boolean) {
  const query = parseCatalogQuery(params);
  const source = updates ? 'winget' : query.source;
  if (source === 'registry' && !['all', 'unmatched'].includes(query.status)) throw new Error('Registry entries have no catalog match yet');
  return db.$transaction(async tx => {
    const scan = await tx.inventorySnapshot.findFirst({ where: { device: { key: deviceKey } }, orderBy: { scannedAt: 'desc' },
      select: { id: true, scannedAt: true, wingetStatus: true, warnings: true } });
    if (!scan) return { state: 'empty', rows: [], total: 0, page: 1, pageSize: query.pageSize, source };
    const meta = { snapshotId: scan.id, scannedAt: scan.scannedAt, wingetStatus: scan.wingetStatus,
      stale: Date.now() - scan.scannedAt.getTime() > 86400000, source,
      warningCount: Array.isArray(scan.warnings) ? scan.warnings.length : 0, pageSize: query.pageSize };
    if (source === 'winget' && scan.wingetStatus !== 'completed')
      return { ...meta, state: 'unavailable', rows: [], total: null, page: 1 };
    const orderBy = [{ [query.sort]: query.direction }, { id: 'asc' as const }];
    if (source === 'registry') {
      const where: Prisma.RegistryApplicationWhereInput = { snapshotId: scan.id,
        ...(query.q ? { OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { publisher: { contains: query.q, mode: 'insensitive' } }] } : {}) };
      const total = await tx.registryApplication.count({ where });
      const page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
      const rows = await tx.registryApplication.findMany({ where, orderBy, skip: (page - 1) * query.pageSize, take: query.pageSize,
        select: { id: true, name: true, publisher: true, installedVersion: true, scope: true, registryView: true, matchStatus: true } });
      return { ...meta, state: 'ready', total, page, rows: rows.map(row => ({ ...row, status: 'unmatched', packageId: null, availableVersions: [] })) };
    }
    const where: Prisma.WinGetPackageWhereInput = { snapshotId: scan.id,
      ...(query.q ? { OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { packageId: { contains: query.q, mode: 'insensitive' } }] } : {}),
      ...(updates || query.status === 'update' ? { isUpdateAvailable: true, matchStatus: 'matched', source: { equals: 'winget', mode: 'insensitive' } } :
        query.status === 'matched' ? { matchStatus: 'matched', source: { equals: 'winget', mode: 'insensitive' } } : query.status === 'unmatched' ? { matchStatus: 'unmatched' } : {}) };
    const total = await tx.winGetPackage.count({ where });
    const page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
    const rows = await tx.winGetPackage.findMany({ where, orderBy, skip: (page - 1) * query.pageSize, take: query.pageSize,
      select: { id: true, name: true, installedVersion: true, packageId: true, source: true, isUpdateAvailable: true, matchStatus: true, availableVersions: true } });
    return { ...meta, state: 'ready', total, page, rows: rows.map(row => ({ ...row,
      status: row.matchStatus !== 'matched' ? 'unmatched' : row.isUpdateAvailable ? 'update' : 'matched' })) };
  }, { isolationLevel: 'RepeatableRead' });
}
