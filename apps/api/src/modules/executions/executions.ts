import { z } from 'zod';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import { updateExecutionStatuses } from '../agent/execution.js';

const listSchema = z.object({
  q: z.string().trim().max(200).default(''),
  status: z.enum(['all', ...updateExecutionStatuses]).default('all'),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
}).strict();

export function parseExecutionListQuery(params: URLSearchParams) {
  for (const key of new Set(params.keys())) if (params.getAll(key).length !== 1) throw new Error('Duplicate query parameter');
  return listSchema.parse(Object.fromEntries(params));
}

type Job = { id: string; operation: string; state: string; progress: unknown; error: string | null;
  createdAt: Date; startedAt: Date | null; finishedAt: Date | null; snapshotId: string | null };

const jobSummary = (job: Job) => ({
  id: job.id, operation: job.operation, state: job.state, progress: job.progress, error: job.error,
  createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt, snapshotId: job.snapshotId,
});

export async function readExecutions(db: PrismaClient, deviceKey: string, params: URLSearchParams) {
  const query = parseExecutionListQuery(params);
  const where: Prisma.UpdateExecutionWhereInput = {
    device: { key: deviceKey },
    ...(query.status !== 'all' ? { status: query.status } : {}),
    ...(query.q ? { OR: [
      { name: { contains: query.q, mode: 'insensitive' } },
      { packageId: { contains: query.q, mode: 'insensitive' } },
      ...(z.uuid().safeParse(query.q).success ? [{ id: query.q }] : []),
    ] } : {}),
  };
  return db.$transaction(async tx => {
    const total = await tx.updateExecution.count({ where });
    const page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
    const rows = await tx.updateExecution.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * query.pageSize, take: query.pageSize,
      select: { id: true, name: true, packageId: true, installedVersion: true, targetVersion: true,
        status: true, stage: true, progress: true, message: true, error: true,
        createdAt: true, startedAt: true, finishedAt: true, confirmedAt: true,
        scanJobs: { orderBy: { createdAt: 'desc' }, take: 3, select: { id: true, operation: true, state: true, progress: true,
          error: true, createdAt: true, startedAt: true, finishedAt: true, snapshotId: true } } } });
    return { state: total ? 'ready' : 'empty', rows: rows.map(row => ({ ...row, jobs: row.scanJobs.map(jobSummary), scanJobs: undefined })),
      total, page, pageSize: query.pageSize };
  }, { isolationLevel: 'RepeatableRead' });
}

export async function readExecution(db: PrismaClient, deviceKey: string, id: string) {
  const executionId = z.uuid().parse(id);
  return db.$transaction(async tx => {
    const row = await tx.updateExecution.findFirst({ where: { id: executionId, device: { key: deviceKey } },
      include: { scanJobs: { orderBy: { createdAt: 'desc' },
        select: { id: true, operation: true, state: true, progress: true, error: true, createdAt: true,
          startedAt: true, finishedAt: true, snapshotId: true } } } });
    if (!row) return { state: 'empty' };
    return { state: 'ready', execution: { ...row, scanJobs: undefined, jobs: row.scanJobs.map(jobSummary) } };
  }, { isolationLevel: 'RepeatableRead' });
}
