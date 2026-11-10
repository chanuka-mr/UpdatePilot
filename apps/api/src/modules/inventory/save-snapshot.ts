import type { Prisma } from '../../../generated/prisma/client.js';
import { contentHash, type Snapshot } from './inventory.js';
export async function saveSnapshot(tx: Prisma.TransactionClient, deviceId: string, input: Snapshot) {
  const hash = contentHash(input);
  const existing = await tx.inventorySnapshot.findUnique({where:{deviceId_contentHash:{deviceId,contentHash:hash}}});
  if (existing) return existing;
  return tx.inventorySnapshot.create({ data: {
    deviceId, scannedAt:new Date(input.scannedAt), contentHash:hash, wingetStatus:input.winget.status,
    warnings:input.warnings, raw:input as Prisma.InputJsonValue,
    applications:{create:input.applications},
    packages:{create:input.winget.status==='completed'?input.winget.inventory.packages.map(({id,...pkg})=>({...pkg,packageId:id})):[]},
  }});
}
