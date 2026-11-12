import { z } from 'zod';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import { parseCatalogQuery } from './catalog.js';

const formatSchema = z.enum(['json', 'csv']).default('json');

export type ExportRow = Record<string, string | number | boolean | null>;

const escapeCsv = (value: string | number | boolean | null) => {
  if (value === null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export function toCsv(rows: ExportRow[]) {
  if (!rows.length) return '';
  const columns = Object.keys(rows[0]);
  return [columns, ...rows.map(row => columns.map(column => row[column] ?? null))]
    .map(values => values.map(escapeCsv).join(',')).join('\r\n');
}

export async function exportCatalog(db: PrismaClient, deviceKey: string, params: URLSearchParams, updates: boolean) {
  const format = formatSchema.parse(params.get('format') ?? 'json');
  const catalogParams = new URLSearchParams(params);
  catalogParams.delete('format');
  const query = parseCatalogQuery(catalogParams);
  const source = updates ? 'winget' : query.source;
  const result = await db.$transaction(async tx => {
    const scan = await tx.inventorySnapshot.findFirst({ where: { device: { key: deviceKey } }, orderBy: { scannedAt: 'desc' },
      select: { id: true, scannedAt: true, wingetStatus: true, warnings: true } });
    if (!scan) return { state: 'empty' as const, rows: [] as ExportRow[] };
    if (source === 'registry') {
      const where: Prisma.RegistryApplicationWhereInput = { snapshotId: scan.id,
        ...(query.q ? { OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { publisher: { contains: query.q, mode: 'insensitive' } }] } : {}) };
      const records = await tx.registryApplication.findMany({ where, orderBy: [{ [query.sort]: query.direction }, { id: 'asc' }], take: 20000 });
      return { state: 'ready' as const, rows: records.map(row => ({
        recordId: row.id, kind: 'registry', name: row.name, publisher: row.publisher, installedVersion: row.installedVersion,
        packageId: null, source: null, status: 'unmatched', scope: row.scope, registryView: row.registryView,
        availableVersions: null,
      })) };
    }
    if (scan.wingetStatus !== 'completed') return { state: 'unavailable' as const, rows: [] as ExportRow[] };
    const where: Prisma.WinGetPackageWhereInput = { snapshotId: scan.id,
      ...(query.q ? { OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { packageId: { contains: query.q, mode: 'insensitive' } }] } : {}),
      ...(updates || query.status === 'update' ? { isUpdateAvailable: true, matchStatus: 'matched', source: { equals: 'winget', mode: 'insensitive' } } :
        query.status === 'matched' ? { matchStatus: 'matched', source: { equals: 'winget', mode: 'insensitive' } } :
          query.status === 'unmatched' ? { matchStatus: 'unmatched' } : {}) };
    const records = await tx.winGetPackage.findMany({ where, orderBy: [{ [query.sort]: query.direction }, { id: 'asc' }], take: 20000 });
    return { state: 'ready' as const, rows: records.map(row => ({
      recordId: row.id, kind: 'winget', name: row.name, publisher: null, installedVersion: row.installedVersion,
      packageId: row.packageId, source: row.source, status: row.matchStatus !== 'matched' ? 'unmatched' : row.isUpdateAvailable ? 'update' : 'matched',
      scope: null, registryView: null, availableVersions: row.availableVersions.join(' | '),
    })) };
  }, { isolationLevel: 'RepeatableRead' });
  const exportedAt = new Date().toISOString();
  if (format === 'csv') return { format, body: toCsv(result.rows), snapshot: result.state, count: result.rows.length };
  return { format, body: JSON.stringify({ exportedAt, type: updates ? 'update-candidates' : source, scope: 'latest stored scan', ...result }, null, 2),
    snapshot: result.state, count: result.rows.length };
}
