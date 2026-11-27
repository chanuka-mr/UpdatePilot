import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { createDatabase } from './config/database.js';
import { summarizePackages } from './modules/dashboard/dashboard.js';
import { readCatalog } from './modules/catalog/catalog.js';
import { readApplicationDetail, readUpdateDetail } from './modules/catalog/detail.js';
import { exportCatalog } from './modules/catalog/export.js';
import { readHistory } from './modules/history/history.js';
import { agentRequest, control, ApiError, body, isOnline } from './modules/agent/api.js';
import { readExecution, readExecutions } from './modules/executions/executions.js';
import { readSecurity } from './modules/security/security.js';
import {
  authenticateUser,
  createDeviceSchema,
  createOwnedDevice,
  createUserAccount,
  createUserSession,
  deleteOwnedDevice,
  isSignupAllowed,
  listOwnedDevices,
  loginSchema,
  resolveOwnedDevice,
  resolveUserSession,
  revokeUserSession,
  signupSchema,
} from './modules/auth/auth.js';
import { writeAuditLog } from './modules/security/audit.js';
import {
  agentPollLimiter,
  authLimiter,
  clientIp,
  pairLimiter,
  userApiLimiter,
} from './modules/security/rate-limit.js';

const db = createDatabase();
const token = process.env.BACKEND_API_TOKEN;
if (!token || token.length < 32) {
  throw new Error('Set BACKEND_API_TOKEN to a random secret of at least 32 characters.');
}
const port = Number(process.env.PORT || 4010);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('Invalid backend port.');
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status);
  res.end(JSON.stringify(payload));
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function checkRateLimit(
  res: ServerResponse,
  limiter: typeof authLimiter,
  key: string,
): boolean {
  const result = limiter.check(key);
  if (!result.allowed) {
    res.setHeader('Retry-After', String(result.retryAfterSeconds));
    sendJson(res, 429, { error: 'Too many requests. Please try again later.' });
    return false;
  }
  return true;
}

function handleApiError(res: ServerResponse, error: unknown, fallbackMessage: string) {
  if (error instanceof ApiError) {
    sendJson(res, error.status, {
      error: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
    return;
  }
  if (
    error instanceof Error &&
    (error.name === 'ZodError' ||
      error.message === 'Duplicate query parameter' ||
      error.message.startsWith('Registry entries'))
  ) {
    sendJson(res, 400, { error: 'Invalid request parameters.' });
    return;
  }
  sendJson(res, 503, { error: fallbackMessage });
}

const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');

  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const ip = clientIp(req);
  const userAgent = headerValue(req, 'user-agent');

  if (url.pathname === '/healthz' || url.pathname === '/api/v1/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  // Agent endpoints authenticate via pairing code or device bearer token.
  if (url.pathname.startsWith('/api/v1/agent/')) {
    const action = url.pathname.slice('/api/v1/agent/'.length);
    const limiter = action === 'pair' ? pairLimiter : agentPollLimiter;
    if (!checkRateLimit(res, limiter, `agent:${action}:${ip}`)) {
      await writeAuditLog(db, { action: 'rate_limited', ip, userAgent, metadata: { scope: 'agent', action } });
      return;
    }
    try {
      const result = await agentRequest(db, req, action);
      if (action === 'pair') {
        await writeAuditLog(db, { action: 'agent.pair', ip, userAgent });
      }
      sendJson(res, 200, result);
    } catch (error) {
      if (action === 'pair') {
        await writeAuditLog(db, { action: 'agent.pair_failed', ip, userAgent });
      }
      handleApiError(res, error, 'Agent request could not be processed.');
    }
    return;
  }

  // Service-to-service authentication from the Next.js server.
  const supplied = Buffer.from(req.headers.authorization || '');
  const expected = Buffer.from(`Bearer ${token}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  // Auth endpoints (called by Next.js server on behalf of the browser).
  if (url.pathname.startsWith('/api/v1/auth/')) {
    const action = url.pathname.slice('/api/v1/auth/'.length);
    if (action === 'signup' && req.method === 'POST') {
      if (!checkRateLimit(res, authLimiter, `auth:signup:${ip}`)) return;
      try {
        const parsed = signupSchema.parse(await body(req));
        const gate = isSignupAllowed(parsed.email);
        if (!gate.allowed) {
          await writeAuditLog(db, { action: 'auth.signup_blocked', ip, userAgent });
          throw new ApiError(403, gate.reason || 'Registration is disabled.');
        }
        const user = await createUserAccount(db, parsed);
        const session = await createUserSession(db, user.id);
        await writeAuditLog(db, { userId: user.id, action: 'auth.signup', ip, userAgent });
        sendJson(res, 201, { user, sessionToken: session.token, expiresAt: session.expiresAt });
      } catch (error) {
        handleApiError(res, error, 'Unable to create account.');
      }
      return;
    }

    if (action === 'login' && req.method === 'POST') {
      if (!checkRateLimit(res, authLimiter, `auth:login:${ip}`)) return;
      try {
        const parsed = loginSchema.parse(await body(req));
        const user = await authenticateUser(db, parsed);
        const session = await createUserSession(db, user.id);
        await writeAuditLog(db, { userId: user.id, action: 'auth.login', ip, userAgent });
        sendJson(res, 200, { user, sessionToken: session.token, expiresAt: session.expiresAt });
      } catch (error) {
        await writeAuditLog(db, { action: 'auth.login_failed', ip, userAgent });
        handleApiError(res, error, 'Sign-in failed.');
      }
      return;
    }

    if (action === 'logout' && req.method === 'POST') {
      const sessionToken = headerValue(req, 'x-session-token');
      const existing = await resolveUserSession(db, sessionToken);
      await revokeUserSession(db, sessionToken);
      if (existing) {
        await writeAuditLog(db, { userId: existing.user.id, action: 'auth.logout', ip, userAgent });
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    if (action === 'me' && req.method === 'GET') {
      const session = await resolveUserSession(db, headerValue(req, 'x-session-token'));
      if (!session) {
        sendJson(res, 401, { error: 'Authentication required.' });
        return;
      }
      const devices = await listOwnedDevices(db, session.user.id);
      sendJson(res, 200, { user: session.user, devices });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  // All remaining routes require an authenticated user session.
  const session = await resolveUserSession(db, headerValue(req, 'x-session-token'));
  if (!session) {
    sendJson(res, 401, { error: 'Authentication required.' });
    return;
  }

  if (!checkRateLimit(res, userApiLimiter, `user:${session.user.id}:${ip}`)) {
    await writeAuditLog(db, { userId: session.user.id, action: 'rate_limited', ip, userAgent });
    return;
  }

  // Device management endpoints (owned by session.user.id).
  if (url.pathname === '/api/v1/devices') {
    try {
      if (req.method === 'GET') {
        sendJson(res, 200, { devices: await listOwnedDevices(db, session.user.id) });
        return;
      }
      if (req.method === 'POST') {
        const parsed = createDeviceSchema.parse(await body(req));
        const device = await createOwnedDevice(db, session.user.id, parsed.name);
        await writeAuditLog(db, {
          userId: session.user.id,
          deviceId: device.id,
          action: 'device.create',
          ip,
          userAgent,
        });
        sendJson(res, 201, { device: { id: device.id, name: device.name, createdAt: device.createdAt } });
        return;
      }
      sendJson(res, 405, { error: 'Method not allowed' });
    } catch (error) {
      handleApiError(res, error, 'Device operation failed.');
    }
    return;
  }

  const deviceDeleteMatch = url.pathname.match(
    /^\/api\/v1\/devices\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
  );
  if (deviceDeleteMatch && req.method === 'DELETE') {
    try {
      const result = await deleteOwnedDevice(db, session.user.id, deviceDeleteMatch[1]);
      await writeAuditLog(db, {
        userId: session.user.id,
        deviceId: deviceDeleteMatch[1],
        action: 'device.delete',
        ip,
        userAgent,
      });
      sendJson(res, 200, result);
    } catch (error) {
      handleApiError(res, error, 'Could not delete device.');
    }
    return;
  }

  // Resolve the user's owned device (enforces ownership on every device-scoped route).
  const requestedDeviceId =
    headerValue(req, 'x-device-id') || url.searchParams.get('deviceId') || undefined;
  let ownedDevice: Awaited<ReturnType<typeof resolveOwnedDevice>> = null;
  try {
    ownedDevice = await resolveOwnedDevice(db, session.user.id, requestedDeviceId);
  } catch (error) {
    handleApiError(res, error, 'Device lookup failed.');
    return;
  }

  // Strip deviceId from searchParams before passing to strict Zod query parsers.
  const cleanParams = new URLSearchParams(url.searchParams);
  cleanParams.delete('deviceId');

  if (url.pathname.startsWith('/api/v1/control/')) {
    const action = url.pathname.slice('/api/v1/control/'.length);
    try {
      if (!ownedDevice && action === 'pairing' && req.method === 'POST') {
        ownedDevice = await createOwnedDevice(db, session.user.id, 'My Windows PC');
        await writeAuditLog(db, {
          userId: session.user.id,
          deviceId: ownedDevice.id,
          action: 'device.create',
          ip,
          userAgent,
        });
      }
      if (!ownedDevice && action === 'status' && req.method === 'GET') {
        sendJson(res, 200, {
          paired: false,
          online: false,
          lastSeenAt: null,
          job: null,
          activeJob: false,
          executionEnabled: process.env.UPDATE_EXECUTION_ENABLED === 'true',
          deviceName: 'No device enrolled',
          deviceId: null,
        });
        return;
      }
      if (!ownedDevice) {
        throw new ApiError(409, 'Enroll a device and generate a pairing code first.');
      }

      const payload = [
        '/api/v1/control/preview',
        '/api/v1/control/verify',
        '/api/v1/control/update',
        '/api/v1/control/cancel',
      ].includes(url.pathname)
        ? await body(req)
        : undefined;

      const result = await control(db, ownedDevice.key, action, req.method || '', payload, {
        userId: session.user.id,
      });

      if (req.method === 'POST') {
        await writeAuditLog(db, {
          userId: session.user.id,
          deviceId: ownedDevice.id,
          action: `control.${action}`,
          ip,
          userAgent,
        });
      }
      sendJson(res, 200, result);
    } catch (error) {
      handleApiError(res, error, 'Control request failed. Retry after checking the database migration.');
    }
    return;
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    sendJson(res, 405, { error: 'Read-only API' });
    return;
  }

  if (!ownedDevice) {
    if (url.pathname === '/api/v1/dashboard') {
      sendJson(res, 200, { state: 'empty', agentStatus: 'unpaired', lastSeenAt: null });
      return;
    }
    if (['/api/v1/applications', '/api/v1/updates', '/api/v1/history', '/api/v1/executions'].includes(url.pathname)) {
      sendJson(res, 200, { state: 'empty', rows: [], total: 0, page: 1, pageSize: 10 });
      return;
    }
    if (url.pathname === '/api/v1/security') {
      sendJson(res, 200, { state: 'empty', findings: [] });
      return;
    }
    sendJson(res, 404, { error: 'No device enrolled.' });
    return;
  }

  const deviceKey = ownedDevice.key;

  const exportMatch = url.pathname.match(/^\/api\/v1\/export\/(applications|updates)$/);
  if (exportMatch) {
    try {
      const updates = exportMatch[1] === 'updates';
      const result = await exportCatalog(db, deviceKey, cleanParams, updates);
      if (result.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="updatepilot-${exportMatch[1]}.csv"`);
        res.writeHead(200);
        res.end(result.body);
      } else {
        sendJson(res, 200, JSON.parse(result.body));
      }
    } catch (error) {
      handleApiError(res, error, 'Export unavailable. Check the filters, database, and migrations.');
    }
    return;
  }

  const detailMatch = url.pathname.match(
    /^\/api\/v1\/(applications|updates)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
  );
  if (detailMatch) {
    try {
      const snapshotId = cleanParams.get('snapshotId') ?? undefined;
      sendJson(
        res,
        200,
        detailMatch[1] === 'applications'
          ? await readApplicationDetail(db, deviceKey, detailMatch[2], snapshotId)
          : await readUpdateDetail(db, deviceKey, detailMatch[2], snapshotId),
      );
    } catch (error) {
      handleApiError(res, error, 'Stored record unavailable. Check the database and migrations.');
    }
    return;
  }

  if (url.pathname === '/api/v1/security') {
    try {
      sendJson(res, 200, await readSecurity(db, deviceKey));
    } catch (error) {
      handleApiError(res, error, 'Security insights unavailable. Check the database, migration, and NVD connectivity.');
    }
    return;
  }

  if (url.pathname === '/api/v1/executions' || url.pathname.startsWith('/api/v1/executions/')) {
    try {
      const id = url.pathname.slice('/api/v1/executions/'.length);
      sendJson(
        res,
        200,
        url.pathname === '/api/v1/executions'
          ? await readExecutions(db, deviceKey, cleanParams)
          : await readExecution(db, deviceKey, id),
      );
    } catch (error) {
      handleApiError(res, error, 'Update history unavailable. Check the database and migrations.');
    }
    return;
  }

  if (!['/api/v1/dashboard', '/api/v1/applications', '/api/v1/updates', '/api/v1/history'].includes(url.pathname)) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  if (url.pathname !== '/api/v1/dashboard') {
    try {
      sendJson(
        res,
        200,
        url.pathname === '/api/v1/history'
          ? await readHistory(db, deviceKey, cleanParams)
          : await readCatalog(db, deviceKey, cleanParams, url.pathname === '/api/v1/updates'),
      );
    } catch (error) {
      handleApiError(res, error, 'Inventory database unavailable. Check the database connection and migrations.');
    }
    return;
  }

  try {
    const result = await db.$transaction(
      async tx => {
        const agent = await tx.agentCredential.findFirst({
          where: { device: { key: deviceKey }, revokedAt: null },
          orderBy: { createdAt: 'desc' },
          select: { lastSeenAt: true, revokedAt: true },
        });
        const scan = await tx.inventorySnapshot.findFirst({
          where: { device: { key: deviceKey } },
          orderBy: { scannedAt: 'desc' },
          select: {
            id: true,
            scannedAt: true,
            importedAt: true,
            wingetStatus: true,
            warnings: true,
            device: { select: { name: true } },
            _count: { select: { applications: true } },
            packages: {
              select: {
                id: true,
                name: true,
                packageId: true,
                installedVersion: true,
                source: true,
                isUpdateAvailable: true,
                matchStatus: true,
              },
            },
          },
        });
        return { scan, agent };
      },
      { isolationLevel: 'RepeatableRead' },
    );

    const { scan, agent } = result;
    const agentStatus = !agent
      ? 'unpaired'
      : isOnline(agent.lastSeenAt, agent.revokedAt)
        ? 'online'
        : 'offline';
    const lastSeenAt = agent?.lastSeenAt ?? null;

    if (!scan) {
      sendJson(res, 200, {
        state: 'empty',
        deviceId: ownedDevice.id,
        deviceName: ownedDevice.name,
        agentStatus,
        lastSeenAt,
      });
      return;
    }

    sendJson(res, 200, {
      state: 'ready',
      deviceId: ownedDevice.id,
      deviceName: scan.device.name,
      snapshotId: scan.id,
      scannedAt: scan.scannedAt,
      importedAt: scan.importedAt,
      agentStatus,
      lastSeenAt,
      stale: Date.now() - scan.scannedAt.getTime() > 24 * 60 * 60 * 1000,
      wingetStatus: scan.wingetStatus,
      warningCount: Array.isArray(scan.warnings) ? scan.warnings.length : 0,
      registryEntries: scan._count.applications,
      ...summarizePackages(scan.wingetStatus, scan.packages),
    });
  } catch {
    console.error('Dashboard database query failed.');
    sendJson(res, 503, { error: 'Database unavailable. Check the backend database connection and migrations.' });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`UpdatePilot API listening on port ${port}`);
});
