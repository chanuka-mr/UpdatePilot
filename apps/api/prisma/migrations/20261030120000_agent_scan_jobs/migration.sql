CREATE TABLE "AgentCredential" (
 "id" UUID NOT NULL PRIMARY KEY, "deviceId" UUID NOT NULL, "tokenHash" TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "lastSeenAt" TIMESTAMPTZ(3), "revokedAt" TIMESTAMPTZ(3),
 CONSTRAINT "AgentCredential_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AgentCredential_tokenHash_key" ON "AgentCredential"("tokenHash");
CREATE TABLE "PairingTicket" (
 "id" UUID NOT NULL PRIMARY KEY, "deviceId" UUID NOT NULL, "codeHash" TEXT NOT NULL,
 "expiresAt" TIMESTAMPTZ(3) NOT NULL, "usedAt" TIMESTAMPTZ(3),
 CONSTRAINT "PairingTicket_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PairingTicket_codeHash_key" ON "PairingTicket"("codeHash");
CREATE TABLE "ScanJob" (
 "id" UUID NOT NULL PRIMARY KEY, "deviceId" UUID NOT NULL, "agentId" UUID,
 "state" TEXT NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expiresAt" TIMESTAMPTZ(3) NOT NULL, "startedAt" TIMESTAMPTZ(3), "finishedAt" TIMESTAMPTZ(3),
 "leaseHash" TEXT, "snapshotId" UUID, "resultHash" TEXT, "error" TEXT,
 CONSTRAINT "ScanJob_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "ScanJob_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "ScanJob_deviceId_createdAt_idx" ON "ScanJob"("deviceId", "createdAt" DESC);
