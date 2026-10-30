-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventorySnapshot" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "scannedAt" TIMESTAMPTZ(3) NOT NULL,
    "importedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentHash" TEXT NOT NULL,
    "wingetStatus" TEXT NOT NULL,
    "warnings" JSONB NOT NULL,
    "raw" JSONB NOT NULL,

    CONSTRAINT "InventorySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistryApplication" (
    "id" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "installedVersion" TEXT,
    "publisher" TEXT,
    "scope" TEXT NOT NULL,
    "registryView" TEXT NOT NULL,
    "registryPath" TEXT NOT NULL,
    "discoverySource" TEXT NOT NULL,
    "matchStatus" TEXT NOT NULL,

    CONSTRAINT "RegistryApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WinGetPackage" (
    "id" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "packageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "installedVersion" TEXT,
    "source" TEXT,
    "isUpdateAvailable" BOOLEAN NOT NULL,
    "availableVersions" TEXT[],
    "matchStatus" TEXT NOT NULL,

    CONSTRAINT "WinGetPackage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Device_key_key" ON "Device"("key");

-- CreateIndex
CREATE INDEX "InventorySnapshot_deviceId_scannedAt_idx" ON "InventorySnapshot"("deviceId", "scannedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "InventorySnapshot_deviceId_contentHash_key" ON "InventorySnapshot"("deviceId", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "InventorySnapshot_deviceId_scannedAt_key" ON "InventorySnapshot"("deviceId", "scannedAt");

-- CreateIndex
CREATE INDEX "RegistryApplication_snapshotId_name_idx" ON "RegistryApplication"("snapshotId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "RegistryApplication_snapshotId_scope_registryView_registryP_key" ON "RegistryApplication"("snapshotId", "scope", "registryView", "registryPath");

-- CreateIndex
CREATE INDEX "WinGetPackage_snapshotId_isUpdateAvailable_idx" ON "WinGetPackage"("snapshotId", "isUpdateAvailable");

-- CreateIndex
CREATE INDEX "WinGetPackage_snapshotId_packageId_idx" ON "WinGetPackage"("snapshotId", "packageId");

-- AddForeignKey
ALTER TABLE "InventorySnapshot" ADD CONSTRAINT "InventorySnapshot_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistryApplication" ADD CONSTRAINT "RegistryApplication_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "InventorySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WinGetPackage" ADD CONSTRAINT "WinGetPackage_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "InventorySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
