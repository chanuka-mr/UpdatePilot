import { z } from 'zod';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { record } from '../agent/update.js';

const idSchema = z.uuid();

const snapshotMeta = (snapshot: { id: string; scannedAt: Date; importedAt: Date; wingetStatus: string; warnings: unknown }) => ({
  snapshotId: snapshot.id, scannedAt: snapshot.scannedAt, importedAt: snapshot.importedAt,
  wingetStatus: snapshot.wingetStatus, stale: Date.now() - snapshot.scannedAt.getTime() > 86400000,
  warningCount: Array.isArray(snapshot.warnings) ? snapshot.warnings.length : 0,
});

const packageStatus = (pkg: { matchStatus: string; isUpdateAvailable: boolean }) =>
  pkg.matchStatus !== 'matched' ? 'unmatched' : pkg.isUpdateAvailable ? 'update' : 'matched';

async function findSnapshot(db: PrismaClient, deviceKey: string, snapshotId?: string) {
  return db.inventorySnapshot.findFirst({
    where: { device: { key: deviceKey }, ...(snapshotId ? { id: snapshotId } : {}) },
    orderBy: { scannedAt: 'desc' },
    select: { id: true, deviceId: true, scannedAt: true, importedAt: true, wingetStatus: true, warnings: true },
  });
}

async function evidence(db: PrismaClient, deviceId: string, packageId: string, previewJobId?: string | null, verificationJobId?: string | null) {
  const jobs = await db.scanJob.findMany({
    where: { deviceId, operation: { in: ['preview', 'verify'] }, state: 'completed' },
    orderBy: { createdAt: 'desc' }, take: 40,
    select: { id: true, operation: true, state: true, request: true, preview: true, verification: true, createdAt: true, finishedAt: true },
  });
  const preview = jobs.find(job => job.operation === 'preview' && record(job.request)?.packageId === packageId);
  const verification = jobs.find(job => job.operation === 'verify' && record(job.request)?.packageId === packageId);
  return {
    preview: preview ?? null,
    verification: verification ?? null,
    previewJobId: previewJobId ?? preview?.id ?? null,
    verificationJobId: verificationJobId ?? verification?.id ?? null,
  };
}

export async function readApplicationDetail(db: PrismaClient, deviceKey: string, id: string, snapshotId?: string) {
  const applicationId = idSchema.parse(id);
  const selectedSnapshotId = snapshotId ? idSchema.parse(snapshotId) : undefined;
  const snapshot = await findSnapshot(db, deviceKey, selectedSnapshotId);
  if (!snapshot) return { state: 'empty' };
  const [application, pkg] = await Promise.all([
    db.registryApplication.findFirst({ where: { id: applicationId, snapshotId: snapshot.id } }),
    db.winGetPackage.findFirst({ where: { id: applicationId, snapshotId: snapshot.id } }),
  ]);
  if (!application && !pkg) return { state: 'not-found', snapshot: snapshotMeta(snapshot) };
  if (application) return { state: 'ready', kind: 'registry', snapshot: snapshotMeta(snapshot),
    record: { ...application, status: 'unmatched', packageId: null, availableVersions: [] }, evidence: null };
  const pkgRecord = pkg!;
  return { state: 'ready', kind: 'winget', snapshot: snapshotMeta(snapshot),
    record: { ...pkgRecord, status: packageStatus(pkgRecord) },
    evidence: await evidence(db, snapshot.deviceId, pkgRecord.packageId) };
}

export async function readUpdateDetail(db: PrismaClient, deviceKey: string, id: string, snapshotId?: string) {
  const applicationId = idSchema.parse(id);
  const selectedSnapshotId = snapshotId ? idSchema.parse(snapshotId) : undefined;
  const snapshot = await findSnapshot(db, deviceKey, selectedSnapshotId);
  if (!snapshot) return { state: 'empty' };
  const pkg = await db.winGetPackage.findFirst({ where: { id: applicationId, snapshotId: snapshot.id } });
  if (!pkg) return { state: 'not-found', snapshot: snapshotMeta(snapshot) };
  return { state: 'ready', kind: 'winget', snapshot: snapshotMeta(snapshot),
    record: { ...pkg, status: packageStatus(pkg) },
    evidence: await evidence(db, snapshot.deviceId, pkg.packageId) };
}
