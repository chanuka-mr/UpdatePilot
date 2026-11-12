import assert from 'node:assert/strict';
import { test } from 'node:test';
import { statusForResult, updateExecutionResultSchema, versionMatches } from '../src/modules/agent/execution.js';

const hash = 'a'.repeat(64);
const result = {
  schemaVersion: 1, status: 'succeeded', profile: 'inno-machine', installerType: 'inno', installerSha256: hash,
  hashMatched: true, architecture: 'x64', architectureCompatible: true,
  signature: { status: 'Valid', signerSubject: 'CN=VideoLAN, O=VideoLAN', signerThumbprint: 'ABC123', timestamped: true },
  exitCode: 0, rebootRequired: false, reason: 'Installer completed successfully.',
  startedAt: '2026-11-12T10:00:00Z', finishedAt: '2026-11-12T10:01:00Z',
};

test('executed update evidence requires a matching hash, valid signature, architecture, and exit code', () => {
  assert.equal(updateExecutionResultSchema.safeParse(result).success, true);
  for (const invalid of [
    { ...result, command: 'winget upgrade' },
    { ...result, profile: 'exe-machine' },
    { ...result, installerSha256: 'bad' },
    { ...result, hashMatched: false },
    { ...result, architectureCompatible: false },
    { ...result, signature: { ...result.signature, status: 'NotTrusted' } },
    { ...result, exitCode: null },
    { ...result, status: 'restart_required' },
  ]) assert.equal(updateExecutionResultSchema.safeParse(invalid).success, false);
  assert.equal(updateExecutionResultSchema.safeParse({ ...result, status: 'restart_required', rebootRequired: true, exitCode: 3010 }).success, true);
});

test('blocked update evidence cannot claim an exit code', () => {
  assert.equal(updateExecutionResultSchema.safeParse({ ...result, status: 'blocked', exitCode: null, hashMatched: false,
    architecture: 'unknown', architectureCompatible: false, signature: { ...result.signature, status: 'Unknown' } }).success, true);
  assert.equal(updateExecutionResultSchema.safeParse({ ...result, status: 'blocked' }).success, false);
});

test('result statuses map to confirmation or terminal execution states', () => {
  assert.equal(statusForResult('succeeded'), 'confirming');
  assert.equal(statusForResult('restart_required'), 'awaiting_restart');
  assert.equal(statusForResult('failed'), 'failed');
  assert.equal(statusForResult('blocked'), 'blocked');
});

test('confirmation accepts exact versions and exact tokens but never a substring', () => {
  assert.equal(versionMatches('9.8.3', '9.8.3'), true);
  assert.equal(versionMatches('ad 9.7.13', '9.7.13'), true);
  assert.equal(versionMatches('9.8.30', '9.8.3'), false);
  assert.equal(versionMatches(null, '9.8.3'), false);
});
