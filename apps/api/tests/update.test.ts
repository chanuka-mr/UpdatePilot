import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateUpdateGate, updateControlSchema, updateRequestSchema, type UpdateBlocker, type UpdateGateInput } from '../src/modules/agent/update.js';

const snapshotId = '00000000-0000-4000-8000-000000000001';
const previewJobId = '00000000-0000-4000-8000-000000000002';
const candidateId = '00000000-0000-4000-8000-000000000003';
const hash = 'a'.repeat(64);

const snapshot = { id: snapshotId, scannedAt: new Date('2026-11-02T09:00:00Z'), wingetStatus: 'completed' };
const candidate = { id: candidateId, packageId: 'VideoLAN.VLC', installedVersion: '3.0.20', source: 'winget', isUpdateAvailable: true, matchStatus: 'matched' };
const preview = {
  schemaVersion: 1, packageId: 'VideoLAN.VLC', source: 'winget', checkedAt: '2026-11-02T10:00:00Z',
  installedVersion: '3.0.20', targetVersion: '3.0.23', publisher: 'VideoLAN', scope: 'machine',
  architecture: 'x64', installerType: 'exe', installerSha256: hash, selectionValidated: true,
  status: 'incomplete', reason: 'Installer applicability is not verified.', signatureVerified: true,
  installationEnabled: false,
};
const previewJob = {
  id: previewJobId, state: 'completed', createdAt: new Date('2026-11-02T10:00:00Z'),
  request: { packageId: 'VideoLAN.VLC', installedVersion: '3.0.20', snapshotId }, preview,
};
const base = {
  executionEnabled: true, agentOnline: true, snapshot, candidate, previewJob, activeJob: false,
  now: new Date('2026-11-02T10:30:00Z').getTime(),
};
const blockers = (input: UpdateGateInput): UpdateBlocker[] => {
  const result = evaluateUpdateGate(input);
  return result.ok ? [] : result.blockers;
};

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

test('update gate builds an exact version-pinned request from verified preview data', () => {
  const result = evaluateUpdateGate(base);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.request, {
    packageId: 'VideoLAN.VLC', installedVersion: '3.0.20', targetVersion: '3.0.23',
    installerType: 'exe', installerSha256: hash, scope: 'machine',
    snapshotId, previewJobId,
  });
});

test('update requests reject extra properties and invalid installer evidence', () => {
  const request = {
    packageId: 'VideoLAN.VLC', installedVersion: '3.0.20', targetVersion: '3.0.23',
    installerType: 'exe', installerSha256: hash, scope: 'machine', snapshotId, previewJobId,
  };
  assert.equal(updateRequestSchema.safeParse(request).success, true);
  for (const bad of [
    { ...request, command: 'winget upgrade' },
    { ...request, installerUrl: 'https://example.com/file.exe' },
    { ...request, packageId: '--all' },
    { ...request, packageId: '; whoami' },
    { ...request, installerSha256: 'not-a-hash' },
    { ...request, scope: 'unknown' },
  ]) assert.equal(updateRequestSchema.safeParse(bad).success, false);
});

test('update execution stays disabled until the server flag is enabled', () => {
  assert.deepEqual(blockers({ ...base, executionEnabled: false }), ['execution_disabled']);
});

test('update gate blocks unknown scope, unknown architecture, and unverified signature', () => {
  const cases: Array<[string, unknown]> = [
    ['scope_unknown', { ...preview, scope: 'unknown' }],
    ['architecture_unknown', { ...preview, architecture: 'unknown' }],
    ['signature_unverified', { ...preview, signatureVerified: false }],
  ];
  for (const [blocker, storedPreview] of cases) {
    assert.ok(blockers({ ...base, previewJob: { ...previewJob, preview: storedPreview } }).includes(blocker as UpdateBlocker));
  }
});

test('update gate blocks stale scans, stale previews, identity drift, and unvalidated selections', () => {
  assert.ok(blockers({ ...base, snapshot: { ...snapshot, scannedAt: new Date('2026-10-30T09:00:00Z') } }).includes('stale_scan'));
  assert.ok(blockers({ ...base, previewJob: { ...previewJob, createdAt: new Date('2026-11-02T08:00:00Z') } }).includes('preview_stale'));
  assert.ok(blockers({ ...base, candidate: { ...candidate, installedVersion: '3.0.19' } }).includes('identity_mismatch'));
  assert.ok(blockers({ ...base, previewJob: { ...previewJob, preview: { ...preview, selectionValidated: false } } }).includes('selection_unvalidated'));
});

test('update gate blocks missing installer metadata and an active job', () => {
  assert.ok(blockers({ ...base, previewJob: { ...previewJob, preview: { ...preview, installerType: null } } }).includes('installer_identity_missing'));
  assert.ok(blockers({ ...base, previewJob: { ...previewJob, preview: { ...preview, installerSha256: null } } }).includes('installer_identity_missing'));
  assert.ok(blockers({ ...base, activeJob: true }).includes('job_active'));
  assert.ok(blockers({ ...base, agentOnline: false }).includes('agent_offline'));
});
