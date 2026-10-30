import { z } from 'zod';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
const schema = z.object({
  q: z.string().trim().max(200).default(''),
  status: z.enum(['all','completed','failed','not-requested']).default('all'),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  direction: z.enum(['asc','desc']).default('desc'),
  id: z.uuid().optional(),
}).strict();
export function parseHistoryQuery(params: URLSearchParams) {
  for (const key of new Set(params.keys())) if (params.getAll(key).length !== 1) throw new Error('Duplicate query parameter');
  return schema.parse(Object.fromEntries(params));
}
export function scanOutcome(status: string, warningCount: number) {
  if (status === 'failed') return 'WinGet Failed';
  if (status === 'not-requested') return 'Registry Only';
  if (status !== 'completed') return 'Unknown';
  return warningCount ? 'Completed with Warnings' : 'Completed';
}
export async function readHistory(db: PrismaClient, deviceKey: string, params: URLSearchParams) {
  const query = parseHistoryQuery(params);
  const uuid = z.uuid().safeParse(query.q);
  const where: Prisma.InventorySnapshotWhereInput = {
    device: { key: deviceKey }, ...(query.id ? { id: query.id } : {}),
    ...(query.status !== 'all' ? { wingetStatus: query.status } : {}),
    ...(query.q ? { OR: [{ device: { name: { contains: query.q, mode: 'insensitive' } } }, ...(uuid.success ? [{ id: uuid.data }] : [])] } : {}),
  };
  return db.$transaction(async tx => {
    const total = await tx.inventorySnapshot.count({ where });
    const page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
    const scans = await tx.inventorySnapshot.findMany({ where, orderBy: [{ scannedAt: query.direction }, { id: 'asc' }],
      skip: (page-1)*query.pageSize, take: query.pageSize,
      select: { id: true, scannedAt: true, importedAt: true, wingetStatus: true, warnings: true,
        device: { select: { name: true } }, _count: { select: { applications: true, packages: true } } } });
    const rows = await Promise.all(scans.map(async scan => {
      const warnings = Array.isArray(scan.warnings) ? scan.warnings.filter((w): w is string => typeof w === 'string') : [];
      const updates = scan.wingetStatus === 'completed' ? await tx.winGetPackage.count({ where: {
        snapshotId: scan.id, isUpdateAvailable: true, matchStatus: 'matched', source: { equals: 'winget', mode: 'insensitive' } } }) : null;
      return { id: scan.id, type: 'SCAN', deviceName: scan.device.name, scannedAt: scan.scannedAt,
        importedAt: scan.importedAt, wingetStatus: scan.wingetStatus, outcome: scanOutcome(scan.wingetStatus, warnings.length),
        warningCount: warnings.length, ...(query.id ? { warnings } : {}), registryEntries: scan._count.applications,
        wingetEntries: scan.wingetStatus === 'completed' ? scan._count.packages : null, updatesAvailable: updates };
    }));
    return { state: total ? 'ready' : 'empty', rows, total, page, pageSize: query.pageSize };
  }, { isolationLevel: 'RepeatableRead', timeout: 15000 });
}
