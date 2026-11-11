import { z } from 'zod';

export const updateControlSchema = z.object({ recordId: z.uuid() }).strict();

export const updateRequestSchema = z.object({
  packageId: z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9.+_-]*$/),
  installedVersion: z.string().min(1).max(4096),
  targetVersion: z.string().min(1).max(4096),
  installerType: z.string().min(1).max(128),
  installerSha256: z.string().regex(/^[A-Fa-f0-9]{64}$/),
  scope: z.enum(['user', 'machine']),
  snapshotId: z.uuid(),
  previewJobId: z.uuid(),
}).strict();

export const updateBlockers = [
  'execution_disabled',
  'agent_offline',
  'stale_scan',
  'winget_unavailable',
  'candidate_missing',
  'preview_missing',
  'preview_stale',
  'identity_mismatch',
  'version_missing',
  'installer_identity_missing',
  'selection_unvalidated',
  'scope_unknown',
  'architecture_unknown',
  'signature_unverified',
  'job_active',
] as const;
export type UpdateBlocker = typeof updateBlockers[number];

export type UpdateGateInput = {
  executionEnabled: boolean;
  agentOnline: boolean;
  snapshot: { id: string; scannedAt: Date; wingetStatus: string } | null;
  candidate: { id: string; packageId: string; installedVersion: string | null; source: string | null; isUpdateAvailable: boolean; matchStatus: string } | null;
  previewJob: { id: string; state: string; createdAt: Date; request: unknown; preview: unknown } | null;
  activeJob: boolean;
  now?: number;
};

export type UpdateGateResult =
  | { ok: true; request: z.infer<typeof updateRequestSchema> }
  | { ok: false; blockers: UpdateBlocker[] };

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function evaluateUpdateGate(input: UpdateGateInput): UpdateGateResult {
  const blockers = new Set<UpdateBlocker>();
  const now = input.now ?? Date.now();
  if (!input.executionEnabled) blockers.add('execution_disabled');
  if (!input.agentOnline) blockers.add('agent_offline');
  if (!input.snapshot) blockers.add('stale_scan');
  else {
    if (input.snapshot.wingetStatus !== 'completed') blockers.add('winget_unavailable');
    if (now - input.snapshot.scannedAt.getTime() > 86400000) blockers.add('stale_scan');
  }

  const candidate = input.candidate;
  if (!candidate) blockers.add('candidate_missing');
  else {
    if (candidate.matchStatus !== 'matched' || !candidate.isUpdateAvailable || (candidate.source ?? '').toLowerCase() !== 'winget')
      blockers.add('candidate_missing');
    if (!candidate.installedVersion) blockers.add('version_missing');
  }

  if (input.activeJob) blockers.add('job_active');

  const job = input.previewJob;
  const request = record(job?.request);
  const preview = record(job?.preview);
  if (!job || job.state !== 'completed' || !preview || !input.snapshot || !candidate) {
    blockers.add('preview_missing');
  } else {
    if (job.createdAt.getTime() < input.snapshot.scannedAt.getTime()) blockers.add('preview_stale');
    if (request?.snapshotId !== input.snapshot.id || preview.packageId !== candidate.packageId || preview.installedVersion !== candidate.installedVersion)
      blockers.add('identity_mismatch');
    if (typeof preview.targetVersion !== 'string' || !preview.targetVersion) blockers.add('version_missing');
    if (typeof preview.installerType !== 'string' || !preview.installerType ||
      typeof preview.installerSha256 !== 'string' || !/^[A-Fa-f0-9]{64}$/.test(preview.installerSha256))
      blockers.add('installer_identity_missing');
    if (preview.selectionValidated !== true) blockers.add('selection_unvalidated');
    if (preview.scope !== 'user' && preview.scope !== 'machine') blockers.add('scope_unknown');
    if (typeof preview.architecture !== 'string' || preview.architecture === 'unknown') blockers.add('architecture_unknown');
    if (preview.signatureVerified !== true) blockers.add('signature_unverified');
  }

  if (blockers.size > 0) return { ok: false, blockers: [...blockers] };
  if (!input.snapshot || !candidate || !candidate.installedVersion || !job || !request || !preview)
    return { ok: false, blockers: [...blockers] };

  return {
    ok: true,
    request: updateRequestSchema.parse({
      packageId: candidate.packageId,
      installedVersion: candidate.installedVersion,
      targetVersion: preview.targetVersion,
      installerType: preview.installerType,
      installerSha256: String(preview.installerSha256).toLowerCase(),
      scope: preview.scope,
      snapshotId: input.snapshot.id,
      previewJobId: job.id,
    }),
  };
}
