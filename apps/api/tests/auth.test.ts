import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hashPassword,
  isSignupAllowed,
  maxDevicesPerUser,
  normalizeEmail,
  verifyPassword,
} from '../src/modules/auth/auth.js';
import { RateLimiter } from '../src/modules/security/rate-limit.js';

test('scrypt password hashing verifies matching password and rejects wrong password', async () => {
  const hash = await hashPassword('CorrectHorseBatteryStaple123!');
  assert.ok(hash.startsWith('scrypt$'));
  assert.equal(await verifyPassword('CorrectHorseBatteryStaple123!', hash), true);
  assert.equal(await verifyPassword('WrongPassword123!', hash), false);
});

test('email normalization trims and lowercases', () => {
  assert.equal(normalizeEmail('  Owner@Example.COM  '), 'owner@example.com');
});

test('signup gate respects SIGNUP_ENABLED and ALLOWED_SIGNUP_EMAILS', () => {
  const prevEnabled = process.env.SIGNUP_ENABLED;
  const prevAllowlist = process.env.ALLOWED_SIGNUP_EMAILS;
  try {
    process.env.SIGNUP_ENABLED = 'false';
    delete process.env.ALLOWED_SIGNUP_EMAILS;
    assert.equal(isSignupAllowed('owner@example.com').allowed, false);

    process.env.SIGNUP_ENABLED = 'true';
    process.env.ALLOWED_SIGNUP_EMAILS = 'owner@example.com, tester@example.com';
    assert.equal(isSignupAllowed('OWNER@example.com').allowed, true);
    assert.equal(isSignupAllowed('stranger@example.com').allowed, false);
  } finally {
    if (prevEnabled === undefined) delete process.env.SIGNUP_ENABLED;
    else process.env.SIGNUP_ENABLED = prevEnabled;
    if (prevAllowlist === undefined) delete process.env.ALLOWED_SIGNUP_EMAILS;
    else process.env.ALLOWED_SIGNUP_EMAILS = prevAllowlist;
  }
});

test('maxDevicesPerUser defaults to 1 for Milestone 1', () => {
  const prev = process.env.MAX_DEVICES_PER_USER;
  try {
    delete process.env.MAX_DEVICES_PER_USER;
    assert.equal(maxDevicesPerUser(), 1);
    process.env.MAX_DEVICES_PER_USER = '5';
    assert.equal(maxDevicesPerUser(), 5);
  } finally {
    if (prev === undefined) delete process.env.MAX_DEVICES_PER_USER;
    else process.env.MAX_DEVICES_PER_USER = prev;
  }
});

test('rate limiter blocks requests above window threshold and resets after window', () => {
  const limiter = new RateLimiter(2, 1000);
  assert.equal(limiter.check('ip:1', 100).allowed, true);
  assert.equal(limiter.check('ip:1', 200).allowed, true);
  const blocked = limiter.check('ip:1', 300);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);
  assert.equal(limiter.check('ip:1', 1200).allowed, true);
});
