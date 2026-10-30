import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { createDatabase } from "./database.js";
import { summarizePackages } from "./dashboard.js";
import { readCatalog } from "./catalog.js";

const db = createDatabase();
const token = process.env.BACKEND_API_TOKEN;
if (!token || token.length < 32) throw new Error("Set BACKEND_API_TOKEN to a random secret of at least 32 characters.");
const deviceKey = process.env.DEVICE_KEY || "local-pc";
const port = Number(process.env.PORT || 4010);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid backend port.");
const server = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const send = (status: number, body: unknown) => { res.writeHead(status); res.end(JSON.stringify(body)); };
  // Local single-device development API. The Next.js server keeps this token private.
  // No CORS access or agent execution endpoints are exposed.
  const supplied = Buffer.from(req.headers.authorization || "");
  const expected = Buffer.from(`Bearer ${token}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { send(401, { error: "Unauthorized" }); return; }
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); send(405, { error: "Read-only API" }); return; }
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (!['/api/v1/dashboard', '/api/v1/applications', '/api/v1/updates'].includes(url.pathname)) { send(404, { error: "Not found" }); return; }
  if (url.pathname !== '/api/v1/dashboard') {
    try { send(200, await readCatalog(db, deviceKey, url.searchParams, url.pathname === '/api/v1/updates')); }
    catch (error) {
      if (error instanceof Error && (error.name === 'ZodError' || error.message === 'Duplicate query parameter' || error.message.startsWith('Registry entries'))) send(400, { error: 'Invalid search, filter, sorting, or pagination parameters.' });
      else send(503, { error: 'Inventory database unavailable. Check the database connection and migrations.' });
    }
    return;
  }
  try {
    const scan = await db.$transaction(tx => tx.inventorySnapshot.findFirst({
      where: { device: { key: deviceKey } }, orderBy: { scannedAt: "desc" },
      select: { id: true, scannedAt: true, importedAt: true, wingetStatus: true, warnings: true,
        device: { select: { name: true } }, _count: { select: { applications: true } },
        packages: { select: { id: true, name: true, packageId: true, installedVersion: true,
          source: true, isUpdateAvailable: true, matchStatus: true } } },
    }), { isolationLevel: "RepeatableRead" });
    if (!scan) { send(200, { state: "empty", deviceKey, agentStatus: "unknown" }); return; }
    send(200, { state: "ready", deviceName: scan.device.name, snapshotId: scan.id,
      scannedAt: scan.scannedAt, importedAt: scan.importedAt, agentStatus: "unknown",
      stale: Date.now() - scan.scannedAt.getTime() > 24 * 60 * 60 * 1000,
      wingetStatus: scan.wingetStatus, warningCount: Array.isArray(scan.warnings) ? scan.warnings.length : 0,
      registryEntries: scan._count.applications, ...summarizePackages(scan.wingetStatus, scan.packages) });
  } catch {
    // Query arguments and connection errors can contain private inventory/credentials.
    console.error("Dashboard database query failed.");
    send(503, { error: "Database unavailable. Check the backend database connection and migrations." });
  }
});
server.requestTimeout = 15000;
server.listen(port, "127.0.0.1", () => console.log(`UpdatePilot read-only API: http://127.0.0.1:${port}`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => {
  server.close(() => { void db.$disconnect().finally(() => process.exit(0)); });
});
