CREATE TABLE "UpdateExecution" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "packageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "installedVersion" TEXT NOT NULL,
    "targetVersion" TEXT NOT NULL,
    "sourceSnapshotId" UUID NOT NULL,
    "previewJobId" UUID NOT NULL,
    "verificationJobId" UUID NOT NULL,
    "installerType" TEXT NOT NULL,
    "installerSha256" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "profile" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "stage" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "error" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "confirmedAt" TIMESTAMPTZ(3),
    CONSTRAINT "UpdateExecution_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ScanJob" ADD COLUMN "progress" JSONB;
ALTER TABLE "ScanJob" ADD COLUMN "updateExecutionId" UUID;

CREATE INDEX "UpdateExecution_deviceId_createdAt_idx" ON "UpdateExecution"("deviceId", "createdAt" DESC);
CREATE INDEX "UpdateExecution_status_idx" ON "UpdateExecution"("status");
CREATE INDEX "ScanJob_updateExecutionId_idx" ON "ScanJob"("updateExecutionId");

ALTER TABLE "UpdateExecution" ADD CONSTRAINT "UpdateExecution_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScanJob" ADD CONSTRAINT "ScanJob_updateExecutionId_fkey" FOREIGN KEY ("updateExecutionId") REFERENCES "UpdateExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
