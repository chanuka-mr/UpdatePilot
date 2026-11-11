import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verificationResultSchema, verifyControlSchema } from '../src/modules/agent/verify.js';

const hash = 'a'.repeat(64);
const recordId = '00000000-0000-4000-8000-000000000001';
const verification = {
  schemaVersion: 1, packageId: 'VideoLAN.VLC', targetVersion: '3.0.23', installerType: 'exe',
  installerSha256: hash, architecture: 'x64', architectureCompatible: true, hashMatched: true,
  signature: { status: 'Valid', signerSubject: 'CN=VideoLAN, O=VideoLAN', signerThumbprint: 'ABC123', timestamped: true },
  publisherMatch: 'unverified', verifiedAt: '2026-11-11T10:00:00Z', installationEnabled: false,
};

test('verify control accepts only a record id and rejects commands, package ids, and installer URLs', () => {
  for (const payload of [
    { recordId, command: 'winget download' },
    { recordId, packageId: 'VideoLAN.VLC' },
    { recordId, installerUrl: 'https://example.com/file.exe' },
    { recordId: '; whoami' },
    { recordId: 'C:\\setup.exe' },
  ]) assert.equal(verifyControlSchema.safeParse(payload).success, false);
  assert.equal(verifyControlSchema.safeParse({ recordId }).success, true);
});

test('verification evidence is strict and installation remains disabled', () => {
  assert.equal(verificationResultSchema.safeParse(verification).success, true);
  assert.equal(verificationResultSchema.safeParse({ ...verification, publisherMatch: 'mismatch' }).success, true);
  for (const bad of [
    { ...verification, installationEnabled: true },
    { ...verification, hashMatched: false },
    { ...verification, architecture: 'arm' },
    { ...verification, signature: { ...verification.signature, status: 'Bypassed' } },
    { ...verification, signature: { ...verification.signature, signerSubject: undefined } },
    { ...verification, verifiedAt: 'not-a-date' },
    { ...verification, command: 'winget download' },
  ]) assert.equal(verificationResultSchema.safeParse(bad).success, false);
});
