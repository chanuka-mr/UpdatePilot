import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { ApiError, hashSecret, isOnline } from '../agent/api.js';

const scryptAsync = promisify(scrypt);
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DUMMY_HASH = 'scrypt$00000000000000000000000000000000$' + '00'.repeat(64);

export const signupSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(12, 'Password must be at least 12 characters.').max(128),
  name: z.string().trim().min(1).max(80).optional(),
}).strict();

export const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
}).strict();

export const createDeviceSchema = z.object({
  name: z.string().trim().min(1).max(80),
}).strict();

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hashHex] = parts;
  if (!salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = (await scryptAsync(password, salt, expected.length)) as Buffer;
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function isSignupAllowed(email: string): { allowed: boolean; reason?: string } {
  if (process.env.SIGNUP_ENABLED !== 'true') {
    return { allowed: false, reason: 'Public registration is disabled for this private deployment.' };
  }
  const allowlistRaw = process.env.ALLOWED_SIGNUP_EMAILS?.trim();
  if (allowlistRaw) {
    const allowed = allowlistRaw
      .split(',')
      .map(item => normalizeEmail(item))
      .filter(Boolean);
    if (!allowed.includes(normalizeEmail(email))) {
      return { allowed: false, reason: 'This email address is not on the private test allowlist.' };
    }
  }
  return { allowed: true };
}

export function maxDevicesPerUser(): number {
  const raw = Number(process.env.MAX_DEVICES_PER_USER ?? '1');
  if (!Number.isInteger(raw) || raw < 1) return 1;
  return Math.min(raw, 100);
}

export async function createUserAccount(
  db: PrismaClient,
  input: { email: string; password: string; name?: string; role?: 'user' | 'admin' },
) {
  const email = normalizeEmail(input.email);
  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) throw new ApiError(409, 'An account with this email already exists.');
  const passwordHash = await hashPassword(input.password);
  return db.user.create({
    data: {
      email,
      passwordHash,
      name: input.name?.trim() || null,
      role: input.role ?? 'user',
    },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });
}

export async function authenticateUser(db: PrismaClient, input: { email: string; password: string }) {
  const email = normalizeEmail(input.email);
  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, role: true, passwordHash: true },
  });
  const ok = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw new ApiError(401, 'Invalid email or password.');
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

export async function createUserSession(db: PrismaClient, userId: string) {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.session.create({
    data: { userId, tokenHash: hashSecret(token), expiresAt },
  });
  return { token, expiresAt };
}

export async function resolveUserSession(db: PrismaClient, token: string | undefined) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const now = new Date();
  const session = await db.session.findUnique({
    where: { tokenHash: hashSecret(token) },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      user: { select: { id: true, email: true, name: true, role: true } },
    },
  });
  if (!session || session.revokedAt || session.expiresAt <= now) return null;
  await db.session.updateMany({
    where: { id: session.id, revokedAt: null },
    data: { lastSeenAt: now },
  });
  return { sessionId: session.id, user: session.user };
}

export async function revokeUserSession(db: PrismaClient, token: string | undefined) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return;
  await db.session.updateMany({
    where: { tokenHash: hashSecret(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function resolveOwnedDevice(db: PrismaClient, userId: string, requestedDeviceId?: string | null) {
  if (requestedDeviceId) {
    const id = z.uuid().safeParse(requestedDeviceId);
    if (!id.success) throw new ApiError(400, 'Invalid device identifier.');
    const device = await db.device.findFirst({
      where: { id: id.data, userId },
      select: { id: true, key: true, name: true, createdAt: true },
    });
    if (!device) throw new ApiError(404, 'Device not found.');
    return device;
  }
  return db.device.findFirst({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, key: true, name: true, createdAt: true },
  });
}

export async function listOwnedDevices(db: PrismaClient, userId: string) {
  const devices = await db.device.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      createdAt: true,
      agents: {
        where: { revokedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { lastSeenAt: true, revokedAt: true },
      },
    },
  });
  return devices.map(device => {
    const agent = device.agents[0];
    return {
      id: device.id,
      name: device.name,
      createdAt: device.createdAt,
      paired: !!agent,
      online: agent ? isOnline(agent.lastSeenAt, agent.revokedAt) : false,
      lastSeenAt: agent?.lastSeenAt ?? null,
    };
  });
}

export async function createOwnedDevice(db: PrismaClient, userId: string, name: string) {
  const limit = maxDevicesPerUser();
  return db.$transaction(async tx => {
    const count = await tx.device.count({ where: { userId } });
    if (count >= limit) {
      throw new ApiError(409, `Device limit reached (${limit} device${limit === 1 ? '' : 's'} allowed).`);
    }
    const key = `dev_${randomBytes(12).toString('hex')}`;
    return tx.device.create({
      data: { userId, key, name: name.trim() },
      select: { id: true, key: true, name: true, createdAt: true },
    });
  }, { isolationLevel: 'Serializable' });
}

export async function deleteOwnedDevice(db: PrismaClient, userId: string, deviceId: string) {
  const id = z.uuid().parse(deviceId);
  const existing = await db.device.findFirst({ where: { id, userId }, select: { id: true } });
  if (!existing) throw new ApiError(404, 'Device not found.');
  await db.$transaction(async tx => {
    await tx.agentCredential.updateMany({ where: { deviceId: existing.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.device.delete({ where: { id: existing.id } });
  });
  return { deleted: true };
}
