-- Enforce one active credential, pending pairing code, and scan per device,
-- including when requests arrive concurrently from multiple browser tabs.
CREATE UNIQUE INDEX "AgentCredential_one_active_per_device" ON "AgentCredential"("deviceId") WHERE "revokedAt" IS NULL;
CREATE UNIQUE INDEX "PairingTicket_one_pending_per_device" ON "PairingTicket"("deviceId") WHERE "usedAt" IS NULL;
CREATE UNIQUE INDEX "ScanJob_one_active_per_device" ON "ScanJob"("deviceId") WHERE "state" IN ('queued', 'running');
