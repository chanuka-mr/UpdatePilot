import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';

export type AuditInput = {
  userId?: string | null;
  deviceId?: string | null;
  action: string;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Prisma.InputJsonValue;
};

export async function writeAuditLog(db: PrismaClient, entry: AuditInput): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        deviceId: entry.deviceId ?? null,
        action: entry.action.slice(0, 80),
        ip: entry.ip ? entry.ip.slice(0, 64) : null,
        userAgent: entry.userAgent ? entry.userAgent.slice(0, 256) : null,
        metadata: entry.metadata ?? undefined,
      },
    });
  } catch {
    console.error('Audit log write failed.');
  }
}
