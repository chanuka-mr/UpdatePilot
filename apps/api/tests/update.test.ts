import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateUpdateGate, updateControlSchema, updateRequestSchema, type UpdateBlocker, type UpdateGateInput } from '../src/modules/agent/update.js';

const snapshotId = '00000000-0000-4000-8000-000000000001';
const previewJobId = '00000000-0000-4000-8000-000000000002';
const candidateId = '00000000-0000-4000-8000-000000000003';
const verificationJobId = '00000000-0000-4000-8000-000000000004';
const hash = 'a'.repeat(64);

const snapshot = { id: snapshotId, scannedAt: new Date('2026-11-02T09:00:00Z'), wingetStatus: 'completed' };
const candidate = { id: candidateId, packageId: 'VideoLAN.VLC', installedVersion: '3.0.20', source: 'winget', isUpdateAvailable: true, matchStatus: 'matched' };
const request = {
  packageId: 'VideoLAN.VLC', installedVersion: '3.0.20', targetVersion: '3.0.23',
  installerType: 'inno', installerSha256: hash, scope: 'machine', profile: 'inno-machine', snapshotId, previewJobId,
};
const preview = {
  schemaVersion: 1, packageId: 'VideoLAN.VLC', source: 'winget', checkedAt: '2026-11-02T10:00:00Z',
  installedVersion: '3.0.20', targetVersion: '3.0.23', publisher: 'VideoLAN', scope: 'machine',
  architecture: 'unknown', installerType: 'inno', installerSha256: hash, selectionValidated: true,
  status: 'incomplete', reason: 'Installer applicability is not verified.', signatureVerified: false,
  installationEnabled: false,
};
const previewJob = {
  id: previewJobId, state: 'completed', createdAt: new Date('2026-11-02T10:00:00Z'),
  request: { packageId: 'VideoLAN.VLC', installedVersion: '3.0.20', snapshotId }, preview,
};
const verification = {
  schemaVersion: 1, packageId: 'VideoLAN.VLC', targetVersion: '3.0.23', installerType: 'inno',
  installerSha256: hash, architecture: 'x64', architectureCompatible: true, hashMatched: true,
  signature: { status: 'Valid', signerSubject: 'CN=VideoLAN, O=VideoLAN', signerThumbprint: 'ABC123', timestamped: true },
  publisherMatch: 'matched', verifiedAt: '2026-11-02T10:15:00Z', installationEnabled: false,
};
const verificationJob = {
  id: verificationJobId, state: 'completed', createdAt: new Date('2026-11-02T10:15:00Z'),
  request, verification,
};
const base = {
  executionEnabled: true, agentOnline: true, snapshot, candidate, previewJob, verificationJob, activeJob: false,
  now: new Date('2026-11-02T10:30:00Z').getTime(),
};
const blockers = (input: UpdateGateInput): UpdateBlocker[] => {
  const result = evaluateUpdateGate(input);
  return result.ok ? [] : result.blockers;
};
const withVerification = (value: unknown): UpdateGateInput => ({ ...base, verificationJob: { ...verificationJob, verification: value } });

test('update control accepts only a record id and rejects commands, package ids, and installer URLs', () => {
  for (const payload of [
    { recordId: snapshotId, command: 'winget upgrade' },
    { recordId: snapshotId, packageId: 'VideoLAN.VLC' },
    { recordId: snapshotId, installerUrl: 'https://example.com/file.exe' },
    { recordId: '; whoami' },
    { recordId: 'C:\\setup.exe' },
  ]) assert.equal(updateControlSchema.safeParse(payload).success, false);
  assert.equal(updateControlSchema.safeParse({ recordId: snapshotId }).success, true);
});

test('update gate builds an exact version-pinned request from preview and verification evidence', () => {
  const result = evaluateUpdateGate(base);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.request, request);
});

test('update requests reject extra properties and invalid installer evidence', () => {
  assert.equal(updateRequestSchema.safeParse(request).success, true);
  for (const bad of [
    { ...request, command: 'winget upgrade' },
    { ...request, installerUrl: 'https://example.com/file.exe' },
    { ...request, packageId: '--all' },
    { ...request, packageId: '; whoami' },
    { ...request, installerSha256: 'not-a-hash' },
    { ...request, scope: 'unknown' },
    { ...request, profile: 'exe-machine' },
  ]) assert.equal(updateRequestSchema.safeParse(bad).success, false);
  const { profile: _profile, ...withoutProfile } = request;
  assert.equal(updateRequestSchema.safeParse(withoutProfile).success, false);
});

test('update gate blocks installers without an allowlisted execution profile', () => {
  assert.ok(blockers({ ...base, previewJob: { ...previewJob, preview: { ...preview, installerType: 'exe' } } }).includes('execution_profile_unavailable'));
});

test('update execution stays disabled until the server flag is enabled', () => {
  assert.deepEqual(blockers({ ...base, executionEnabled: false }), ['execution_disabled']);
});

test('update gate requires verification evidence', () => {
  assert.deepEqual(blockers({ ...base, verificationJob: null }), ['verification_missing']);
});

test('update gate blocks unknown scope, unknown architecture, and unverified signature', () => {
  const cases: Array<[string, UpdateGateInput]> = [
    ['scope_unknown', { ...base, previewJob: { ...previewJob, preview: { ...preview, scope: 'unknown' } } }],
    ['architecture_unknown', withVerification({ ...verification, architecture: 'unknown' })],
    ['signature_unverified', withVerification({ ...verification, signature: { ...verification.signature, status: 'NotTrusted' } })],
  ];
  for (const [blocker, input] of cases) assert.ok(blockers(input).includes(blocker as UpdateBlocker));
});

test('update gate blocks stale scans, stale previews, stale verification, identity drift, and unvalidated selections', () => {
  assert.ok(blockers({ ...base, snapshot: { ...snapshot, scannedAt: new Date('2026-10-30T09:00:00Z') } }).includes('stale_scan'));
  assert.ok(blockers({ ...base, previewJob: { ...previewJob, createdAt: new Date('2026-11-02T08:00:00Z') } }).includes('preview_stale'));
  assert.ok(blockers({ ...base, verificationJob: { ...verificationJob, createdAt: new Date('2026-11-02T09:30:00Z') } }).includes('verification_stale'));
  assert.ok(blockers({ ...base, candidate: { ...candidate, installedVersion: '3.0.19' } }).includes('identity_mismatch'));
  assert.ok(blockers({ ...base, previewJob: { ...previewJob, preview: { ...preview, selectionValidated: false } } }).includes('selection_unvalidated'));
});

test('update gate binds verification to the preview, snapshot, and installer identity', () => {
  assert.ok(blockers({ ...base, verificationJob: { ...verificationJob, request: { ...request, previewJobId: '00000000-0000-4000-8000-000000000099' } } }).includes('verification_mismatch'));
  assert.ok(blockers(withVerification({ ...verification, packageId: 'Other.Package' })).includes('verification_mismatch'));
  assert.ok(blockers(withVerification({ ...verification, installerSha256: 'b'.repeat(64) })).includes('verification_mismatch'));
  assert.ok(blockers(withVerification({ ...verification, hashMatched: false })).includes('hash_mismatch'));
  assert.ok(blockers(withVerification({ ...verification, architectureCompatible: false })).includes('architecture_incompatible'));
});

test('publisher mismatch is recorded as evidence but does not hard-block this milestone', () => {
  assert.deepEqual(blockers(withVerification({ ...verification, publisherMatch: 'mismatch' })), []);
});

test('update gate blocks missing installer metadata and an active job', () => {
  assert.ok(blockers({ ...base, previewJob: { ...previewJob, preview: { ...preview, installerType: null } } }).includes('installer_identity_missing'));
  assert.ok(blockers({ ...base, previewJob: { ...previewJob, preview: { ...preview, installerSha256: null } } }).includes('installer_identity_missing'));
  assert.ok(blockers({ ...base, activeJob: true }).includes('job_active'));
  assert.ok(blockers({ ...base, agentOnline: false }).includes('agent_offline'));
});
