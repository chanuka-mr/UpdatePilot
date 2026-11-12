import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { createDatabase } from "./config/database.js";
import { summarizePackages } from "./modules/dashboard/dashboard.js";
import { readCatalog } from "./modules/catalog/catalog.js";
import { readApplicationDetail, readUpdateDetail } from "./modules/catalog/detail.js";
import { exportCatalog } from "./modules/catalog/export.js";
import { readHistory } from "./modules/history/history.js";
import { agentRequest, control, ApiError, body, isOnline } from './modules/agent/api.js';
import { readExecution, readExecutions } from './modules/executions/executions.js';
import { readSecurity } from './modules/security/security.js';

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
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if(url.pathname.startsWith('/api/v1/agent/')) {
    try {send(200,await agentRequest(db,req,url.pathname.slice('/api/v1/agent/'.length)));}
    catch(error){send(error instanceof ApiError?error.status:error instanceof Error&&error.name==='ZodError'?400:503,{error:error instanceof ApiError?error.message:'Agent request could not be processed.'});}
    return;
  }
  // Local single-device development API. The Next.js server keeps this token private.
  // No CORS access or agent execution endpoints are exposed.
  const supplied = Buffer.from(req.headers.authorization || "");
  const expected = Buffer.from(`Bearer ${token}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { send(401, { error: "Unauthorized" }); return; }
  if(url.pathname.startsWith('/api/v1/control/')) {
    try{send(200,await control(db,deviceKey,url.pathname.slice('/api/v1/control/'.length),req.method||'',['/api/v1/control/preview','/api/v1/control/verify','/api/v1/control/update','/api/v1/control/cancel'].includes(url.pathname)?await body(req):undefined));}
    catch(error){if(error instanceof ApiError)send(error.status,{error:error.message,...(error.details?{details:error.details}:{})});else send(503,{error:'Control request failed. Retry after checking the database migration.'});}
    return;
  }
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); send(405, { error: "Read-only API" }); return; }
  const exportMatch = url.pathname.match(/^\/api\/v1\/export\/(applications|updates)$/);
  if (exportMatch) {
    try {
      const updates = exportMatch[1] === 'updates';
      const result = await exportCatalog(db, deviceKey, url.searchParams, updates);
      if (result.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="updatepilot-${exportMatch[1]}.csv"`);
        res.writeHead(200); res.end(result.body);
      } else send(200, JSON.parse(result.body));
    } catch (error) {
      send(error instanceof Error && error.name === 'ZodError' ? 400 : 503, { error: 'Export unavailable. Check the filters, database, and migrations.' });
    }
    return;
  }
  const detailMatch = url.pathname.match(/^\/api\/v1\/(applications|updates)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  if (detailMatch) {
    try {
      const snapshotId = url.searchParams.get('snapshotId') ?? undefined;
      send(200, detailMatch[1] === 'applications'
        ? await readApplicationDetail(db, deviceKey, detailMatch[2], snapshotId)
        : await readUpdateDetail(db, deviceKey, detailMatch[2], snapshotId));
    } catch (error) {
      send(error instanceof Error && error.name === 'ZodError' ? 400 : 503, { error: 'Stored record unavailable. Check the database and migrations.' });
    }
    return;
  }
  if (url.pathname === '/api/v1/security') {
    try { send(200, await readSecurity(db, deviceKey)); }
    catch { send(503, { error: 'Security insights unavailable. Check the database, migration, and NVD connectivity.' }); }
    return;
  }
  if (url.pathname === '/api/v1/executions' || url.pathname.startsWith('/api/v1/executions/')) {
    try {
      const id = url.pathname.slice('/api/v1/executions/'.length);
      send(200, url.pathname === '/api/v1/executions' ? await readExecutions(db, deviceKey, url.searchParams) : await readExecution(db, deviceKey, id));
    } catch (error) {
      send(error instanceof Error && error.name === 'ZodError' ? 400 : 503, { error: 'Update history unavailable. Check the database and migrations.' });
    }
    return;
  }
  if (!['/api/v1/dashboard', '/api/v1/applications', '/api/v1/updates', '/api/v1/history'].includes(url.pathname)) { send(404, { error: "Not found" }); return; }
  if (url.pathname !== '/api/v1/dashboard') {
    try { send(200, url.pathname === '/api/v1/history' ? await readHistory(db, deviceKey, url.searchParams) : await readCatalog(db, deviceKey, url.searchParams, url.pathname === '/api/v1/updates')); }
    catch (error) {
      if (error instanceof Error && (error.name === 'ZodError' || error.message === 'Duplicate query parameter' || error.message.startsWith('Registry entries'))) send(400, { error: 'Invalid search, filter, sorting, or pagination parameters.' });
      else send(503, { error: 'Inventory database unavailable. Check the database connection and migrations.' });
    }
    return;
  }
  try {
    const result = await db.$transaction(async tx => {
      const agent = await tx.agentCredential.findFirst({
        where: { device: { key: deviceKey }, revokedAt: null }, orderBy: { createdAt: 'desc' },
        select: { lastSeenAt: true, revokedAt: true },
      });
      const scan = await tx.inventorySnapshot.findFirst({
        where: { device: { key: deviceKey } }, orderBy: { scannedAt: "desc" },
        select: { id: true, scannedAt: true, importedAt: true, wingetStatus: true, warnings: true,
          device: { select: { name: true } }, _count: { select: { applications: true } },
          packages: { select: { id: true, name: true, packageId: true, installedVersion: true,
            source: true, isUpdateAvailable: true, matchStatus: true } } },
      });
      return { scan, agent };
    }, { isolationLevel: "RepeatableRead" });
    const { scan, agent } = result;
    const agentStatus = !agent ? 'unpaired' : isOnline(agent.lastSeenAt, agent.revokedAt) ? 'online' : 'offline';
    const lastSeenAt = agent?.lastSeenAt ?? null;
    if (!scan) { send(200, { state: "empty", deviceKey, agentStatus, lastSeenAt }); return; }
    send(200, { state: "ready", deviceName: scan.device.name, snapshotId: scan.id,
      scannedAt: scan.scannedAt, importedAt: scan.importedAt, agentStatus, lastSeenAt,
      stale: Date.now() - scan.scannedAt.getTime() > 24 * 60 * 60 * 1000,
      wingetStatus: scan.wingetStatus, warningCount: Array.isArray(scan.warnings) ? scan.warnings.length : 0,
      registryEntries: scan._count.applications, ...summarizePackages(scan.wingetStatus, scan.packages) });
  } catch {
    // Query arguments and connection errors can contain private inventory/credentials.
    console.error("Dashboard database query failed.");
    send(503, { error: "Database unavailable. Check the backend database connection and migrations." });
  }
});
server.requestTimeout = 240000;
server.listen(port, "127.0.0.1", () => console.log(`UpdatePilot read-only API: http://127.0.0.1:${port}`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => {
  server.close(() => { void db.$disconnect().finally(() => process.exit(0)); });
});
